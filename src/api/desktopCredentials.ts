import type { FolderFileSnapshot } from '../../contract/localFolderSnapshot.mjs'
import type { PdfImportStatus } from '../../contract/pdfImport.mjs'
import type { DocxImportStatus } from '../../contract/docxImport.mjs'

/** The renderer-side face of Electron's narrow native capabilities. The web
 * build has no bridge and keeps browser pickers plus the existing PROVIDER_*
 * workflow. Credentials remain write-only; backup and picker methods expose
 * bounded results but no arbitrary path, handle, or raw IPC authority. Restore
 * is a path-free native intent whose destructive work remains in the shell. */
export interface DesktopBackupMetadata {
  fileName: string
  sizeBytes: number
  createdAt: string
}

export type DesktopRecoveryStatus =
  | { status: 'ready'; backup: DesktopBackupMetadata }
  | { status: 'failed' }

export type DesktopRestoreResult = { status: 'cancelled' } | { status: 'restarting' }

export type DesktopContextPickerRejection =
  | 'image-too-large'
  | 'invalid-request'
  | 'selection-too-large'
  | 'too-many-files'
  | 'too-many-folder-entries'
  | 'unreadable'
  | 'unsupported-image'

export interface DesktopPickedFile {
  name: string
  kind: 'file' | 'photo'
  sizeBytes: number
  text?: string
  previewDataUrl?: string
  /** Transient parser input. Never copied into persisted Attachment state. */
  pdfBytes?: Uint8Array
  pdfFailure?: Exclude<PdfImportStatus, 'ready' | 'no-text'>
  /** Transient parser input. Never copied into persisted Attachment state. */
  docxBytes?: Uint8Array
  docxFailure?: Exclude<DocxImportStatus, 'ready' | 'no-text'>
}

export type DesktopFilePickResult =
  | { status: 'cancelled' }
  | { status: 'rejected'; reason: DesktopContextPickerRejection }
  | { status: 'selected'; files: DesktopPickedFile[] }

export type DesktopFolderPickResult =
  | { status: 'cancelled' }
  | { status: 'rejected'; reason: DesktopContextPickerRejection }
  | { status: 'selected'; folder: { name: string; files: Array<{ name: string; sizeBytes: number; snapshot?: FolderFileSnapshot }> } }

export interface DesktopBridge {
  context?: {
    pickFiles(accept: 'image' | 'any'): Promise<DesktopFilePickResult>
    pickFolder(): Promise<DesktopFolderPickResult>
  }
  credentials?: {
    provision(secret: string): Promise<string>
    bind(reference: string, providerId: string): Promise<void>
    discard(reference: string): Promise<void>
    removeProvider(providerId: string): Promise<void>
  }
  data?: {
    createBackup(): Promise<DesktopBackupMetadata>
    getRecoveryStatus(): Promise<DesktopRecoveryStatus>
    revealBackups(): Promise<void>
    restoreBackup(): Promise<DesktopRestoreResult>
  }
}

/** Compatibility name retained for the provider controller and its fixtures. */
export type DesktopCredentialBridge = DesktopBridge

declare global {
  interface Window {
    agentCommonsDesktop?: DesktopBridge
  }
}

export type DesktopBridgeScope = { agentCommonsDesktop?: DesktopBridge }

function bridge(scope: DesktopBridgeScope = window): DesktopBridge['credentials'] | undefined {
  return scope.agentCommonsDesktop?.credentials
}

export function desktopCredentialsAvailable(scope?: DesktopBridgeScope): boolean {
  return bridge(scope) !== undefined
}

export async function provisionDesktopCredential(secret: string, scope?: DesktopBridgeScope): Promise<string> {
  const credentials = bridge(scope)
  if (!credentials) throw new Error('Secure device credential storage is unavailable.')
  return credentials.provision(secret)
}

export async function bindDesktopCredential(reference: string, providerId: string, scope?: DesktopBridgeScope): Promise<void> {
  const credentials = bridge(scope)
  if (!credentials) throw new Error('Secure device credential storage is unavailable.')
  await credentials.bind(reference, providerId)
}

export async function discardDesktopCredential(reference: string, scope?: DesktopBridgeScope): Promise<void> {
  const credentials = bridge(scope)
  if (!credentials) return
  await credentials.discard(reference)
}

export async function removeDesktopProviderCredentials(providerId: string, scope?: DesktopBridgeScope): Promise<void> {
  const credentials = bridge(scope)
  if (!credentials) return
  await credentials.removeProvider(providerId)
}
