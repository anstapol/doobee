export async function runCommands(commands: string[], cwd: string): Promise<void> {
  for (const cmd of commands) {
    const proc = Bun.spawn(["sh", "-c", cmd], { cwd, stdout: "inherit", stderr: "inherit" })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      console.warn(`[commands] "${cmd}" exited with code ${exitCode}`)
    }
  }
}
