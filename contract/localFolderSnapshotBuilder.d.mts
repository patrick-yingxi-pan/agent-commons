import type { FolderSnapshotFile } from './localFolderSnapshot.mjs'

export function snapshotFolderFiles(
  files: Array<{ name: string; sizeBytes: number }>,
  readBytes: (file: { name: string; sizeBytes: number }) => Promise<Uint8Array> | Uint8Array,
): Promise<FolderSnapshotFile[]>

/** Apply the shared file/read budgets to an already validated ordered list. */
export function snapshotFolderEntries(
  files: Array<{ name: string; sizeBytes: number }>,
  readBytes: (file: { name: string; sizeBytes: number }) => Promise<Uint8Array> | Uint8Array,
  options?: { textName?: (file: { name: string; sizeBytes: number }) => string },
): Promise<FolderSnapshotFile[]>
