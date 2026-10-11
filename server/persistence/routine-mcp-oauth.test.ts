/** OAuth Routine authority is private durable provenance, including after revoke. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SCHEDULED_TASKS } from '../data/cowork.ts'
import { routineMcpJsonText } from '../routineMcpPolicy.ts'
import { STORE_VERSION, hasCorePersistedShape, type PersistedState } from './format.ts'
import { JsonFileBackend } from './json.ts'
import { SqliteBackend } from './sqlite.ts'

const root = mkdtempSync(join(tmpdir(), 'agent-commons-routine-mcp-oauth-'))
const previousEnvironment = { DATA_FILE: process.env.DATA_FILE, DATABASE_PATH: process.env.DATABASE_PATH }
process.env.DATA_FILE = join(root, 'fixture.json')
process.env.DATABASE_PATH = join(root, 'fixture.db')
after(() => {
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(root, { recursive: true, force: true })
})

const tenantId = 'routine-oauth-tenant'
const ownerUserId = 'routine-oauth-person'
const otherUserId = 'routine-manager-peer'
const routineId = 'routine-oauth'
const runId = 'routine-oauth-run'
const connectionId = `mcp-connection-${'a'.repeat(32)}`
const legacyConnectionId = `mcp-connection-${'b'.repeat(32)}`
const otherConnectionId = `mcp-connection-${'c'.repeat(32)}`
const now = 1_800_000_000_000
const authority = () => ({ ownerUserId, connectionIds: [connectionId] })
const hash = (value: unknown) => createHash('sha256').update(routineMcpJsonText(value)).digest('hex')

function fixture({ stamp = true, oauth = true, revoked = false, retired = false,
  queued = false, done = false, mixed = false } = {}): PersistedState {
  const task = structuredClone(SCHEDULED_TASKS[0])
  task.id = routineId
  task.tenantId = tenantId
  task.runs = []
  const tool = { connectionId, connectionRevision: 4, toolName: 'write', schemaHash: 'd'.repeat(64), fixedArguments: {} }
  const approval = { definitionRevision: task.revision ?? 0, reviewHash: 'e'.repeat(64), approvedAt: now,
    expiresAt: now + 3_600_000, maxCallsPerRun: 3, tools: [tool] }
  if (mixed) approval.tools.push({ ...tool, connectionId: legacyConnectionId })
  const permission = { tenantId, routineId, policy: { version: 1, revision: 1, approval }, ...(stamp ? { oauthAuthority: authority() } : {}) }
  const policy = revoked ? { ...permission, policy: { version: 1, revision: 2, approval: null } } : permission
  const decisions = [{ decisionId: `routine-mcp-decision-${'1'.repeat(64)}`, tenantId, routineId,
    requestHash: '2'.repeat(64), policyRevision: 1, action: 'approve',
    ...(stamp ? { oauthAuthority: authority(), actorUserId: ownerUserId } : {}) }]
  if (revoked) decisions.push({ decisionId: `routine-mcp-decision-${'3'.repeat(64)}`, tenantId, routineId,
    requestHash: '4'.repeat(64), policyRevision: 2, action: 'revoke',
    ...(stamp ? { oauthAuthority: authority(), actorUserId: otherUserId } : {}) })
  const runs: unknown[] = []
  if (queued) {
    const call = { connectionId, connectionRevision: 4, toolName: 'write', schemaHash: tool.schemaHash, arguments: {} }
    const id = `routine-mcp-${'5'.repeat(64)}`
    runs.push({ permission, permissionHash: hash({ permission, runId }), runId, phase: 'active', calls: [{
      id, call, callHash: hash({ permission, runId, id, call }), startedAt: now + 1,
      ...(done ? { status: 'done', finishedAt: now + 2,
        result: { resultType: 'complete', content: [{ type: 'text', text: 'Known OAuth result.' }], isError: false } }
        : { status: 'pending' }),
    }] })
    task.runs.push({ id: runId, status: 'running', duration: '—', reachedStep: 0, summary: 'Queued', at: now,
      attempts: 1, maxAttempts: 3, nextAttemptAt: now + 1,
      execution: { definitionRevision: approval.definitionRevision, trigger: task.trigger, prompt: task.prompt,
        steps: task.steps, delivery: task.delivery, agentId: task.agentId ?? 'agent-fixture', providerId: task.providerId ?? 'provider-fixture' } })
  }
  const connection = { tenantId, id: connectionId, ...(oauth ? { ownerUserId } : {}) }
  const state = {
    version: STORE_VERSION, initialWorld: 'clean', sessions: [], bindings: [], workspaces: [], schedules: [task],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: { sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {}, artifactSource: {},
      scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {}, extraArtifacts: [], extraProjects: [], standingApprovals: {} },
    seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
    routineMcp: { policies: [policy], decisions, runs },
    mcpConnections: retired ? { connections: [], retired: [connection] } : {
      connections: [{ ...connection, label: 'OAuth fixture', endpoint: 'https://mcp.example/mcp',
        authentication: oauth ? 'device-oauth' : 'none', revision: 4, connected: false }], retired: [],
    },
  } as unknown as PersistedState
  if (mixed) state.mcpConnections!.retired.push({ tenantId, id: legacyConnectionId })
  return structuredClone(state)
}

function rehashRun(state: any) {
  const run = state.routineMcp.runs[0]
  run.permissionHash = hash({ permission: run.permission, runId: run.runId })
  for (const receipt of run.calls) receipt.callHash = hash({ permission: run.permission, runId: run.runId,
    id: receipt.id, call: receipt.call })
}

test('known OAuth Routine approval and queued permission cannot silently remain tenant-only', () => {
  for (const queued of [false, true]) {
    assert.equal(hasCorePersistedShape(fixture({ stamp: false, queued })), false,
      'known live OAuth selection requires an explicit authenticated person stamp')
    assert.equal(hasCorePersistedShape(fixture({ stamp: false, queued, retired: true })), false,
      'retirement retains the obligation to bind the original OAuth person')
  }
})

test('Routine OAuth authority must equal exactly the selected OAuth connection set', () => {
  const good = fixture({ mixed: true })
  assert.equal(hasCorePersistedShape(good), true, 'a mixed approval stamps only its personal connection')
  for (const mutate of [
    (state: any) => { delete state.routineMcp.policies[0].oauthAuthority },
    (state: any) => { state.routineMcp.policies[0].oauthAuthority.ownerUserId = otherUserId },
    (state: any) => { state.routineMcp.policies[0].oauthAuthority.connectionIds = [] },
    (state: any) => { state.routineMcp.policies[0].oauthAuthority.connectionIds = [legacyConnectionId] },
    (state: any) => { state.routineMcp.policies[0].oauthAuthority.connectionIds.push(legacyConnectionId) },
    (state: any) => { state.routineMcp.policies[0].oauthAuthority.connectionIds.push(connectionId) },
    (state: any) => { state.mcpConnections.connections[0].tenantId = 'foreign-tenant' },
    (state: any) => { state.mcpConnections.connections[0].ownerUserId = otherUserId },
    (state: any) => { state.mcpConnections = { connections: [], retired: [] } },
  ]) {
    const invalid = structuredClone(good)
    mutate(invalid)
    assert.equal(hasCorePersistedShape(invalid), false)
  }
})

test('revoked Routine policies keep exact OAuth identities and historical decision actors', () => {
  const good = fixture({ revoked: true, retired: true })
  assert.equal(hasCorePersistedShape(good), true, 'a different authorized manager may retain a revoke decision')
  for (const mutate of [
    (state: any) => { delete state.routineMcp.policies[0].oauthAuthority },
    (state: any) => { state.routineMcp.policies[0].oauthAuthority.connectionIds = [otherConnectionId] },
    (state: any) => { delete state.routineMcp.decisions[0].oauthAuthority; delete state.routineMcp.decisions[0].actorUserId },
    (state: any) => { state.routineMcp.decisions[0].actorUserId = otherUserId },
    (state: any) => { delete state.routineMcp.decisions[1].oauthAuthority; delete state.routineMcp.decisions[1].actorUserId },
    (state: any) => { state.routineMcp.decisions[0].oauthAuthority.ownerUserId = otherUserId; state.routineMcp.decisions[0].actorUserId = otherUserId },
  ]) {
    const invalid = structuredClone(good)
    mutate(invalid)
    assert.equal(hasCorePersistedShape(invalid), false)
  }
})

test('frozen queued Routine OAuth permission joins the original approval even after revoke', () => {
  const good = fixture({ queued: true, revoked: true, retired: true })
  assert.equal(hasCorePersistedShape(good), true)
  for (const mutate of [
    (state: any) => { delete state.routineMcp.runs[0].permission.oauthAuthority },
    (state: any) => { state.routineMcp.runs[0].permission.oauthAuthority.ownerUserId = otherUserId },
    (state: any) => { state.routineMcp.runs[0].permission.oauthAuthority.connectionIds = [legacyConnectionId] },
  ]) {
    const invalid = structuredClone(good)
    mutate(invalid)
    rehashRun(invalid)
    assert.equal(hasCorePersistedShape(invalid), false, 'recomputing integrity hashes cannot supply missing person provenance')
  }
})

test('superseded Routine OAuth decisions retain source ownership after a legacy replacement approval', () => {
  const state = fixture({ revoked: true, retired: true })
  const registry = state.routineMcp!
  const replacement = fixture({ stamp: false, oauth: false }).routineMcp!.policies[0]
  replacement.policy.revision = 3
  replacement.policy.approval!.tools[0].connectionId = legacyConnectionId
  registry.policies = [replacement]
  registry.decisions.push({ decisionId: `routine-mcp-decision-${'6'.repeat(64)}`, tenantId, routineId,
    requestHash: '7'.repeat(64), policyRevision: 3, action: 'approve' })
  state.mcpConnections!.retired.push({ tenantId, id: legacyConnectionId })
  assert.equal(hasCorePersistedShape(state), true, 'historical personal authority does not make a new legacy approval personal')
  const wrongOwner = structuredClone(state)
  wrongOwner.routineMcp!.decisions[0].oauthAuthority!.ownerUserId = otherUserId
  wrongOwner.routineMcp!.decisions[0].actorUserId = otherUserId
  assert.equal(hasCorePersistedShape(wrongOwner), false)
  const missingSource = structuredClone(state)
  missingSource.mcpConnections!.retired = missingSource.mcpConnections!.retired.filter(row => row.id !== connectionId)
  assert.equal(hasCorePersistedShape(missingSource), false, 'current legacy permission cannot hide an orphan historical OAuth decision')
})

test('revoked OAuth Routine authority cannot outlive all originating approval decisions', () => {
  const state = fixture({ revoked: true })
  state.routineMcp!.decisions = []
  assert.equal(hasCorePersistedShape(state), false, 'a retained person stamp still requires its originating approval proof')
})

test('legacy Routine MCP state stays ownerless and cannot gain personal authority', () => {
  const legacy = fixture({ oauth: false, stamp: false, queued: true })
  assert.equal(hasCorePersistedShape(legacy), true)
  delete legacy.mcpConnections
  assert.equal(hasCorePersistedShape(legacy), true, 'older Routine calls retain their existing tenant-only semantics')
  assert.equal(hasCorePersistedShape(fixture({ oauth: false })), false)
})

for (const backendName of ['json', 'sqlite'] as const) {
  test(`${backendName}: Routine OAuth policies, queued permissions and decisions survive connection retirement`, () => {
    const backend = backendName === 'json' ? new JsonFileBackend() : new SqliteBackend(process.env.DATABASE_PATH)
    try {
      for (const retired of [false, true]) for (const revoked of [false, true]) {
        const state = fixture({ retired, revoked, queued: true })
        assert.equal(hasCorePersistedShape(state), true)
        backend.save(state)
        assert.deepEqual(backend.load()?.routineMcp, state.routineMcp)
      }
    } finally { backend.close() }
  })

  test(`${backendName}: ownerless known OAuth Routine snapshots fail without replacing stored contents`, () => {
    const backend = backendName === 'json' ? new JsonFileBackend() : new SqliteBackend(process.env.DATABASE_PATH)
    try {
      backend.save(fixture({ stamp: false, queued: true }))
      const filename = backendName === 'json' ? process.env.DATA_FILE! : process.env.DATABASE_PATH!
      const bytes = readFileSync(filename)
      assert.throws(() => backend.load(), /incompatible|required core slices/)
      assert.deepEqual(readFileSync(filename), bytes)
    } finally { backend.close() }
  })

  for (const done of [false, true]) test(`${backendName}: ${done ? 'known' : 'pending'} OAuth call recovery retains its owner while pausing and revoking`, () => {
    const dataFile = join(root, `recovery-${backendName}-${done}.json`)
    const databasePath = join(root, `recovery-${backendName}-${done}.db`)
    const state = fixture({ queued: true, done, retired: true })
    if (backendName === 'json') writeFileSync(dataFile, JSON.stringify(state))
    else {
      const backend = new SqliteBackend(databasePath)
      try { backend.save(state) } finally { backend.close() }
    }
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      const { store } = await import(${JSON.stringify(new URL('../store/index.ts', import.meta.url).href)});
      const { loadState, closePersistence } = await import(${JSON.stringify(new URL('./persist.ts', import.meta.url).href)});
      store.initPersistence();
      const state = loadState();
      console.log(JSON.stringify({ registry: state.routineMcp, task: state.schedules.find(task => task.id === ${JSON.stringify(routineId)}),
        pending: store.pendingScheduleRuns() }));
      closePersistence();
    `], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, INITIAL_WORLD: 'clean', DEPLOYMENT_PROFILE: '',
      BACKEND: 'mock', PERSIST_BACKEND: backendName, DATA_FILE: dataFile, DATABASE_PATH: databasePath } })
    assert.equal(result.status, 0, result.stderr)
    const recovered = JSON.parse(result.stdout)
    assert.equal(recovered.registry.policies[0].policy.approval, null)
    assert.deepEqual(recovered.registry.policies[0].oauthAuthority, authority())
    assert.deepEqual(recovered.registry.runs[0].permission.oauthAuthority, authority())
    assert.equal(recovered.registry.runs[0].calls[0].status, done ? 'done' : 'uncertain')
    if (done) assert.equal(recovered.registry.runs[0].calls[0].result.content[0].text, 'Known OAuth result.')
    assert.deepEqual(recovered.registry.decisions, state.routineMcp!.decisions)
    assert.equal(recovered.task.enabled, false)
    assert.equal(recovered.task.runs[0].status, 'failed')
    assert.deepEqual(recovered.pending, [])
  })
}
