import type { Identity } from '../../contract/identity.ts'
import { isLocalGitCapture, isLocalGitConnectionId, type LocalGitCapture, type LocalGitConnection, type NativeLocalGitBridge } from '../../contract/localGitCapture.ts'
import { parseLocalGitReview, type LocalGitReview } from '../../contract/localGitReview.mjs'
import { isLocalGitFileSelection, parseLocalGitFileListing, parseLocalGitFilePreview, type LocalGitFileSelection } from '../../contract/localGitBrowse.mjs'
import { parseLocalGitUntrackedFileRequest, parseLocalGitUntrackedFilesRequest,
  parseLocalGitUntrackedFileListing, parseLocalGitUntrackedFilePreview } from '../../contract/localGitUntrackedBrowse.mjs'
import { parseLocalGitFileComparisonSelection, parseLocalGitFileComparisonRequest, parseLocalGitFileComparison,
  type LocalGitFileComparisonSelection } from '../../contract/localGitFileComparison.mjs'
import { accountGeneration, activeAccount, onAccountSwitch } from './account.ts'
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

/** Read one explicit, transient local review from the native pinned source.
 * The identity fence and detached contract parser keep device data account-
 * scoped and out of persistence/model-input paths. */
export async function readLocalGitChanges(id: string, scope: DesktopBridgeScope = window): Promise<LocalGitReview> {
  const identity = captureLocalGitSource()
  if (!isLocalGitConnectionId(id)) throw new Error('This repository connection is unavailable.')
  const result = await bridge(scope).review(id, identity.source)
  identity.assertCurrent()
  const review = parseLocalGitReview(result)
  if (!review) throw new Error('The repository returned an invalid review.')
  return structuredClone(review)
}

/** List only bounded tracked path metadata and ignore counts. This does not
 * read or return source file contents. */
export async function readLocalGitFiles(id: string, scope: DesktopBridgeScope = window) {
  const identity = captureLocalGitSource()
  if (!isLocalGitConnectionId(id)) throw new Error('This repository connection is unavailable.')
  const result = await bridge(scope).files(id, identity.source)
  identity.assertCurrent()
  const listing = parseLocalGitFileListing(result)
  if (!listing) throw new Error('The repository returned an invalid file listing.')
  return structuredClone(listing)
}

/** Read exactly one user-selected tracked file, bounded by the detached
 * contract parser; results remain transient and account-fenced. */
export async function readLocalGitFile(id: string, path: string, scope: DesktopBridgeScope = window) {
  const identity = captureLocalGitSource()
  if (!isLocalGitConnectionId(id)) throw new Error('This repository connection is unavailable.')
  const selection: LocalGitFileSelection = { path }
  if (!isLocalGitFileSelection(selection)) throw new Error('Choose a valid tracked file path.')
  const result = await bridge(scope).file(id, selection, identity.source)
  identity.assertCurrent()
  const preview = parseLocalGitFilePreview(result)
  if (!preview || preview.path !== path) throw new Error('The repository returned an invalid file preview.')
  return structuredClone(preview)
}

function abortError() { return new DOMException('The native repository read was cancelled.', 'AbortError') }

type GitReadSource = { userId: string; namespace: string }
type GitReadOperation<S extends string> = { scope: S; operationId: string }

/** One account-bound cancellation/publication lifecycle for explicitly scoped
 * native reads. Each adapter still owns its exact request and result parser. */
function readOperation<T, S extends string>(id: string, signal: AbortSignal | undefined, scope: DesktopBridgeScope | undefined,
  operationScope: S, available: (port: NativeLocalGitBridge) => boolean,
  invoke: (port: NativeLocalGitBridge, request: GitReadOperation<S>, source: GitReadSource) => Promise<unknown>,
  cancelRead: (port: NativeLocalGitBridge, request: GitReadOperation<S>, source: GitReadSource) => Promise<unknown>,
  parse: (value: unknown) => T | undefined, matches: (value: T) => boolean): Promise<T> {
  const identity = captureLocalGitSource()
  if (!isLocalGitConnectionId(id)) return Promise.reject(new Error('This repository connection is unavailable.'))
  const currentScope = scope ?? (typeof window === 'undefined' ? undefined : window)
  let port: NativeLocalGitBridge
  try { port = bridge(currentScope as DesktopBridgeScope) }
  catch (error) { return Promise.reject(error) }
  if (!available(port)) {
    return Promise.reject(new Error('This repository operation is unavailable on this device.'))
  }
  if (signal?.aborted) return Promise.reject(abortError())
  const operationId = globalThis.crypto?.randomUUID?.()
  if (typeof operationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    return Promise.reject(new Error('Could not start the native repository read.'))
  }
  const generation = accountGeneration()
  const request = { scope: operationScope, operationId }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let dispatched = false
    let unsubscribe = () => {}
    const cleanup = () => { signal?.removeEventListener('abort', onAbort); unsubscribe() }
    const finish = (error?: unknown, value?: T) => {
      if (settled) return
      settled = true
      cleanup()
      if (error !== undefined) reject(error)
      else resolve(value as T)
    }
    const cancel = () => {
      if (!dispatched) return
      try { void Promise.resolve(cancelRead(port, request, identity.source)).catch(() => {}) }
      catch { /* the local publication fence is immediate */ }
    }
    const onAbort = () => { cancel(); finish(abortError()) }
    const onSwitch = () => { cancel(); finish(new AccountSwitchedError('local Git identity changed')) }
    try {
      unsubscribe = onAccountSwitch(onSwitch)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) { onAbort(); return }
      if (generation !== accountGeneration()) { onSwitch(); return }
      void Promise.resolve().then(() => {
        if (settled) return undefined
        dispatched = true
        return invoke(port, request, identity.source)
      }).then((result) => {
        if (settled) return
        identity.assertCurrent()
        if (generation !== accountGeneration()) throw new AccountSwitchedError('local Git identity changed')
        const detached = parse(result)
        if (!detached || !matches(detached)) {
          throw new Error('The repository returned an invalid read result.')
        }
        finish(undefined, structuredClone(detached))
      }, (error) => finish(error)).catch((error) => finish(error))
    } catch (error) { finish(error) }
  })
}

function readUntracked<T>(id: string, signal: AbortSignal | undefined, scope: DesktopBridgeScope | undefined,
  invoke: (port: NativeLocalGitBridge, request: GitReadOperation<'untracked'>, source: GitReadSource) => Promise<unknown>,
  parse: (value: unknown) => T | undefined, expectedPath?: string): Promise<T> {
  return readOperation(id, signal, scope, 'untracked',
    port => typeof port.untrackedFiles === 'function' && typeof port.untrackedFile === 'function' && typeof port.cancelUntrackedRead === 'function',
    invoke, (port, request, source) => port.cancelUntrackedRead(id as LocalGitConnection['id'], request, source),
    parse, value => expectedPath === undefined || (value as { path?: string }).path === expectedPath)
}

/** Compare exactly one selected file; this operation does not depend on a
 * successful whole-repository review and never captures unrelated file bodies. */
export function readLocalGitFileComparison(id: string, selection: LocalGitFileComparisonSelection,
  signal?: AbortSignal, scope?: DesktopBridgeScope) {
  const detached = parseLocalGitFileComparisonSelection(selection)
  if (!detached) return Promise.reject(new Error('Choose a valid repository file path and comparison.'))
  return readOperation(id, signal, scope, 'file-comparison',
    port => typeof port.fileComparison === 'function' && typeof port.cancelFileComparison === 'function',
    (port, operation, source) => {
      const request = parseLocalGitFileComparisonRequest({ ...operation, ...detached })
      if (!request) throw new Error('Could not start the selected-file comparison.')
      return port.fileComparison!(id as LocalGitConnection['id'], request, source)
    },
    (port, request, source) => port.cancelFileComparison!(id as LocalGitConnection['id'], request, source),
    parseLocalGitFileComparison, value => value.path === detached.path && value.comparison === detached.comparison)
}

/** List untracked metadata through the explicit native scope and cancellation door. */
export function readLocalGitUntrackedFiles(id: string, signal?: AbortSignal, scope?: DesktopBridgeScope) {
  return readUntracked(id, signal, scope, (port, request, source) => {
    const closed = parseLocalGitUntrackedFilesRequest(request)
    return port.untrackedFiles!(id as LocalGitConnection['id'], closed!, source)
  }, parseLocalGitUntrackedFileListing)
}

/** Read one explicitly selected untracked path as a transient detached preview. */
export function readLocalGitUntrackedFile(id: string, path: string, signal?: AbortSignal, scope?: DesktopBridgeScope) {
  return readUntracked(id, signal, scope, (port, operation, source) => {
    const request = parseLocalGitUntrackedFileRequest({ ...operation, path })
    if (!request) throw new Error('Choose a valid untracked file path.')
    return port.untrackedFile!(id as LocalGitConnection['id'], request, source)
  }, parseLocalGitUntrackedFilePreview, path)
}
