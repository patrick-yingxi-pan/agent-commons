import { ATTACHMENT_TEXT_FILE_BYTES } from '../../contract/attachmentInput.ts'
import { parseLocalGitFileComparison, type LocalGitFileComparison } from '../../contract/localGitFileComparison.mjs'

export type GitFileComparisonCopyResult =
  | { status: 'ready'; name: string; text: string; sizeBytes: number }
  | { status: 'too-large' | 'unavailable' }

const MAX_ATTACHMENT_LABEL_LENGTH = 160

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

/** Serialize exactly one validated, already-captured Git comparison. This
 * projection does not reread the repository, truncate, or grant Git authority. */
export function prepareGitFileComparisonCopy(input: {
  comparison: LocalGitFileComparison
  readAt: number
  repositoryName: string
}): GitFileComparisonCopyResult {
  try {
    if (!input || typeof input !== 'object' || !Number.isFinite(input.readAt) ||
      !Number.isFinite(new Date(input.readAt).getTime()) || typeof input.repositoryName !== 'string' || !input.repositoryName.trim()) {
      return { status: 'unavailable' }
    }
    const captured = parseLocalGitFileComparison(input.comparison)
    if (!captured || captured.status !== 'ready') return { status: 'unavailable' }
    const serialized = {
      version: 1,
      kind: 'git-file-comparison-copy',
      repositoryName: input.repositoryName,
      capturedAt: new Date(input.readAt).toISOString(),
      head: { ref: captured.head.ref, oid: captured.head.oid },
      comparison: captured.comparison,
      path: captured.path,
      change: captured.change,
      before: captured.before,
      after: captured.after,
    }
    const text = JSON.stringify(serialized, null, 2)
    const sizeBytes = new TextEncoder().encode(text).byteLength
    if (sizeBytes > ATTACHMENT_TEXT_FILE_BYTES) return { status: 'too-large' }
    return { status: 'ready', name: displayName(captured.path, captured.comparison), text, sizeBytes }
  } catch {
    return { status: 'unavailable' }
  }
}
