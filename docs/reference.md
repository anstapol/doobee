# Reference

Quick-reference tables for labels, branches, commits, webhooks, endpoints, and output markers.

## Labels

| Label | Where | Meaning |
|---|---|---|
| `doobee:solve` | Issue | Trigger Doobee to solve this issue |
| `doobee:review` | PR | Trigger Doobee to review this PR |
| `doobee:revise` | PR | Trigger Doobee to address review feedback on this PR |
| `doobee:stuck` | Issue/PR | Doobee couldn't resolve this |
| `doobee:in-progress` | Issue/PR | Doobee is currently working on this |

All labels are created automatically when the app is installed. Trigger labels (`doobee:solve`, `doobee:review`, `doobee:revise`) are removed when the job starts, so re-adding re-triggers the action.

## Branch naming

| Type | Pattern | Example |
|---|---|---|
| Standalone issue | `doobee/<issue#>` | `doobee/42` |
| Sub-issue group | `doobee/<parent#>` | `doobee/10` |

## Commit messages

| Context | Format |
|---|---|
| Solving an issue | `ISSUE #<number>: <description>` |
| Addressing review | `PR #<number>: address review feedback` |

## Webhook events

The server listens for exactly nine events:

| Event | Action |
|---|---|
| `issues.labeled` | Triggers solve (when label is `doobee:solve`) |
| `issues.unlabeled` | Cancels running/pending job (when `doobee:in-progress` is removed) |
| `pull_request.labeled` | Triggers review (`doobee:review`) or revise (`doobee:revise`) |
| `pull_request.unlabeled` | Cancels running/pending job (when `doobee:in-progress` is removed) |
| `pull_request.review_requested` | Triggers review (when requested reviewer is bot) |
| `issue_comment.created` | Triggers solve, review, or revise (when comment mentions bot) |
| `pull_request_review.submitted` | Triggers revise (auto, when "changes requested" on a bot PR) |
| `installation.created` | Creates labels on each repo |
| `installation_repositories.added` | Creates labels on each repo |

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/webhook` | GitHub webhook receiver (signature-verified) |
| `GET` | `/health` | Queue status: `{ status: "ok", active: <running>, pending: <queued> }` |

## Output markers

Claude outputs these markers to communicate results back to Doobee:

| Marker | Meaning |
|---|---|
| `[DOOBEE:STUCK]` | Issue could not be resolved |
| `[DOOBEE:COMPLETE]` | Issue was already resolved, no changes needed |
| `[DOOBEE:REVIEW]{"path","line","body"}[DOOBEE:REVIEW_END]` | Inline review comment (review flow only) |

**Result parsing:** stdout+stderr are scanned for markers. `[DOOBEE:STUCK]` = stuck, `[DOOBEE:COMPLETE]` = complete, non-zero exit without marker = crashed, otherwise = solved.
