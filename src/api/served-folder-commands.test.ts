import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refreshSessionFolder } from './servedFolderCommands.ts'

test('folder refresh posts exact optimistic-concurrency identity and invalidates its session', async (t) => {
  const request = {
    expectedSnapshotId: null,
    requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }
  const response = { contexts: [], workspace: { workspaces: [], repos: [], connectors: [], attachments: [] } }
  let seenUrl = ''
  let seenBody = ''
  let timeout = 0
  const sessionSignal = new AbortController()
  t.mock.method(AbortSignal, 'timeout', (ms: number) => { timeout = ms; return sessionSignal.signal })
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    seenUrl = String(url)
    seenBody = String(init?.body)
    assert.equal(init?.signal, sessionSignal.signal)
    return new Response(JSON.stringify(response), { status: 200 })
  })

  assert.deepEqual(await refreshSessionFolder('session / one', 'cloud::docs', request), response)
  assert.ok(seenUrl.endsWith('/sessions/session%20%2F%20one/folders/cloud%3A%3Adocs/refresh'))
  assert.deepEqual(JSON.parse(seenBody), request)
  assert.equal(timeout, 30_000)
})
