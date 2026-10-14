import type { GitSnapshotFile } from './localGitSnapshot.mjs'
import { isClosedRecord } from './closedRecord.mjs'
import type { LocalGitReview } from './localGitReview.mjs'
import { isGitSnapshotFiles } from './localGitSnapshot.mjs'
import type { LocalGitFileListing, LocalGitFilePreview, LocalGitFileSelection } from './localGitBrowse.mjs'
import type { LocalGitUntrackedFileListing, LocalGitUntrackedFilePreview, LocalGitUntrackedFileRequest, LocalGitUntrackedFilesRequest } from './localGitUntrackedBrowse.mjs'
import type { LocalGitFileComparison, LocalGitFileComparisonRequest, LocalGitFileComparisonCancel } from './localGitFileComparison.mjs'
import { isServedCaptureTime, isSnapshotId } from './servedTextSnapshot.ts'

export type LocalGitConnectionId = `GIT_${string}`
export interface LocalGitCapture {
  version: 1
  snapshotId: string
  capturedAt: string
  connectionId: LocalGitConnectionId
  files: GitSnapshotFile[]
}
export interface LocalGitRefreshRequest {
  expectedSnapshotId: string | null
  requestId: string
  snapshot: LocalGitCapture
}
export interface LocalGitConnection { id: LocalGitConnectionId; name: string; remembered: boolean }
export interface NativeLocalGitBridge {
  list(source: import('./localFolderCapture.ts').LocalFolderAccountSource): Promise<LocalGitConnection[]>
  connect(input: { remember: boolean }, source: import('./localFolderCapture.ts').LocalFolderAccountSource): Promise<{ status: 'cancelled' } | { status: 'connected'; connection: LocalGitConnection }>
  snapshot(id: LocalGitConnectionId, source: import('./localFolderCapture.ts').LocalFolderAccountSource): Promise<{ name: string; files: GitSnapshotFile[] }>
  review(id: LocalGitConnectionId, source: import('./localFolderCapture.ts').LocalFolderAccountSource): Promise<LocalGitReview>
  files(id: LocalGitConnectionId, source: import('./localFolderCapture.ts').LocalFolderAccountSource): Promise<LocalGitFileListing>
  file(id: LocalGitConnectionId, selection: LocalGitFileSelection, source: import('./localFolderCapture.ts').LocalFolderAccountSource): Promise<LocalGitFilePreview>
  untrackedFiles(id: LocalGitConnectionId, request: LocalGitUntrackedFilesRequest, source: import('./localFolderCapture.ts').LocalFolderAccountSource): Promise<LocalGitUntrackedFileListing>
  untrackedFile(id: LocalGitConnectionId, request: LocalGitUntrackedFileRequest, source: import('./localFolderCapture.ts').LocalFolderAccountSource): Promise<LocalGitUntrackedFilePreview>
  cancelUntrackedRead(id: LocalGitConnectionId, request: LocalGitUntrackedFilesRequest, source: import('./localFolderCapture.ts').LocalFolderAccountSource): Promise<boolean>
  fileComparison?(id: LocalGitConnectionId, request: LocalGitFileComparisonRequest, source: import('./localFolderCapture.ts').LocalFolderAccountSource): Promise<LocalGitFileComparison>
  cancelFileComparison?(id: LocalGitConnectionId, request: LocalGitFileComparisonCancel, source: import('./localFolderCapture.ts').LocalFolderAccountSource): Promise<boolean>
  disconnect(id: LocalGitConnectionId, source: import('./localFolderCapture.ts').LocalFolderAccountSource): Promise<void>
}

export function isLocalGitConnectionId(value: unknown): value is LocalGitConnectionId {
  return typeof value === 'string' && /^GIT_[A-F0-9]{32}$/.test(value)
}
export function isLocalGitCapture(value: unknown): value is LocalGitCapture {
  const fields = ['version', 'snapshotId', 'capturedAt', 'connectionId', 'files']
  if (!isClosedRecord(value, fields)) return false
  const item = value as Record<string, unknown>
  return item.version === 1 && isSnapshotId(item.snapshotId) && isServedCaptureTime(item.capturedAt) &&
    isLocalGitConnectionId(item.connectionId) && isGitSnapshotFiles(item.files)
}
export function isLocalGitRefreshRequest(value: unknown): value is LocalGitRefreshRequest {
  if (!isClosedRecord(value, ['expectedSnapshotId', 'requestId', 'snapshot'])) return false
  const item = value as Record<string, unknown>
  return (item.expectedSnapshotId === null || isSnapshotId(item.expectedSnapshotId)) && isSnapshotId(item.requestId) &&
    item.requestId !== item.expectedSnapshotId && isLocalGitCapture(item.snapshot) && item.snapshot.snapshotId === item.requestId
}
