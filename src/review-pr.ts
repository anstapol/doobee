import {
  buildReviewPrompt,
  buildReviewSystemPrompt,
  parseReviewComments,
  runClaude,
} from "./claude"
import { createWorktree, fetch, getDiff, removeWorktree } from "./git"
import type { GitHub } from "./github"
import { postComment, submitReview } from "./github"
import type { DoobeeConfig, PullRequest } from "./types"

export interface ReviewPrContext {
  pr: PullRequest
  baseBranch: string
  installationId: number
  github: GitHub
  config: DoobeeConfig
  repoDir: string
}

export async function reviewPr(ctx: ReviewPrContext): Promise<void> {
  const { pr, baseBranch, installationId, github, config, repoDir } = ctx
  const octokit = await github.api(installationId)

  // 1. Fetch origin
  const fetchResult = await fetch(repoDir)
  if (!fetchResult.ok) {
    console.error(`[review-pr] Fetch failed: ${fetchResult.error}`)
    await postComment(octokit, {
      owner: pr.repoOwner,
      repo: pr.repoName,
      issueNumber: pr.number,
      body: `Could not review PR: failed to fetch origin.`,
    })
    return
  }

  // 2. Create worktree from the PR branch
  const wtResult = await createWorktree(repoDir, pr.branch, pr.branch)
  if (!wtResult.ok) {
    console.error(`[review-pr] Failed to create worktree: ${wtResult.error}`)
    await postComment(octokit, {
      owner: pr.repoOwner,
      repo: pr.repoName,
      issueNumber: pr.number,
      body: `Could not review PR: failed to create worktree.`,
    })
    return
  }
  const wtPath = wtResult.value

  try {
    // 3. Get diff against base branch
    const diffResult = await getDiff(wtPath, baseBranch)
    if (!diffResult.ok) {
      console.error(`[review-pr] Failed to get diff: ${diffResult.error}`)
      return
    }
    if (!diffResult.value) {
      console.log(`[review-pr] No diff for PR #${pr.number}, skipping review`)
      return
    }

    // 4. Run Claude
    const prompt = buildReviewPrompt(pr, diffResult.value, config)
    const systemPrompt = buildReviewSystemPrompt()

    console.log(`[review-pr] Running Claude for PR #${pr.number}`)
    const result = await runClaude({
      prompt,
      systemPrompt,
      cwd: wtPath,
      model: config.model,
    })

    if (result.status === "crashed") {
      console.error(`[review-pr] Claude crashed reviewing PR #${pr.number}`)
      await postComment(octokit, {
        owner: pr.repoOwner,
        repo: pr.repoName,
        issueNumber: pr.number,
        body: `Could not complete PR review: Claude crashed.`,
      })
      return
    }

    if (result.status === "complete") {
      console.log(`[review-pr] PR #${pr.number} looks clean, no comments`)
      return
    }

    // 5. Parse review comments
    const comments = parseReviewComments(result.output)
    if (comments.length === 0) {
      console.log(`[review-pr] No parseable comments for PR #${pr.number}`)
      return
    }

    // 6. Submit review
    await submitReview(octokit, {
      owner: pr.repoOwner,
      repo: pr.repoName,
      prNumber: pr.number,
      body: "",
      comments,
    })

    console.log(`[review-pr] Submitted ${comments.length} comments on PR #${pr.number}`)
  } finally {
    // 7. Clean up worktree
    await removeWorktree(repoDir, pr.branch)
  }
}
