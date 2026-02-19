import { join } from "node:path"
import type { EmitterWebhookEvent } from "@octokit/webhooks"
import { loadConfig } from "../config"
import { cloneIfMissing } from "../git"
import type { GitHub } from "../github"
import type { JobQueue } from "../queue"
import { solve } from "../solve"
import type { Issue } from "../types"

export async function handleAssigned(
  event: EmitterWebhookEvent<"issues.assigned">,
  github: GitHub,
  queue: JobQueue,
  reposDir: string,
  botName: string,
): Promise<void> {
  const { payload } = event
  const assignee = payload.assignee?.login
  if (assignee !== botName) return

  const installationId = payload.installation?.id
  if (!installationId) {
    console.error("[assigned] No installation ID in payload")
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

  console.log(`[assigned] Issue #${issue.number} assigned to ${assignee} in ${owner}/${repo}`)

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
