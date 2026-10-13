import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalFolderConnections } from './localFolderConnectionsCore.ts'
import { createLocalFolderBrowserCore } from './localFolderBrowserCore.ts'
import type { LocalFolderConnection } from '../../contract/localFolderCapture.ts'

const connection = (suffix: string, remembered = false): LocalFolderConnection => ({
  id: `LOCAL_${suffix.repeat(32)}` as LocalFolderConnection['id'],
  name: `Folder ${suffix}`,
  remembered,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('reload reads only connection metadata and coalesces concurrent requests', async () => {
  const pending = deferred<LocalFolderConnection[]>()
  let reads = 0
  const existing = connection('A', true)
  const core = createLocalFolderConnections({
    list: () => { reads += 1; return pending.promise },
    connect: async () => null,
    disconnect: async () => {},
  })

  const first = core.reload()
  const coalesced = core.reload()
  assert.equal(first, coalesced)
  assert.equal(reads, 1)
  assert.deepEqual(core.get(), { rows: [], status: 'loading', busy: false, error: null })
  pending.resolve([existing])
  await first

  assert.deepEqual(core.get(), { rows: [existing], status: 'ready', busy: false, error: null })
  assert.deepEqual(Object.keys(core.get().rows[0]!).sort(), ['id', 'name', 'remembered'])
})

test('connect passes the unchecked false choice and publishes its row only after acknowledgement', async () => {
  const pending = deferred<LocalFolderConnection | null>()
  const source = connection('B')
  const rememberChoices: boolean[] = []
  const core = createLocalFolderConnections({
    list: async () => [],
    connect: remember => { rememberChoices.push(remember); return pending.promise },
    disconnect: async () => {},
  })
  await core.reload()

  const action = core.connect(false)
  assert.deepEqual(rememberChoices, [false], 'unchecked Remember is explicitly supplied as false')
  assert.deepEqual(core.get(), { rows: [], status: 'ready', busy: true, error: null }, 'no connection row appears before native acknowledgement')
  pending.resolve(source)
  assert.equal(await action, source)
  assert.deepEqual(core.get(), { rows: [source], status: 'ready', busy: false, error: null })
})

test('lost connect acknowledgement retains old rows and blocks mutation until an authoritative reload', async () => {
  const before = connection('C', true)
  const after = connection('D', false)
  let listings = [before]
  let connectCalls = 0
  const core = createLocalFolderConnections({
    list: async () => listings,
    connect: async () => { connectCalls += 1; throw new Error('acknowledgement lost') },
    disconnect: async () => {},
  })
  await core.reload()

  assert.equal(await core.connect(false), null)
  assert.deepEqual(core.get().rows, [before], 'uncertain connection is never optimistically added')
  assert.equal(core.get().status, 'error')
  assert.equal(core.get().busy, false)
  assert.equal(await core.connect(false), null, 'uncertainty blocks another mutation')
  assert.equal(connectCalls, 1)

  listings = [before, after]
  const reload = core.reload()
  assert.deepEqual(core.get().rows, [before], 'reload retains the last authoritative rows while pending')
  assert.equal(core.get().status, 'loading')
  await reload
  assert.deepEqual(core.get().rows, [before, after], 'only an authoritative reload admits the uncertain row')
  assert.equal(core.get().status, 'ready')
})

test('lost disconnect acknowledgement keeps the row and shared status until reload confirms absence', async () => {
  const existing = connection('E', true)
  let listings = [existing]
  let failList = false
  let disconnectCalls = 0
  const core = createLocalFolderConnections({
    list: async () => { if (failList) throw new Error('truth unavailable'); return listings },
    connect: async () => null,
    disconnect: async () => { disconnectCalls += 1; throw new Error('response lost') },
  })
  const observed: string[] = []
  const unsubscribe = core.subscribe(() => observed.push(`${core.get().status}:${core.get().busy}:${core.get().rows.length}`))
  await core.reload()

  await core.disconnect(existing.id)
  assert.deepEqual(core.get().rows, [existing], 'disconnect is not an optimistic removal')
  assert.equal(core.get().status, 'error')
  assert.equal(await core.disconnect(existing.id), null, 'uncertain disconnection blocks retries')
  assert.equal(await core.connect(false), null, 'uncertain disconnection blocks other mutations')
  assert.equal(disconnectCalls, 1)
  assert.ok(observed.includes('ready:true:1'), 'subscribers observe the shared in-flight mutation status')
  assert.ok(observed.includes('error:false:1'), 'subscribers observe retained rows and recovery status')

  failList = true
  await core.reload()
  assert.deepEqual(core.get().rows, [existing], 'failed reload retains the last authoritative row')
  assert.equal(core.get().status, 'error', 'failed reload leaves mutation authority unresolved')
  assert.equal(await core.connect(false), null, 'a failed reload cannot unlock mutations')
  assert.equal(disconnectCalls, 1)

  failList = false
  listings = []
  await core.reload()
  assert.deepEqual(core.get().rows, [])
  assert.equal(core.get().status, 'ready')
  unsubscribe()
})

test('accepted folder disconnect clears its transient browser before acknowledgement and keeps it cleared on failure', async () => {
  const existing = connection('M')
  const gate = deferred<void>()
  const browser = createLocalFolderBrowserCore({
    list: async () => ({ version: 1, visited: 1, hiddenCount: 0, directoryCount: 0, files: [{ path: 'secret.txt', kind: 'file' }] }),
    preview: async () => ({ version: 1, path: 'secret.txt', sizeBytes: 6, snapshot: { text: 'secret' } }),
    now: () => 1,
  })
  const core = createLocalFolderConnections({ list: async () => [existing], connect: async () => null, disconnect: () => gate.promise })
  const events: string[] = []
  const unsubscribe = core.subscribeDisconnect(id => { events.push(id); browser.dismiss(id) })
  await core.reload()
  await browser.readListing(existing.id)
  await browser.readPreview(existing.id, 'secret.txt')

  const operation = core.disconnect(existing.id)
  assert.deepEqual(events, [existing.id], 'accepted disconnect notifies synchronously before its acknowledgement')
  assert.equal(browser.get(existing.id).preview, null)
  assert.equal(browser.get(existing.id).listing, null)
  gate.reject(new Error('response lost'))
  await operation
  assert.deepEqual(core.get().rows, [existing], 'failed disconnect retains authoritative connection metadata')
  assert.equal(browser.get(existing.id).preview, null, 'failure never restores old source bytes')
  unsubscribe()
})

test('clear fences late list and mutation completions and lets a new identity reload and connect', async () => {
  const oldRead = deferred<LocalFolderConnection[]>()
  const oldMutation = deferred<LocalFolderConnection | null>()
  const newMutation = deferred<LocalFolderConnection | null>()
  const current = connection('F', true)
  const connected = connection('G')
  let reads = 0
  let connects = 0
  const core = createLocalFolderConnections({
    list: () => ++reads === 1 ? oldRead.promise : Promise.resolve([current]),
    connect: () => ++connects === 1 ? oldMutation.promise : newMutation.promise,
    disconnect: async () => {},
  })

  const previousRead = core.reload()
  core.clear()
  assert.deepEqual(core.get(), { rows: [], status: 'idle', busy: false, error: null })
  const currentRead = core.reload()
  oldRead.resolve([connection('H')])
  await previousRead
  assert.deepEqual(core.get().rows, [current], 'a retired list response cannot publish over the new identity')
  await currentRead
  assert.deepEqual(core.get().rows, [current])

  const retiredMutation = core.connect(false)
  assert.equal(core.get().busy, true)
  core.clear()
  const newRead = core.reload()
  await newRead
  const currentMutation = core.connect(false)
  newMutation.resolve(connected)
  assert.equal(await currentMutation, connected)
  oldMutation.resolve(connection('I'))
  assert.equal(await retiredMutation, null)
  assert.deepEqual(core.get(), { rows: [current, connected], status: 'ready', busy: false, error: null }, 'late old-account acknowledgement cannot overwrite the new account projection')
})
