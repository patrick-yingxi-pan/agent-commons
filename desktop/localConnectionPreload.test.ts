import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8')
const channels = {
  list: 'agent-commons:local-folders:list',
  connect: 'agent-commons:local-folders:connect',
  snapshot: 'agent-commons:local-folders:snapshot',
  snapshotTree: 'agent-commons:local-folders:snapshot-tree',
  files: 'agent-commons:local-folders:files',
  file: 'agent-commons:local-folders:file',
  disconnect: 'agent-commons:local-folders:disconnect',
}
const gitChannels = {
  list: 'agent-commons:local-git:list',
  connect: 'agent-commons:local-git:connect',
  snapshot: 'agent-commons:local-git:snapshot',
  review: 'agent-commons:local-git:review',
  files: 'agent-commons:local-git:files',
  file: 'agent-commons:local-git:file',
  disconnect: 'agent-commons:local-git:disconnect',
}
const unavailableMessage = 'The local folder is unavailable. Your saved snapshots have not been changed.'
const gitUnavailableMessage = 'The repository is unavailable or has changed. Your saved snapshots have not been changed.'
const busyMessage = 'Local folder reads are busy. Try again when the current reads finish.'
const gitBusyMessage = 'Repository reads are busy. Try again when the current reads finish.'
const limitMessage = 'This device has reached its local connection limit. Disconnect an unused connection first.'

function loadPreload(responses = [], platform = 'linux') {
  const calls = []
  let bridge
  const electron = {
    contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'agentCommonsDesktop'); bridge = value } },
    ipcRenderer: {
      invoke(channel, ...args) {
        calls.push([channel, ...args])
        const response = responses.shift()
        if (response?.reject) return Promise.reject(response.reject)
        return Promise.resolve(response?.value)
      },
    },
  }
  const context = vm.createContext({
    process: { argv: [], platform },
    require(name) {
      assert.equal(name, 'electron', 'preload may require only Electron in this test harness')
      return electron
    },
  })
  vm.runInContext(source, context, { filename: 'preload.cjs' })
  return { bridge, calls }
}

const sourceIdentity = { namespace: 'tenant-a', userId: 'user-a' }

test('local folder preload methods unwrap successful replies and preserve exact arguments and values', async () => {
  const values = [
    [{ id: 'LOCAL_A', name: 'Project', remembered: true }],
    { status: 'cancelled' },
    { name: 'Project', files: [{ name: 'note.txt', sizeBytes: 4, snapshot: { text: 'body' } }] },
    { version: 1, visited: 1, hiddenCount: 0, directoryCount: 0, files: [{ path: 'note.txt', kind: 'file' }] },
    { version: 1, path: 'note.txt', sizeBytes: 4, snapshot: { text: 'body' } },
    undefined,
  ]
  const { bridge, calls } = loadPreload(values.map((value) => ({ value: { ok: true, value } })), 'darwin')
  const folders = bridge.context.localFolders

  assert.deepEqual(await folders.list(sourceIdentity), values[0])
  const options = { remember: false }
  assert.deepEqual(await folders.connect(options, sourceIdentity), values[1])
  assert.deepEqual(await folders.snapshot('LOCAL_A', sourceIdentity), values[2])
  assert.deepEqual(await folders.files('LOCAL_A', sourceIdentity), values[3])
  const selection = { path: 'note.txt' }
  assert.deepEqual(await folders.file('LOCAL_A', selection, sourceIdentity), values[4])
  assert.equal(await folders.disconnect('LOCAL_A', sourceIdentity), undefined)
  assert.deepEqual(calls, [
    [channels.list, sourceIdentity],
    [channels.connect, options, sourceIdentity],
    [channels.snapshot, 'LOCAL_A', sourceIdentity],
    [channels.files, 'LOCAL_A', sourceIdentity],
    [channels.file, 'LOCAL_A', selection, sourceIdentity],
    [channels.disconnect, 'LOCAL_A', sourceIdentity],
  ])
})

test('all local folder methods map safe failure codes to fixed user guidance', async () => {
  const methods = [
    ['list', () => [sourceIdentity]],
    ['connect', () => [{ remember: true }, sourceIdentity]],
    ['snapshot', () => ['LOCAL_A', sourceIdentity]],
    ['files', () => ['LOCAL_A', sourceIdentity]],
    ['file', () => ['LOCAL_A', { path: 'note.txt' }, sourceIdentity]],
    ['disconnect', () => ['LOCAL_A', sourceIdentity]],
  ]
  const cases = [
    ['busy', busyMessage],
    ['limit-reached', limitMessage],
    ['unavailable', unavailableMessage],
  ]

  for (const [method, args] of methods) {
    for (const [code, expectedMessage] of cases) {
      const { bridge, calls } = loadPreload([{ value: { ok: false, error: code } }], 'darwin')
      await assert.rejects(bridge.context.localFolders[method](...args()), (error) => {
        assert.equal(error.message, expectedMessage)
        assert.equal(error.cause, undefined)
        assert.equal(String(error).includes(channels[method]), false)
        return true
      })
      assert.equal(calls.length, 1)
      assert.equal(calls[0][0], channels[method])
    }
  }
})

test('recursive folder capture is exposed only on macOS and keeps the old snapshot signature intact', async () => {
  const linux = loadPreload([], 'linux')
  assert.equal(Object.hasOwn(linux.bridge.context.localFolders, 'snapshotTree'), false)
  assert.equal(Object.hasOwn(linux.bridge.context.localFolders, 'files'), false)
  assert.equal(Object.hasOwn(linux.bridge.context.localFolders, 'file'), false)

  const tree = { name: 'Project', files: [{ name: 'nested/note.txt', sizeBytes: 4, snapshot: { text: 'body' } }] }
  const { bridge, calls } = loadPreload([{ value: { ok: true, value: tree } }], 'darwin')
  assert.deepEqual(await bridge.context.localFolders.snapshotTree('LOCAL_A', sourceIdentity), tree)
  assert.deepEqual(calls, [[channels.snapshotTree, 'LOCAL_A', sourceIdentity]])

  const denied = loadPreload([{ value: { ok: false, error: 'unavailable' } }], 'darwin')
  await assert.rejects(denied.bridge.context.localFolders.snapshotTree('LOCAL_A', sourceIdentity), error => {
    assert.equal(error.message, unavailableMessage)
    assert.equal(error.cause, undefined)
    assert.equal(String(error).includes(channels.snapshotTree), false)
    return true
  })
  assert.deepEqual(denied.calls, [[channels.snapshotTree, 'LOCAL_A', sourceIdentity]])
})

test('selective folder browse methods are macOS-only and pass only exact relative selections on fixed channels', async () => {
  const linux = loadPreload([], 'linux')
  assert.equal(Object.hasOwn(linux.bridge.context.localFolders, 'files'), false)
  assert.equal(Object.hasOwn(linux.bridge.context.localFolders, 'file'), false)
  const listing = { version: 1, visited: 1, hiddenCount: 0, directoryCount: 0, files: [{ path: 'note.txt', kind: 'file' }] }
  const preview = { version: 1, path: 'note.txt', sizeBytes: 4, snapshot: { text: 'body' } }
  const { bridge, calls } = loadPreload([
    { value: { ok: true, value: listing } }, { value: { ok: true, value: preview } },
  ], 'darwin')
  assert.deepEqual(await bridge.context.localFolders.files('LOCAL_A', sourceIdentity), listing)
  const selection = { path: 'note.txt' }
  assert.deepEqual(await bridge.context.localFolders.file('LOCAL_A', selection, sourceIdentity), preview)
  assert.deepEqual(calls, [[channels.files, 'LOCAL_A', sourceIdentity], [channels.file, 'LOCAL_A', selection, sourceIdentity]])
})

test('selected folder and Git document bytes cross only their existing explicit file channels', async () => {
  for (const [door, id, channel] of [['localFolders', 'LOCAL_A', channels.file], ['localGit', 'GIT_A', gitChannels.file]]) {
    const selection = { path: 'nested/selected.pdf' }
    const preview = { version: 1, path: selection.path, sizeBytes: 3,
      snapshot: { document: { format: 'pdf', bytes: new Uint8Array([0, 255, 1]) } } }
    const { bridge, calls } = loadPreload([{ value: { ok: true, value: preview } }], 'darwin')
    assert.deepEqual(await bridge.context[door].file(id, selection, sourceIdentity), preview)
    assert.deepEqual(calls, [[channel, id, selection, sourceIdentity]])
  }
})

test('raw IPC rejection and malformed or prototype-shaped replies become path-free unavailable errors', async () => {
  const privatePath = '/Users/private/customer/source'
  const cases = [
    { reject: Object.assign(new Error(`Error invoking remote method '${channels.list}': ${privatePath}`), { cause: new Error(privatePath) }) },
    { value: null },
    { value: { ok: true } },
    { value: { ok: 'yes', value: [] } },
    { value: Object.assign(Object.create({ ok: true, value: [] }), {}) },
    { value: Object.assign(Object.create({ ok: false, error: 'busy' }), {}) },
    { value: { ok: false, error: privatePath } },
    { value: JSON.parse('{"ok":false,"error":"__proto__"}') },
    { value: { ok: true, value: [], constructor: 'unexpected' } },
  ]

  for (const response of cases) {
    const { bridge } = loadPreload([response])
    await assert.rejects(bridge.context.localFolders.list(sourceIdentity), (error) => {
      assert.equal(error.message, unavailableMessage)
      assert.equal(error.cause, undefined)
      assert.equal(Object.hasOwn(error, 'cause'), false)
      assert.equal(String(error).includes(privatePath), false)
      assert.equal(String(error).includes(channels.list), false)
      return true
    })
  }
})

test('macOS Git preload unwraps exact tracked-path snapshots and invokes only the fixed Git channels', async () => {
  const files = [{ path: '.github/workflows/check.yml', sizeBytes: 4, snapshot: { text: 'test' } }]
  const values = [
    [{ id: 'GIT_0123456789ABCDEF0123456789ABCDEF', name: 'Agent Commons', remembered: false }],
    { status: 'cancelled' },
    { name: 'Agent Commons', files },
    { version: 1, comparison: 'raw', head: { oid: 'a'.repeat(40), ref: 'refs/heads/main' }, excludedCount: 0, unchangedCount: 0, files: [] },
    { version: 1, files: [{ path: 'src/main.ts', kind: 'file' }], excludedCount: 0 },
    { version: 1, path: 'src/main.ts', sizeBytes: 4, snapshot: { text: 'test' } },
    undefined,
  ]
  const { bridge, calls } = loadPreload(values.map(value => ({ value: { ok: true, value } })), 'darwin')
  const git = bridge.context.localGit
  assert.deepEqual(await git.list(sourceIdentity), values[0])
  const remember = { remember: true }
  assert.deepEqual(await git.connect(remember, sourceIdentity), values[1])
  assert.deepEqual(await git.snapshot('GIT_0123456789ABCDEF0123456789ABCDEF', sourceIdentity), values[2])
  assert.deepEqual(await git.review('GIT_0123456789ABCDEF0123456789ABCDEF', sourceIdentity), values[3])
  assert.deepEqual(await git.files('GIT_0123456789ABCDEF0123456789ABCDEF', sourceIdentity), values[4])
  const selection = { path: 'src/main.ts' }
  assert.deepEqual(await git.file('GIT_0123456789ABCDEF0123456789ABCDEF', selection, sourceIdentity), values[5])
  assert.equal(await git.disconnect('GIT_0123456789ABCDEF0123456789ABCDEF', sourceIdentity), undefined)
  assert.deepEqual(calls, [
    [gitChannels.list, sourceIdentity],
    [gitChannels.connect, remember, sourceIdentity],
    [gitChannels.snapshot, 'GIT_0123456789ABCDEF0123456789ABCDEF', sourceIdentity],
    [gitChannels.review, 'GIT_0123456789ABCDEF0123456789ABCDEF', sourceIdentity],
    [gitChannels.files, 'GIT_0123456789ABCDEF0123456789ABCDEF', sourceIdentity],
    [gitChannels.file, 'GIT_0123456789ABCDEF0123456789ABCDEF', selection, sourceIdentity],
    [gitChannels.disconnect, 'GIT_0123456789ABCDEF0123456789ABCDEF', sourceIdentity],
  ])
  assert.equal(JSON.stringify(values[2]).includes('/Users/'), false, 'Git snapshots expose relative tracked paths only')
})

test('Git preload is absent outside macOS and maps every native failure to fixed path-free guidance', async () => {
  const linux = loadPreload([], 'linux')
  assert.equal(Object.hasOwn(linux.bridge.context, 'localGit'), false)

  const methods = [
    ['list', () => [sourceIdentity]],
    ['connect', () => [{ remember: false }, sourceIdentity]],
    ['snapshot', () => ['GIT_0123456789ABCDEF0123456789ABCDEF', sourceIdentity]],
    ['review', () => ['GIT_0123456789ABCDEF0123456789ABCDEF', sourceIdentity]],
    ['files', () => ['GIT_0123456789ABCDEF0123456789ABCDEF', sourceIdentity]],
    ['file', () => ['GIT_0123456789ABCDEF0123456789ABCDEF', { path: 'src/main.ts' }, sourceIdentity]],
    ['disconnect', () => ['GIT_0123456789ABCDEF0123456789ABCDEF', sourceIdentity]],
  ]
  const privatePath = '/Users/private/customer/repository'
  for (const [method, args] of methods) {
    for (const [response, expected] of [
      [{ value: { ok: false, error: 'busy' } }, gitBusyMessage],
      [{ value: { ok: false, error: 'limit-reached' } }, limitMessage],
      [{ value: { ok: false, error: 'unavailable' } }, gitUnavailableMessage],
      [{ reject: new Error(`${gitChannels[method]} ${privatePath}`) }, gitUnavailableMessage],
    ]) {
      const { bridge, calls } = loadPreload([response], 'darwin')
      await assert.rejects(bridge.context.localGit[method](...args()), error => {
        assert.equal(error.message, expected)
        assert.equal(error.cause, undefined)
        assert.equal(String(error).includes(privatePath), false)
        assert.equal(String(error).includes(gitChannels[method]), false)
        return true
      })
      assert.equal(calls.length, 1)
      assert.equal(calls[0][0], gitChannels[method])
    }
  }
})
