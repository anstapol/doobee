import { join } from "node:path"
import type { EmitterWebhookEvent } from "@octokit/webhooks"
import { loadConfig } from "../config"
import { cloneIfMissing } from "../git"
import type { GitHub } from "../github"
import { fetchPr } from "../github"
import { parseCommand } from "../parse-command"
import type { JobQueue } from "../queue"
import { reviewPr } from "../review-pr"
import { solve } from "../solve"
import type { Issue } from "../types"

export async function handleComment(
  event: EmitterWebhookEvent<"issue_comment.created">,
  github: GitHub,
  queue: JobQueue,
  reposDir: string,
  botName: string,
): Promise<void> {
  const { payload } = event

  // Skip bot's own comments
  if (payload.comment.user?.login === botName) return

  // Skip closed issues/PRs
  if (payload.issue.state === "closed") return

  const isPullRequest = "pull_request" in payload.issue && !!payload.issue.pull_request
  const parsed = parseCommand(payload.comment.body ?? "", botName, isPullRequest)
  if (!parsed) return

  const installationId = payload.installation?.id
  if (!installationId) {
    console.error("[comment] No installation ID in payload")
    return
  }

  const owner = payload.repository.owner.login
  const repo = payload.repository.name
  const repoDir = join(reposDir, owner, repo)
  const repoUrl = payload.repository.clone_url
  const extraContext = parsed.context || undefined

  if (parsed.command === "solve" && isPullRequest) {
    console.log(`[comment] Ignoring solve command on PR #${payload.issue.number}`)
    return
  }

  if (parsed.command === "review" && !isPullRequest) {
    console.log(`[comment] Ignoring review command on issue #${payload.issue.number}`)
    return
  }

  const token = await github.token(installationId)
  await cloneIfMissing(repoUrl, repoDir, token)
  const config = await loadConfig(repoDir)

  if (parsed.command === "solve") {
    const issue: Issue = {
      number: payload.issue.number,
      title: payload.issue.title,
      body: payload.issue.body,
      repoOwner: owner,
      repoName: repo,
    }

    console.log(`[comment] Solve triggered for issue #${issue.number} in ${owner}/${repo}`)

    queue.enqueue({
      id: `solve-${owner}/${repo}#${issue.number}`,
      run: () =>
        solve({
          issue,
          installationId,
          github,
          config,
          repoDir,
          extraContext,
        }),
    })
  } else {
    // review command on a PR
    const octokit = await github.api(installationId)
    const prResult = await fetchPr(octokit, {
      owner,
      repo,
      prNumber: payload.issue.number,
    })

    if (!prResult.ok) {
      console.error(`[comment] Failed to fetch PR #${payload.issue.number}: ${prResult.error}`)
      return
    }

    const { pr, baseBranch } = prResult.value

    console.log(`[comment] Review triggered for PR #${pr.number} in ${owner}/${repo}`)

    queue.enqueue({
      id: `review-pr-${owner}/${repo}#${pr.number}`,
      run: () =>
        reviewPr({
          pr,
          baseBranch,
          installationId,
          github,
          config,
          repoDir,
          extraContext,
        }),
    })
  }
}
