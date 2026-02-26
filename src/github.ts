import { App } from "@octokit/app"
import type { Octokit } from "@octokit/core"
import type { InlineComment, Issue, PullRequest, Result, ReviewComment } from "./types"

export const LABELS = {
  solve: "doobee:solve",
  stuck: "doobee:stuck",
  inProgress: "doobee:in-progress",
  review: "doobee:review",
  revise: "doobee:revise",
} as const

type Target = { repoOwner: string; repoName: string; number: number }

export interface GitHub {
  app: App
  api(installationId: number): Promise<Octokit>
  token(installationId: number): Promise<string>
}

export function createGitHub(appId: string, privateKey: string, webhookSecret: string): GitHub {
  const app = new App({
    appId,
    privateKey,
    webhooks: { secret: webhookSecret },
  })

  return {
    app,
    api: (installationId: number) => app.getInstallationOctokit(installationId),
    token: async (installationId: number) => {
      const auth = (await app.octokit.auth({
        type: "installation",
        installationId,
      })) as { token: string }
      return auth.token
    },
  }
}

export async function createPr(
  octokit: Octokit,
  opts: { owner: string; repo: string; title: string; body: string; head: string; base: string },
): Promise<Result<PullRequest>> {
  try {
    const { data } = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
      owner: opts.owner,
      repo: opts.repo,
      title: opts.title,
      body: opts.body,
      head: opts.head,
      base: opts.base,
    })
    return {
      ok: true,
      value: {
        number: data.number,
        title: data.title,
        body: data.body ?? "",
        branch: data.head.ref,
        repoOwner: opts.owner,
        repoName: opts.repo,
      },
    }
  } catch (err) {
    return { ok: false, error: `Failed to create PR: ${err}` }
  }
}

export async function addLabel(octokit: Octokit, target: Target, label: string): Promise<void> {
  await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
    owner: target.repoOwner,
    repo: target.repoName,
    issue_number: target.number,
    labels: [label],
  })
}

export async function removeLabel(octokit: Octokit, target: Target, label: string): Promise<void> {
  try {
    await octokit.request("DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}", {
      owner: target.repoOwner,
      repo: target.repoName,
      issue_number: target.number,
      name: label,
    })
  } catch {
    // Label may not exist — ignore
  }
}

export async function postComment(octokit: Octokit, target: Target, body: string): Promise<void> {
  await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
    owner: target.repoOwner,
    repo: target.repoName,
    issue_number: target.number,
    body,
  })
}

async function fetchInlineComments(
  octokit: Octokit,
  target: Target,
  reviewId: number,
): Promise<ReviewComment[]> {
  const comments: ReviewComment[] = []
  let page = 1
  while (true) {
    const { data: inline } = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments",
      {
        owner: target.repoOwner,
        repo: target.repoName,
        pull_number: target.number,
        review_id: reviewId,
        per_page: 100,
        page,
      },
    )

    for (const comment of inline) {
      comments.push({
        author: comment.user?.login ?? "unknown",
        body: comment.body,
        path: comment.path,
        line: comment.line ?? undefined,
        diffHunk: comment.diff_hunk,
      })
    }

    if (inline.length < 100) break
    page++
  }
  return comments
}

export async function fetchReviews(
  octokit: Octokit,
  target: Target,
  reviewId: number,
): Promise<ReviewComment[]> {
  const comments: ReviewComment[] = []

  const { data: review } = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
    {
      owner: target.repoOwner,
      repo: target.repoName,
      pull_number: target.number,
      review_id: reviewId,
    },
  )

  if (review.body) {
    comments.push({
      author: review.user?.login ?? "unknown",
      body: review.body,
    })
  }

  comments.push(...(await fetchInlineComments(octokit, target, reviewId)))
  return comments
}

export async function fetchAllReviews(octokit: Octokit, target: Target): Promise<ReviewComment[]> {
  const comments: ReviewComment[] = []

  const { data: reviews } = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
    {
      owner: target.repoOwner,
      repo: target.repoName,
      pull_number: target.number,
    },
  )

  const changesRequested = reviews.filter((r: { state: string }) => r.state === "CHANGES_REQUESTED")

  for (const review of changesRequested) {
    if (review.body) {
      comments.push({
        author: review.user?.login ?? "unknown",
        body: review.body,
      })
    }

    comments.push(...(await fetchInlineComments(octokit, target, review.id)))
  }

  return comments
}

export async function submitReview(
  octokit: Octokit,
  target: Target,
  body: string,
  comments: InlineComment[],
): Promise<void> {
  await octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
    owner: target.repoOwner,
    repo: target.repoName,
    pull_number: target.number,
    body,
    event: "COMMENT",
    comments,
  })
}

export async function markStuck(octokit: Octokit, target: Target, reason: string): Promise<void> {
  await addLabel(octokit, target, LABELS.stuck)
  await postComment(octokit, target, reason)
}

export async function fetchSubIssues(octokit: Octokit, target: Target): Promise<Issue[]> {
  try {
    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
      {
        owner: target.repoOwner,
        repo: target.repoName,
        issue_number: target.number,
      },
    )
    const issues = data as Array<{ number: number; title: string; body: string | null }>
    return issues.map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body,
      repoOwner: target.repoOwner,
      repoName: target.repoName,
    }))
  } catch {
    return []
  }
}

export async function fetchParent(octokit: Octokit, target: Target): Promise<Issue | null> {
  try {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}", {
      owner: target.repoOwner,
      repo: target.repoName,
      issue_number: target.number,
    })
    const body = data.body ?? ""
    const parentMatch = body.match(/(?:parent|tracking)\s+(?:issue\s+)?#(\d+)/i)
    if (!parentMatch) return null

    const parentNumber = parseInt(parentMatch[1], 10)
    const { data: parent } = await octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}",
      {
        owner: target.repoOwner,
        repo: target.repoName,
        issue_number: parentNumber,
      },
    )
    return {
      number: parent.number,
      title: parent.title,
      body: parent.body ?? null,
      repoOwner: target.repoOwner,
      repoName: target.repoName,
    }
  } catch {
    return null
  }
}

export async function fetchPr(
  octokit: Octokit,
  opts: { owner: string; repo: string; prNumber: number },
): Promise<Result<{ pr: PullRequest; baseBranch: string }>> {
  try {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner: opts.owner,
      repo: opts.repo,
      pull_number: opts.prNumber,
    })
    return {
      ok: true,
      value: {
        pr: {
          number: data.number,
          title: data.title,
          body: data.body ?? "",
          branch: data.head.ref,
          repoOwner: opts.owner,
          repoName: opts.repo,
        },
        baseBranch: data.base.ref,
      },
    }
  } catch (err) {
    return { ok: false, error: `Failed to fetch PR: ${err}` }
  }
}

export async function fetchRepoVariables(
  octokit: Octokit,
  opts: { owner: string; repo: string },
): Promise<Record<string, string> | undefined> {
  try {
    const orgVars = await fetchOrgVariables(octokit, opts.owner)
    const repoVars = await fetchVariables(octokit, `GET /repos/{owner}/{repo}/actions/variables`, {
      owner: opts.owner,
      repo: opts.repo,
    })

    const vars = { ...orgVars, ...repoVars }
    if (Object.keys(vars).length === 0) return undefined

    const orgCount = Object.keys(orgVars).length
    const repoCount = Object.keys(repoVars).length
    console.log(
      `[github] Loaded ${repoCount} repo + ${orgCount} org variables for ${opts.owner}/${opts.repo}`,
    )
    return vars
  } catch (err) {
    console.warn(`[github] Could not fetch repo variables for ${opts.owner}/${opts.repo}: ${err}`)
    return undefined
  }
}

async function fetchOrgVariables(octokit: Octokit, org: string): Promise<Record<string, string>> {
  try {
    return await fetchVariables(octokit, `GET /orgs/{org}/actions/variables`, { org })
  } catch {
    return {}
  }
}

async function fetchVariables(
  octokit: Octokit,
  route: string,
  params: Record<string, string>,
): Promise<Record<string, string>> {
  const vars: Record<string, string> = {}
  let page = 1

  while (true) {
    const { data } = await octokit.request(route, {
      ...params,
      per_page: 30,
      page,
    })

    for (const v of (data as { variables: { name: string; value: string }[] }).variables) {
      vars[v.name] = v.value
    }

    if ((data as { variables: unknown[] }).variables.length < 30) break
    page++
  }

  return vars
}

export async function ensureLabel(
  octokit: Octokit,
  opts: { owner: string; repo: string; name: string; color: string; description: string },
): Promise<void> {
  try {
    await octokit.request("POST /repos/{owner}/{repo}/labels", {
      owner: opts.owner,
      repo: opts.repo,
      name: opts.name,
      color: opts.color,
      description: opts.description,
    })
  } catch {
    // Label already exists — ignore
  }
}
