import { join } from "node:path"
import type { EmitterWebhookEvent } from "@octokit/webhooks"
import { loadConfig } from "../config"
import { cloneIfMissing } from "../git"
import type { GitHub } from "../github"
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
  if (payload.label?.name !== "doobee:solve") return

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

  const token = await github.token(installationId)
  await cloneIfMissing(repoUrl, repoDir, token)
  const config = await loadConfig(repoDir)

  queue.enqueue({
    id: `solve-${issue.number}`,
    run: () =>
      solve({
        issue,
        installationId,
        github,
        config,
        repoDir,
      }),
  })
}
