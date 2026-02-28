import { readFileFromRef } from "./git"
import type { DoobeeConfig } from "./types"

export const DEFAULT_CONFIG: DoobeeConfig = {
  baseBranch: "main",
  commands: {
    setup: [],
    start: [],
    stop: [],
    verify: [],
    fix: [],
  },
  maxRetries: 3,
  timeout: 3600,
  ports: [],
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? value : undefined
}

export async function loadConfig(repoDir: string): Promise<DoobeeConfig> {
  const result = await readFileFromRef(repoDir, "origin/HEAD", ".doobee.json")

  if (!result.ok) {
    return { ...DEFAULT_CONFIG }
  }

  let raw: unknown
  try {
    raw = JSON.parse(result.value)
  } catch {
    throw new Error("Invalid .doobee.json: not valid JSON")
  }

  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Invalid .doobee.json: expected object, got ${typeof raw}`)
  }

  const obj = raw as Record<string, unknown>
  const cmds =
    typeof obj.commands === "object" && obj.commands
      ? (obj.commands as Record<string, unknown>)
      : undefined

  return {
    baseBranch: typeof obj.baseBranch === "string" ? obj.baseBranch : DEFAULT_CONFIG.baseBranch,
    commands: {
      setup: asStringArray(cmds?.setup) ?? DEFAULT_CONFIG.commands.setup,
      start: asStringArray(cmds?.start) ?? DEFAULT_CONFIG.commands.start,
      stop: asStringArray(cmds?.stop) ?? DEFAULT_CONFIG.commands.stop,
      verify: asStringArray(cmds?.verify) ?? DEFAULT_CONFIG.commands.verify,
      fix: asStringArray(cmds?.fix) ?? DEFAULT_CONFIG.commands.fix,
    },
    maxRetries:
      typeof obj.maxRetries === "number" && obj.maxRetries > 0
        ? obj.maxRetries
        : DEFAULT_CONFIG.maxRetries,
    timeout:
      typeof obj.timeout === "number" && obj.timeout > 0 ? obj.timeout : DEFAULT_CONFIG.timeout,
    ports: asStringArray(obj.ports) ?? DEFAULT_CONFIG.ports,
    promptContext: typeof obj.promptContext === "string" ? obj.promptContext : undefined,
    model: typeof obj.model === "string" ? obj.model : undefined,
  }
}
