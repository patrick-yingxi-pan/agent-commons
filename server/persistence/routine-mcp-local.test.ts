/** Only authored snapshot fixtures and disposable files: no native program,
 * Keychain item, live model, external service, or owner data is used here. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import type { McpConnectionView } from '../../contract/mcpConnections.ts'
import { SCHEDULED_TASKS } from '../data/cowork.ts'
import { RoutineMcpRegistry } from '../routineMcpRegistry.ts'
import { routineMcpJsonText } from '../routineMcpPolicy.ts'
import { reserveRoutineMcpCall, settleRoutineMcpCall, routineMcpRunMayRetry } from '../routineMcpState.ts'
import { mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { STORE_VERSION, hasCorePersistedShape, type PersistedState, type PersistenceBackend } from './format.ts'
import { JsonFileBackend } from './json.ts'
import { SqliteBackend } from './sqlite.ts'
import { exportBackendSnapshot, readPortableSnapshot, restoreBackendState, restoreBackendSnapshot } from './portable.ts'
import { prepareRoutineRestoreState } from './routineRestore.ts'
import { restoreDamagedSqlite } from './sqliteRestore.ts'
import { restoreSnapshot, snapshotPath } from './backup.ts'

const root = mkdtempSync(join(tmpdir(), 'agent-commons-routine-local-persistence-'))
const savedEnvironment = { DATA_FILE: process.env.DATA_FILE, DATABASE_PATH: process.env.DATABASE_PATH,
  PERSIST_BACKEND: process.env.PERSIST_BACKEND, SNAPSHOT_DIR: process.env.SNAPSHOT_DIR }
after(() => {
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(root, { recursive: true, force: true })
})

const tenantId = 'routine-local-tenant'
const ownerUserId = 'routine-local-person'
const routineId = 'routine-local'
const runId = 'routine-local-run'
const localId = `mcp-connection-${'a'.repeat(32)}`
const oauthId = `mcp-connection-${'b'.repeat(32)}`
const httpId = `mcp-connection-${'c'.repeat(32)}`
const now = 1_800_000_000_000
const reviewHash = 'd'.repeat(64)
const tool = { name: 'write', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }
const schemaHash = mcpToolSchemaHash(tool)
const hash = (value: unknown) => createHash('sha256').update(routineMcpJsonText(value)).digest('hex')
const permission = (connectionId: string) => ({ connectionId, connectionRevision: 3, toolName: tool.name, schemaHash, fixedArguments: {} })
type FixturePhase = 'idle' | 'queued' | 'pending' | 'done' | 'finished'

function view(id: string): McpConnectionView {
  const common = { id, label: 'Authored snapshot source', status: 'connected' as const, revision: 3,
    inspectedAt: now, protocolVersion: '2026-07-28', execution: 'approval-required' as const,
    executableTools: [tool.name], tools: [tool] }
  return id === localId ? { ...common, transport: 'stdio' } : { ...common,
    authentication: id === oauthId ? 'device-oauth' : 'none' }
}

function fixture({ phase = 'idle', retired = false, mixed = false, kind = 'local', replaceHttp = false }:
  { phase?: FixturePhase; retired?: boolean; mixed?: boolean; kind?: 'local' | 'oauth' | 'http'; replaceHttp?: boolean } = {}): PersistedState {
  const task = structuredClone(SCHEDULED_TASKS[0])
  task.id = routineId
  task.tenantId = tenantId
  task.enabled = true
  task.nextFireAt = now + 10_000
  task.runs = []
  const definitionRevision = task.revision ?? 0
  const selectedId = kind === 'local' ? localId : kind === 'oauth' ? oauthId : httpId
  const registry = new RoutineMcpRegistry()
  const context = { definitionRevision, reviewHash, now, actorUserId: ownerUserId, allowLocalPrograms: true,
    connection: (id: string, tenant: string, actor?: string) => tenant === tenantId && (id === httpId || actor === ownerUserId) ? view(id) : undefined }
  const approval = { expectedRevision: 0, expectedDefinitionRevision: definitionRevision, reviewHash,
    expiresAt: now + 3_600_000, maxCallsPerRun: 3, tools: [permission(selectedId), ...(mixed ? [permission(oauthId)] : [])],
    ...(kind === 'local' ? { localPrograms: true as const } : {}) }
  registry.decide({ tenantId, routineId }, { requestId: 'approve-original', action: 'approve', approval }, context)
  if (phase !== 'idle') {
    const frozen = registry.policy(tenantId, routineId)!
    const queued = registry.queue(frozen, runId)
    if (phase !== 'queued') {
      const reserved = reserveRoutineMcpCall(queued, { key: 'one-authored-call', live: frozen, definitionRevision, reviewHash,
        now: now + 1, connection: context.connection, allowLocalPrograms: true,
        call: { connectionId: selectedId, connectionRevision: 3, toolName: tool.name, schemaHash, arguments: {} } })
      registry.setRun(reserved.run)
      if (phase === 'done' || phase === 'finished') registry.setRun(settleRoutineMcpCall(reserved.run, reserved.receipt.id, {
        status: 'done', summary: 'Authored known result.', result: { resultType: 'complete',
          content: [{ type: 'text', text: 'Known durable local result.' }], isError: false },
      }, now + 2))
    }
    task.runs.push({ id: runId, status: phase === 'finished' ? 'ok' : 'running', duration: '—', reachedStep: 0,
      summary: phase === 'finished' ? 'Completed' : 'Queued', at: now, attempts: phase === 'queued' ? 0 : 1, maxAttempts: 3,
      ...(phase === 'finished' ? {} : { nextAttemptAt: now + 1 }),
      execution: { definitionRevision, trigger: task.trigger, prompt: task.prompt, steps: task.steps, delivery: task.delivery,
        agentId: task.agentId ?? 'agent-fixture', providerId: task.providerId ?? 'provider-fixture' } })
  }
  if (replaceHttp) {
    const { localPrograms: _localPrograms, ...ordinary } = approval
    registry.decide({ tenantId, routineId }, { requestId: 'replace-with-http', action: 'approve',
      approval: { ...ordinary, expectedRevision: 1, tools: [permission(httpId)] } }, context)
  }
  const identities = [{ tenantId, id: localId, ownerUserId, transport: 'stdio' as const },
    { tenantId, id: oauthId, ownerUserId }, { tenantId, id: httpId }]
  const state: PersistedState = {
    version: STORE_VERSION, initialWorld: 'clean', sessions: [], bindings: [], workspaces: [], schedules: [task],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: { sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {}, artifactSource: {},
      scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {}, extraArtifacts: [], extraProjects: [], standingApprovals: {} },
    seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
    routineMcp: registry.snapshot(), mcpConnections: retired ? { connections: [], retired: identities } : {
      connections: [{ ...identities[0]!, transport: 'stdio', ownerUserId, label: 'Saved local fixture', revision: 3, connected: false },
        { tenantId, id: oauthId, ownerUserId, label: 'OAuth fixture', endpoint: 'https://mcp.example/mcp',
          authentication: 'device-oauth', revision: 3, connected: false },
        { tenantId, id: httpId, label: 'HTTP fixture', endpoint: 'https://mcp.example/mcp',
          authentication: 'none', revision: 3, connected: false }], retired: [],
    },
  }
  assert.equal(hasCorePersistedShape(state), true, 'the authored fixture must cross real snapshot admission')
  return state
}

function backend(kind: 'json' | 'sqlite', label: string): { port: PersistenceBackend; file: string } {
  const file = join(root, `${label}-${kind}.${kind === 'json' ? 'json' : 'db'}`)
  if (kind === 'json') process.env.DATA_FILE = file
  return { port: kind === 'json' ? new JsonFileBackend() : new SqliteBackend(file), file }
}

function boot(file: string, kind: 'json' | 'sqlite') {
  const output = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    const { store } = await import(${JSON.stringify(new URL('../store/index.ts', import.meta.url).href)});
    const { loadState, closePersistence } = await import(${JSON.stringify(new URL('./persist.ts', import.meta.url).href)});
    store.initPersistence();
    const state = loadState();
    console.log(JSON.stringify({ state, pending: store.pendingScheduleRuns(),
      retry: store.routineMcpRunMayRetry(${JSON.stringify(routineId)}, ${JSON.stringify(runId)}) }));
    closePersistence();
  `], { encoding: 'utf8', timeout: 25_000, env: { ...process.env, INITIAL_WORLD: 'clean', DEPLOYMENT_PROFILE: '',
    BACKEND: 'mock', PERSIST_BACKEND: kind, DATA_FILE: file, DATABASE_PATH: file } })
  assert.equal(output.status, 0, output.stderr)
  return JSON.parse(output.stdout) as { state: PersistedState; pending: unknown[]; retry: boolean }
}

function rehash(state: PersistedState) {
  for (const run of state.routineMcp!.runs) {
    run.permissionHash = hash({ permission: run.permission, runId: run.runId })
    for (const receipt of run.calls) receipt.callHash = hash({ permission: run.permission, runId: run.runId, id: receipt.id, call: receipt.call })
  }
}

test('local snapshot admission verifies exact live/retired person and transport history independently of native readiness', () => {
  for (const retired of [false, true]) {
    const state = fixture({ phase: 'finished', retired, mixed: true })
    for (const mutate of [
      (bad: any) => { bad.mcpConnections = { connections: [], retired: [] } },
      (bad: any) => { (retired ? bad.mcpConnections.retired : bad.mcpConnections.connections)[0].ownerUserId = 'foreign-person' },
      (bad: any) => { (retired ? bad.mcpConnections.retired : bad.mcpConnections.connections)[0].tenantId = 'foreign-tenant' },
      (bad: any) => { delete (retired ? bad.mcpConnections.retired : bad.mcpConnections.connections)[0].transport },
      (bad: any) => { delete bad.routineMcp.policies[0].localAuthority },
      (bad: any) => { delete bad.routineMcp.decisions[0].localAuthority },
      (bad: any) => { bad.routineMcp.decisions[0].actorUserId = 'foreign-person' },
      (bad: any) => { bad.routineMcp.runs[0].permission.localAuthority.ownerUserId = 'foreign-person'; rehash(bad) },
      (bad: any) => { bad.routineMcp.runs[0].calls[0].transport = 'http' },
    ]) {
      const invalid = structuredClone(state)
      mutate(invalid)
      assert.equal(hasCorePersistedShape(invalid), false)
    }
  }
})

test('explicit restore is local-scoped, idempotent and keeps newer HTTP grants after completed local history', () => {
  const local = fixture({ phase: 'finished', mixed: true })
  const before = structuredClone(local.routineMcp)
  const once = prepareRoutineRestoreState(structuredClone(local), now + 10)
  assert.equal(once.routineMcp!.policies[0]!.policy.approval, null)
  assert.equal(once.schedules[0]!.enabled, false)
  assert.equal(once.schedules[0]!.nextFireAt, undefined)
  assert.deepEqual(once.routineMcp!.decisions, before!.decisions)
  assert.deepEqual(once.routineMcp!.runs, before!.runs, 'completed private receipts remain exact')
  assert.deepEqual(prepareRoutineRestoreState(structuredClone(once), now + 20), once)
  for (const kind of ['http', 'oauth'] as const) {
    const ordinary = fixture({ kind, phase: 'pending' })
    assert.deepEqual(prepareRoutineRestoreState(structuredClone(ordinary), now + 10), ordinary,
      'restore does not expand cancellation to existing HTTP/OAuth Routines')
  }
  for (const phase of ['finished', 'pending', 'queued'] as const) {
    const replaced = fixture({ phase, replaceHttp: true })
    const restored = prepareRoutineRestoreState(structuredClone(replaced), now + 10)
    assert.deepEqual(restored.routineMcp!.policies, replaced.routineMcp!.policies,
      'a historical local run cannot revoke a newer HTTP-only grant')
    assert.equal(restored.schedules[0]!.enabled, phase === 'finished')
    if (phase !== 'finished') assert.equal(restored.schedules[0]!.runs[0]!.status, 'failed')
  }
})

for (const kind of ['json', 'sqlite'] as const) {
  test(`${kind}: cancelled Routine run round-trips and is never re-admitted after restart`, () => {
    const { port, file } = backend(kind, 'cancelled-run')
    const state = fixture()
    const stopped = {
      id: runId,
      status: 'cancelled' as const,
      duration: '4s',
      reachedStep: 1,
      summary: 'Stopped by owner',
      detail: 'A call may already have taken effect.',
      at: now,
      attempts: 1,
      maxAttempts: 3,
      nextAttemptAt: now + 1,
    }
    state.schedules[0]!.runs = [stopped]
    try {
      port.save(state)
      assert.deepEqual(port.load()?.schedules[0]?.runs[0], stopped, 'the backend preserves the exact terminal row')
    } finally { port.close() }

    const recovered = boot(file, kind)
    assert.deepEqual(recovered.state.schedules[0]?.runs[0], stopped, 'restart preserves cancelled status and metadata')
    assert.deepEqual(recovered.pending, [], 'terminal work is not queued for execution')
  })

  test(`${kind}: local history round-trips without native custody and malformed data is not repaired`, () => {
    const { port, file } = backend(kind, 'history')
    try {
      for (const retired of [false, true]) {
        const state = fixture({ phase: 'finished', mixed: true, retired })
        port.save(state)
        assert.deepEqual(port.load()?.routineMcp, state.routineMcp)
        const exportFile = join(root, `history-${kind}-${retired}.backup`)
        exportBackendSnapshot(port, exportFile)
        assert.deepEqual(readPortableSnapshot(exportFile).routineMcp, state.routineMcp,
          'reading/exporting history does not revoke local approval')
      }
      const malformed = fixture({ phase: 'pending' })
      malformed.mcpConnections!.connections[0]!.ownerUserId = 'foreign-person'
      port.save(malformed)
      const bytes = readFileSync(file)
      assert.throws(() => port.load(), /incompatible|required core slices/)
      assert.deepEqual(readFileSync(file), bytes)
    } finally { port.close() }
  })

  for (const phase of ['pending', 'done', 'finished'] as const) test(`${kind}: ordinary restart preserves ${phase} local history and recovers unfinished effects`, () => {
    const { port, file } = backend(kind, `restart-${phase}`)
    const state = fixture({ phase, retired: true, mixed: true })
    try { port.save(state) } finally { port.close() }
    const recovered = boot(file, kind)
    const ledger = recovered.state.routineMcp!.runs[0]!
    assert.deepEqual(recovered.state.routineMcp!.decisions, state.routineMcp!.decisions)
    assert.deepEqual(ledger.permission, state.routineMcp!.runs[0]!.permission)
    assert.equal(ledger.calls[0]!.transport, 'stdio')
    assert.equal(ledger.calls[0]!.status, phase === 'pending' ? 'uncertain' : 'done')
    assert.deepEqual(recovered.pending, [])
    assert.equal(recovered.retry, false)
    if (phase === 'finished') {
      assert.deepEqual(ledger, state.routineMcp!.runs[0])
      assert.deepEqual(recovered.state.routineMcp!.policies, state.routineMcp!.policies)
    } else {
      assert.equal(recovered.state.schedules[0]!.enabled, false)
      assert.equal(recovered.state.schedules[0]!.runs[0]!.status, 'failed')
      assert.equal(recovered.state.routineMcp!.policies[0]!.policy.approval, null)
    }
    assert.deepEqual(boot(file, kind).state.routineMcp, recovered.state.routineMcp, 'a second boot cannot repeat recovery')
  })

  for (const phase of ['idle', 'queued', 'pending', 'done', 'finished'] as const) test(`${kind}: explicit restore fences ${phase} local authority before replacement and relaunch`, () => {
    const { port, file } = backend(kind, `restore-${phase}`)
    const input = fixture({ phase, mixed: true, retired: true })
    const original = structuredClone(input)
    let restored: PersistedState
    try {
      restored = restoreBackendState(port, input)
      assert.deepEqual(input, original, 'the caller-owned snapshot is unchanged')
      assert.equal(restored.routineMcp!.policies[0]!.policy.approval, null)
      assert.equal(restored.schedules[0]!.enabled, false)
      assert.equal(restored.schedules[0]!.nextFireAt, undefined)
      assert.deepEqual(restored.routineMcp!.decisions, input.routineMcp!.decisions)
      assert.deepEqual(restored.routineMcp!.policies[0]!.localAuthority, input.routineMcp!.policies[0]!.localAuthority)
      assert.deepEqual(restoreBackendState(port, restored), restored, 'restoring the transformed state is idempotent')
      const invalid = structuredClone(input)
      invalid.routineMcp!.policies[0]!.localAuthority!.ownerUserId = 'foreign-person'
      assert.throws(() => restoreBackendState(port, invalid), /unsupported or invalid/)
      assert.deepEqual(port.load(), restored, 'invalid input cannot alter the previous valid destination')
    } finally { port.close() }
    const reboot = boot(file, kind)
    assert.deepEqual(reboot.pending, [])
    assert.deepEqual(reboot.state.routineMcp, restored!.routineMcp)
    if (phase !== 'idle') {
      const ledger = restored!.routineMcp!.runs[0]!
      if (phase === 'finished') assert.deepEqual(ledger, input.routineMcp!.runs[0])
      else {
        assert.equal(ledger.phase, 'interrupted')
        assert.equal(routineMcpRunMayRetry(ledger), false)
        assert.equal(reboot.state.schedules[0]!.runs[0]!.status, 'failed')
        const session = reboot.state.sessions.find(session => session.scheduledRunOf?.taskId === routineId)
        assert.ok(session?.messages?.some(message => message.role === 'assistant' && message.content.includes('restoring a backup')),
          'boot materialization supplies the exact restored failure recap')
      }
      if (phase === 'pending') assert.equal(ledger.calls[0]!.status, 'uncertain')
      if (phase === 'done') assert.deepEqual(ledger.calls, input.routineMcp!.runs[0]!.calls)
    }
  })
}

test('portable file restore and damaged SQLite staging share the same local-program fence', () => {
  const input = fixture({ phase: 'pending', mixed: true })
  const original = structuredClone(input)
  const { port } = backend('json', 'portable-source')
  const exportFile = join(root, 'local-routine.backup')
  try { port.save(input); exportBackendSnapshot(port, exportFile) } finally { port.close() }
  const sqliteFile = join(root, 'portable-local.db')
  const sqlite = new SqliteBackend(sqliteFile)
  try { assert.equal(restoreBackendSnapshot(sqlite, exportFile).routineMcp!.policies[0]!.policy.approval, null) } finally { sqlite.close() }
  const damagedFile = join(root, 'damaged-local.db')
  writeFileSync(damagedFile, 'repository-authored damaged SQLite bytes')
  restoreDamagedSqlite(damagedFile, input)
  const recovered = new SqliteBackend(damagedFile)
  try {
    const state = recovered.load()!
    assert.equal(state.routineMcp!.policies[0]!.policy.approval, null)
    assert.equal(state.routineMcp!.runs[0]!.calls[0]!.status, 'uncertain')
    assert.equal(state.schedules[0]!.enabled, false)
    assert.equal(state.schedules[0]!.runs[0]!.status, 'failed')
  } finally { recovered.close() }
  assert.deepEqual(input, original)
})

test('managed backup restoration uses the same local-grant fence', () => {
  process.env.SNAPSHOT_DIR = join(root, 'managed')
  process.env.PERSIST_BACKEND = 'json'
  const { port } = backend('json', 'managed-live')
  try {
    port.save(fixture({ phase: 'queued' }))
    exportBackendSnapshot(port, snapshotPath('local-routine'))
    restoreSnapshot('local-routine')
    const state = port.load()!
    assert.equal(state.routineMcp!.policies[0]!.policy.approval, null)
    assert.equal(state.schedules[0]!.runs[0]!.status, 'failed')
    assert.equal(routineMcpRunMayRetry(state.routineMcp!.runs[0]!), false)
  } finally { port.close() }
})
