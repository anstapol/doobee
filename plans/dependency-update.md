# Plan: Scheduled Dependency Update Cron

## Context

Doobee is currently purely event-driven (webhooks). The user wants a weekly cron that automatically checks all installed repos for outdated dependencies, updates them using Claude, and creates PRs. This is essentially a "Dependabot-like" feature powered by Claude — ecosystem-agnostic, running inside the existing server process.

## Approach

Add a timer-based cron inside `server.ts` that weekly enumerates all GitHub App installations, iterates their repos, and for each repo spawns Claude to detect and update outdated dependencies. One PR per repo with all updates bundled.

## Files to Create/Modify

### 1. `src/update.ts` (new) — Core workflow

Main function `updateAllDeps(github, reposDir, allowedAccounts)`:

1. **List installations**: Use `github.app.octokit.request("GET /app/installations")` to enumerate all installations
2. **Filter by allowlist**: Skip accounts not in `ALLOWED_ACCOUNTS`
3. **List repos per installation**: `octokit.request("GET /installation/repositories")` with pagination
4. **For each repo**:
   - Skip if an open PR from branch `doobee/dependency-update` already exists
   - Clone/fetch using existing `cloneIfMissing()` from `src/git.ts`
   - Load `.doobee.json` using `loadConfig()` from `src/config.ts`
   - Create worktree on branch `doobee/dependency-update` from `origin/<baseBranch>`
   - Run setup commands (e.g., `npm ci`) using `runCommands()` from `src/commands.ts`
   - Spawn Claude with a dependency-update prompt (see below)
   - If Claude made commits (`hasNewCommits`), push and create PR
   - Cleanup worktree in `finally` block
5. Process repos **sequentially** (one at a time) to avoid resource issues
6. Log progress, skip failures gracefully (log + continue to next repo)

**Claude prompt** for dependency updates:
```
# Update Dependencies

Check for outdated dependencies in this project. Update the main dependencies
to their latest compatible versions.

## Instructions

1. Identify the package manager(s) used (npm, pip, cargo, go modules, etc.)
2. Check which dependencies have newer versions available
3. Update dependencies conservatively — prefer minor/patch bumps, flag major bumps in commit message
4. Run the lock file update (e.g., `bun install`, `npm install`, `pip freeze`)
5. Run verify commands: <from config>
6. Commit with message: chore: upgrade dependencies

If all dependencies are already up to date, output exactly: [DOOBEE:COMPLETE]
If you cannot update dependencies safely, output exactly: [DOOBEE:STUCK]
```

**PR format**:
- Branch: `doobee/dependency-update`
- Title: `chore: upgrade dependencies`
- Body: `Automated dependency update by Doobee.`

**Skip logic**: Before processing a repo, check if there's already an open PR with `head: doobee/dependency-update`. If so, skip (don't create duplicate PRs).

### 2. `src/server.ts` (modify) — Wire up the timer

- Import `updateAllDeps` from `./update`
- Read `UPDATE_INTERVAL_HOURS` env var (default: `168` = 7 days)
- After server starts, set up `setInterval` calling `updateAllDeps`
- Also run once after a 60-second startup delay (don't block server boot)
- Pass `github`, `reposDir`, `allowedAccounts` to the function
- Wrap in try/catch so cron failures don't crash the server

```typescript
const updateInterval = parseInt(process.env.UPDATE_INTERVAL_HOURS ?? "168", 10) * 3600_000
const runUpdate = () => updateAllDeps(github, reposDir, allowedAccounts).catch(err =>
  console.error("[cron] Dependency update sweep failed:", err)
)
setTimeout(runUpdate, 60_000) // first run after 60s
setInterval(runUpdate, updateInterval)
```

### 3. `.env.example` (modify) — Document new env var

Add:
```
UPDATE_INTERVAL_HOURS=168  # How often to check for dependency updates (0 to disable)
```

### 4. `src/github.ts` (modify) — Add helper to check for existing open PR

Add a `findOpenPr` function:
```typescript
export async function findOpenPr(
  octokit: Octokit,
  opts: { owner: string; repo: string; head: string },
): Promise<boolean> {
  const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls", {
    owner: opts.owner, repo: opts.repo,
    head: `${opts.owner}:${opts.head}`, state: "open", per_page: 1,
  })
  return data.length > 0
}
```

### 5. `src/claude.ts` (modify) — Add `buildUpdatePrompt`

New prompt builder function for the dependency update task. Reuses the existing system prompt builder pattern.

### 6. Documentation updates

- `CLAUDE.md`: Add cron section documenting the new behavior
- `README.md`: Document `UPDATE_INTERVAL_HOURS` env var and the feature
- `.env.example`: Add the new env var

## Key Design Decisions

- **Not queued**: Runs independently of the job queue to avoid blocking solve/revise jobs. Uses git worktrees for isolation (different branch name `doobee/dependency-update`), so no conflicts.
- **Sequential repos**: Process one repo at a time within the cron sweep to limit resource usage.
- **Skip duplicates**: If `doobee/dependency-update` PR is already open, skip that repo entirely.
- **Disable with 0**: Setting `UPDATE_INTERVAL_HOURS=0` disables the cron entirely.
- **No schema change**: Doesn't add new fields to `.doobee.json` — keeps it simple. Uses existing `commands.verify` for post-update verification.

## Reusable Functions

- `cloneIfMissing()` from `src/git.ts:131` — clone/fetch repos
- `configureAuth()` from `src/git.ts:26` — set git auth token
- `fetch()` from `src/git.ts:113` — git fetch origin
- `createWorktree()` / `removeWorktree()` from `src/git.ts:44,75` — worktree lifecycle
- `push()` from `src/git.ts:84` — push with rebase retry
- `getCurrentSha()` / `hasNewCommits()` from `src/git.ts:107,102`
- `createPr()` from `src/github.ts:41` — create pull request
- `loadConfig()` from `src/config.ts:21` — load `.doobee.json`
- `runClaude()` from `src/claude.ts:8` — spawn Claude CLI
- `buildSystemPrompt()` from `src/claude.ts:280` — system prompt for Claude
- `runCommands()` from `src/commands.ts` — run lifecycle commands

## Verification

1. Set `UPDATE_INTERVAL_HOURS=0.01` (36 seconds) for testing
2. Start the server with `bun run dev`
3. Verify the first sweep runs after ~60s and logs repos being processed
4. Confirm it skips repos where `doobee/dependency-update` PR already exists
5. Verify worktrees are cleaned up after each repo
6. Check that a PR is created with the expected title and branch
7. Set `UPDATE_INTERVAL_HOURS=0` and verify the cron doesn't run
