export type FolderSnapshotOmission = 'unsupported' | 'too-large' | 'budget' | 'unreadable'
export type FolderFileSnapshot = {
  text?: string
  omitted?: FolderSnapshotOmission
}
export type FolderSnapshotFile = {
  name: string
  sizeBytes: number
  snapshot: FolderFileSnapshot
}
export const MAX_FOLDER_SNAPSHOT_ENTRIES: 500
export const MAX_FOLDER_SNAPSHOT_FILE_BYTES: 65536
export const MAX_FOLDER_SNAPSHOT_TOTAL_BYTES: 131072
export const MAX_FOLDER_SNAPSHOT_READABLE_FILES: 24
export function isFolderSnapshotFiles(value: unknown): value is FolderSnapshotFile[]
export function snapshotFolderFiles(
  files: Array<{ name: string; sizeBytes: number }>,
  readBytes: (file: { name: string; sizeBytes: number }) => Promise<Uint8Array> | Uint8Array,
): Promise<FolderSnapshotFile[]>
