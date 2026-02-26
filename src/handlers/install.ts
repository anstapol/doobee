import type { EmitterWebhookEvent } from "@octokit/webhooks"
import type { GitHub } from "../github"
import { ensureLabel, LABELS } from "../github"

type InstallEvent =
  | EmitterWebhookEvent<"installation.created">
  | EmitterWebhookEvent<"installation_repositories.added">

export async function handleInstall(event: InstallEvent, github: GitHub): Promise<void> {
  const { payload } = event
  const installationId = payload.installation.id
  const octokit = await github.api(installationId)

  const repos =
    "repositories" in payload
      ? (payload.repositories ?? [])
      : "repositories_added" in payload
        ? payload.repositories_added
        : []

  for (const repo of repos) {
    const [owner, name] = repo.full_name.split("/")
    console.log(`[install] Ensuring labels in ${owner}/${name}`)

    await ensureLabel(octokit, {
      owner,
      repo: name,
      name: LABELS.stuck,
      color: "D93F0B",
      description: "Doobee could not resolve this issue",
    })

    await ensureLabel(octokit, {
      owner,
      repo: name,
      name: LABELS.solve,
      color: "0E8A16",
      description: "Trigger Doobee to solve this issue",
    })

    await ensureLabel(octokit, {
      owner,
      repo: name,
      name: LABELS.inProgress,
      color: "0075CA",
      description: "Doobee is currently working on this",
    })

    await ensureLabel(octokit, {
      owner,
      repo: name,
      name: LABELS.review,
      color: "5319E7",
      description: "Trigger Doobee to review this PR",
    })

    await ensureLabel(octokit, {
      owner,
      repo: name,
      name: LABELS.revise,
      color: "FBCA04",
      description: "Trigger Doobee to address review feedback on this PR",
    })
  }
}
