export type LocalBrowseDocumentFormat = 'pdf' | 'docx' | 'xlsx' | 'pptx'
export type LocalBrowseFileSnapshot = { text: string } |
  { document: { format: LocalBrowseDocumentFormat; bytes: Uint8Array } } |
  { image: { bytes: Uint8Array } } |
  { omitted: 'unsupported' | 'too-large' | 'unreadable' }
export const MAX_LOCAL_BROWSE_TEXT_BYTES: number
export function localBrowseDocumentFormat(name: string): LocalBrowseDocumentFormat | undefined
export function isLocalBrowseFileName(name: string): boolean
export function localBrowseFileByteLimit(name: string): number
export function parseLocalBrowseFileSnapshot(path: string, sizeBytes: number, value: unknown): LocalBrowseFileSnapshot | undefined
export function localBrowseSnapshotFromBytes(path: string, sizeBytes: number, bytes: Uint8Array): LocalBrowseFileSnapshot | undefined
