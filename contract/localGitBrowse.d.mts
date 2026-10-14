import type { LocalBrowseFileSnapshot } from './localFileBrowse.mjs'

export const MAX_GIT_BROWSE_ENTRIES: number
export const MAX_GIT_BROWSE_FILE_BYTES: number
export const MAX_GIT_BROWSE_PATH_BYTES: number
export type LocalGitFileSelection = { path: string }
export type LocalGitFileListing = {
  version: 1
  files: Array<{ path: string; kind: 'file' | 'conflict' | 'sparse' | 'unsupported' }>
  excludedCount: number
}
export type LocalGitFilePreview = {
  version: 1
  path: string
  sizeBytes: number
  snapshot: LocalBrowseFileSnapshot
}
export function isLocalGitFileSelection(value: unknown): value is LocalGitFileSelection
export function parseLocalGitFileListing(value: unknown): LocalGitFileListing | undefined
export function parseLocalGitFilePreview(value: unknown): LocalGitFilePreview | undefined
