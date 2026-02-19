import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { Result } from "./types"

async function run(cmd: string[], cwd: string): Promise<Result<string>> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    return { ok: false, error: stderr.trim() || `Command failed with exit code ${exitCode}` }
  }
  return { ok: true, value: stdout.trim() }
}

function authedUrl(cloneUrl: string, token: string): string {
  const url = new URL(cloneUrl)
  url.username = "x-access-token"
  url.password = token
  return url.toString()
}

export async function configureAuth(repoDir: string, token: string): Promise<void> {
  const result = await run(["git", "remote", "get-url", "origin"], repoDir)
  if (!result.ok) return
  const url = new URL(result.value)
  url.username = "x-access-token"
  url.password = token
  await run(["git", "remote", "set-url", "origin", url.toString()], repoDir)
}

function sanitizeBranch(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9\-_/]/g, "-")
}

function worktreePath(repoDir: string, branch: string): string {
  const safe = sanitizeBranch(branch).replace(/\//g, "-")
  return join(repoDir, ".worktrees", `doobee-${safe}`)
}

export async function createWorktree(
  repoDir: string,
  branch: string,
  base: string,
): Promise<Result<string>> {
  const wtPath = worktreePath(repoDir, branch)

  // Remove stale worktree if it exists
  if (existsSync(wtPath)) {
    await run(["git", "worktree", "remove", wtPath, "--force"], repoDir)
  }

  // Create branch from origin/<base>
  const result = await run(
    ["git", "worktree", "add", "-b", branch, wtPath, `origin/${base}`],
    repoDir,
  )

  if (!result.ok) {
    // Branch might already exist — try checking it out
    const retry = await run(["git", "worktree", "add", wtPath, branch], repoDir)
    if (!retry.ok) return retry
  }

  // Sync worktree to latest origin state
  const reset = await run(["git", "reset", "--hard", `origin/${base}`], wtPath)
  if (!reset.ok) return { ok: false, error: `Failed to sync with origin: ${reset.error}` }

  return { ok: true, value: wtPath }
}

export async function removeWorktree(repoDir: string, branch: string): Promise<void> {
  const wtPath = worktreePath(repoDir, branch)
  await run(["git", "worktree", "remove", wtPath, "--force"], repoDir)
  await run(["git", "worktree", "prune"], repoDir)
}

export async function push(worktreePath: string, branch: string): Promise<Result<void>> {
  const result = await run(["git", "push", "origin", branch], worktreePath)
  if (!result.ok) return result
  return { ok: true, value: undefined }
}

export async function hasNewCommits(worktreePath: string, since: string): Promise<boolean> {
  const current = await getCurrentSha(worktreePath)
  return current !== since
}

export async function getCurrentSha(worktreePath: string): Promise<string> {
  const result = await run(["git", "rev-parse", "HEAD"], worktreePath)
  if (!result.ok) throw new Error(`Failed to get SHA: ${result.error}`)
  return result.value
}

export async function fetch(repoDir: string): Promise<Result<void>> {
  const result = await run(["git", "fetch", "origin"], repoDir)
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, value: undefined }
}

export async function getDiff(worktreePath: string, base: string): Promise<Result<string>> {
  return run(["git", "diff", `origin/${base}...HEAD`], worktreePath)
}

export async function readFileFromRef(
  repoDir: string,
  ref: string,
  filePath: string,
): Promise<Result<string>> {
  return run(["git", "show", `${ref}:${filePath}`], repoDir)
}

export async function cloneIfMissing(
  repoUrl: string,
  repoDir: string,
  token?: string,
): Promise<void> {
  if (existsSync(repoDir)) {
    if (token) await configureAuth(repoDir, token)
    await fetch(repoDir)
    return
  }

  const parent = join(repoDir, "..")
  mkdirSync(parent, { recursive: true })

  const url = token ? authedUrl(repoUrl, token) : repoUrl
  const result = await run(["git", "clone", url, repoDir], parent)
  if (!result.ok) {
    throw new Error(`Failed to clone ${repoUrl}: ${result.error}`)
  }
}
