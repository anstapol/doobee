import type { Result } from "./types"

const DEFAULT_COMMAND_TIMEOUT = 10 * 60_000 // 10 minutes

export async function runCommands(
  commands: string[],
  cwd: string,
  env?: Record<string, string>,
  timeout: number = DEFAULT_COMMAND_TIMEOUT,
): Promise<Result<void>> {
  for (const cmd of commands) {
    console.log(`[commands] Running: ${cmd}`)
    const proc = Bun.spawn(["sh", "-c", cmd], {
      cwd,
      stdout: "inherit",
      stderr: "inherit",
      env: env ? { ...process.env, ...env } : undefined,
    })
    const timer = setTimeout(() => {
      console.error(`[commands] Timed out after ${timeout / 1000}s: ${cmd}`)
      proc.kill()
    }, timeout)
    const exitCode = await proc.exited
    clearTimeout(timer)
    if (exitCode !== 0) {
      return { ok: false, error: `"${cmd}" exited with code ${exitCode}` }
    }
    console.log(`[commands] Done: ${cmd}`)
  }
  return { ok: true, value: undefined }
}
