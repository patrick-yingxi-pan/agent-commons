import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JsonFileBackend } from './json.ts'
import { SqliteBackend } from './sqlite.ts'
import { restoreBackendState } from './portable.ts'
import { restoreDamagedSqlite } from './sqliteRestore.ts'
import { STORE_VERSION, type PersistedState } from './format.ts'
import { prepareCommissionRestoreState } from './commissionRestore.ts'
import { CommissionMcpRegistry, parseCommissionMcpRegistryState } from '../commissionMcpRegistry.ts'
import { commissionMcpClaimId } from '../commissionMcpClaim.ts'
import { mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import type { CommissionMcpApprovalIntent } from '../../contract/commissionMcp.ts'

const root = mkdtempSync(join(tmpdir(), `commission-restore-${process.pid}-`))
const work = { id: 'restore-work', projectId: 'restore-project', subGoal: 'Write a reviewed record',
  type: 'mcp.mutate' as const, target: 'write_once', note: 'Reviewed work', status: 'open' as const }

function baseline(): PersistedState {
  return {
    version: STORE_VERSION,
    initialWorld: 'clean',
    sessions: [], bindings: [], workspaces: [], schedules: [],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: { sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {}, artifactSource: {},
      scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {}, extraArtifacts: [], extraProjects: [], standingApprovals: {} },
    savedContexts: [], mcpConnections: { connections: [], retired: [] },
    openSubGoals: [structuredClone(work)],
    seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
  }
}

after(() => rmSync(root, { recursive: true, force: true }))

for (const kind of ['json', 'sqlite'] as const) {
  test(`${kind}: explicit restore fences restored open MCP work and invalid input preserves destination`, () => {
    const path = join(root, `restore-${kind}${kind === 'json' ? '.json' : '.db'}`)
    const oldDataFile = process.env.DATA_FILE
    const backend = kind === 'json'
      ? (() => { process.env.DATA_FILE = path; return new JsonFileBackend() })()
      : new SqliteBackend(path)
    try {
      const input = baseline()
      const inputBefore = JSON.stringify(input)
      const restored = restoreBackendState(backend, input)
      const id = commissionMcpClaimId(work.projectId, work.id)
      assert.deepEqual(restored.commissionMcp?.blockedWork, [id])
      assert.ok(new CommissionMcpRegistry(restored.commissionMcp).isWorkBlocked(work.projectId, work.id))
      assert.equal(JSON.stringify(input), inputBefore, 'restore never mutates its caller-owned snapshot')
      assert.deepEqual(restoreBackendState(backend, restored), restored, 'the transformed state is a stable restore input')

      const destinationBefore = backend.load()
      const invalid = { ...input, commissionMcp: { policies: [], claims: [], retired: [], blockedWork: ['bad-id'] } } as unknown as PersistedState
      assert.throws(() => restoreBackendState(backend, invalid), /unsupported or invalid/)
      assert.deepEqual(backend.load(), destinationBefore, 'invalid input leaves the authored destination unchanged')
    } finally {
      backend.close()
      if (oldDataFile === undefined) delete process.env.DATA_FILE
      else process.env.DATA_FILE = oldDataFile
    }
  })
}

test('the registry restore boundary is additive, idempotent, and old absent blockedWork parses as empty', () => {
  const id = commissionMcpClaimId(work.projectId, work.id)
  const old = { policies: [], claims: [], retired: [] }
  assert.deepEqual(parseCommissionMcpRegistryState(old), { policies: [], claims: [], retired: [], decisions: [] })
  const registry = new CommissionMcpRegistry(old)
  registry.restoreBoundary([id], 1_800_000_000_000)
  const once = registry.snapshot()
  assert.ok(registry.isWorkBlocked(work.projectId, work.id))
  registry.restoreBoundary([id], 1_800_000_000_000)
  assert.deepEqual(registry.snapshot(), once)
})

test('restore revokes every current approval and interrupts active claims, including unrelated idle grants', () => {
  const now = 1_800_000_000_000
  const toolDefinition = { name: 'write_once', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }
  const connectionId = 'mcp-connection-restore-boundary'
  const tool = { connectionId, connectionRevision: 1, toolName: 'write_once',
    schemaHash: mcpToolSchemaHash(toolDefinition), fixedArguments: {} }
  const connection = { id: connectionId, label: 'Reviewed tool', status: 'connected' as const, revision: 1,
    authentication: 'none' as const, protocolVersion: '2026-07-28', inspectedAt: now,
    tools: [toolDefinition], execution: 'approval-required' as const, executableTools: ['write_once'] }
  const context = { configurationRevision: 1, reviewHash: 'c'.repeat(64), now,
    connection: (id: string, tenantId: string, ownerUserId: string) =>
      id === connectionId && tenantId === 'restore-tenant' && ownerUserId === 'restore-owner' ? connection : undefined }
  const registry = new CommissionMcpRegistry()
  const scope = { tenantId: 'restore-tenant', ownerUserId: 'restore-owner', projectId: work.projectId,
    commissionId: 'active-commission', agentId: 'active-agent' }
  const idleScope = { ...scope, commissionId: 'idle-commission', agentId: 'idle-agent' }
  const approve = (commissionId: string, agentId: string) => registry.approve(
    { ...scope, commissionId, agentId }, {
      expectedRevision: 0, expectedConfigurationRevision: 1, reviewHash: 'c'.repeat(64),
      execution: { agentId, providerId: 'provider-restore', modelId: 'model-restore' },
      expiresAt: now + 60_000, maxWorkItems: 2, tools: [tool],
    } satisfies CommissionMcpApprovalIntent, context)
  const grant = approve(scope.commissionId, scope.agentId)
  approve(idleScope.commissionId, idleScope.agentId)
  registry.reserve({ permission: grant,
    work: { itemId: work.id, subGoal: work.subGoal, type: work.type, target: work.target, note: work.note },
    tool, review: { configurationRevision: 1, reviewHash: 'c'.repeat(64) }, now: now + 1, connection: context.connection })
  registry.restoreBoundary([commissionMcpClaimId(work.projectId, work.id)], now + 2)
  const state = registry.snapshot()
  assert.equal(state.claims[0]?.phase, 'closed')
  assert.equal(state.claims[0]?.status, 'uncertain')
  assert.equal(registry.policy(scope)?.policy.approval, null)
  assert.equal(registry.policy(idleScope)?.policy.approval, null, 'approval without a pending claim is also revoked')
})

test('explicit restore makes active usage holds uncertain without changing the input', () => {
  const state = baseline()
  state.usageReservations = [{ id: 'restore-hold', tenantId: 'tenant-restore', allowance: 100,
    fiveHourStart: 1_800_000_000_000, weeklyStart: 1_800_000_000_000, status: 'active', report: null }]
  const before = JSON.stringify(state)
  const restored = prepareCommissionRestoreState(structuredClone(state), 1_800_000_000_000)
  assert.equal(restored.usageReservations?.[0]?.status, 'uncertain')
  assert.equal(JSON.stringify(state), before)
})

test('damaged SQLite replacement publishes and reads back the transformed state', () => {
  const path = join(root, 'damaged.db')
  const input = baseline()
  restoreDamagedSqlite(path, input)
  const backend = new SqliteBackend(path)
  const proof = new SqliteBackend(':memory:')
  try {
    const restored = backend.load()!
    const id = commissionMcpClaimId(work.projectId, work.id)
    assert.ok(restored.commissionMcp?.blockedWork?.includes(id))
    assert.deepEqual(restored, restoreBackendState(proof, restored))
  } finally {
    backend.close()
    proof.close()
  }
})
