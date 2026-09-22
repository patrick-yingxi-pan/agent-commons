/** Served runner filesystem authority follows the runner's advertised grants.
 * The configured logical root remains ~/projects -> sample-runner-host; a
 * narrower grant filters the fixed tree and does not silently re-root it. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LOCAL_RUNNER_SEED } from '../data/runners.ts'
import { store } from '../store/index.ts'
import { call, callRaw } from '../testkit/http.ts'

const runnerId = 'runner-local'
const source = `runner:${runnerId}`
const rootScope = '~/projects'
const narrowScope = '~/projects/insights-dashboard'

function enrollmentHeaders(): Record<string, string> {
  const token = process.env.RUNNER_ENROLL_TOKEN
  return token ? { 'x-runner-token': token } : {}
}

async function setCapabilities(capabilities: unknown[]) {
  return call('PATCH', `/runners/${runnerId}/capabilities`, { capabilities }, enrollmentHeaders())
}

function fsUrl(route: string, path?: string): string {
  return `/fs/${route}?source=${encodeURIComponent(source)}${path === undefined ? '' : `&path=${encodeURIComponent(path)}`}`
}

test('served runner filesystem routes honor advertised grants and fixed logical mapping', async (t) => {
  const original = LOCAL_RUNNER_SEED.capabilities.map((capability) => ({
    type: capability.type,
    scopes: [...capability.scopes],
  }))
  t.after(async () => {
    const restored = await setCapabilities(original)
    assert.equal(restored.status, 200, 'restore seeded runner capabilities')
  })

  const revoked = await setCapabilities([])
  assert.equal(revoked.status, 200)
  const sources = await call('GET', '/fs/sources')
  const revokedRequests = await Promise.all([
    call('GET', fsUrl('catalog')),
    call('GET', fsUrl('folder', 'insights-dashboard')),
    call('GET', fsUrl('text', 'TODO.md')),
    callRaw('GET', fsUrl('content', 'TODO.md')),
  ])
  assert.equal(sources.status, 200)
  assert.deepEqual(revokedRequests.map((response) => response.status), [404, 404, 404, 404])
  assert.equal(sources.json.some((entry: { id: string }) => entry.id === source), false)

  const emptyScopes = await setCapabilities([
    { type: 'fs.read', scopes: [] },
    { type: 'fs.list', scopes: [] },
  ])
  assert.equal(emptyScopes.status, 200)
  const emptySourceList = await call('GET', '/fs/sources')
  const emptyRequests = await Promise.all([
    call('GET', fsUrl('catalog')),
    call('GET', fsUrl('folder', 'insights-dashboard')),
    call('GET', fsUrl('text', 'TODO.md')),
    callRaw('GET', fsUrl('content', 'TODO.md')),
  ])
  assert.equal(emptySourceList.status, 200)
  assert.deepEqual(emptyRequests.map((response) => response.status), [404, 404, 404, 404])
  assert.equal(emptySourceList.json.some((entry: { id: string }) => entry.id === source), false)

  const listOnly = await setCapabilities([{ type: 'fs.list', scopes: [rootScope] }])
  assert.equal(listOnly.status, 200)
  const listCatalog = await call('GET', fsUrl('catalog'))
  const listFolder = await call('GET', fsUrl('folder', 'insights-dashboard'))
  const listText = await call('GET', fsUrl('text', 'TODO.md'))
  const listBytes = await callRaw('GET', fsUrl('content', 'TODO.md'))
  assert.deepEqual([listCatalog.status, listFolder.status, listText.status, listBytes.status], [200, 200, 404, 404])
  assert.ok(listCatalog.json.folders.some((entry: { name: string }) => entry.name === 'insights-dashboard'))

  const readOnly = await setCapabilities([{ type: 'fs.read', scopes: [rootScope] }])
  assert.equal(readOnly.status, 200)
  const readCatalog = await call('GET', fsUrl('catalog'))
  const readFolder = await call('GET', fsUrl('folder', 'insights-dashboard'))
  const readText = await call('GET', fsUrl('text', 'TODO.md'))
  const readBytes = await callRaw('GET', fsUrl('content', 'TODO.md'))
  assert.deepEqual([readCatalog.status, readFolder.status, readText.status, readBytes.status], [404, 404, 200, 200])
  assert.match(readText.json.text, /insights/i)
  assert.ok(readBytes.body.length > 0)

  const narrow = await setCapabilities([
    { type: 'fs.read', scopes: [narrowScope] },
    { type: 'fs.list', scopes: [narrowScope] },
  ])
  assert.equal(narrow.status, 200)
  const narrowCatalog = await call('GET', fsUrl('catalog'))
  const narrowFolder = await call('GET', fsUrl('folder', 'insights-dashboard'))
  const narrowTodo = await call('GET', fsUrl('text', 'TODO.md'))
  assert.deepEqual([narrowCatalog.status, narrowFolder.status, narrowTodo.status], [200, 200, 404])
  assert.deepEqual(narrowCatalog.json.files, [])
  assert.deepEqual(narrowCatalog.json.photos, [])
  assert.deepEqual(narrowCatalog.json.folders.map((entry: { name: string }) => entry.name), ['insights-dashboard'])
  assert.ok(narrowFolder.json.artifacts.some((entry: { name: string }) => entry.name === 'src-notes.md'))

  store.attachContext('auth-refactor', {
    id: 'ctx-runner-authority-narrow',
    type: 'folder',
    label: 'insights-dashboard',
    scope: narrowScope,
  })
  const nestedRead = await call('POST', `/runners/${runnerId}/invoke`, {
    sessionId: 'auth-refactor',
    contextId: 'ctx-runner-authority-narrow',
    capability: 'fs.read',
    target: `${narrowScope}/src-notes.md`,
    commandId: 'cmd-fs-authority-nested-read',
  })
  const nestedList = await call('POST', `/runners/${runnerId}/invoke`, {
    sessionId: 'auth-refactor',
    contextId: 'ctx-runner-authority-narrow',
    capability: 'fs.list',
    target: narrowScope,
    commandId: 'cmd-fs-authority-nested-list',
  })
  assert.deepEqual([nestedRead.status, nestedList.status], [200, 200])
  assert.match(nestedRead.json.output.content, /src-notes|insights/i)
  assert.ok(nestedList.json.output.entries.some((entry: { name: string }) => entry.name === 'src-notes.md'))
})
