import { join } from "node:path"
import type { EmitterWebhookEvent } from "@octokit/webhooks"
import { loadConfig } from "../config"
import { cloneIfMissing } from "../git"
import type { GitHub } from "../github"
import type { JobQueue } from "../queue"
import { reviewPr } from "../review-pr"
import type { PullRequest } from "../types"

export async function handleReviewRequested(
  event: EmitterWebhookEvent<"pull_request.review_requested">,
  github: GitHub,
  queue: JobQueue,
  reposDir: string,
  botName: string,
): Promise<void> {
  const { payload } = event

  if (!("requested_reviewer" in payload) || !payload.requested_reviewer) return
  if (payload.requested_reviewer.login !== botName) return

  const installationId = payload.installation?.id
  if (!installationId) {
    console.error("[review-requested] No installation ID in payload")
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

  const baseBranch = payload.pull_request.base.ref

  console.log(`[review-requested] Review requested on PR #${pr.number} in ${owner}/${repo}`)

  await cloneIfMissing(repoUrl, repoDir)
  const config = await loadConfig(repoDir)

  queue.enqueue({
    id: `review-pr-${pr.number}`,
    run: () =>
      reviewPr({
        pr,
        baseBranch,
        installationId,
        github,
        config,
        repoDir,
      }),
  })
}
