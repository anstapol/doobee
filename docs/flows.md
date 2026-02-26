# Flows

Detailed diagrams for every Doobee workflow.

## Solve flow

Triggered by: `doobee:solve` label on an issue, or `@doobeebot solve` comment.

```mermaid
flowchart TD
    Start[issues.labeled / comment] --> Validate{doobee:solve label?}
    Validate -->|No| Ignore[Ignore]
    Validate -->|Yes| Clone[Clone repo if missing]
    Clone --> Config[Load .doobee.json]
    Config --> Enqueue[Enqueue solve job]
    Enqueue --> Fetch[git fetch origin]
    Fetch --> Parent{Has parent issue?}

    Parent -->|No| Single[Single issue<br/>Branch: doobee/issue#]
    Parent -->|Yes| SubIssues[Fetch all sub-issues<br/>Branch: doobee/parent#]

    Single --> Worktree[Create worktree]
    SubIssues --> Worktree

    Worktree --> Docker[Isolate Docker ports]
    Docker --> Vars[Fetch repo/org variables]
    Vars --> Setup[Run setup + start commands]
    Setup --> Loop[For each issue in group]

    Loop --> SHA[Record current SHA]
    SHA --> Claude[Spawn Claude CLI]
    Claude --> Result{Parse result}

    Result -->|solved| NewCommits{New commits?}
    Result -->|complete| Skip[Already resolved — skip]
    Result -->|stuck / crashed| Stuck[Label doobee:stuck<br/>Post comment<br/>Break loop]

    NewCommits -->|Yes| Track[Track as solved]
    NewCommits -->|No| Skip

    Track --> More{More issues?}
    Skip --> More
    More -->|Yes| Loop
    More -->|No| Solved{Any solved issues?}
    Stuck --> Solved

    Solved -->|Yes| Push[git push branch]
    Solved -->|No| Cleanup

    Push --> PR[Create PR with 'Closes #N']
    PR --> Cleanup[Run stop commands<br/>Remove worktree]
```

## Revise flow

Triggered by: `doobee:revise` label on a PR, `@doobeebot revise` comment, or "Request changes" review on a bot PR.

```mermaid
flowchart TD
    Start[PR labeled / comment / review submitted] --> Validate{Valid revise trigger?}
    Validate -->|No| Ignore[Ignore]
    Validate -->|Yes| Clone[Clone repo if missing]
    Clone --> Config[Load .doobee.json]
    Config --> Enqueue[Enqueue revise job]
    Enqueue --> Fetch[git fetch origin]
    Fetch --> Worktree[Create worktree from PR branch]
    Worktree --> Docker[Isolate Docker ports]
    Docker --> Vars[Fetch repo/org variables]
    Vars --> Reviews[Fetch review comments<br/>review-level + inline with diff context]
    Reviews --> Setup[Run setup + start commands]
    Setup --> Claude[Spawn Claude CLI with revision prompt]
    Claude --> Result{Parse result}

    Result -->|solved + new commits| Push[git push to PR branch]
    Result -->|complete| Done[Feedback already addressed]
    Result -->|stuck / crashed| Stuck[Label doobee:stuck on PR<br/>Post comment]

    Push --> Cleanup[Run stop commands<br/>Remove worktree]
    Done --> Cleanup
    Stuck --> Cleanup
```

When triggered by the `doobee:revise` label, all reviews with `changes_requested` state are collected. When triggered by a specific review webhook, only that review's comments are fetched.

## Review flow

Triggered by: `doobee:review` label on a PR, bot added as reviewer, or `@doobeebot review` comment.

```mermaid
flowchart TD
    Start[PR labeled / review requested / comment] --> Validate{Valid review trigger?}
    Validate -->|No| Ignore[Ignore]
    Validate -->|Yes| Clone[Clone repo if missing]
    Clone --> Config[Load .doobee.json]
    Config --> Enqueue[Enqueue review job]
    Enqueue --> Fetch[git fetch origin]
    Fetch --> Worktree[Create worktree on PR branch]
    Worktree --> Diff[git diff against base branch]
    Diff --> Claude[Spawn Claude CLI with review prompt]
    Claude --> Parse[Parse output for DOOBEE:REVIEW markers]
    Parse --> Comments{Inline comments found?}

    Comments -->|Yes| Submit[Submit review with inline comments]
    Comments -->|No / DOOBEE:COMPLETE| Clean[Code looks clean — no comments]

    Submit --> Cleanup[Remove worktree]
    Clean --> Cleanup
```

Review is read-only — Claude does not modify files. Comments focus on correctness, bugs, and logic errors — not style.

## Comment routing

Triggered by: `issue_comment.created` webhook with an `@doobeebot` mention.

```mermaid
flowchart TD
    Start[issue_comment.created] --> BotCheck{Comment by bot?}
    BotCheck -->|Yes| Ignore[Ignore own comments]
    BotCheck -->|No| Closed{Issue/PR closed?}
    Closed -->|Yes| Ignore
    Closed -->|No| Parse[Parse @doobeebot mention]
    Parse --> Command{Command?}

    Command -->|solve| IssueCheck{Is an issue?}
    Command -->|review| PRCheck1{Is a PR?}
    Command -->|revise| PRCheck2{Is a PR?}
    Command -->|bare mention| Type{Issue or PR?}

    IssueCheck -->|Yes| EnqueueSolve[Enqueue solve<br/>with extra context]
    IssueCheck -->|No| Invalid[Invalid: solve only on issues]

    PRCheck1 -->|Yes| EnqueueReview[Enqueue review<br/>with extra context]
    PRCheck1 -->|No| Invalid2[Invalid: review only on PRs]

    PRCheck2 -->|Yes| EnqueueRevise[Enqueue revise<br/>with extra context]
    PRCheck2 -->|No| Invalid3[Invalid: revise only on PRs]

    Type -->|Issue| EnqueueSolve
    Type -->|PR| EnqueueReview
```

Text after the command (e.g. `@doobeebot solve focus on the API layer`) becomes extra context in Claude's prompt.

## Cancellation

Triggered by: removing the `doobee:in-progress` label from an issue or PR.

```mermaid
sequenceDiagram
    participant U as User
    participant GH as GitHub
    participant H as Unlabeled Handler
    participant Q as Job Queue
    participant C as Claude Process
    participant F as Finally Block

    U->>GH: Remove doobee:in-progress label
    GH->>H: issues.unlabeled / pull_request.unlabeled
    H->>Q: queue.cancel(jobId)

    alt Job is running
        Q->>Q: Abort AbortController
        Q->>C: Signal fires → kill process
        C->>F: Process exits
        F->>F: Run stop commands
        F->>F: Remove worktree
    else Job is pending
        Q->>Q: Remove from queue
    end

    Note over Q: Queue moves to next job
```
