import type { Identity } from '../../contract/identity.ts'
import { isLocalGitCapture, isLocalGitConnectionId, type LocalGitCapture, type LocalGitConnection, type NativeLocalGitBridge } from '../../contract/localGitCapture.ts'
import { accountGeneration, activeAccount } from './account.ts'
import { AccountSwitchedError } from './client.ts'
import { peek } from './cache.ts'
import { keys } from './keys.ts'
import type { DesktopBridgeScope } from './desktopCredentials.ts'

export function captureLocalGitSource() {
  const me = peek<Identity>(keys.me)
  const account = activeAccount()
  if (!me || (account && (account.userId !== me.user.id || account.tenantId !== me.tenant.id))) {
    throw new AccountSwitchedError('local Git identity unresolved')
  }
  const source = { userId: me.user.id, namespace: me.tenant.id }
  const generation = accountGeneration()
  const assertCurrent = () => {
    const current = peek<Identity>(keys.me)
    if (generation !== accountGeneration() || current?.user.id !== source.userId || current?.tenant.id !== source.namespace) {
      throw new AccountSwitchedError('local Git identity changed')
    }
  }
  return { source, assertCurrent, sourceUserId: me.via === 'session' ? me.user.id : null }
}

function bridge(scope: DesktopBridgeScope): NativeLocalGitBridge {
  const port = scope?.agentCommonsDesktop?.context?.localGit
  if (!port) throw new Error('Repository connections require the macOS desktop app on the original device. Your saved snapshots are unchanged.')
  return port
}

function validConnection(value: unknown): value is LocalGitConnection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return Object.keys(row).length === 3 && isLocalGitConnectionId(row.id) && typeof row.name === 'string'
    && row.name.length > 0 && row.name.length <= 255 && !/[\x00-\x1f/\\]/u.test(row.name) && typeof row.remembered === 'boolean'
}

export async function readLocalGitConnections(scope: DesktopBridgeScope = window): Promise<LocalGitConnection[]> {
  const identity = captureLocalGitSource()
  const rows = await bridge(scope).list(identity.source)
  identity.assertCurrent()
  if (!Array.isArray(rows) || rows.length > 64 || !rows.every(validConnection) || new Set(rows.map(row => row.id)).size !== rows.length) {
    throw new Error('The device returned an invalid repository connection list.')
  }
  return rows
}

export async function connectLocalGit(remember: boolean, scope: DesktopBridgeScope = window): Promise<LocalGitConnection | null> {
  const identity = captureLocalGitSource()
  const result = await bridge(scope).connect({ remember }, identity.source)
  identity.assertCurrent()
  if (result.status === 'cancelled') return null
  if (result.status !== 'connected' || !validConnection(result.connection) || result.connection.remembered !== remember) {
    throw new Error('Could not confirm the selected repository. Check the connection list before choosing again.')
  }
  return result.connection
}

export async function disconnectLocalGit(id: string, scope: DesktopBridgeScope = window): Promise<void> {
  const identity = captureLocalGitSource()
  if (!isLocalGitConnectionId(id)) throw new Error('This repository connection is unavailable.')
  await bridge(scope).disconnect(id, identity.source)
  identity.assertCurrent()
}

/** Only explicit Attach and Refresh acts capture source bytes. */
export async function captureLocalGit(id: string, snapshotId = crypto.randomUUID(), scope: DesktopBridgeScope = window): Promise<LocalGitCapture> {
  const identity = captureLocalGitSource()
  if (!isLocalGitConnectionId(id)) throw new Error('This repository connection is unavailable.')
  const result = await bridge(scope).snapshot(id, identity.source)
  identity.assertCurrent()
  if (typeof result?.name !== 'string' || !result.name || result.name.length > 255 || /[\x00-\x1f/\\]/u.test(result.name)) {
    throw new Error('The repository returned an invalid display name.')
  }
  const snapshot: LocalGitCapture = { version: 1, snapshotId, capturedAt: new Date().toISOString(), connectionId: id, files: result.files }
  if (!isLocalGitCapture(snapshot)) throw new Error('The repository did not return a complete supported snapshot.')
  return structuredClone(snapshot)
}
