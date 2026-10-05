import type { Identity } from '../../contract/identity.ts'
import { isLocalConnectionId, isLocalFolderCapture, type LocalFolderCapture, type LocalFolderConnection, type NativeLocalFolderBridge } from '../../contract/localFolderCapture.ts'
import { accountGeneration, activeAccount } from './account.ts'
import { AccountSwitchedError } from './client.ts'
import { peek } from './cache.ts'
import { keys } from './keys.ts'
import type { DesktopBridgeScope } from './desktopCredentials.ts'
export { localFoldersAvailable } from './localFolderCapability.ts'

/** Device-only authority stays behind the native bridge. The supplied account is
 * a precondition checked against native cookie truth, never an owner assertion. */
export function captureLocalFolderSource() {
  const me = peek<Identity>(keys.me)
  const account = activeAccount()
  if (!me || (account && (account.userId !== me.user.id || account.tenantId !== me.tenant.id))) {
    throw new AccountSwitchedError('local folder identity unresolved')
  }
  const source = { userId: me.user.id, namespace: me.tenant.id }
  const generation = accountGeneration()
  const assertCurrent = () => {
    const current = peek<Identity>(keys.me)
    if (generation !== accountGeneration() || current?.user.id !== source.userId || current?.tenant.id !== source.namespace) {
      throw new AccountSwitchedError('local folder identity changed')
    }
  }
  return { source, assertCurrent, sourceUserId: me.via === 'session' ? me.user.id : null }
}

function bridge(scope: DesktopBridgeScope): NativeLocalFolderBridge {
  const port = scope?.agentCommonsDesktop?.context?.localFolders
  if (!port) throw new Error('Local connections are available in the desktop app. Choose a folder again in this browser.')
  return port
}

function validConnection(value: unknown): value is LocalFolderConnection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return Object.keys(row).length === 3 && isLocalConnectionId(row.id) && typeof row.name === 'string'
    && row.name.length > 0 && row.name.length <= 255 && !/[\x00-\x1f/\\]/u.test(row.name) && typeof row.remembered === 'boolean'
}

export async function readLocalFolders(scope: DesktopBridgeScope = window): Promise<LocalFolderConnection[]> {
  const identity = captureLocalFolderSource()
  const rows = await bridge(scope).list(identity.source)
  identity.assertCurrent()
  if (!Array.isArray(rows) || rows.length > 64 || !rows.every(validConnection) || new Set(rows.map(row => row.id)).size !== rows.length) {
    throw new Error('The device returned an invalid connection list.')
  }
  return rows
}

export async function connectLocalFolder(remember: boolean, scope: DesktopBridgeScope = window): Promise<LocalFolderConnection | null> {
  const identity = captureLocalFolderSource()
  const result = await bridge(scope).connect({ remember }, identity.source)
  identity.assertCurrent()
  if (result.status === 'cancelled') return null
  if (result.status !== 'connected' || !validConnection(result.connection) || result.connection.remembered !== remember) {
    throw new Error('Could not confirm the selected connection. Check the connection list before choosing again.')
  }
  return result.connection
}

export async function disconnectLocalFolder(id: string, scope: DesktopBridgeScope = window): Promise<void> {
  const identity = captureLocalFolderSource()
  if (!isLocalConnectionId(id)) throw new Error('This local connection is unavailable.')
  await bridge(scope).disconnect(id, identity.source)
  identity.assertCurrent()
}

/** Only Attach and Refresh call this function. Listing, preview and generation
 * never capture; a portable receipt is content, not native access authority. */
export async function captureLocalFolder(id: string, snapshotId = crypto.randomUUID(), scope: DesktopBridgeScope = window): Promise<LocalFolderCapture> {
  const identity = captureLocalFolderSource()
  if (!isLocalConnectionId(id)) throw new Error('This local connection is unavailable.')
  const result = await bridge(scope).snapshot(id, identity.source)
  identity.assertCurrent()
  const snapshot: LocalFolderCapture = { version: 1, snapshotId, capturedAt: new Date().toISOString(), connectionId: id, files: result.files }
  if (!isLocalFolderCapture(snapshot)) throw new Error('The selected folder did not return a complete supported snapshot.')
  return structuredClone(snapshot)
}
