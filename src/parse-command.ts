export interface ParsedCommand {
  command: "solve" | "review"
  context: string
}

export function parseCommand(
  body: string,
  botName: string,
  isPullRequest: boolean,
): ParsedCommand | null {
  // Strip [bot] suffix — GitHub renders mentions without it
  const mention = botName.replace(/\[bot\]$/, "")
  const pattern = new RegExp(`^@${escapeRegex(mention)}(?:\\s+(solve|review))?(.*)$`, "im")
  const match = body.match(pattern)
  if (!match) return null

  const command =
    (match[1]?.toLowerCase() as "solve" | "review") ?? (isPullRequest ? "review" : "solve")
  const context = match[2]?.trim() ?? ""

  return { command, context }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
