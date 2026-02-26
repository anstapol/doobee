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

Doobee can also [review PRs, revise based on feedback, handle sub-issues, and more](docs/usage.md).

## Quick start

### Prerequisites

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

1. Go to **Settings > Developer settings > GitHub Apps > New GitHub App**
2. Set the **webhook URL** to `https://your-server:4567/webhook`
3. Set a **webhook secret** (random string)
4. Enable these **permissions**:
   - **Issues**: Read & write
   - **Pull requests**: Read & write
   - **Contents**: Read & write
   - **Variables**: Read (optional — for repo/org variables)
   - **Organization variables**: Read (optional — for org variables)
5. Subscribe to these **events**: Issues, Issue comments, Pull request, Pull request review
6. Generate a **private key** and download the `.pem` file
7. Note the **App ID** from the app settings page
8. Install the app on your repos

When installed, Doobee automatically creates the `doobee:solve`, `doobee:review`, `doobee:revise`, `doobee:stuck`, and `doobee:in-progress` labels on each repo.

### Environment

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `APP_ID` | Yes | GitHub App ID |
| `PRIVATE_KEY_PATH` | Yes | Path to the `.pem` private key file |
| `WEBHOOK_SECRET` | Yes | Webhook secret set during app creation |
| `REPOS_DIR` | No | Where repos are cloned (default: `./repos`) |
| `PORT` | No | Server port (default: `4567`) |
| `BOT_NAME` | No | Bot login name (default: `doobeebot[bot]`) |
| `ALLOWED_ACCOUNTS` | Yes | Comma-separated GitHub usernames/orgs to allow |

### Run

```bash
bun run dev
```

## Config

Create `.doobee.json` in your repo root:

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

| Field | Default | Description |
|---|---|---|
| `baseBranch` | `"main"` | Branch to create feature branches from |
| `commands.setup` | `[]` | Run once when worktree is created (e.g. install deps) |
| `commands.start` | `[]` | Run before Claude starts (e.g. start services) |
| `commands.stop` | `[]` | Run after Claude finishes (e.g. tear down services) |
| `commands.verify` | `[]` | Passed to Claude — runs these to verify the build |
| `commands.fix` | `[]` | Passed to Claude — runs these to auto-fix lint/format |
| `maxRetries` | `3` | Attempts before marking stuck |
| `timeout` | `3600` | Max seconds per Claude invocation |
| `model` | — | Claude model override |
| `promptContext` | — | Extra context for Claude's prompt |

All fields are optional. See [full configuration docs](docs/configuration.md) for repo/org variables, Docker port isolation, and more.

## Deployment

The `bin/doobee` CLI manages your VPS:

```bash
export PATH="/path/to/doobee/bin:$PATH"
doobee config vps_host root@your-server
doobee install    # first-time setup
doobee deploy     # push updates
doobee logs       # follow service logs
doobee status     # systemctl status
doobee ssh        # open shell on VPS
```

After `doobee install`, follow the printed instructions to copy your `.pem` key, fill in `.env`, authenticate Claude CLI, and set up a reverse proxy.

For local development, use `bun run dev` with ngrok or a similar tunnel for the webhook URL.

## Documentation

- **[Architecture](docs/architecture.md)** — system overview, components, webhook routing, worktree lifecycle, job queue
- **[Flows](docs/flows.md)** — detailed Mermaid diagrams for solve, revise, review, comment routing, and cancellation
- **[Configuration](docs/configuration.md)** — `.doobee.json` deep dive, repo/org variables, Docker port isolation, env vars
- **[Usage](docs/usage.md)** — triggering actions, comment commands, cancellation, stuck handling, sub-issues, label lifecycle
- **[Reference](docs/reference.md)** — labels, branches, commits, webhook events, endpoints, output markers
