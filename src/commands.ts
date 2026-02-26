import type { Result } from "./types"

const DEFAULT_COMMAND_TIMEOUT = 20 * 60_000 // 20 minutes

async function pipeLines(
  stream: ReadableStream<Uint8Array>,
  tag: string,
  dest: "stdout" | "stderr",
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  const write = dest === "stdout" ? console.log : console.error
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    for (let nl = buf.indexOf("\n"); nl !== -1; nl = buf.indexOf("\n")) {
      write(`[${tag}] ${buf.slice(0, nl)}`)
      buf = buf.slice(nl + 1)
    }
  }
  if (buf) write(`[${tag}] ${buf}`)
}

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
      stdout: "pipe",
      stderr: "pipe",
      env: env ? { ...process.env, ...env } : undefined,
    })
    const timer = setTimeout(() => {
      console.error(`[commands] Timed out after ${timeout / 1000}s: ${cmd}`)
      proc.kill()
    }, timeout)
    await Promise.all([
      pipeLines(proc.stdout, cmd, "stdout"),
      pipeLines(proc.stderr, cmd, "stderr"),
    ])
    const exitCode = await proc.exited
    clearTimeout(timer)
    if (exitCode !== 0) {
      return { ok: false, error: `"${cmd}" exited with code ${exitCode}` }
    }
    console.log(`[commands] Done: ${cmd}`)
  }
  return { ok: true, value: undefined }
}
