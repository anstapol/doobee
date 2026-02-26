import { join } from "node:path"
import type { EmitterWebhookEvent } from "@octokit/webhooks"
import { loadConfig } from "../config"
import { cloneIfMissing } from "../git"
import type { GitHub } from "../github"
import { postComment } from "../github"
import type { JobQueue } from "../queue"
import { revise } from "../revise"
import type { PullRequest } from "../types"

export async function handleReview(
  event: EmitterWebhookEvent<"pull_request_review.submitted">,
  github: GitHub,
  queue: JobQueue,
  reposDir: string,
  botName: string,
): Promise<void> {
  const { payload } = event
  if (payload.review.state !== "changes_requested") return

  const prUser = payload.pull_request.user?.login ?? ""
  if (prUser !== botName) return

  const installationId = payload.installation?.id
  if (!installationId) {
    console.error("[review] No installation ID in payload")
    return
  }

  const owner = payload.repository.owner.login
  const repo = payload.repository.name
  const repoDir = join(reposDir, owner, repo)
  const repoUrl = payload.repository.clone_url

  const pr: PullRequest = {
    number: payload.pull_request.number,
    title: payload.pull_request.title,
    body: payload.pull_request.body ?? "",
    branch: payload.pull_request.head.ref,
    repoOwner: owner,
    repoName: repo,
  }

  console.log(`[review] Changes requested on PR #${pr.number} in ${owner}/${repo}`)

  let config: Awaited<ReturnType<typeof loadConfig>>
  try {
    const token = await github.token(installationId)
    await cloneIfMissing(repoUrl, repoDir, token)
    config = await loadConfig(repoDir)
  } catch (err) {
    console.error(`[review] Failed to prepare PR #${pr.number}: ${err}`)
    try {
      const octokit = await github.api(installationId)
      await postComment(octokit, pr, `Failed to process review: ${err}`)
    } catch {}
    return
  }

  queue.enqueue({
    id: `revise-${owner}/${repo}#${pr.number}`,
    run: (signal) =>
      revise({
        pr,
        reviewId: payload.review.id,
        installationId,
        github,
        config,
        repoDir,
        signal,
      }),
  })
}
