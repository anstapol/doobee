# Architecture

## Overview

Doobee is an event-driven GitHub App. No polling, no cron — webhooks trigger everything.

```mermaid
flowchart LR
    GH[GitHub Webhook] --> Server[Bun HTTP Server]
    Server --> Queue[Job Queue]
    Queue --> Claude[Claude Code CLI]
    Claude --> Git[Git Push]
    Git --> PR[Pull Request]
```

## Components

| Component | File | Responsibility |
|---|---|---|
| HTTP server | `src/server.ts` | Webhook signature verification, event routing |
| Job queue | `src/queue.ts` | Single-job queue with cancellation support |
| Solve | `src/solve.ts` | Issue → worktree → Claude → PR |
| Revise | `src/revise.ts` | Review feedback → worktree → Claude → push |
| Review | `src/review-pr.ts` | PR diff → Claude → inline comments |
| GitHub API | `src/github.ts` | Octokit wrapper (PRs, labels, comments, reviews, variables) |
| Git ops | `src/git.ts` | Worktree management, branches, push, commit detection |
| Claude CLI | `src/claude.ts` | Spawn Claude, build prompts, parse output markers |
| Config | `src/config.ts` | Load `.doobee.json`, merge with defaults |
| Commands | `src/commands.ts` | Run lifecycle commands (setup, start, stop) |
| Command parser | `src/parse-command.ts` | Parse `@doobeebot` comment commands |

### Handlers

| Handler | File | Webhook event |
|---|---|---|
| Labeled | `src/handlers/labeled.ts` | `issues.labeled` (solve trigger) |
| PR labeled | `src/handlers/pr-labeled.ts` | `pull_request.labeled` (review/revise trigger) |
| Review requested | `src/handlers/review-requested.ts` | `pull_request.review_requested` |
| Comment | `src/handlers/comment.ts` | `issue_comment.created` |
| Review submitted | `src/handlers/review.ts` | `pull_request_review.submitted` (auto-revise) |
| Unlabeled | `src/handlers/unlabeled.ts` | `issues.unlabeled` / `pull_request.unlabeled` (cancel) |
| Install | `src/handlers/install.ts` | `installation.created` / `installation_repositories.added` |

## Webhook routing

The server listens for nine webhook events and routes them to handlers:

```mermaid
flowchart TD
    WH[Incoming Webhook] --> Verify{Signature valid?}
    Verify -->|No| Drop[Drop request]
    Verify -->|Yes| Account{Allowed account?}
    Account -->|No| Ignore[Ignore silently]
    Account -->|Yes| Route{Event type}

    Route -->|issues.labeled| Solve[Solve handler]
    Route -->|issues.unlabeled| Cancel[Cancel handler]
    Route -->|pull_request.labeled| PRLabel{Label?}
    Route -->|pull_request.unlabeled| Cancel
    Route -->|pull_request.review_requested| Review[Review handler]
    Route -->|issue_comment.created| Comment[Comment handler]
    Route -->|pull_request_review.submitted| AutoRevise[Auto-revise handler]
    Route -->|installation.*| Install[Install handler]

    PRLabel -->|doobee:review| Review
    PRLabel -->|doobee:revise| Revise[Revise handler]

    Comment --> Parse{Parse command}
    Parse -->|solve| Solve
    Parse -->|review| Review
    Parse -->|revise| Revise
```

## Worktree lifecycle

Every solve, revise, and review job runs in an isolated git worktree. The main checkout is never mutated.

```mermaid
sequenceDiagram
    participant Q as Job Queue
    participant G as Git
    participant W as Worktree
    participant C as Claude CLI
    participant F as Finally Block

    Q->>G: git fetch origin
    G->>W: git worktree add .worktrees/doobee-<branch>
    Note over W: Isolated working directory
    W->>W: Run setup + start commands
    W->>C: Spawn Claude CLI
    C->>C: Solve / revise / review
    C-->>W: Exit (success or failure)
    W->>W: Push if commits exist
    W->>F: Always runs (even on error)
    F->>W: Run stop commands
    F->>G: git worktree remove
```

Worktrees live at `<repoDir>/.worktrees/doobee-<branch>`. Created before Claude runs, removed in a `finally` block after — cleanup always happens, even on crashes or cancellation.

## Job queue

Global single-job queue — one Claude session runs at a time. Jobs are in-memory and not persisted; if the server restarts, queued jobs are lost (webhooks can be replayed by re-adding the trigger label).

Each job receives an `AbortSignal` from the queue's `AbortController`. When a job is cancelled (via label removal), the signal fires, killing the Claude process. The `finally` blocks handle cleanup naturally.

Queue behavior:
- **Running job**: `cancel()` aborts the `AbortController`, killing the Claude process
- **Pending job**: `cancel()` removes it from the queue before it starts
- **New job**: enqueued and waits for the current job to finish
