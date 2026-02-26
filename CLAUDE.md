# Doobee

GitHub App that resolves issues autonomously. Listens for webhooks, spawns Claude Code to solve issues, and opens PRs.

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

External CLIs: `git`, `claude`, `docker` (optional, for port isolation). Must be on PATH.

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

- Account allowlist: `ALLOWED_ACCOUNTS` env var (comma-separated GitHub usernames/orgs). Webhooks from unlisted accounts are silently dropped. If unset or empty, all webhooks are skipped.
- Bot identity: `doobeebot[bot]` (configurable via `BOT_NAME` env var).
- Solve trigger: add the `doobee:solve` label to an issue, or comment `@doobeebot solve` on an issue.
- Review triggers: add the `doobee:review` label to a PR, add bot as a reviewer on a PR, or comment `@doobeebot review` on a PR.
- Revise triggers: add the `doobee:revise` label to a PR, comment `@doobeebot revise` on a PR, or submit "Request changes" review on a bot PR (auto-triggers revise).
- Comment commands: `@doobeebot solve [context]` on issues, `@doobeebot review [context]` or `@doobeebot revise [context]` on PRs. Bare `@doobeebot` defaults to solve on issues, review on PRs. Text after the command becomes extra context in Claude's prompt.
- Labels: `doobee:solve` (trigger solve on issues), `doobee:review` (trigger review on PRs), `doobee:revise` (trigger revise on PRs), `doobee:stuck` (added when Claude can't resolve), `doobee:in-progress` (added while working, removed when done). Trigger labels are removed when the job starts, so re-adding re-triggers the action.
- On stuck: bot comments with reason, adds `doobee:stuck`.

### Error Handling

- Never silently swallow errors.
- Log with context: what failed, why, what issue/PR it relates to.
- If Claude gets stuck, label `doobee:stuck` and skip downstream dependents.
- Worktree cleanup runs in `finally` blocks — always cleans up even on error.

### Documentation

When changing behavior, update `CLAUDE.md`, `README.md`, and relevant `docs/` files to match. Docs stay in sync with code.
