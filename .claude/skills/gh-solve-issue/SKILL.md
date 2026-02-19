---
name: gh-solve-issue
description: Solve a GitHub issue — branch, fix, commit, push, and open a PR
disable-model-invocation: true
---

Solve a GitHub issue end-to-end in the current repo.

Usage: /gh-solve-issue <issue-number>

You are already in the repo's working directory. Follow these steps in order:

## 1. Fetch the issue

Run `gh issue view $ARGUMENTS --json number,title,body` to get the issue details. If it fails, stop and tell the user.

## 2. Load config

Read `.doobee.json` from the repo root if it exists. It may contain:
- `baseBranch` — branch to base off (default: `main`)
- `commands.setup` — run once to set up the environment (e.g. `npm ci`)
- `commands.start` — run before solving (e.g. `docker compose up -d`)
- `commands.stop` — run after solving (e.g. `docker compose down`)
- `commands.fix` — auto-fix commands to run after changes (e.g. `npm run lint:fix`)
- `commands.verify` — verify commands to run after changes (e.g. `npm run build`)
- `promptContext` — extra context about the repo

If the file doesn't exist, use defaults (baseBranch: `main`, no commands).

## 3. Create a branch

```bash
git checkout -b doobee/$ARGUMENTS <baseBranch>
```

## 4. Run setup and start commands

If `.doobee.json` has `commands.setup`, run each command. Then if it has `commands.start`, run each command.

## 5. Solve the issue

Implement the fix or feature described in the issue. Write tests if applicable. Make the smallest change possible. Use existing patterns in the codebase.

If `promptContext` exists in config, use it as additional context about the repo.

## 6. Fix and verify

If `.doobee.json` has `commands.fix`, run them. Then if it has `commands.verify`, run them. Fix any failures.

## 7. Commit

```bash
git add <changed files>
git commit -m "ISSUE #$ARGUMENTS: <short description>"
```

## 8. Push and open a PR

```bash
git push -u origin doobee/$ARGUMENTS
gh pr create --title "<issue title>" --body "Closes #$ARGUMENTS"
```

## 9. Stop commands

If `.doobee.json` has `commands.stop`, run each command.
