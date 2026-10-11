import type { FolderSnapshotFile } from './localFolderSnapshot.mjs'

export const MAX_FOLDER_TREE_DEPTH: 16
export const MAX_FOLDER_TREE_DIRECTORIES: 64
export const MAX_FOLDER_TREE_PATH_BYTES: 4096
export const MAX_FOLDER_TREE_ENTRIES: 500
export function isFolderTreePath(value: unknown): value is string
export function isFolderTreeFiles(value: unknown): value is FolderSnapshotFile[]
export function snapshotFolderTreeFiles(
  files: Array<{ name: string; sizeBytes: number }>,
  readBytes: (file: { name: string; sizeBytes: number }) => Promise<Uint8Array> | Uint8Array,
): Promise<FolderSnapshotFile[]>
