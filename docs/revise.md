# Revise flow

Triggered when a reviewer submits "Request changes" on a bot PR.

## Flow

```
          pull_request_review.submitted webhook
                           |
                 review state = "changes_requested"?
                      /          \
                    NO            YES
                     |              |
                  ignore      PR opened by bot?
                                /          \
                              NO            YES
                               |              |
                            ignore      clone repo if missing
                                              |
                                       load .doobee.json
                                              |
                                       enqueue revise job
                                              |
                                    ── job starts ──
                                              |
                                        git fetch origin
                                              |
                                  create worktree from PR branch
                                              |
                                  fetch all review comments
                                  (review-level + inline with diff context)
                                              |
                                     run commands.setup
                                     run commands.start
                                              |
                                    record current SHA
                                              |
                                build revision prompt + system prompt
                                              |
                                   spawn Claude CLI
                                              |
                                  parse result:
                                     |
                                     +---> "solved" + new commits
                                     |       |
                                     |    git push to PR branch
                                     |
                                     +---> "complete"
                                     |       |
                                     |    feedback already addressed
                                     |
                                     +---> "stuck" / "crashed"
                                             |
                                          label doobee:stuck on PR
                                          post comment on PR
                                              |
                                     run commands.stop
                                              |
                                     remove worktree
```

## Revision prompt

Claude receives:

- PR number, title, body
- All review comments with:
  - Author name
  - Comment body
  - File path and line number (for inline comments)
  - Diff hunk context (for inline comments)
- `promptContext` from config if set
- Instructions to address feedback and commit

## Commit messages

```
PR #<number>: address review feedback
```

## Notifications

| When | Message |
|---|---|
| Job picked up | `Revision requested on PR #N: <title>` |
| Revision pushed | `Pushed revision for PR #N` |
| Already addressed | `PR #N — review feedback already addressed` |
| Stuck | `Stuck on revision for PR #N` |
