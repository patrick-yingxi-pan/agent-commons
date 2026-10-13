import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { createLocalGitConnections } from './localGitConnectionsCore.ts'
import { createLocalGitBrowserCore } from './localGitBrowserCore.ts'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import type { LocalGitConnection } from '../../contract/localGitCapture.ts'

const connection = (suffix: string, remembered = false): LocalGitConnection => ({ id: `GIT_${suffix.repeat(32)}` as LocalGitConnection['id'], name: `Repo ${suffix}`, remembered })
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('Git connection state lists metadata, publishes only acknowledgements, and sends explicit Remember false', async () => {
  const pending = deferred<LocalGitConnection | null>()
  const existing = connection('A', true)
  const seen: boolean[] = []
  const core = createLocalGitConnections({ list: async () => [existing], connect: remember => { seen.push(remember); return pending.promise }, disconnect: async () => {} })
  await core.reload()
  const operation = core.connect(false)
  assert.deepEqual(seen, [false])
  assert.equal(core.get().busy, true)
  assert.deepEqual(core.get().rows, [existing], 'no row is invented before native acknowledgement')
  const added = connection('B')
  pending.resolve(added)
  assert.equal(await operation, added)
  assert.deepEqual(core.get().rows, [existing, added])
})

test('lost Git disconnect acknowledgement retains the row and requires authoritative reload', async () => {
  const existing = connection('C', true)
  let rows = [existing]
  let fail = true
  const core = createLocalGitConnections({ list: async () => rows, connect: async () => null, disconnect: async () => { if (fail) throw new Error('lost') } })
  await core.reload()
  await core.disconnect(existing.id)
  assert.deepEqual(core.get().rows, [existing])
  assert.equal(core.get().status, 'error')
  assert.equal(await core.connect(false), null, 'uncertainty blocks other writes')
  rows = []
  fail = false
  await core.reload()
  assert.deepEqual(core.get().rows, [])
  assert.equal(core.get().status, 'ready')
})

test('accepted Git disconnect clears only that browser immediately, even if acknowledgement is lost', async () => {
  const existing = connection('J')
  const gate = deferred<void>()
  const browser = createLocalGitBrowserCore({
    list: async () => ({ version: 1, excludedCount: 0, files: [{ path: 'secret.txt', kind: 'file' }] }),
    preview: async () => ({ version: 1, path: 'secret.txt', sizeBytes: 6, snapshot: { text: 'secret' } }),
    now: () => 1,
  })
  const core = createLocalGitConnections({ list: async () => [existing], connect: async () => null, disconnect: () => gate.promise })
  const events: string[] = []
  const unsubscribe = core.subscribeDisconnect(id => { events.push(id); browser.dismiss(id) })
  await core.reload()
  await browser.readListing(existing.id)
  await browser.readPreview(existing.id, 'secret.txt')
  await browser.readListing(connection('K').id)

  const operation = core.disconnect(existing.id)
  assert.deepEqual(events, [existing.id], 'accepted disconnect notifies synchronously before its acknowledgement')
  assert.equal(browser.get(existing.id).preview, null)
  assert.equal(browser.get(existing.id).listing, null)
  assert.ok(browser.get(connection('K').id).listing, 'another connection keeps its transient listing')
  gate.reject(new Error('response lost'))
  await operation
  assert.deepEqual(core.get().rows, [existing], 'failed disconnect retains authoritative connection metadata')
  assert.equal(browser.get(existing.id).preview, null, 'failure never restores old source bytes')
  unsubscribe()
})

test('Git disconnect notifications are absent for rejected mutations and can be unsubscribed', async () => {
  const existing = connection('L')
  const core = createLocalGitConnections({ list: async () => [existing], connect: async () => null, disconnect: async () => {} })
  const events: string[] = []
  const unsubscribe = core.subscribeDisconnect(id => events.push(id))
  assert.equal(await core.disconnect(existing.id), null, 'a not-ready disconnect is rejected')
  await core.reload()
  unsubscribe()
  await core.disconnect(existing.id)
  assert.deepEqual(events, [], 'no event is emitted outside accepted subscribed disconnects')
})

test('both production browser controllers dismiss the exact accepted-disconnect target', () => {
  const git = stripComments(read(join(ROOT, 'src/controller/localGitBrowser.ts')))
  const folder = stripComments(read(join(ROOT, 'src/controller/localFolderBrowser.ts')))
  assert.ok(git.includes('localGitConnections.subscribeDisconnect(id => localGitBrowser.dismiss(id))'))
  assert.ok(folder.includes('localFolderConnections.subscribeDisconnect(id => localFolderBrowser.dismiss(id))'))
})

test('account clear fences late Git list and mutation completions', async () => {
  const oldRead = deferred<LocalGitConnection[]>()
  const oldConnect = deferred<LocalGitConnection | null>()
  const current = connection('D', true)
  let listNumber = 0
  let connectNumber = 0
  const core = createLocalGitConnections({
    list: () => ++listNumber === 1 ? oldRead.promise : Promise.resolve([current]),
    connect: () => ++connectNumber === 1 ? oldConnect.promise : Promise.resolve(connection('E')),
    disconnect: async () => {},
  })
  const oldList = core.reload()
  core.clear()
  const newList = core.reload()
  oldRead.resolve([connection('F')])
  await oldList
  await newList
  assert.deepEqual(core.get().rows, [current])
  const oldMutation = core.connect(false)
  core.clear()
  await core.reload()
  assert.deepEqual(await core.connect(false), connection('E'))
  oldConnect.resolve(connection('G'))
  assert.equal(await oldMutation, null)
  assert.deepEqual(core.get().rows.map(row => row.id), [current.id, connection('E').id])
})
