import type { DoobeeConfig, InlineComment, Issue, PullRequest, ReviewComment } from "./types"

export interface ClaudeResult {
  status: "solved" | "stuck" | "complete" | "crashed"
  output: string
}

export async function runClaude(opts: {
  prompt: string
  systemPrompt: string
  cwd: string
  model?: string
}): Promise<ClaudeResult> {
  const args = [
    "claude",
    "-p",
    "--dangerously-skip-permissions",
    "--append-system-prompt",
    opts.systemPrompt,
  ]

  if (opts.model) {
    args.push("--model", opts.model)
  }

  args.push(opts.prompt)

  const proc = Bun.spawn(args, {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  const output = stdout + stderr

  if (output.includes("[DOOBEE:STUCK]")) {
    return { status: "stuck", output }
  }
  if (output.includes("[DOOBEE:COMPLETE]")) {
    return { status: "complete", output }
  }
  if (exitCode !== 0) {
    return { status: "crashed", output }
  }
  return { status: "solved", output }
}

export function buildSolvePrompt(issue: Issue, config: DoobeeConfig): string {
  const lines: string[] = [`# Issue #${issue.number}: ${issue.title}`, ""]

  if (issue.body) {
    lines.push(issue.body, "")
  }

  if (config.promptContext) {
    lines.push("## Additional Context", "", config.promptContext, "")
  }

  lines.push(
    "## Instructions",
    "",
    "1. Implement the fix or feature described in the issue above.",
    "2. Write tests if applicable.",
  )

  if (config.commands.fix.length > 0) {
    lines.push(`3. Run fix commands: ${config.commands.fix.join(" && ")}`)
  }
  if (config.commands.verify.length > 0) {
    lines.push(`4. Run verify commands: ${config.commands.verify.join(" && ")}`)
  }

  lines.push(
    `5. Commit your changes with the message: ISSUE #${issue.number}: <short description of what you did>`,
    "",
    `If you cannot resolve this after ${config.maxRetries} attempts, output exactly: [DOOBEE:STUCK]`,
    "If the issue is already resolved and no changes are needed, output exactly: [DOOBEE:COMPLETE]",
  )

  return lines.join("\n")
}

export function buildRevisionPrompt(
  pr: PullRequest,
  reviews: ReviewComment[],
  config: DoobeeConfig,
): string {
  const lines: string[] = [
    `# PR #${pr.number}: ${pr.title}`,
    "",
    pr.body,
    "",
    "## Review Comments",
    "",
  ]

  for (const review of reviews) {
    lines.push(`### ${review.author}:`)
    if (review.path) {
      lines.push(`File: ${review.path}${review.line ? `:${review.line}` : ""}`)
    }
    if (review.diffHunk) {
      lines.push("```diff", review.diffHunk, "```")
    }
    lines.push(review.body, "")
  }

  if (config.promptContext) {
    lines.push("## Additional Context", "", config.promptContext, "")
  }

  lines.push(
    "## Instructions",
    "",
    "1. Address all review feedback above.",
    "2. Make the smallest changes possible to resolve each comment.",
  )

  if (config.commands.fix.length > 0) {
    lines.push(`3. Run fix commands: ${config.commands.fix.join(" && ")}`)
  }
  if (config.commands.verify.length > 0) {
    lines.push(`4. Run verify commands: ${config.commands.verify.join(" && ")}`)
  }

  lines.push(
    `5. Commit your changes with the message: PR #${pr.number}: address review feedback`,
    "",
    `If you cannot resolve this after ${config.maxRetries} attempts, output exactly: [DOOBEE:STUCK]`,
    "If all feedback is already addressed and no changes are needed, output exactly: [DOOBEE:COMPLETE]",
  )

  return lines.join("\n")
}

export function buildReviewPrompt(pr: PullRequest, diff: string, config: DoobeeConfig): string {
  const lines: string[] = [`# PR #${pr.number}: ${pr.title}`, ""]

  if (pr.body) {
    lines.push(pr.body, "")
  }

  lines.push("## Diff", "", "```diff", diff, "```", "")

  if (config.promptContext) {
    lines.push("## Additional Context", "", config.promptContext, "")
  }

  lines.push(
    "## Instructions",
    "",
    "Review the diff above. For each issue you find, output a comment in this exact format:",
    "",
    '[DOOBEE:REVIEW]{"path":"<file path>","line":<line number>,"body":"<comment>"}[DOOBEE:REVIEW_END]',
    "",
    "The line number must refer to a line in the new version of the file (the + side of the diff).",
    "Focus on correctness, bugs, and logic errors. Do not comment on style or formatting.",
    "If the code looks clean and correct, output exactly: [DOOBEE:COMPLETE]",
  )

  return lines.join("\n")
}

export function buildReviewSystemPrompt(): string {
  return [
    "You are running in a fully automated pipeline. No human operator. Never pause for confirmation.",
    "This is a read-only review. Do NOT create, modify, or delete any files.",
    "You are reviewing a pull request diff. Focus on correctness, bugs, and logic errors.",
    "Do not comment on style, formatting, or naming conventions.",
    "Use the exact output markers specified in the instructions.",
  ].join("\n")
}

export function parseReviewComments(output: string): InlineComment[] {
  const comments: InlineComment[] = []
  const pattern = /\[DOOBEE:REVIEW\](.*?)\[DOOBEE:REVIEW_END\]/gs

  for (const match of output.matchAll(pattern)) {
    try {
      const parsed: unknown = JSON.parse(match[1])
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "path" in parsed &&
        "line" in parsed &&
        "body" in parsed &&
        typeof (parsed as Record<string, unknown>).path === "string" &&
        typeof (parsed as Record<string, unknown>).line === "number" &&
        typeof (parsed as Record<string, unknown>).body === "string"
      ) {
        const { path, line, body } = parsed as InlineComment
        comments.push({ path, line, body })
      }
    } catch {
      // Skip malformed blocks
    }
  }

  return comments
}

export function buildSystemPrompt(config: DoobeeConfig): string {
  const lines: string[] = [
    "You are running in a fully automated pipeline. No human operator. Never pause for confirmation.",
    "You have full permission to create, modify, and delete files.",
    "You are on a clean feature branch in a git worktree.",
  ]

  if (config.commands.setup.length > 0) {
    lines.push(`Setup commands already ran: ${config.commands.setup.join(", ")}`)
  }
  if (config.commands.start.length > 0) {
    lines.push(`Start commands already ran: ${config.commands.start.join(", ")}`)
  }

  lines.push("Focus only on the issue. Make the smallest change possible. Use existing patterns.")

  return lines.join("\n")
}
