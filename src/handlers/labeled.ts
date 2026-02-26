import { join } from "node:path"
import type { EmitterWebhookEvent } from "@octokit/webhooks"
import { loadConfig } from "../config"
import { cloneIfMissing } from "../git"
import type { GitHub } from "../github"
import { LABELS, postComment } from "../github"
import type { JobQueue } from "../queue"
import { solve } from "../solve"
import type { Issue } from "../types"

export async function handleLabeled(
  event: EmitterWebhookEvent<"issues.labeled">,
  github: GitHub,
  queue: JobQueue,
  reposDir: string,
): Promise<void> {
  const { payload } = event
  if (payload.label?.name !== LABELS.solve) return

  const installationId = payload.installation?.id
  if (!installationId) {
    console.error("[labeled] No installation ID in payload")
    return
  }

  const owner = payload.repository.owner.login
  const repo = payload.repository.name
  const repoDir = join(reposDir, owner, repo)
  const repoUrl = payload.repository.clone_url

  const issue: Issue = {
    number: payload.issue.number,
    title: payload.issue.title,
    body: payload.issue.body,
    repoOwner: owner,
    repoName: repo,
  }

  console.log(`[labeled] Issue #${issue.number} labeled doobee:solve in ${owner}/${repo}`)

  let config: Awaited<ReturnType<typeof loadConfig>>
  try {
    const token = await github.token(installationId)
    await cloneIfMissing(repoUrl, repoDir, token)
    config = await loadConfig(repoDir)
  } catch (err) {
    console.error(`[labeled] Failed to prepare issue #${issue.number}: ${err}`)
    try {
      const octokit = await github.api(installationId)
      await postComment(octokit, issue, `Failed to process issue: ${err}`)
    } catch {}
    return
  }

  queue.enqueue({
    id: `solve-${owner}/${repo}#${issue.number}`,
    run: (signal) =>
      solve({
        issue,
        installationId,
        github,
        config,
        repoDir,
        signal,
      }),
  })
}
