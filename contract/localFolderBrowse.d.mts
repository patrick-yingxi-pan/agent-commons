import type { LocalBrowseFileSnapshot } from './localFileBrowse.mjs'

export type LocalFolderFileKind = 'file' | 'unsupported'
export type LocalFolderFileOmission = 'too-large' | 'unsupported' | 'unreadable'
export interface LocalFolderFileSelection { path: string }
export interface LocalFolderFileListing {
  version: 1
  /** Raw entries counted by the native walk, including hidden names. */
  visited: number
  /** Hidden entries excluded from the visible descriptor result. */
  hiddenCount: number
  /** Visible directories omitted from the file list. */
  directoryCount: number
  files: Array<{ path: string; kind: LocalFolderFileKind }>
}
export interface LocalFolderFilePreview {
  version: 1
  path: string
  sizeBytes: number
  snapshot: LocalBrowseFileSnapshot
}
export function isLocalFolderFileSelection(value: unknown): value is LocalFolderFileSelection
export function parseLocalFolderFileListing(value: unknown): LocalFolderFileListing | undefined
export function parseLocalFolderFilePreview(value: unknown): LocalFolderFilePreview | undefined
export const MAX_LOCAL_FOLDER_BROWSE_FILE_BYTES: number
export const MAX_LOCAL_FOLDER_BROWSE_PATH_BYTES: number
