import { ATTACHMENT_TEXT_FILE_BYTES } from '../../contract/attachmentInput.ts'
import { parseLocalGitReview, type GitReviewSide, type LocalGitReview } from '../../contract/localGitReview.mjs'
import { findGitRenameSuggestions } from './gitRenameSuggestions.ts'

export type GitComparisonCopyInput = {
  review: LocalGitReview
  comparison: 'staged' | 'unstaged'
  path: string
  previousPath?: string
  readAt: number
  repositoryName: string
}

export type GitComparisonCopyResult =
  | { status: 'ready'; name: string; text: string; sizeBytes: number }
  | { status: 'too-large' | 'unavailable' }

type CopySide = GitReviewSide
const MAX_ATTACHMENT_LABEL_LENGTH = 160

function copySide(side: GitReviewSide): CopySide {
  switch (side.kind) {
    case 'missing': return { kind: 'missing' }
    case 'omitted': return { kind: 'omitted', reason: side.reason }
    case 'text': return { kind: 'text', text: side.text, mode: side.mode }
  }
}

function displayName(path: string, comparison: 'staged' | 'unstaged'): string {
  const prefix = `git-${comparison}-`
  const suffix = '.comparison.json'
  const pathLabel = path.replaceAll('/', '__')
  const available = MAX_ATTACHMENT_LABEL_LENGTH - prefix.length - suffix.length
  if (pathLabel.length <= available) return `${prefix}${pathLabel}${suffix}`

  const points = Array.from(pathLabel)
  let leftCount = Math.ceil((available - 1) / 2)
  let rightCount = Math.floor((available - 1) / 2)
  let left = points.slice(0, leftCount).join('')
  let right = rightCount ? points.slice(-rightCount).join('') : ''
  while (left.length + 1 + right.length > available) {
    if (left.length >= right.length && leftCount > 0) left = points.slice(0, --leftCount).join('')
    else {
      rightCount = Math.max(0, rightCount - 1)
      right = rightCount ? points.slice(-rightCount).join('') : ''
    }
  }
  return `${prefix}${left}…${right}${suffix}`
}

/**
 * Project one already-captured Git comparison into ordinary saved-copy text.
 * This function performs no reads and grants no Git or filesystem authority.
 */
export function prepareGitComparisonCopy(input: GitComparisonCopyInput): GitComparisonCopyResult {
  try {
    if (!input || typeof input !== 'object' ||
        (input.comparison !== 'staged' && input.comparison !== 'unstaged') ||
        typeof input.path !== 'string' || !input.path ||
        (input.previousPath !== undefined && (typeof input.previousPath !== 'string' || !input.previousPath || input.previousPath === input.path)) ||
        !Number.isFinite(input.readAt) || !Number.isFinite(new Date(input.readAt).getTime()) ||
        typeof input.repositoryName !== 'string' || !input.repositoryName.trim()) return { status: 'unavailable' }

    const review = parseLocalGitReview(input.review)
    if (!review) return { status: 'unavailable' }
    const selected = review.files.find(file => file.path === input.path)
    if (!selected) return { status: 'unavailable' }
    const change = input.comparison === 'staged' ? selected.staged : selected.unstaged
    if (change === 'unchanged') return { status: 'unavailable' }

    const beforeKey = input.comparison === 'staged' ? 'head' : 'index'
    const afterKey = input.comparison === 'staged' ? 'index' : 'working'
    let beforePath = selected.path
    let before = selected[beforeKey]
    const after = selected[afterKey]
    let renameProvenance: string | undefined

    if (input.previousPath !== undefined) {
      if (input.comparison !== 'staged') return { status: 'unavailable' }
      const suggestion = findGitRenameSuggestions(review.files).pairs.find(pair =>
        pair.fromPath === input.previousPath && pair.toPath === selected.path)
      if (!suggestion) return { status: 'unavailable' }
      const previous = review.files.find(file => file.path === input.previousPath)
      if (!previous) return { status: 'unavailable' }
      beforePath = previous.path
      before = previous[beforeKey]
      renameProvenance = 'possible rename, not recorded Git operation'
    }

    const serialized = {
      version: 1,
      kind: 'git-comparison-copy',
      repositoryName: input.repositoryName,
      capturedAt: new Date(input.readAt).toISOString(),
      head: { ref: review.head.ref, oid: review.head.oid },
      comparison: input.comparison,
      paths: { before: beforePath, after: selected.path },
      ...(renameProvenance ? { provenance: renameProvenance } : {}),
      change,
      before: copySide(before),
      after: copySide(after),
    }
    const text = JSON.stringify(serialized, null, 2)
    const sizeBytes = new TextEncoder().encode(text).byteLength
    if (sizeBytes > ATTACHMENT_TEXT_FILE_BYTES) return { status: 'too-large' }
    return { status: 'ready', name: displayName(selected.path, input.comparison), text, sizeBytes }
  } catch {
    return { status: 'unavailable' }
  }
}
