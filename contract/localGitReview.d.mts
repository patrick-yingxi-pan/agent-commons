export type GitReviewChange =
  | 'unchanged'
  | 'added'
  | 'deleted'
  | 'modified'
  | 'mode-changed'
  | 'type-changed'
  | 'unavailable'
  | 'unmerged'

export type GitReviewOmission =
  | 'unsupported'
  | 'too-large'
  | 'budget'
  | 'unreadable'
  | 'sparse'
  | 'unmerged'
  | 'not-needed'

export type GitReviewSide =
  | { kind: 'missing' }
  | { kind: 'text'; text: string; mode: '100644' | '100755' }
  | { kind: 'omitted'; reason: GitReviewOmission }

export type LocalGitReviewFile = {
  path: string
  staged: GitReviewChange
  unstaged: GitReviewChange
  head: GitReviewSide
  index: GitReviewSide
  working: GitReviewSide
}

export type LocalGitReview = {
  version: 1
  comparison: 'raw'
  head: { oid: string | null; ref: string | null }
  excludedCount: number
  unchangedCount: number
  files: LocalGitReviewFile[]
}

/** Parse and detach the internal, raw-byte local Git review projection. */
export function parseLocalGitReview(value: unknown): LocalGitReview | undefined
