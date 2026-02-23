# Doobee

GitHub App that resolves issues autonomously. Listens for webhooks, spawns Claude Code to solve issues, and opens PRs.

## Architecture

```
GitHub webhook → Bun HTTP server → Job queue → Claude Code CLI
```

Event-driven. No polling, no cron. A user adds the `doobee:solve` label or comments `@doobeebot solve`, the webhook fires, Claude solves it, a PR appears. Labels are the primary trigger; comments allow passing extra context.

### Data flow

**Solve** (issue → PR):
```
issues.labeled webhook (doobee:solve)
  → src/handlers/labeled.ts — validate trigger, extract issue
  → git.cloneIfMissing() — clone repo if first time, else fetch
  → config.loadConfig() — read .doobee.json from repo
  → queue.enqueue() — global single-job queue
  → src/solve.ts:
      1. git.fetch()
      2. github.fetchParent() / fetchSubIssues() — detect sub-issue group
      3. git.createWorktree() — isolated branch from baseBranch
      4. Run commands.setup + commands.start (Bun.spawn)
      5. For each issue in group:
         - claude.runClaude(buildSolvePrompt(), buildSystemPrompt())
         - Check result: solved → track / stuck → label + break
      6. If commits exist: git.push() → github.createPr()
      7. Run commands.stop
      8. git.removeWorktree() (in finally block — always runs)
```

**Revise** (review feedback → push fixes):
```
pull_request.labeled webhook (doobee:revise) OR pull_request_review.submitted webhook (changes_requested on bot PR)
  → src/handlers/pr-labeled.ts or src/handlers/review.ts — validate trigger
  → clone/fetch → config → enqueue
  → src/revise.ts:
      1. git.fetch()
      2. git.createWorktree() — checkout existing PR branch
      3. github.fetchReviews() or fetchAllReviews() — review-level + inline comments with diff hunks
      4. Run commands.setup + commands.start
      5. claude.runClaude(buildRevisionPrompt(), buildSystemPrompt())
      6. If solved + new commits: git.push() to PR branch
         If stuck: label doobee:stuck on PR + comment
      7. Run commands.stop
      8. git.removeWorktree() (in finally block)
```

**Review** (PR review → inline comments):
```
pull_request.labeled webhook (doobee:review) OR pull_request.review_requested webhook (requested_reviewer is bot)
  → src/handlers/pr-labeled.ts or src/handlers/review-requested.ts — validate trigger
  → clone/fetch → config → enqueue
  → src/review-pr.ts:
      1. git.fetch()
      2. git.createWorktree() — checkout PR branch
      3. git.getDiff() — diff against base branch
      4. claude.runClaude(buildReviewPrompt(), buildReviewSystemPrompt())
      5. parseReviewComments() — extract [DOOBEE:REVIEW] markers
      6. github.submitReview() — post inline comments (event: COMMENT)
      7. git.removeWorktree() (in finally block)
```

**Comment command** (comment → solve, review, or revise):
```
issue_comment.created webhook
  → src/handlers/comment.ts — skip bot's own comments, skip closed issues
  → src/parse-command.ts — parse @doobeebot mention, extract command + extra context
  → Validate: solve only on issues, review/revise only on PRs
  → clone/fetch → config → enqueue
  → solve command: enqueue solve (same as handleLabeled, with extraContext)
  → review command: github.fetchPr() → enqueue reviewPr (with extraContext)
  → revise command: github.fetchPr() → enqueue revise (with extraContext)
```

**Install** (app installed on repo):
```
installation.created / installation_repositories.added webhook
  → src/handlers/install.ts — create doobee:stuck, doobee:solve, doobee:in-progress, doobee:review, and doobee:revise labels on each repo
```

### Webhook events

The server listens for exactly seven events:
- `issues.labeled` — triggers solve (when label is `doobee:solve`)
- `pull_request.labeled` — triggers review (`doobee:review`) or revise (`doobee:revise`)
- `pull_request.review_requested` — triggers review (when requested reviewer is bot)
- `issue_comment.created` — triggers solve, review, or revise (when comment mentions bot with a command)
- `pull_request_review.submitted` — triggers revise (auto, only if "changes requested" on a bot PR)
- `installation.created` — creates labels
- `installation_repositories.added` — creates labels

### Job queue

Global single-job queue. One Claude session at a time. Not persisted — if the server restarts, queued jobs are lost (webhooks can be replayed).

### Worktree lifecycle

Every solve/revise creates a git worktree for isolation. Worktrees live at `<repoDir>/.worktrees/doobee-<branch>`. Created before Claude runs, removed in a `finally` block after. The main checkout is never mutated.

## Project Structure

- `src/server.ts` — HTTP server, webhook signature verification, event routing. Entry point.
- `src/queue.ts` — Global single-job queue.
- `src/solve.ts` — Core solve flow: worktree → prompt → Claude → PR.
- `src/revise.ts` — Revision flow: read review comments → Claude → push fixes.
- `src/github.ts` — Octokit wrapper. App auth, PRs, labels, comments, reviews. All functions take an authenticated `Octokit` instance as first arg.
- `src/git.ts` — Git worktree management, branches, push, commit detection. All via `Bun.spawn`.
- `src/claude.ts` — Spawn Claude CLI, build prompts (solve/revise/review/system), parse output markers.
- `src/config.ts` — Load `.doobee.json` from repos, merge with defaults. Exports `DEFAULT_CONFIG`.
- `src/commands.ts` — Shared `runCommands` helper for lifecycle commands.
- `src/review-pr.ts` — PR review flow: worktree → diff → Claude → inline comments.
- `src/parse-command.ts` — Parse `@doobeebot` comment commands. Pure function.
- `src/handlers/labeled.ts` — Handle `issues.labeled` webhook (doobee:solve label).
- `src/handlers/pr-labeled.ts` — Handle `pull_request.labeled` webhook (doobee:review and doobee:revise labels).
- `src/handlers/review-requested.ts` — Handle `pull_request.review_requested` webhook (review when bot added as reviewer).
- `src/handlers/comment.ts` — Handle `issue_comment.created` webhook (comment commands).
- `src/handlers/review.ts` — Handle `pull_request_review.submitted` webhook (auto-revise).
- `src/handlers/install.ts` — Handle `installation.created` and `installation_repositories.added` webhooks.
- `src/types.ts` — Shared domain types: `Issue`, `SubIssueGroup`, `ReviewComment`, `PullRequest`, `InlineComment`, `DoobeeConfig`, `Result<T>`.
- `schema.json` — JSON Schema for `.doobee.json` config files.

## Philosophy

Keep it tight. Minimal code, minimal complexity. Every line earns its place. If it can be done in 5 lines, don't write 20. Prefer flat, obvious code over clever indirection.

SOLID where it matters: single responsibility per module, depend on abstractions at boundaries, but don't over-abstract. Three similar lines beat a premature helper.

## Rules

### TypeScript

- Bun runtime. No Node.js polyfills.
- Strict mode. No `any` — use `unknown` and narrow.
- Short, clear names. `solve`, `revise`, `queue` — not `issueSolverService`.
- Functions over classes unless state is needed. When a class is needed, keep it small.
- One export per file when possible. Name the export to match the file.
- Early returns over nested ifs.
- Errors are values. Throw only for unrecoverable failures. Return `{ ok, error }` for expected failures using the `Result<T>` type from `src/types.ts`.
- No barrel files. Import from the source directly.
- No enums. Use `as const` objects or union types.
- Prefer `interface` over `type` for object shapes.
- Template literals over string concatenation.

### Types

- **Domain types** (`Issue`, `PullRequest`, `ReviewComment`, `SubIssueGroup`, `DoobeeConfig`) are slim, intentional subsets of GitHub's data. They live in `src/types.ts` and flow through the entire codebase. Don't replace them with Octokit's full API response types.
- **Webhook payload types** come from Octokit. Handlers accept `EmitterWebhookEvent<"event.action">` from `@octokit/webhooks`. Don't write manual payload interfaces.
- **`Result<T>`** = `{ ok: true, value: T } | { ok: false, error: string }`. Used for operations that can fail expectedly (git commands, PR creation). Check `.ok` before accessing `.value`.

### Dependencies

Runtime: `@octokit/app`, `@octokit/webhooks`. That's it. Add nothing without explicit approval.

External CLIs: `git`, `claude`. Must be on PATH.

### Config

Per-repo config is `.doobee.json` in the repo root, validated against `schema.json`.

Defaults (from `src/config.ts`):
- `baseBranch`: `"main"`
- `commands`: all empty arrays
- `maxRetries`: `3`
- `timeout`: `3600` (seconds)

If `.doobee.json` is missing, defaults are used. If it exists but is invalid JSON, throw.

### Git

- Branches: `doobee/<issue>` (standalone) or `doobee/<parent>` (sub-issue group).
- Commits by Claude: `ISSUE #<number>: <description>`.
- Revision commits by Claude: `PR #<number>: address review feedback`.
- Use `git worktree` for parallel isolation. Never mutate the main checkout.
- Push rebases onto remote if the branch has diverged (e.g., from a previous revise or manual edit). If rebase has conflicts, the push fails and reports the error.
- Never force-push.
- Repos are cloned to `<REPOS_DIR>/<owner>/<repo>`.

### GitHub App

- Bot identity: `doobeebot[bot]` (configurable via `BOT_NAME` env var).
- Solve trigger: add the `doobee:solve` label to an issue, or comment `@doobeebot solve` on an issue.
- Review triggers: add the `doobee:review` label to a PR, add bot as a reviewer on a PR, or comment `@doobeebot review` on a PR.
- Revise triggers: add the `doobee:revise` label to a PR, comment `@doobeebot revise` on a PR, or submit "Request changes" review on a bot PR (auto-triggers revise).
- Comment commands: `@doobeebot solve [context]` on issues, `@doobeebot review [context]` or `@doobeebot revise [context]` on PRs. Bare `@doobeebot` defaults to solve on issues, review on PRs. Text after the command becomes extra context in Claude's prompt.
- Labels: `doobee:solve` (trigger solve on issues), `doobee:review` (trigger review on PRs), `doobee:revise` (trigger revise on PRs), `doobee:stuck` (added when Claude can't resolve), `doobee:in-progress` (added while working, removed when done). Trigger labels are removed when the job starts, so re-adding re-triggers the action.
- On stuck: bot comments with reason, adds `doobee:stuck`.

### Claude Invocation

```
claude -p --dangerously-skip-permissions --append-system-prompt "<system>" [--model <model>] "<prompt>"
```

**System prompt** tells Claude:
- Fully automated pipeline, never pause for confirmation.
- Full file permissions, clean feature branch in a worktree.
- Which setup/start commands already ran.
- Focus on the issue, smallest change possible.

**Solve prompt** includes: issue number/title/body, promptContext if set, extraContext from comment commands if set (under "## User Instructions"), instructions to implement + test + run fix/verify commands + commit. Markers for stuck/complete.

**Revision prompt** includes: PR number/title/body, all review comments (author, body, file:line, diff hunk), extraContext from comment commands if set (under "## User Instructions"), same fix/verify/context instructions. When triggered by label (`doobee:revise`), collects ALL reviews with changes_requested state. When triggered by a specific review webhook, fetches only that review's comments.

**Review prompt** includes: PR number/title/body, full diff in fenced block, promptContext, extraContext from comment commands if set (under "## User Instructions"). Tells Claude to output `[DOOBEE:REVIEW]...[DOOBEE:REVIEW_END]` markers with JSON inline comments, or `[DOOBEE:COMPLETE]` if clean.

**Review system prompt**: automated pipeline, read-only (no file modifications), focus on correctness not style.

**Output markers** (Claude outputs these literally):
- `[DOOBEE:STUCK]` — issue could not be resolved.
- `[DOOBEE:COMPLETE]` — issue was already resolved, no changes needed.
- `[DOOBEE:REVIEW]{"path","line","body"}[DOOBEE:REVIEW_END]` — inline review comment (review flow only).

**Result parsing**: scan stdout+stderr for markers. `[DOOBEE:STUCK]` → stuck, `[DOOBEE:COMPLETE]` → complete, non-zero exit without marker → crashed, otherwise → solved.

### Error Handling

- Never silently swallow errors.
- Log with context: what failed, why, what issue/PR it relates to.
- If Claude gets stuck, label `doobee:stuck` and skip downstream dependents.
- Worktree cleanup runs in `finally` blocks — always cleans up even on error.

### Documentation

When changing behavior, update `CLAUDE.md` and `README.md` to match. Docs stay in sync with code.
