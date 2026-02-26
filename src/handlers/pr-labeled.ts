import { join } from "node:path"
import type { EmitterWebhookEvent } from "@octokit/webhooks"
import { loadConfig } from "../config"
import { cloneIfMissing } from "../git"
import type { GitHub } from "../github"
import { LABELS, postComment } from "../github"
import type { JobQueue } from "../queue"
import { reviewPr } from "../review-pr"
import { revise } from "../revise"
import type { PullRequest } from "../types"

export async function handlePrLabeled(
  event: EmitterWebhookEvent<"pull_request.labeled">,
  github: GitHub,
  queue: JobQueue,
  reposDir: string,
): Promise<void> {
  const { payload } = event
  const labelName = payload.label?.name
  if (labelName !== LABELS.review && labelName !== LABELS.revise) return

  const installationId = payload.installation?.id
  if (!installationId) {
    console.error("[pr-labeled] No installation ID in payload")
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

  let config: Awaited<ReturnType<typeof loadConfig>>
  try {
    const token = await github.token(installationId)
    await cloneIfMissing(repoUrl, repoDir, token)
    config = await loadConfig(repoDir)
  } catch (err) {
    console.error(`[pr-labeled] Failed to prepare PR #${pr.number}: ${err}`)
    try {
      const octokit = await github.api(installationId)
      await postComment(octokit, pr, `Failed to process PR: ${err}`)
    } catch {}
    return
  }

  if (labelName === LABELS.review) {
    console.log(`[pr-labeled] Review triggered on PR #${pr.number} in ${owner}/${repo}`)

    queue.enqueue({
      id: `review-pr-${owner}/${repo}#${pr.number}`,
      run: (signal) =>
        reviewPr({
          pr,
          baseBranch,
          installationId,
          github,
          config,
          repoDir,
          signal,
        }),
    })
  } else {
    console.log(`[pr-labeled] Revise triggered on PR #${pr.number} in ${owner}/${repo}`)

    queue.enqueue({
      id: `revise-${owner}/${repo}#${pr.number}`,
      run: (signal) =>
        revise({
          pr,
          installationId,
          github,
          config,
          repoDir,
          signal,
        }),
    })
  }
}
