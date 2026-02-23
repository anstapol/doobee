# Doobee

GitHub App that resolves issues autonomously. Listens for webhooks, spawns Claude Code to solve issues, and opens PRs.

## How it works

```
GitHub webhook → Bun HTTP server → Job queue → Claude Code CLI → PR
```

1. You add the `doobee:solve` label to an issue or comment `@doobeebot solve`
2. GitHub sends a webhook to the Doobee server
3. Doobee clones the repo (if first time), creates a git worktree on a new branch
4. Runs your setup/start commands, then spawns Claude Code with the issue as a prompt
5. Claude resolves the issue, runs verify/fix commands, and commits
6. Doobee pushes the branch and opens a PR with `Closes #N`
7. Runs your stop commands, removes the worktree

For sub-issues (GitHub's native hierarchy), Doobee detects the parent, fetches all siblings, and processes them sequentially on a shared branch (`doobee/<parent#>`).

### Revisions

Add the `doobee:revise` label to a PR (or comment `@doobeebot revise`) to address review feedback. Doobee checks out the existing PR branch, reads all review comments (including inline feedback with file paths, line numbers, and diff context), spawns Claude to address them, and pushes fixes to the same branch.

Revise also auto-triggers when a reviewer submits "Request changes" on a Doobee PR.

### PR Reviews

Add the `doobee:review` label to any PR, add `doobeebot[bot]` as a reviewer, or comment `@doobeebot review` and Doobee will review it. Doobee checks out the PR branch, diffs it against the base branch, and spawns Claude to review the changes. Claude posts inline comments focusing on correctness, bugs, and logic errors — not style. If the code looks clean, no comments are posted. This is non-critical: if the review fails, it's logged but doesn't affect the PR.

### Comment commands

Comment on an issue or PR to trigger Doobee directly:

- `@doobeebot solve` — on an issue, triggers solve (same as labeling `doobee:solve`)
- `@doobeebot review` — on a PR, triggers a code review
- `@doobeebot revise` — on a PR, triggers revision (address all review feedback)
- `@doobeebot` — defaults to `solve` on issues, `review` on PRs
- `@doobeebot solve focus on the API layer` — text after the command becomes extra context in Claude's prompt

### When it gets stuck

If Claude can't resolve an issue after `maxRetries` attempts, Doobee:
- Adds the `doobee:stuck` label
- Posts a comment explaining why
- Skips any remaining sub-issues in the group

To retry: remove `doobee:stuck`, fix the issue description if needed, and re-add the `doobee:solve` label.

### Job queue

Global single-job queue — one Claude session at a time. The queue is in-memory — if the server restarts, queued jobs are lost, but you can re-trigger by re-adding the appropriate label (`doobee:solve`, `doobee:review`, or `doobee:revise`).

## Local usage

You can use Doobee as a Claude Code skill to solve issues locally — no server needed.

### Install the skill

```bash
cp -r .claude/skills/gh-solve-issue ~/.claude/skills/gh-solve-issue
```

This installs the `/gh-solve-issue` command globally — it works in any repo.

### Requirements

- `claude` (Claude Code CLI) on PATH, authenticated
- `gh` (GitHub CLI) on PATH, authenticated
- `git` on PATH

### Usage

Open Claude Code in any repo and run:

```
/gh-solve-issue 42
```

This will:
1. Fetch issue #42 from GitHub
2. Read `.doobee.json` config (if present)
3. Create a `doobee/42` branch
4. Run setup and start commands
5. Solve the issue
6. Run fix and verify commands
7. Commit, push, and open a PR
8. Run stop commands

## Server

The server is the fully automated mode — assign an issue to the bot and it handles everything.

### Setup

### Requirements

- [Bun](https://bun.sh) runtime
- `git` on PATH
- `claude` (Claude Code CLI) on PATH, authenticated

### Install

```bash
git clone git@github.com:anstapol/doobee.git
cd doobee
bun install
```

### Create a GitHub App

1. Go to **Settings → Developer settings → GitHub Apps → New GitHub App**
2. Set the **webhook URL** to `https://your-server:4567/webhook`
3. Set a **webhook secret** (random string — you'll need it for `WEBHOOK_SECRET`)
4. Enable these **permissions**:
   - **Issues**: Read & write (to label, comment)
   - **Pull requests**: Read & write (to create PRs, read reviews, label)
   - **Contents**: Read & write (to push branches)
5. Subscribe to these **events**:
   - Issues
   - Issue comments
   - Pull request
   - Pull request review
6. Generate a **private key** and download the `.pem` file
7. Note the **App ID** from the app settings page
8. Install the app on your repos

When installed, Doobee automatically creates the `doobee:stuck`, `doobee:solve`, `doobee:in-progress`, `doobee:review`, and `doobee:revise` labels on each repo.

### Environment

Copy `.env.example` and fill in your values:

```bash
cp .env.example .env
```

```
APP_ID=123456
PRIVATE_KEY_PATH=./private-key.pem
WEBHOOK_SECRET=your-webhook-secret
REPOS_DIR=./repos
PORT=4567
BOT_NAME=doobeebot[bot]
```

| Variable | Required | Description |
|---|---|---|
| `APP_ID` | Yes | GitHub App ID |
| `PRIVATE_KEY_PATH` | Yes | Path to the `.pem` private key file |
| `WEBHOOK_SECRET` | Yes | Webhook secret set during app creation |
| `REPOS_DIR` | No | Where repos are cloned (default: `./repos`) |
| `PORT` | No | Server port (default: `4567`) |
| `BOT_NAME` | No | Bot login name (default: `doobeebot[bot]`) |

Repos are cloned to `<REPOS_DIR>/<owner>/<repo>` using the `clone_url` from the webhook payload. Auth uses the GitHub App installation token via Octokit.

### Run

```bash
bun run dev
```

The server starts on the configured port and logs `Doobee server listening on port 4567`.

## Config

Create `.doobee.json` in your repo root to configure Doobee's behavior for that repo:

```json
{
  "baseBranch": "main",
  "commands": {
    "setup": ["npm ci"],
    "start": ["docker compose up -d"],
    "stop": ["docker compose down"],
    "verify": ["npm run build"],
    "fix": ["npm run lint:fix"]
  },
  "maxRetries": 3,
  "timeout": 3600,
  "model": "claude-sonnet-4-5-20250929",
  "promptContext": "This is a Next.js app with Prisma ORM."
}
```

All fields are optional. If `.doobee.json` is missing, defaults are used. See `schema.json` for the full JSON Schema spec.

| Field | Default | Description |
|---|---|---|
| `baseBranch` | `"main"` | Branch to create feature branches from |
| `commands.setup` | `[]` | Run once when a worktree is created (e.g. install deps) |
| `commands.start` | `[]` | Run before Claude starts (e.g. start services) |
| `commands.stop` | `[]` | Run after Claude finishes (e.g. tear down services) |
| `commands.verify` | `[]` | Passed to Claude's prompt — Claude runs these to verify the build |
| `commands.fix` | `[]` | Passed to Claude's prompt — Claude runs these to auto-fix lint/format |
| `maxRetries` | `3` | Attempts before Claude gives up and marks stuck |
| `timeout` | `3600` | Max seconds for a Claude invocation before it is killed |
| `model` | — | Claude model override (e.g. `claude-sonnet-4-5-20250929`) |
| `promptContext` | — | Extra context injected into Claude's prompt (repo conventions, stack info) |

**Note:** `commands.setup`, `start`, and `stop` are run by Doobee directly (via `sh -c`). `commands.verify` and `fix` are instructions passed to Claude — Claude decides when and how to run them.

## Reference

### Labels

| Label | Where | Meaning |
|---|---|---|
| `doobee:solve` | Issue | Trigger Doobee to solve this issue |
| `doobee:review` | PR | Trigger Doobee to review this PR |
| `doobee:revise` | PR | Trigger Doobee to address review feedback on this PR |
| `doobee:stuck` | Issue/PR | Doobee couldn't resolve this |
| `doobee:in-progress` | Issue/PR | Doobee is currently working on this |

All labels are created automatically when the app is installed. Trigger labels (`doobee:solve`, `doobee:review`, `doobee:revise`) are removed when the job starts, so re-adding re-triggers the action.

### Branch naming

| Type | Pattern | Example |
|---|---|---|
| Standalone issue | `doobee/<issue#>` | `doobee/42` |
| Sub-issue group | `doobee/<parent#>` | `doobee/10` |

### Commit messages

| Context | Format |
|---|---|
| Solving an issue | `ISSUE #<number>: <description>` |
| Addressing review | `PR #<number>: address review feedback` |

### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/webhook` | GitHub webhook receiver (signature-verified) |
| `GET` | `/health` | Queue status: `{ status: "ok", active: <running jobs>, pending: <queued jobs> }` |

## Deployment

### VPS setup

Copy the repo to your server and run the install script:

```bash
# From your local machine (only tracked files, respects .gitignore)
git archive --format=tar HEAD | ssh root@your-vps 'mkdir -p /tmp/doobee && tar -xf - -C /tmp/doobee'

# On the VPS (as root)
bash /tmp/doobee/deploy/install.sh
```

The script creates a `doobee` user, installs Bun, Claude Code CLI, copies the source to `/home/doobee/doobee`, installs dependencies, and sets up a systemd service.

After install, follow the printed instructions to:

1. Copy your GitHub App private key (`.pem`)
2. Fill in `.env` (`APP_ID`, `WEBHOOK_SECRET`)
3. Authenticate Claude CLI (`claude login`)
4. Set up a reverse proxy (Caddy recommended for auto-HTTPS)
5. Start the service (`systemctl start doobee`)

To deploy updates:

```bash
# From your local machine
git archive --format=tar HEAD | ssh root@your-vps 'mkdir -p /tmp/doobee && tar -xf - -C /tmp/doobee'

# On VPS
bash /tmp/doobee/deploy/deploy.sh
```

> **Note:** Claude CLI refuses `--dangerously-skip-permissions` as root — the install script creates a dedicated `doobee` user for this reason.

### Local development

```bash
bun run dev
```

Use ngrok or a similar tunnel to expose the webhook URL during development.
