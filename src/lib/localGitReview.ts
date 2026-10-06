import type { GitReviewChange, GitReviewSide, LocalGitReviewFile } from '../../contract/localGitReview.mjs'
import type { TextDiffSide } from './textDiff.ts'

export type GitComparison = 'staged' | 'unstaged'
export const GIT_CHANGE_LABELS: Record<GitReviewChange, string> = {
  unchanged: 'Unchanged', added: 'Added', deleted: 'Deleted', modified: 'Modified',
  'mode-changed': 'Executable mode changed', 'type-changed': 'File type changed',
  unmerged: 'Unmerged', unavailable: 'Comparison unavailable',
}
const omissionCopy: Record<Extract<GitReviewSide, { kind: 'omitted' }>['reason'], string> = {
  unsupported: 'Preview unavailable: unsupported file type or filesystem entry.',
  'too-large': 'Preview unavailable: this file exceeds 64 KiB.',
  budget: 'Preview unavailable: the bounded read or display budget was reached.',
  unreadable: 'Preview unavailable: this file could not be read as supported UTF-8 text.',
  unmerged: 'Preview unavailable: resolve the unmerged index outside this app.',
  sparse: 'Preview unavailable: sparse or skip-worktree entries are not read.',
  'not-needed': 'This side was not read because the comparison is unchanged.',
}

export function gitReviewSide(side: GitReviewSide, label: string): TextDiffSide {
  if (side.kind === 'text') return { label: `${label} · ${side.mode === '100755' ? 'Executable' : 'Regular file'}`, text: side.text }
  return { label, notice: side.kind === 'missing' ? 'Not present in this version.' : omissionCopy[side.reason] }
}

export function gitReviewComparison(file: LocalGitReviewFile, comparison: GitComparison) {
  return comparison === 'staged'
    ? { before: gitReviewSide(file.head, 'HEAD'), after: gitReviewSide(file.index, 'Index') }
    : { before: gitReviewSide(file.index, 'Index'), after: gitReviewSide(file.working, 'Working tree') }
}
