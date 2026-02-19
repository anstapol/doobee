import { App } from "@octokit/app"
import type { Octokit } from "@octokit/core"
import type { InlineComment, Issue, PullRequest, Result, ReviewComment } from "./types"

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

export async function addLabel(
  octokit: Octokit,
  opts: { owner: string; repo: string; issueNumber: number; label: string },
): Promise<void> {
  await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
    owner: opts.owner,
    repo: opts.repo,
    issue_number: opts.issueNumber,
    labels: [opts.label],
  })
}

export async function removeLabel(
  octokit: Octokit,
  opts: { owner: string; repo: string; issueNumber: number; label: string },
): Promise<void> {
  try {
    await octokit.request("DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}", {
      owner: opts.owner,
      repo: opts.repo,
      issue_number: opts.issueNumber,
      name: opts.label,
    })
  } catch {
    // Label may not exist — ignore
  }
}

export async function postComment(
  octokit: Octokit,
  opts: { owner: string; repo: string; issueNumber: number; body: string },
): Promise<void> {
  await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
    owner: opts.owner,
    repo: opts.repo,
    issue_number: opts.issueNumber,
    body: opts.body,
  })
}

export async function assignIssue(
  octokit: Octokit,
  opts: { owner: string; repo: string; issueNumber: number; assignees: string[] },
): Promise<void> {
  await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/assignees", {
    owner: opts.owner,
    repo: opts.repo,
    issue_number: opts.issueNumber,
    assignees: opts.assignees,
  })
}

export async function unassignIssue(
  octokit: Octokit,
  opts: { owner: string; repo: string; issueNumber: number; assignees: string[] },
): Promise<void> {
  await octokit.request("DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees", {
    owner: opts.owner,
    repo: opts.repo,
    issue_number: opts.issueNumber,
    assignees: opts.assignees,
  })
}

export async function fetchReviews(
  octokit: Octokit,
  opts: { owner: string; repo: string; prNumber: number; reviewId: number },
): Promise<ReviewComment[]> {
  const comments: ReviewComment[] = []

  // Fetch the specific review's body
  const { data: review } = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
    {
      owner: opts.owner,
      repo: opts.repo,
      pull_number: opts.prNumber,
      review_id: opts.reviewId,
    },
  )

  if (review.body) {
    comments.push({
      author: review.user?.login ?? "unknown",
      body: review.body,
    })
  }

  // Fetch inline comments for this specific review (paginated)
  let page = 1
  while (true) {
    const { data: inline } = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments",
      {
        owner: opts.owner,
        repo: opts.repo,
        pull_number: opts.prNumber,
        review_id: opts.reviewId,
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

export async function submitReview(
  octokit: Octokit,
  opts: {
    owner: string
    repo: string
    prNumber: number
    body: string
    comments: InlineComment[]
  },
): Promise<void> {
  await octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
    owner: opts.owner,
    repo: opts.repo,
    pull_number: opts.prNumber,
    body: opts.body,
    event: "COMMENT",
    comments: opts.comments,
  })
}

export async function fetchSubIssues(
  octokit: Octokit,
  opts: { owner: string; repo: string; issueNumber: number },
): Promise<Issue[]> {
  try {
    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
      {
        owner: opts.owner,
        repo: opts.repo,
        issue_number: opts.issueNumber,
      },
    )
    const issues = data as Array<{ number: number; title: string; body: string | null }>
    return issues.map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body,
      repoOwner: opts.owner,
      repoName: opts.repo,
    }))
  } catch {
    return []
  }
}

export async function fetchParent(
  octokit: Octokit,
  opts: { owner: string; repo: string; issueNumber: number },
): Promise<Issue | null> {
  try {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}", {
      owner: opts.owner,
      repo: opts.repo,
      issue_number: opts.issueNumber,
    })
    const body = data.body ?? ""
    // Check for parent issue reference in body (GitHub sub-issues pattern)
    const parentMatch = body.match(/(?:parent|tracking)\s+(?:issue\s+)?#(\d+)/i)
    if (!parentMatch) return null

    const parentNumber = parseInt(parentMatch[1], 10)
    const { data: parent } = await octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}",
      {
        owner: opts.owner,
        repo: opts.repo,
        issue_number: parentNumber,
      },
    )
    return {
      number: parent.number,
      title: parent.title,
      body: parent.body ?? null,
      repoOwner: opts.owner,
      repoName: opts.repo,
    }
  } catch {
    return null
  }
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
