import { existsSync } from "fs"
import { join } from "path"

const COMPOSE_FILES = ["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"]
const OVERRIDE_FILE = "docker-compose.override.yml"
const DOOBEE_OVERRIDE = ".doobee-compose-ports.yml"

interface ComposeConfig {
  services?: Record<
    string,
    {
      ports?: Array<{
        published?: string | number
        target?: number
      }>
    }
  >
}

interface PortMapping {
  service: string
  published: number
  target: number
}

function findComposeFile(cwd: string): string | undefined {
  for (const name of COMPOSE_FILES) {
    if (existsSync(join(cwd, name))) return name
  }
  return undefined
}

function parsePortMappings(config: ComposeConfig): PortMapping[] {
  const mappings: PortMapping[] = []
  if (!config.services) return mappings

  for (const [service, svc] of Object.entries(config.services)) {
    if (!svc.ports) continue
    for (const port of svc.ports) {
      const published =
        typeof port.published === "string" ? parseInt(port.published, 10) : port.published
      if (published && port.target) {
        mappings.push({ service, published, target: port.target })
      }
    }
  }

  return mappings
}

async function findFreePorts(count: number): Promise<number[]> {
  const listeners: Array<{ port: number; stop: () => void }> = []

  for (let i = 0; i < count; i++) {
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    })
    listeners.push(listener)
  }

  const ports = listeners.map((l) => l.port)
  for (const l of listeners) l.stop()
  return ports
}

function scanEnvVars(raw: string, portMap: Map<number, number>): Record<string, string> {
  const env: Record<string, string> = {}
  const pattern = /\$\{([A-Z_][A-Z0-9_]*):-(\d+)\}/g

  for (const match of raw.matchAll(pattern)) {
    const varName = match[1]
    const defaultPort = parseInt(match[2], 10)
    const newPort = portMap.get(defaultPort)
    if (newPort !== undefined) {
      env[varName] = String(newPort)
    }
  }

  return env
}

function generateOverride(mappings: Array<PortMapping & { newPort: number }>): string {
  const lines = ["services:"]
  const byService = new Map<string, Array<{ newPort: number; target: number }>>()

  for (const m of mappings) {
    if (!byService.has(m.service)) byService.set(m.service, [])
    byService.get(m.service)!.push({ newPort: m.newPort, target: m.target })
  }

  for (const [service, ports] of byService) {
    lines.push(`  ${service}:`)
    lines.push(`    ports: !reset`)
    for (const p of ports) {
      lines.push(`      - "${p.newPort}:${p.target}"`)
    }
  }

  return lines.join("\n") + "\n"
}

export async function isolateDockerPorts(cwd: string): Promise<Record<string, string> | undefined> {
  const composeFile = findComposeFile(cwd)
  if (!composeFile) return undefined

  // Parse compose config
  const proc = Bun.spawn(["docker", "compose", "-f", composeFile, "config", "--format", "json"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    console.warn(`[docker] docker compose config failed: ${stderr}`)
    return undefined
  }

  let config: ComposeConfig
  try {
    config = JSON.parse(stdout)
  } catch {
    console.warn("[docker] Failed to parse compose config JSON")
    return undefined
  }

  // Extract and remap ports
  const mappings = parsePortMappings(config)
  if (mappings.length === 0) return undefined

  const freePorts = await findFreePorts(mappings.length)
  const remapped = mappings.map((m, i) => ({ ...m, newPort: freePorts[i] }))
  const portMap = new Map(remapped.map((m) => [m.published, m.newPort]))

  // Write override file
  const overrideContent = generateOverride(remapped)
  const hasExistingOverride = existsSync(join(cwd, OVERRIDE_FILE))
  const overridePath = hasExistingOverride ? DOOBEE_OVERRIDE : OVERRIDE_FILE

  await Bun.write(join(cwd, overridePath), overrideContent)

  // Build env vars
  const env: Record<string, string> = {}

  if (hasExistingOverride) {
    env.COMPOSE_FILE = `${composeFile}:${OVERRIDE_FILE}:${DOOBEE_OVERRIDE}`
  }

  const rawContent = await Bun.file(join(cwd, composeFile)).text()
  Object.assign(env, scanEnvVars(rawContent, portMap))

  console.log(
    `[docker] Remapped ports: ${remapped.map((m) => `${m.published} → ${m.newPort}`).join(", ")}`,
  )

  return Object.keys(env).length > 0 ? env : undefined
}
