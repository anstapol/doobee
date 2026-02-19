# Solve flow

Triggered when a user assigns an issue to `doobeebot[bot]`.

## Flow

```
                  issues.assigned webhook
                           |
                   is assignee the bot?
                      /          \
                    NO            YES
                     |              |
                  ignore      clone repo if missing
                                    |
                             load .doobee.json
                                    |
                             enqueue solve job
                                    |
                          ── job starts ──
                                    |
                              git fetch origin
                                    |
                         has parent issue?
                            /          \
                          NO            YES
                           |              |
                     single issue    fetch all sub-issues
                           |              |
                     branch:           branch:
                     doobee/<issue>     doobee/<parent>
                           \          /
                            +--------+
                                 |
                          create worktree
                                 |
                       run commands.setup
                       run commands.start
                                 |
                    for each issue in group:
                                 |
                      record current SHA
                                 |
                      build prompt + system prompt
                                 |
                         spawn Claude CLI
                                 |
                       parse result:
                          |
                          +---> "solved"
                          |       |
                          |    new commits? → track as solved
                          |
                          +---> "complete"
                          |       |
                          |    already resolved, skip
                          |
                          +---> "stuck" / "crashed"
                                  |
                               label doobee:stuck
                               post comment
                               unassign bot
                               mark remaining issues stuck
                               break
                                 |
                    any solved issues?
                       /            \
                     NO              YES
                      |                |
                    done          git push branch
                                       |
                                  create PR
                                  "Closes #N" per solved issue
                                       |
                              run commands.stop
                                       |
                              remove worktree
```

## Branch naming

| Type | Pattern |
|---|---|
| Standalone issue | `doobee/<issue#>` |
| Sub-issue group | `doobee/<parent#>` |

## Commit messages

```
ISSUE #<number>: <short description>
```

## PR body

```
Closes #1
Closes #2
Closes #3
```

If all sub-issues of a parent are solved, the parent issue number is included too.

If some issues in a group got stuck, the PR title gets a `(partial)` suffix.

## Notifications

| When | Message |
|---|---|
| Job picked up | `Picked up #N: <title>` |
| Issue solved | `Solved #N: <title>` |
| Issue already done | `#N already resolved — no changes needed` |
| Issue stuck | `Stuck on #N: <title>` |
| PR created | `PR #N created for <title>` |
| Solve complete | `Solve complete for #N` |
