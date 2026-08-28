/** Acknowledgement boundary for live durable writes.
 *
 * A backend failure must reject the mutation that encountered it, make readiness
 * fail, and permanently wall later product requests in that process. Even if the
 * path becomes writable again, only restart/rehydrate may resume service: memory
 * may already contain part of the failed mutation. This suite owns its process,
 * temp store and one-way fault latch. */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { call, callRaw } from '../testkit/http.ts'
import { buildRouter } from '../routes/index.ts'
import { store } from '../store/index.ts'
import {
  closePersistence,
  loadState,
  STORE_VERSION,
  type PersistedState,
} from './persist.ts'
import { writePortableSnapshot } from './portable.ts'

const ROOT = join(tmpdir(), `agent-commons-ack-boundary-${process.pid}`)
const FILE = join(ROOT, 'store.json')
const BLOCKED = join(ROOT, 'blocked-store-path')
const previousDataFile = process.env.DATA_FILE
const previousBackend = process.env.PERSIST_BACKEND

const baseline: PersistedState = {
  version: STORE_VERSION,
  sessions: [],
  bindings: [],
  workspaces: [],
  schedules: [],
  recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
  graph: {
    sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {},
    artifactSource: {}, scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {},
    extraArtifacts: [], extraProjects: [], standingApprovals: {},
  },
  seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
}

async function openAmbientStream(): Promise<{ status: number; ended: () => boolean }> {
  let status = 0
  let closed = false
  const req = {
    method: 'GET',
    headers: {},
    on() { return req },
  }
  const res = {
    writeHead(next: number) { status = next; return res },
    setHeader() {},
    write() { return true },
    end() { closed = true },
    flushHeaders() {},
    get writableEnded() { return closed },
  }
  await buildRouter().handle(req as never, res as never, new URL('http://test/events'))
  return { status, ended: () => closed }
}

after(() => {
  closePersistence()
  if (previousDataFile === undefined) delete process.env.DATA_FILE
  else process.env.DATA_FILE = previousDataFile
  if (previousBackend === undefined) delete process.env.PERSIST_BACKEND
  else process.env.PERSIST_BACKEND = previousBackend
  rmSync(ROOT, { recursive: true, force: true })
})

test('a failed durable commit never returns success and walls the process until restart', async () => {
  process.env.PERSIST_BACKEND = 'json'
  process.env.DATA_FILE = FILE
  writePortableSnapshot(FILE, baseline)
  store.initPersistence()

  const stream = await openAmbientStream()
  assert.equal(stream.status, 200)
  assert.equal(stream.ended(), false, 'the ambient stream starts open while storage is healthy')

  mkdirSync(BLOCKED, { recursive: true })
  process.env.DATA_FILE = BLOCKED // JsonFileBackend resolves the path per write

  const report = console.error
  console.error = () => {}
  let failed
  try {
    failed = await call('POST', '/sessions', { firstMessage: 'must never be acknowledged' })
  } finally {
    console.error = report
  }
  assert.equal(failed.status, 503, 'the originating mutation is refused')
  assert.equal(failed.json.error.code, 'storage_unavailable')
  assert.equal(store.persistenceHealthy(), false, 'the process latches the durability fault')
  assert.equal(stream.ended(), true, 'existing ambient clients are disconnected from divergent memory')

  process.env.DATA_FILE = FILE // disk access recovers, but this process may not
  const durable = loadState()
  assert.ok(durable)
  assert.equal(
    durable.sessions.some((session) => session.title.includes('must never')),
    false,
    'the failed mutation never reached the durable snapshot',
  )

  const retry = await call('POST', '/sessions', { firstMessage: 'must remain walled' })
  assert.equal(retry.status, 503, 'a recovered path cannot reopen a divergent process')
  assert.equal((await call('GET', '/sessions')).status, 503, 'stale in-memory reads are walled too')
  assert.equal((await call('GET', '/readyz')).status, 503)
  assert.equal((await call('GET', '/readyz')).json.status, 'storage_unavailable')
  assert.equal((await call('GET', '/healthz')).status, 200, 'operators retain a liveness probe')
  const metrics = await callRaw('GET', '/metrics')
  assert.equal(metrics.status, 200, 'operators retain diagnostics')
  assert.match(metrics.body, /persistence_healthy 0/)
})
