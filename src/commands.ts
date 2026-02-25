import type { Result } from "./types"

export async function runCommands(
  commands: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<Result<void>> {
  for (const cmd of commands) {
    const proc = Bun.spawn(["sh", "-c", cmd], {
      cwd,
      stdout: "inherit",
      stderr: "inherit",
      env: env ? { ...process.env, ...env } : undefined,
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      return { ok: false, error: `"${cmd}" exited with code ${exitCode}` }
    }
  }
  return { ok: true, value: undefined }
}
