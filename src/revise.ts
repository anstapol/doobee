import { buildRevisionPrompt, buildSystemPrompt, formatOutput, runClaude } from "./claude"
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
import {
  addLabel,
  fetchAllReviews,
  fetchRepoVariables,
  fetchReviews,
  postComment,
  removeLabel,
} from "./github"
import type { DoobeeConfig, PullRequest } from "./types"

export interface ReviseContext {
  pr: PullRequest
  reviewId?: number
  installationId: number
  github: GitHub
  config: DoobeeConfig
  repoDir: string
  extraContext?: string
}

export async function revise(ctx: ReviseContext): Promise<void> {
  const { pr, reviewId, installationId, github, config, repoDir, extraContext } = ctx
  const octokit = await github.api(installationId)

  // Add in-progress label and remove trigger label
  await addLabel(octokit, {
    owner: pr.repoOwner,
    repo: pr.repoName,
    issueNumber: pr.number,
    label: "doobee:in-progress",
  })
  await removeLabel(octokit, {
    owner: pr.repoOwner,
    repo: pr.repoName,
    issueNumber: pr.number,
    label: "doobee:revise",
  })

  // 1. Configure auth and fetch origin
  const token = await github.token(installationId)
  await configureAuth(repoDir, token)
  const fetchResult = await fetch(repoDir)
  if (!fetchResult.ok) {
    console.error(`[revise] Fetch failed: ${fetchResult.error}`)
    await addLabel(octokit, {
      owner: pr.repoOwner,
      repo: pr.repoName,
      issueNumber: pr.number,
      label: "doobee:stuck",
    })
    await postComment(octokit, {
      owner: pr.repoOwner,
      repo: pr.repoName,
      issueNumber: pr.number,
      body: `Failed to fetch origin: ${fetchResult.error}`,
    })
    await removeLabel(octokit, {
      owner: pr.repoOwner,
      repo: pr.repoName,
      issueNumber: pr.number,
      label: "doobee:in-progress",
    })
    return
  }

  // 2. Create worktree from the PR branch
  const wtResult = await createWorktree(repoDir, pr.branch, pr.branch)
  if (!wtResult.ok) {
    console.error(`[revise] Failed to create worktree: ${wtResult.error}`)
    await addLabel(octokit, {
      owner: pr.repoOwner,
      repo: pr.repoName,
      issueNumber: pr.number,
      label: "doobee:stuck",
    })
    await postComment(octokit, {
      owner: pr.repoOwner,
      repo: pr.repoName,
      issueNumber: pr.number,
      body: `Failed to create worktree: ${wtResult.error}`,
    })
    await removeLabel(octokit, {
      owner: pr.repoOwner,
      repo: pr.repoName,
      issueNumber: pr.number,
      label: "doobee:in-progress",
    })
    return
  }
  const wtPath = wtResult.value

  let started = false
  const dockerEnv = await isolateDockerPorts(wtPath)
  const repoVars = await fetchRepoVariables(octokit, {
    owner: pr.repoOwner,
    repo: pr.repoName,
  })
  const env = { ...repoVars, ...dockerEnv }
  const mergedEnv = Object.keys(env).length > 0 ? env : undefined
  try {
    // 3. Fetch review comments
    const reviews = reviewId
      ? await fetchReviews(octokit, {
          owner: pr.repoOwner,
          repo: pr.repoName,
          prNumber: pr.number,
          reviewId,
        })
      : await fetchAllReviews(octokit, {
          owner: pr.repoOwner,
          repo: pr.repoName,
          prNumber: pr.number,
        })

    // 4. Run setup and start commands
    await runCommands(config.commands.setup, wtPath, mergedEnv)
    await runCommands(config.commands.start, wtPath, mergedEnv)
    started = true

    // 5. Build prompts and run Claude
    const prompt = buildRevisionPrompt(pr, reviews, config, extraContext)
    const systemPrompt = buildSystemPrompt(config, dockerEnv)
    const sha = await getCurrentSha(wtPath)

    console.log(`[revise] Running Claude for PR #${pr.number}`)
    const result = await runClaude({
      prompt,
      systemPrompt,
      cwd: wtPath,
      model: config.model,
      timeout: config.timeout,
      env: mergedEnv,
    })

    // 6. Handle result
    if (result.status === "solved" && (await hasNewCommits(wtPath, sha))) {
      // Refresh token — Claude session may have taken a while
      const pushToken = await github.token(installationId)
      await configureAuth(repoDir, pushToken)
      const pushResult = await push(wtPath, pr.branch)
      if (!pushResult.ok) {
        console.error(`[revise] Push failed: ${pushResult.error}`)
        await postComment(octokit, {
          owner: pr.repoOwner,
          repo: pr.repoName,
          issueNumber: pr.number,
          body: `Push failed after Claude committed changes.\n\n\`\`\`\n${pushResult.error}\n\`\`\``,
        })
        await addLabel(octokit, {
          owner: pr.repoOwner,
          repo: pr.repoName,
          issueNumber: pr.number,
          label: "doobee:stuck",
        })
      }
    } else if (result.status === "complete") {
      // Review feedback already addressed
    } else {
      // stuck or crashed
      await addLabel(octokit, {
        owner: pr.repoOwner,
        repo: pr.repoName,
        issueNumber: pr.number,
        label: "doobee:stuck",
      })
      await postComment(octokit, {
        owner: pr.repoOwner,
        repo: pr.repoName,
        issueNumber: pr.number,
        body: `Could not address review feedback. Status: ${result.status}${formatOutput(result.output)}`,
      })
    }
  } finally {
    // 7. Remove in-progress label
    await removeLabel(octokit, {
      owner: pr.repoOwner,
      repo: pr.repoName,
      issueNumber: pr.number,
      label: "doobee:in-progress",
    })
    // 8. Run stop commands (only if start succeeded)
    if (started) {
      await runCommands(config.commands.stop, wtPath, mergedEnv)
    }
    // 9. Clean up worktree
    await removeWorktree(repoDir, pr.branch)
  }
}
