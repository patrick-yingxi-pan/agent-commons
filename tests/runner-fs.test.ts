/** The runner filesystem source — a connected runner's host, browsed through the
 *  broker (`/fs/*?source=runner:<id>`) and read through the mediated invoke path
 *  (`/runners/:id/invoke` with real `fs.read`). Runs in the default mock (native)
 *  backend, which seeds the co-located `runner-local` mapped to `sample-runner-host/`. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

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
  const attach = await call('POST', '/sessions/insights-launch/contexts', {
    id: 'ctx-runner-fs',
    type: 'folder',
    label: 'projects',
    scope: '~/projects',
  })
  assert.equal(attach.status, 200)

  const r = await call('POST', '/runners/runner-local/invoke', {
    sessionId: 'insights-launch',
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

test('mediated invoke: fs.list (the new monotonic capability) lists a real host directory + journals', async () => {
  await call('POST', '/sessions/insights-launch/contexts', {
    id: 'ctx-runner-list',
    type: 'folder',
    label: 'projects',
    scope: '~/projects',
  })
  const r = await call('POST', '/runners/runner-local/invoke', {
    sessionId: 'insights-launch',
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

test('context mediation still bounds the effect: a target outside the context scope is forbidden', async () => {
  await call('POST', '/sessions/insights-launch/contexts', {
    id: 'ctx-runner-fs2',
    type: 'folder',
    label: 'projects',
    scope: '~/projects',
  })
  const r = await call('POST', '/runners/runner-local/invoke', {
    sessionId: 'insights-launch',
    contextId: 'ctx-runner-fs2',
    capability: 'fs.read',
    target: '~/secrets/keys.txt',
  })
  assert.equal(r.status, 403)
})
