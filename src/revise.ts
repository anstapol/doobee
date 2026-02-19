import { buildRevisionPrompt, buildSystemPrompt, runClaude } from "./claude"
import { runCommands } from "./commands"
import { createWorktree, fetch, getCurrentSha, hasNewCommits, push, removeWorktree } from "./git"
import type { GitHub } from "./github"
import { addLabel, fetchReviews, postComment } from "./github"
import type { DoobeeConfig, PullRequest } from "./types"

export interface ReviseContext {
  pr: PullRequest
  reviewId: number
  installationId: number
  github: GitHub
  config: DoobeeConfig
  repoDir: string
}

export async function revise(ctx: ReviseContext): Promise<void> {
  const { pr, reviewId, installationId, github, config, repoDir } = ctx
  const octokit = await github.api(installationId)

  // 1. Fetch origin
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
    return
  }
  const wtPath = wtResult.value

  let started = false
  try {
    // 3. Fetch review comments
    const reviews = await fetchReviews(octokit, {
      owner: pr.repoOwner,
      repo: pr.repoName,
      prNumber: pr.number,
      reviewId,
    })

    // 4. Run setup and start commands
    await runCommands(config.commands.setup, wtPath)
    await runCommands(config.commands.start, wtPath)
    started = true

    // 5. Build prompts and run Claude
    const prompt = buildRevisionPrompt(pr, reviews, config)
    const systemPrompt = buildSystemPrompt(config)
    const sha = await getCurrentSha(wtPath)

    console.log(`[revise] Running Claude for PR #${pr.number}`)
    const result = await runClaude({
      prompt,
      systemPrompt,
      cwd: wtPath,
      model: config.model,
    })

    // 6. Handle result
    if (result.status === "solved" && (await hasNewCommits(wtPath, sha))) {
      const pushResult = await push(wtPath, pr.branch)
      if (pushResult.ok) {
      } else {
        console.error(`[revise] Push failed: ${pushResult.error}`)
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
        body: `Could not address review feedback. Status: ${result.status}`,
      })
    }
  } finally {
    // 7. Run stop commands (only if start succeeded)
    if (started) {
      await runCommands(config.commands.stop, wtPath)
    }
    // 8. Clean up worktree
    await removeWorktree(repoDir, pr.branch)
  }
}
