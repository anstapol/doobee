import {
  buildReviewPrompt,
  buildReviewSystemPrompt,
  formatOutput,
  parseReviewComments,
  runClaude,
} from "./claude"
import { configureAuth, createWorktree, fetch, getDiff, removeWorktree } from "./git"
import type { GitHub } from "./github"
import { LABELS, postComment, removeLabel, submitReview } from "./github"
import type { DoobeeConfig, PullRequest } from "./types"

export interface ReviewPrContext {
  pr: PullRequest
  baseBranch: string
  installationId: number
  github: GitHub
  config: DoobeeConfig
  repoDir: string
  extraContext?: string
  signal?: AbortSignal
}

export async function reviewPr(ctx: ReviewPrContext): Promise<void> {
  const { pr, baseBranch, installationId, github, config, repoDir, extraContext, signal } = ctx
  const octokit = await github.api(installationId)

  // Remove trigger label
  await removeLabel(octokit, pr, LABELS.review)

  // 1. Configure auth and fetch origin
  const token = await github.token(installationId)
  await configureAuth(repoDir, token)
  const fetchResult = await fetch(repoDir)
  if (!fetchResult.ok) {
    console.error(`[review-pr] Fetch failed: ${fetchResult.error}`)
    await postComment(octokit, pr, `Could not review PR: failed to fetch origin.`)
    return
  }

  // 2. Create worktree from the PR branch
  const wtResult = await createWorktree(repoDir, pr.branch, pr.branch)
  if (!wtResult.ok) {
    console.error(`[review-pr] Failed to create worktree: ${wtResult.error}`)
    await postComment(octokit, pr, `Could not review PR: failed to create worktree.`)
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
    const prompt = buildReviewPrompt(pr, diffResult.value, config, extraContext)
    const systemPrompt = buildReviewSystemPrompt()

    console.log(`[review-pr] Running Claude for PR #${pr.number}`)
    const result = await runClaude({
      prompt,
      systemPrompt,
      cwd: wtPath,
      model: config.model,
      timeout: config.timeout,
      label: `PR #${pr.number}`,
      signal,
    })

    if (result.status === "crashed") {
      console.error(`[review-pr] Claude crashed reviewing PR #${pr.number}`)
      await postComment(
        octokit,
        pr,
        `Could not complete PR review: Claude crashed.${formatOutput(result.output)}`,
      )
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
    await submitReview(octokit, pr, "", comments)

    console.log(`[review-pr] Submitted ${comments.length} comments on PR #${pr.number}`)
  } finally {
    // 7. Clean up worktree
    await removeWorktree(repoDir, pr.branch)
  }
}
