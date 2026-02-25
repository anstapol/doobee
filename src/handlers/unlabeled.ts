import type { EmitterWebhookEvent } from "@octokit/webhooks"
import type { JobQueue } from "../queue"

export function handleUnlabeled(
  event: EmitterWebhookEvent<"issues.unlabeled"> | EmitterWebhookEvent<"pull_request.unlabeled">,
  queue: JobQueue,
): void {
  const { payload } = event
  if (payload.label?.name !== "doobee:in-progress") return

  const owner = payload.repository.owner.login
  const repo = payload.repository.name

  const isPr = "pull_request" in payload
  const number = isPr ? payload.pull_request.number : payload.issue.number

  const candidates = isPr
    ? [`revise-${owner}/${repo}#${number}`, `review-pr-${owner}/${repo}#${number}`]
    : [`solve-${owner}/${repo}#${number}`]

  for (const id of candidates) {
    if (queue.cancel(id)) {
      console.log(`[unlabeled] Cancelled job ${id}`)
    }
  }
}
