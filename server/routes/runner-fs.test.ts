/** The runner filesystem source — a connected runner's host, browsed through the
 *  broker (`/fs/*?source=runner:<id>`) and read through the mediated invoke path
 *  (`/runners/:id/invoke` with real `fs.read`). Runs in the default mock (native)
 *  backend, which seeds the co-located `runner-local` mapped to `sample-runner-host/`. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'
import { runCapability } from '../runner-runtime.ts'
import type { Runner } from '../../contract/index.ts'

test('GET /fs/sources includes the seeded runner', async () => {
  const r = await call('GET', '/fs/sources')
  const runner = r.json.find((s: any) => s.id === 'runner:runner-local')
  assert.ok(runner, 'the co-located runner is a source')
  assert.equal(runner.kind, 'runner')
  assert.equal(runner.runnerId, 'runner-local')
})

test('GET /fs/catalog?source=runner:runner-local lists its host files', async () => {
  const r = await call('GET', '/fs/catalog?source=runner:runner-local')
  assert.equal(r.status, 200)
  assert.ok(r.json.files.map((f: any) => f.name).includes('TODO.md'))
  assert.ok(r.json.photos.map((p: any) => p.name).includes('screenshot.svg'))
  assert.ok(r.json.folders.map((d: any) => d.name).includes('insights-dashboard'))
})

test('GET /fs/text on a runner source returns real host content', async () => {
  const r = await call('GET', '/fs/text?source=runner:runner-local&path=TODO.md')
  assert.equal(r.status, 200)
  assert.equal(r.json.kind, 'text')
  assert.match(r.json.text, /insights/i)
})

test('an unknown / offline runner source 404s', async () => {
  assert.equal((await call('GET', '/fs/catalog?source=runner:nope')).status, 404)
})

test('mediated invoke: fs.read on the runner returns REAL host bytes + journals the effect', async () => {
  // Attach a folder context (scope = the runner's granted root) so the effect can
  // be mediated through it (D5), then invoke a read within that scope.
  store.attachContext('auth-refactor', {
    id: 'ctx-runner-fs',
    type: 'folder',
    label: 'projects',
    scope: '~/projects',
  })

  const r = await call('POST', '/runners/runner-local/invoke', {
    sessionId: 'auth-refactor',
    contextId: 'ctx-runner-fs',
    capability: 'fs.read',
    target: '~/projects/TODO.md',
    commandId: 'cmd-fs-read-todo',
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.capability, 'fs.read')
  assert.equal(r.json.output.encoding, 'utf-8')
  assert.match(r.json.output.content, /insights/i, 'real file content, not a mock string')

  // The effect landed on the runner's authoritative log (D2).
  const log = await call('GET', '/runners/runner-local/effects')
  assert.ok(log.json.some((e: any) => e.commandId === 'cmd-fs-read-todo'))
})

test('mapped runner read refusal is capability_unavailable and never a fake success effect', async () => {
  store.attachContext('auth-refactor', {
    id: 'ctx-runner-fs-missing',
    type: 'folder',
    label: 'projects',
    scope: '~/projects',
  })
  const commandId = 'cmd-fs-read-missing-real-file'
  const r = await call('POST', '/runners/runner-local/invoke', {
    sessionId: 'auth-refactor',
    contextId: 'ctx-runner-fs-missing',
    capability: 'fs.read',
    target: '~/projects/does-not-exist.txt',
    commandId,
  })
  assert.equal(r.status, 409)
  assert.equal(r.json.error.code, 'capability_unavailable')
  const log = await call('GET', '/runners/runner-local/effects')
  assert.ok(!log.json.some((e: any) => e.commandId === commandId), 'a refused read is not journaled as success')

  const refusedCommandId = 'cmd-fs-read-directory-refused'
  const refused = await call('POST', '/runners/runner-local/invoke', {
    sessionId: 'auth-refactor',
    contextId: 'ctx-runner-fs-missing',
    capability: 'fs.read',
    target: '~/projects/insights-dashboard',
    commandId: refusedCommandId,
  })
  assert.equal(refused.status, 409)
  assert.equal(refused.json.error.code, 'capability_unavailable')
  const afterRefused = await call('GET', '/runners/runner-local/effects')
  assert.ok(!afterRefused.json.some((e: any) => e.commandId === refusedCommandId), 'a non-file read is not journaled as success')
})

test('an unmapped development runner retains the deterministic fs.read mock', () => {
  const runner: Runner = {
    id: 'runner-unmapped-fixture',
    label: 'fixture',
    host: 'fixture',
    status: 'online',
    lastSeen: 0,
    capabilities: [{ type: 'fs.read', scopes: ['~/projects'] }],
  }
  const result = runCapability(runner, {
    sessionId: 'unmapped-fixture-session',
    contextId: 'unmapped-fixture-context',
    capability: 'fs.read',
    target: '~/projects/missing.txt',
  })
  assert.deepEqual(result.output, {
    encoding: 'utf-8',
    content: '// mock contents of ~/projects/missing.txt\n',
  })
})

test('mediated invoke: fs.list (the new monotonic capability) lists a real host directory + journals', async () => {
  store.attachContext('auth-refactor', {
    id: 'ctx-runner-list',
    type: 'folder',
    label: 'projects',
    scope: '~/projects',
  })
  const r = await call('POST', '/runners/runner-local/invoke', {
    sessionId: 'auth-refactor',
    contextId: 'ctx-runner-list',
    capability: 'fs.list',
    target: '~/projects/insights-dashboard',
    commandId: 'cmd-fs-list-insights',
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.capability, 'fs.list')
  const names = (r.json.output.entries ?? []).map((e: any) => e.name)
  assert.ok(names.includes('src-notes.md'), 'lists a real file from the host folder')
  // Monotonic (fs.list) bypasses the guardian and still journals the effect (D2).
  const log = await call('GET', '/runners/runner-local/effects')
  assert.ok(log.json.some((e: any) => e.commandId === 'cmd-fs-list-insights'))
})

test('mapped runner fs.list refuses missing, unsafe, and non-directory paths without fake effects', async () => {
  store.attachContext('auth-refactor', {
    id: 'ctx-runner-list-refusals',
    type: 'folder',
    label: 'projects',
    scope: '~/projects',
  })

  const root = await call('POST', '/runners/runner-local/invoke', {
    sessionId: 'auth-refactor',
    contextId: 'ctx-runner-list-refusals',
    capability: 'fs.list',
    target: '~/projects',
    commandId: 'cmd-fs-list-root-real',
  })
  assert.equal(root.status, 200)
  assert.ok(root.json.output.entries.some((entry: any) => entry.name === 'TODO.md'))

  const cases = [
    ['missing', '~/projects/does-not-exist-directory', 'cmd-fs-list-missing'],
    ['unsafe', '~/projects/../secrets', 'cmd-fs-list-unsafe'],
    ['non-directory', '~/projects/TODO.md', 'cmd-fs-list-file'],
  ] as const
  for (const [label, target, commandId] of cases) {
    const result = await call('POST', '/runners/runner-local/invoke', {
      sessionId: 'auth-refactor',
      contextId: 'ctx-runner-list-refusals',
      capability: 'fs.list',
      target,
      commandId,
    })
    assert.equal(result.status, 409, `${label} list should be unavailable`)
    assert.equal(result.json.error.code, 'capability_unavailable', `${label} list error code`)
    const log = await call('GET', '/runners/runner-local/effects')
    assert.ok(!log.json.some((entry: any) => entry.commandId === commandId), `${label} list is not journaled`)
  }
})

test('context mediation still bounds the effect: a target outside the context scope is forbidden', async () => {
  store.attachContext('auth-refactor', {
    id: 'ctx-runner-fs2',
    type: 'folder',
    label: 'projects',
    scope: '~/projects',
  })
  const r = await call('POST', '/runners/runner-local/invoke', {
    sessionId: 'auth-refactor',
    contextId: 'ctx-runner-fs2',
    capability: 'fs.read',
    target: '~/secrets/keys.txt',
  })
  assert.equal(r.status, 403)
})
