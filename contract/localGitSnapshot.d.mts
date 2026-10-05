export type GitSnapshotOmission = 'unsupported' | 'too-large' | 'budget' | 'unreadable'
export type GitFileSnapshot = { text?: string; omitted?: GitSnapshotOmission }
export type GitSnapshotFile = { path: string; sizeBytes: number; snapshot: GitFileSnapshot }
export const MAX_GIT_SNAPSHOT_PATH_LENGTH: 4096
export const MAX_GIT_SNAPSHOT_ENTRIES: 500
export const MAX_GIT_SNAPSHOT_FILE_BYTES: 65536
export const MAX_GIT_SNAPSHOT_TOTAL_BYTES: 131072
export const MAX_GIT_SNAPSHOT_READABLE_FILES: 24
export function isGitSnapshotPath(path: unknown): path is string
export function isGitSnapshotFiles(value: unknown): value is GitSnapshotFile[]
export function snapshotGitFiles(
  files: Array<{ path: string; sizeBytes: number }>,
  readBytes: (file: { path: string; sizeBytes: number }) => Promise<Uint8Array> | Uint8Array,
): Promise<GitSnapshotFile[]>
