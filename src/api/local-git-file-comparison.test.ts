import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Identity } from '../../contract/identity.ts'
import type { LocalGitConnection, NativeLocalGitBridge } from '../../contract/localGitCapture.ts'
import { refreshAccount } from './account.ts'
import { resetAll, setData } from './cache.ts'
import { AccountSwitchedError } from './client.ts'
import { keys } from './keys.ts'
import { readLocalGitFileComparison } from './localGit.ts'

const ada: Identity = { user: { id: 'ada', name: 'Ada' }, tenant: { id: 'tenant-a', name: 'A', kind: 'org' }, role: 'member', local: false, via: 'session' }
const grace: Identity = { ...ada, user: { id: 'grace', name: 'Grace' }, tenant: { id: 'tenant-b', name: 'B', kind: 'org' } }
const id = `GIT_${'A'.repeat(32)}` as LocalGitConnection['id']
const selection = { path: 'src/main.ts', comparison: 'staged' as const }
const result = { version: 1, scope: 'file-comparison', path: 'src/main.ts', comparison: 'staged',
  head: { oid: 'a'.repeat(40), ref: 'refs/heads/main' }, status: 'ready', change: 'modified',
  before: { kind: 'text', text: 'old', mode: '100644' }, after: { kind: 'text', text: 'new', mode: '100644' } }

function select(identity: Identity) {
  refreshAccount({ userId: identity.user.id, tenantId: identity.tenant.id })
  resetAll()
  setData(keys.me, identity)
}
function cleanup() { resetAll(); refreshAccount(null) }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function scopeFor(port: NativeLocalGitBridge) { return { agentCommonsDesktop: { context: { localGit: port } } } }
function bridge(overrides: Partial<NativeLocalGitBridge> = {}, calls: unknown[][] = []): NativeLocalGitBridge {
  return {
    async list(source) { calls.push(['list', source]); return [] },
    async connect(_input, source) { calls.push(['connect', source]); throw new Error('unused') },
    async snapshot(connectionId, source) { calls.push(['snapshot', connectionId, source]); throw new Error('unused') },
    async review(connectionId, source) { calls.push(['review', connectionId, source]); throw new Error('unused') },
    async files(connectionId, source) { calls.push(['files', connectionId, source]); throw new Error('unused') },
    async file(connectionId, selected, source) { calls.push(['file', connectionId, selected, source]); throw new Error('unused') },
    async untrackedFiles(connectionId, request, source) { calls.push(['untrackedFiles', connectionId, request, source]); throw new Error('unused') },
    async untrackedFile(connectionId, request, source) { calls.push(['untrackedFile', connectionId, request, source]); throw new Error('unused') },
    async cancelUntrackedRead(connectionId, request, source) { calls.push(['cancelUntrackedRead', connectionId, request, source]); throw new Error('unused') },
    async disconnect(connectionId, source) { calls.push(['disconnect', connectionId, source]) },
    ...overrides,
  }
}

test('native file comparison sends one detached scoped request and publishes a detached validated result', async () => {
  try {
    select(ada)
    const calls: unknown[][] = []
    const port = bridge({
      async fileComparison(connectionId, request, source) {
        calls.push(['compare', connectionId, request, source])
        return result
      },
      async cancelFileComparison(connectionId, request, source) {
        calls.push(['cancel', connectionId, request, source])
        return true
      },
    }, calls)
    const selected = { ...selection }
    const pending = readLocalGitFileComparison(id, selected, undefined, scopeFor(port))
    selected.path = 'mutated-after-call.ts'
    const captured = await pending
    assert.deepEqual(calls.length, 1)
    assert.equal(calls[0]?.[0], 'compare')
    assert.equal(calls[0]?.[1], id)
    const sent = calls[0]?.[2] as any
    assert.deepEqual(sent, { scope: 'file-comparison', operationId: sent.operationId, path: 'src/main.ts', comparison: 'staged' })
    assert.match(sent.operationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    assert.deepEqual(calls[0]?.[3], { userId: 'ada', namespace: 'tenant-a' })
    assert.deepEqual(captured, result)
    assert.notStrictEqual(captured, result)

    const unavailable = { version: 1, scope: 'file-comparison', path: selection.path, comparison: 'staged',
      head: result.head, status: 'unavailable', reason: 'ignored' }
    const unavailablePort = scopeFor(bridge({
      async fileComparison() { return unavailable }, async cancelFileComparison() { return false },
    }))
    assert.deepEqual(await readLocalGitFileComparison(id, selection, undefined, unavailablePort), unavailable)
  } finally { cleanup() }
})

test('file comparison rejects invalid IDs, selections, optional capability and malformed or mismatched native replies', async () => {
  try {
    select(ada)
    let calls = 0
    const counted = scopeFor(bridge({ async fileComparison() { calls++; return result } }))
    const badSelection = { path: '../private', comparison: 'staged' }
    await assert.rejects(readLocalGitFileComparison('not-a-connection', selection, undefined, counted), /connection is unavailable/i)
    await assert.rejects(readLocalGitFileComparison(id, badSelection as any, undefined, counted), /valid repository file path and comparison/i)
    const accessor = Object.defineProperty({}, 'path', { enumerable: true, get() { throw new Error('getter') } })
    await assert.rejects(readLocalGitFileComparison(id, accessor as any, undefined, counted), /valid repository file path and comparison/i)
    const unavailableBridge = scopeFor(bridge())
    await assert.rejects(readLocalGitFileComparison(id, selection, undefined, unavailableBridge), /operation is unavailable/i)
    assert.equal(calls, 0, 'invalid ID, selections and absent capability never dispatch')

    const malformed = scopeFor(bridge({ async fileComparison() { return { ...result, unexpected: true } as never }, async cancelFileComparison() { return false } }))
    await assert.rejects(readLocalGitFileComparison(id, selection, undefined, malformed), /invalid read result/i)
    const wrongPath = scopeFor(bridge({ async fileComparison() { return { ...result, path: 'other.ts' } }, async cancelFileComparison() { return false } }))
    await assert.rejects(readLocalGitFileComparison(id, selection, undefined, wrongPath), /invalid read result/i)
    const wrongDirection = scopeFor(bridge({ async fileComparison() { return { ...result, comparison: 'unstaged' } }, async cancelFileComparison() { return false } }))
    await assert.rejects(readLocalGitFileComparison(id, selection, undefined, wrongDirection), /invalid read result/i)
  } finally { cleanup() }
})

test('aborting a comparison cancels its exact operation and ignores late replies', async () => {
  try {
    select(ada)
    const pending = deferred<unknown>()
    const calls: unknown[][] = []
    const port = scopeFor(bridge({
      fileComparison(connectionId, request, source) { calls.push(['compare', connectionId, request, source]); return pending.promise },
      async cancelFileComparison(connectionId, request, source) { calls.push(['cancel', connectionId, request, source]); return true },
    }, calls))
    const controller = new AbortController()
    const reading = readLocalGitFileComparison(id, selection, controller.signal, port)
    await Promise.resolve()
    controller.abort()
    await assert.rejects(reading, { name: 'AbortError' })
    await Promise.resolve()
    assert.equal(calls.length, 2)
    assert.equal(calls[0]?.[0], 'compare')
    assert.equal(calls[1]?.[0], 'cancel')
    assert.deepEqual(calls[1]?.[2], { scope: 'file-comparison', operationId: (calls[0]?.[2] as any).operationId },
      'cancel carries only the exact scope and UUID')
    assert.deepEqual(calls[0]?.[3], calls[1]?.[3])
    pending.resolve(result)
    await Promise.resolve()
  } finally { cleanup() }
})

test('an already-aborted signal does not dispatch, and an account switch cancels/fences an active comparison', async () => {
  try {
    select(ada)
    let calls = 0
    const already = new AbortController()
    already.abort()
    await assert.rejects(readLocalGitFileComparison(id, selection, already.signal,
      scopeFor(bridge({ async fileComparison() { calls++; return result }, async cancelFileComparison() { return false } }))), { name: 'AbortError' })
    assert.equal(calls, 0, 'pre-aborted work never reaches the bridge')

    const pending = deferred<unknown>()
    const seen: unknown[][] = []
    const port = scopeFor(bridge({
      fileComparison(connectionId, request, source) { seen.push(['compare', connectionId, request, source]); return pending.promise },
      async cancelFileComparison(connectionId, request, source) { seen.push(['cancel', connectionId, request, source]); return true },
    }))
    const reading = readLocalGitFileComparison(id, selection, undefined, port)
    await Promise.resolve()
    refreshAccount({ userId: 'grace', tenantId: 'tenant-b' })
    setData(keys.me, grace)
    await assert.rejects(reading, AccountSwitchedError)
    assert.equal(seen[0]?.[0], 'compare')
    assert.equal(seen[1]?.[0], 'cancel')
    assert.deepEqual(seen[1]?.[2], { scope: 'file-comparison', operationId: (seen[0]?.[2] as any).operationId })
    pending.resolve(result)
    await Promise.resolve()
  } finally { cleanup() }
})
