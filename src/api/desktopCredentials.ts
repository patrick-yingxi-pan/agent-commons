/** The renderer-side face of Electron's narrow native capabilities. The web
 * build has no bridge and keeps the existing PROVIDER_* environment-reference
 * workflow. Credential methods remain write-only; data methods expose metadata
 * but no filesystem path, file contents, or restore authority. */
export interface DesktopBackupMetadata {
  fileName: string
  sizeBytes: number
  createdAt: string
}

export interface DesktopBridge {
  credentials?: {
    provision(secret: string): Promise<string>
    bind(reference: string, providerId: string): Promise<void>
    discard(reference: string): Promise<void>
    removeProvider(providerId: string): Promise<void>
  }
  data?: {
    createBackup(): Promise<DesktopBackupMetadata>
    revealBackups(): Promise<void>
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
