import type { Octokit } from "@octokit/core"
import { buildSolvePrompt, buildSystemPrompt, formatOutput, runClaude } from "./claude"
import { runCommands } from "./commands"
import { isolateDockerPorts } from "./docker"
import {
  configureAuth,
  createWorktree,
  fetch,
  getCurrentSha,
  hasNewCommits,
  push,
  removeWorktree,
} from "./git"
import type { GitHub } from "./github"
import { addLabel, createPr, fetchParent, fetchSubIssues, postComment, removeLabel } from "./github"
import type { DoobeeConfig, Issue, SubIssueGroup } from "./types"

export interface SolveContext {
  issue: Issue
  installationId: number
  github: GitHub
  config: DoobeeConfig
  repoDir: string
  extraContext?: string
}

async function markStuck(octokit: Octokit, issue: Issue, reason: string): Promise<void> {
  await addLabel(octokit, {
    owner: issue.repoOwner,
    repo: issue.repoName,
    issueNumber: issue.number,
    label: "doobee:stuck",
  })
  await postComment(octokit, {
    owner: issue.repoOwner,
    repo: issue.repoName,
    issueNumber: issue.number,
    body: reason,
  })
}

export async function solve(ctx: SolveContext): Promise<void> {
  const { issue, installationId, github, config, repoDir, extraContext } = ctx
  const octokit = await github.api(installationId)

  // Add in-progress label and remove solve trigger
  await addLabel(octokit, {
    owner: issue.repoOwner,
    repo: issue.repoName,
    issueNumber: issue.number,
    label: "doobee:in-progress",
  })
  await removeLabel(octokit, {
    owner: issue.repoOwner,
    repo: issue.repoName,
    issueNumber: issue.number,
    label: "doobee:solve",
  })

  // 1. Configure auth and fetch origin
  const token = await github.token(installationId)
  await configureAuth(repoDir, token)
  const fetchResult = await fetch(repoDir)
  if (!fetchResult.ok) {
    console.error(`[solve] Fetch failed: ${fetchResult.error}`)
    await markStuck(octokit, issue, `Failed to fetch origin: ${fetchResult.error}`)
    await removeLabel(octokit, {
      owner: issue.repoOwner,
      repo: issue.repoName,
      issueNumber: issue.number,
      label: "doobee:in-progress",
    })
    return
  }

  // 2. Build issue group
  const parent = await fetchParent(octokit, {
    owner: issue.repoOwner,
    repo: issue.repoName,
    issueNumber: issue.number,
  })

  let group: SubIssueGroup
  if (parent) {
    const subIssues = await fetchSubIssues(octokit, {
      owner: parent.repoOwner,
      repo: parent.repoName,
      issueNumber: parent.number,
    })
    group = {
      parent,
      issues: subIssues.length > 0 ? subIssues : [issue],
      branch: `doobee/${parent.number}`,
    }
  } else {
    group = {
      parent: null,
      issues: [issue],
      branch: `doobee/${issue.number}`,
    }
  }

  // 3. Create worktree
  const wtResult = await createWorktree(repoDir, group.branch, config.baseBranch)
  if (!wtResult.ok) {
    console.error(`[solve] Failed to create worktree: ${wtResult.error}`)
    await markStuck(octokit, issue, `Failed to create worktree: ${wtResult.error}`)
    await removeLabel(octokit, {
      owner: issue.repoOwner,
      repo: issue.repoName,
      issueNumber: issue.number,
      label: "doobee:in-progress",
    })
    return
  }
  const wtPath = wtResult.value

  let started = false
  const dockerEnv = await isolateDockerPorts(wtPath)
  try {
    // 4. Run setup and start commands
    await runCommands(config.commands.setup, wtPath, dockerEnv)
    await runCommands(config.commands.start, wtPath, dockerEnv)
    started = true

    // 5. Process each issue
    const solved: Issue[] = []
    let stuck = false

    for (const current of group.issues) {
      const sha = await getCurrentSha(wtPath)
      const prompt = buildSolvePrompt(current, config, extraContext)
      const systemPrompt = buildSystemPrompt(config, dockerEnv)

      console.log(`[solve] Running Claude for issue #${current.number}`)
      const result = await runClaude({
        prompt,
        systemPrompt,
        cwd: wtPath,
        model: config.model,
        timeout: config.timeout,
        env: dockerEnv,
      })

      if (result.status === "solved") {
        if (await hasNewCommits(wtPath, sha)) {
          solved.push(current)
        }
      } else if (result.status === "complete") {
        // No changes needed
      } else {
        // stuck or crashed
        const reason =
          result.status === "stuck"
            ? `Claude got stuck on this issue.${formatOutput(result.output)}`
            : `Claude crashed while working on this issue.${formatOutput(result.output)}`
        await markStuck(octokit, current, reason)

        // Mark remaining issues as blocked
        const remaining = group.issues.slice(group.issues.indexOf(current) + 1)
        for (const blocked of remaining) {
          await markStuck(octokit, blocked, `Blocked by #${current.number} which is stuck.`)
        }

        stuck = true
        break
      }
    }

    // 6. Push and create PR if there are commits
    if (solved.length > 0) {
      // Refresh token — Claude session may have taken a while
      const pushToken = await github.token(installationId)
      await configureAuth(repoDir, pushToken)
      const pushResult = await push(wtPath, group.branch)
      if (pushResult.ok) {
        const closes = solved.map((i) => `Closes #${i.number}`).join("\n")
        const parentClose =
          group.parent && !stuck && solved.length === group.issues.length
            ? `\nCloses #${group.parent.number}`
            : ""
        const titleSuffix = stuck ? " (partial)" : ""
        const prTitle = group.parent
          ? `${group.parent.title}${titleSuffix}`
          : `${issue.title}${titleSuffix}`

        const prResult = await createPr(octokit, {
          owner: issue.repoOwner,
          repo: issue.repoName,
          title: prTitle,
          body: `${closes}${parentClose}`,
          head: group.branch,
          base: config.baseBranch,
        })

        if (!prResult.ok) {
          console.error(`[solve] Failed to create PR: ${prResult.error}`)
        }
      } else {
        console.error(`[solve] Push failed: ${pushResult.error}`)
        await postComment(octokit, {
          owner: issue.repoOwner,
          repo: issue.repoName,
          issueNumber: issue.number,
          body: `Push failed after Claude committed changes.\n\n\`\`\`\n${pushResult.error}\n\`\`\``,
        })
        await addLabel(octokit, {
          owner: issue.repoOwner,
          repo: issue.repoName,
          issueNumber: issue.number,
          label: "doobee:stuck",
        })
      }
    }
  } finally {
    // 7. Remove in-progress label
    await removeLabel(octokit, {
      owner: issue.repoOwner,
      repo: issue.repoName,
      issueNumber: issue.number,
      label: "doobee:in-progress",
    })
    // 8. Run stop commands (only if start succeeded)
    if (started) {
      await runCommands(config.commands.stop, wtPath, dockerEnv)
    }
    // 9. Clean up worktree
    await removeWorktree(repoDir, group.branch)
  }
}
