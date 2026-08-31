/** The renderer-side face of Electron's write-only credential bridge. The web
 * build has no bridge and keeps the existing PROVIDER_* environment-reference
 * workflow. No method can list or read a stored secret. */
export interface DesktopCredentialBridge {
  credentials: {
    provision(secret: string): Promise<string>
    bind(reference: string, providerId: string): Promise<void>
    discard(reference: string): Promise<void>
    removeProvider(providerId: string): Promise<void>
  }
}

declare global {
  interface Window {
    agentCommonsDesktop?: DesktopCredentialBridge
  }
}

type BridgeScope = { agentCommonsDesktop?: DesktopCredentialBridge }

function bridge(scope: BridgeScope = window): DesktopCredentialBridge['credentials'] | undefined {
  return scope.agentCommonsDesktop?.credentials
}

export function desktopCredentialsAvailable(scope?: BridgeScope): boolean {
  return bridge(scope) !== undefined
}

export async function provisionDesktopCredential(secret: string, scope?: BridgeScope): Promise<string> {
  const credentials = bridge(scope)
  if (!credentials) throw new Error('Secure device credential storage is unavailable.')
  return credentials.provision(secret)
}

export async function bindDesktopCredential(reference: string, providerId: string, scope?: BridgeScope): Promise<void> {
  const credentials = bridge(scope)
  if (!credentials) throw new Error('Secure device credential storage is unavailable.')
  await credentials.bind(reference, providerId)
}

export async function discardDesktopCredential(reference: string, scope?: BridgeScope): Promise<void> {
  const credentials = bridge(scope)
  if (!credentials) return
  await credentials.discard(reference)
}

export async function removeDesktopProviderCredentials(providerId: string, scope?: BridgeScope): Promise<void> {
  const credentials = bridge(scope)
  if (!credentials) return
  await credentials.removeProvider(providerId)
}
