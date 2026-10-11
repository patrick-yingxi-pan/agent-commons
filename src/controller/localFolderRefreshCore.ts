import type { LocalFolderCapture } from '../../contract/localFolderCapture.ts'

/** The user's original saved scope is part of Refresh intent. Legacy copies
 * stay flat; recursive copies must use the tree bridge on every refresh. */
export function localFolderRefreshScope(snapshot: LocalFolderCapture | undefined): 'flat' | 'recursive' {
  return snapshot?.version === 2 ? 'recursive' : 'flat'
}
