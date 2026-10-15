import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { after, test } from 'node:test'
import type { PersistedState } from './format.ts'
import { STORE_VERSION } from './persist.ts'
import { JsonFileBackend } from './json.ts'
import { SqliteBackend } from './sqlite.ts'
import { restoreBackendSnapshot } from './portable.ts'
import { prepareAgentRequestRestoreState } from './agentRequestRestore.ts'
import { beginProxyRequest, cancelProxyRequest, createProxyRequest, denyProxyRequest,
  settleProxyRequest, shareProxyReply, type StoredProxyRequest } from '../proxyRequestState.ts'

const root = join(tmpdir(), `agent-request-restore-${process.pid}`)
const portable = join(root, 'source.json')
const malformed = join(root, 'malformed.json')
const sourceDb = join(root, 'source.json-store')
const requester = { tenantId: 'tenant-requester', userId: 'person-requester', agentId: 'agent-requester' }
const owner = { tenantId: 'tenant-owner', userId: 'person-owner', agentId: 'agent-owner' }
const requesterActor = { tenantId: requester.tenantId, userId: requester.userId }
const ownerActor = { tenantId: owner.tenantId, userId: owner.userId }
const now = 1_800_000_000_000
const approval = { transport: 'http' as const, call: {
  connectionId: 'mcp-connection-owner', connectionRevision: 3, toolName: 'invoice_lookup',
  schemaHash: 'b'.repeat(64), arguments: { invoice: 'INV-42' },
} }

function request(suffix = 'a'): StoredProxyRequest {
  return createProxyRequest({ id: `agent-request-${suffix.repeat(32)}`, requester, owner,
    task: 'Look up the latest invoice status.', createdAt: now })
}

function restoreFixture(rows: StoredProxyRequest[]): PersistedState {
  return {
    version: STORE_VERSION, sessions: [], bindings: [], workspaces: [], schedules: [],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: { sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {}, artifactSource: {},
      scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {}, extraArtifacts: [], extraProjects: [], standingApprovals: {} },
    agentRequests: rows,
  } as PersistedState
}

function seedPortableSnapshot(): void {
  const source = run(sourceDb, 'json', `
    import { store } from ${href('../store/index.ts')}
    import { loadState, closePersistence } from ${href('./persist.ts')}
    import { writePortableSnapshot } from ${href('./portable.ts')}
    store.initPersistence()
    const { agentCreationId } = await import(${href('../agentCreationIdentity.ts')})
    const fromAgentId = agentCreationId('tenant-acme', 'restore-source-agent')
    const toAgentId = agentCreationId('tenant-beta', 'restore-target-agent')
    store.createAgent({ label: 'Restore requester', systemPrompt: 'Test.', tools: [], instructions: '' },
      'tenant-acme', { logicalId: fromAgentId, ownerUserId: 'user-ada' })
    store.createAgent({ label: 'Restore owner', systemPrompt: 'Test.', tools: [], instructions: '', published: true },
      'tenant-beta', { logicalId: toAgentId, ownerUserId: 'user-grace' })
    store.createAgentRequest({ tenantId: 'tenant-acme', userId: 'user-ada' }, 'restore-waiting-request', {
      fromAgentId, toAgentId, task: 'A request restored from portable data.' })
    writePortableSnapshot(${JSON.stringify(portable)}, loadState())
    console.log('portable source ready')
    closePersistence()
  `)
  assert.equal(source.status, 0, source.stderr || source.stdout)
}

function href(name: string): string { return JSON.stringify(new URL(name, import.meta.url).href) }

function run(file: string, backend: 'json' | 'sqlite', source: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, BACKEND: 'mock', INITIAL_WORLD: 'demo', PERSIST_BACKEND: backend,
      DATA_FILE: file, DATABASE_PATH: file, IDENTITY_HEADERS: 'deny', AUTH_GATE: 'off',
      AUTH_SECRET: 'agent-request-restore-disposable-test-signing-secret' },
  })
}

after(() => {
  // Test-owned files are confined to a unique path under the system temp directory.
  rmSync(root, { recursive: true, force: true })
})

test('explicit restore fences waiting rows without claiming a human decision and interrupts pending attempts', () => {
  const waiting = request('a')
  const running = beginProxyRequest(request('c'), ownerActor, 1, approval, now + 1)
  const cancelledPending = cancelProxyRequest(running, requesterActor, 2, now + 2)
  const denied = denyProxyRequest(request('b'), ownerActor, 1, now + 1)
  const finished = beginProxyRequest(request('d'), ownerActor, 1, approval, now + 1)
  const awaiting = settleProxyRequest(finished, finished.execution!.callHash, { status: 'uncertain', summary: 'ignored' }, now + 2)
  const replied = shareProxyReply(awaiting, ownerActor, awaiting.revision, 'Reviewed before backup.', now + 3)
  const input = restoreFixture([waiting, denied, cancelledPending, replied])
  const before = JSON.stringify(input)

  const restored = prepareAgentRequestRestoreState(structuredClone(input), now + 10)
  const rows = restored.agentRequests!
  assert.equal(JSON.stringify(input), before, 'restore does not mutate the caller-owned state')
  assert.equal(rows[0]?.status, 'waiting')
  assert.equal(rows[0]?.revision, 1, 'the restore fence is not a fabricated owner decision')
  assert.equal(rows[0]?.executionBlockedByRestore, true)
  assert.equal(rows[1]?.status, 'denied')
  assert.deepEqual(rows[1], denied, 'an already recorded denial stays unchanged')
  assert.equal(rows[2]?.status, 'cancelled')
  assert.equal(rows[2]?.execution?.status, 'uncertain', 'an in-flight cancelled attempt is interrupted conservatively')
  assert.equal(rows[2]?.executionBlockedByRestore, undefined)
  assert.deepEqual(rows[3], replied, 'known terminal history and an already shared reply are retained exactly')
})

test('ordinary restart state and snapshots with no request slice remain untouched', () => {
  const waiting = request('a')
  const state = restoreFixture([waiting])
  const absent = restoreFixture([])
  delete absent.agentRequests
  assert.deepEqual(prepareAgentRequestRestoreState(structuredClone(state), now + 1).agentRequests?.[0],
    { ...waiting, executionBlockedByRestore: true })
  assert.deepEqual(prepareAgentRequestRestoreState(structuredClone(absent), now + 1), absent,
    'a legacy snapshot with no private request slice stays absent')
})

for (const backendKind of ['json', 'sqlite'] as const) {
  test(`${backendKind}: portable rollback fences old waiting work and malformed fences do not write`, () => {
    seedPortableSnapshot()
    const valid = JSON.parse(readFileSync(portable, 'utf8')) as PersistedState
    const malformedState = structuredClone(valid)
    malformedState.agentRequests![0] = { ...malformedState.agentRequests![0]!, executionBlockedByRestore: false } as never
    writeFileSync(malformed, JSON.stringify(malformedState))

    const destination = join(root, `destination-${backendKind}${backendKind === 'json' ? '.json' : '.db'}`)
    const previousDataFile = process.env.DATA_FILE
    if (backendKind === 'json') process.env.DATA_FILE = destination
    const concrete = backendKind === 'json' ? new JsonFileBackend() : new SqliteBackend(destination)
    let saves = 0
    const backend = {
      name: concrete.name,
      load: () => concrete.load(),
      save: (state: PersistedState) => { saves += 1; concrete.save(state) },
      close: () => concrete.close(),
    }
    try {
      const restored = restoreBackendSnapshot(backend, portable)
      const row = restored.agentRequests?.[0]
      assert.equal(row?.status, 'waiting')
      assert.equal(row?.revision, 1)
      assert.equal(row?.executionBlockedByRestore, true)
      assert.throws(() => beginProxyRequest(row!, ownerActor, row!.revision, approval, now + 2),
        'an old waiting request stays unexecutable even with fresh explicit approval input')

      const prior = backend.load()
      const saveCount = saves
      assert.throws(() => restoreBackendSnapshot(backend, malformed), /unsupported or invalid/)
      assert.equal(saves, saveCount, 'strict fence admission runs before the backend write')
      assert.deepEqual(backend.load(), prior, 'failed admission preserves the restored destination')
    } finally {
      concrete.close()
      if (previousDataFile === undefined) delete process.env.DATA_FILE
      else process.env.DATA_FILE = previousDataFile
    }
  })
}
