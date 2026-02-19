import type { Octokit } from "@octokit/core"
import { buildSolvePrompt, buildSystemPrompt, runClaude } from "./claude"
import { runCommands } from "./commands"
import { createWorktree, fetch, getCurrentSha, hasNewCommits, push, removeWorktree } from "./git"
import type { GitHub } from "./github"
import {
  addLabel,
  createPr,
  fetchParent,
  fetchSubIssues,
  postComment,
  unassignIssue,
} from "./github"
import type { DoobeeConfig, Issue, SubIssueGroup } from "./types"

export interface SolveContext {
  issue: Issue
  installationId: number
  github: GitHub
  config: DoobeeConfig
  repoDir: string
}

async function markStuck(
  octokit: Octokit,
  issue: Issue,
  reason: string,
  botLogin: string,
): Promise<void> {
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
  await unassignIssue(octokit, {
    owner: issue.repoOwner,
    repo: issue.repoName,
    issueNumber: issue.number,
    assignees: [botLogin],
  })
}

export async function solve(ctx: SolveContext): Promise<void> {
  const { issue, installationId, github, config, repoDir } = ctx
  const octokit = await github.api(installationId)
  const botLogin = process.env.BOT_NAME ?? "doobeebot[bot]"

  // 1. Fetch origin
  const fetchResult = await fetch(repoDir)
  if (!fetchResult.ok) {
    console.error(`[solve] Fetch failed: ${fetchResult.error}`)
    await markStuck(octokit, issue, `Failed to fetch origin: ${fetchResult.error}`, botLogin)
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
    await markStuck(octokit, issue, `Failed to create worktree: ${wtResult.error}`, botLogin)
    return
  }
  const wtPath = wtResult.value

  let started = false
  try {
    // 4. Run setup and start commands
    await runCommands(config.commands.setup, wtPath)
    await runCommands(config.commands.start, wtPath)
    started = true

    // 5. Process each issue
    const solved: Issue[] = []
    let stuck = false

    for (const current of group.issues) {
      const sha = await getCurrentSha(wtPath)
      const prompt = buildSolvePrompt(current, config)
      const systemPrompt = buildSystemPrompt(config)

      console.log(`[solve] Running Claude for issue #${current.number}`)
      const result = await runClaude({
        prompt,
        systemPrompt,
        cwd: wtPath,
        model: config.model,
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
            ? `Claude got stuck on this issue.`
            : `Claude crashed while working on this issue.`
        await markStuck(octokit, current, reason, botLogin)

        // Mark remaining issues as blocked
        const remaining = group.issues.slice(group.issues.indexOf(current) + 1)
        for (const blocked of remaining) {
          await markStuck(
            octokit,
            blocked,
            `Blocked by #${current.number} which is stuck.`,
            botLogin,
          )
        }

        stuck = true
        break
      }
    }

    // 6. Push and create PR if there are commits
    if (solved.length > 0) {
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
      }
    }
  } finally {
    // 7. Run stop commands (only if start succeeded)
    if (started) {
      await runCommands(config.commands.stop, wtPath)
    }
    // 8. Clean up worktree
    await removeWorktree(repoDir, group.branch)
  }
}
