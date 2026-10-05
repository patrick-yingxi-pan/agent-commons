import type { FolderSnapshotFile } from './localFolderSnapshot.mjs'

export function snapshotFolderFiles(
  files: Array<{ name: string; sizeBytes: number }>,
  readBytes: (file: { name: string; sizeBytes: number }) => Promise<Uint8Array> | Uint8Array,
): Promise<FolderSnapshotFile[]>
