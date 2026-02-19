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

  const partial = raw as Partial<DoobeeConfig>

  return {
    baseBranch: partial.baseBranch ?? DEFAULT_CONFIG.baseBranch,
    commands: {
      setup: partial.commands?.setup ?? DEFAULT_CONFIG.commands.setup,
      start: partial.commands?.start ?? DEFAULT_CONFIG.commands.start,
      stop: partial.commands?.stop ?? DEFAULT_CONFIG.commands.stop,
      verify: partial.commands?.verify ?? DEFAULT_CONFIG.commands.verify,
      fix: partial.commands?.fix ?? DEFAULT_CONFIG.commands.fix,
    },
    maxRetries: partial.maxRetries ?? DEFAULT_CONFIG.maxRetries,
    promptContext: partial.promptContext,
    model: partial.model,
  }
}
