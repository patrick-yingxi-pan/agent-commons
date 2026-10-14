import type { GitReviewChange, GitReviewSide, LocalGitReview } from './localGitReview.mjs'

export type LocalGitFileComparisonKind = 'staged' | 'unstaged'
export type LocalGitFileComparisonSelection = { path: string; comparison: LocalGitFileComparisonKind }
export type LocalGitFileComparisonRequest = {
  scope: 'file-comparison'
  operationId: string
  path: string
  comparison: LocalGitFileComparisonKind
}
export type LocalGitFileComparisonCancel = { scope: 'file-comparison'; operationId: string }
export type LocalGitFileComparisonUnavailableReason =
  | 'ignored'
  | 'not-tracked'
  | 'not-in-index'
  | 'sparse'
  | 'unmerged'
export type LocalGitFileComparison = {
  version: 1
  scope: 'file-comparison'
  path: string
  comparison: LocalGitFileComparisonKind
  head: LocalGitReview['head']
} & (
  | { status: 'ready'; change: GitReviewChange; before: GitReviewSide; after: GitReviewSide }
  | { status: 'unavailable'; reason: LocalGitFileComparisonUnavailableReason }
)

export function parseLocalGitFileComparisonSelection(value: unknown): LocalGitFileComparisonSelection | undefined
export function parseLocalGitFileComparisonRequest(value: unknown): LocalGitFileComparisonRequest | undefined
export function parseLocalGitFileComparisonCancel(value: unknown): LocalGitFileComparisonCancel | undefined
export function parseLocalGitFileComparison(value: unknown): LocalGitFileComparison | undefined
