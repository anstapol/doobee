export async function assignPorts(vars: string[]): Promise<Record<string, string>> {
  const listeners: Array<{ port: number; stop: () => void }> = []
  try {
    for (let i = 0; i < vars.length; i++) {
      const listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: { data() {} },
      })
      listeners.push(listener)
    }

    const env: Record<string, string> = {}
    for (let i = 0; i < vars.length; i++) {
      env[vars[i]] = String(listeners[i].port)
    }

    const assignments = vars.map((v) => `${v}=${env[v]}`).join(", ")
    console.log(`[ports] Assigned: ${assignments}`)

    return env
  } finally {
    for (const l of listeners) l.stop()
  }
}
