export interface Issue {
  number: number
  title: string
  body: string | null
  repoOwner: string
  repoName: string
}

export interface SubIssueGroup {
  parent: Issue | null
  issues: Issue[]
  branch: string
}

export interface ReviewComment {
  author: string
  body: string
  path?: string
  line?: number
  diffHunk?: string
}

export interface PullRequest {
  number: number
  title: string
  body: string
  branch: string
  repoOwner: string
  repoName: string
}

export interface InlineComment {
  path: string
  line: number
  body: string
}

export interface DoobeeConfig {
  baseBranch: string
  commands: {
    setup: string[]
    start: string[]
    stop: string[]
    verify: string[]
    fix: string[]
  }
  maxRetries: number
  timeout: number
  promptContext?: string
  model?: string
}

interface Ok<T> {
  ok: true
  value: T
}

interface Err {
  ok: false
  error: string
}

export type Result<T> = Ok<T> | Err
