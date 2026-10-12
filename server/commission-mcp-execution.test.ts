import assert from 'node:assert/strict'
import test from 'node:test'
import type { CommissionMcpWork } from '../contract/commissionMcp.ts'
import type { McpBoundToolCall, McpToolPermission } from '../contract/mcpExecution.ts'
import type { Agent, Commission, ModelProvider, Project } from '../contract/index.ts'
import type { McpConnectionView, McpDiscoveredTool } from '../contract/mcpConnections.ts'
import { CommissionMcpExecution, type CommissionMcpExecutionPort } from './commissionMcpExecution.ts'
import type { CommissionMcpLiveSource } from './commissionMcpHost.ts'
import { CommissionMcpRegistry } from './commissionMcpRegistry.ts'
import { prepareCommissionMcpInput } from './commissionMcpPreparation.ts'
import { commissionMcpReviewFacts } from './commissionMcpReview.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import { UsageRegistry } from './usageRegistry.ts'

const now = 1_800_000_000_000
const tenantId = 'tenant-owner'
const ownerUserId = 'person-owner'
const projectId = 'project-private'
const commissionId = 'commission-private'
const agentId = 'agent-private'
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const execution = { agentId, providerId: 'provider-private', modelId: 'model-private' }
const definition: McpDiscoveredTool = { name: 'search', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: true } }
const schemaHash = mcpToolSchemaHash(definition)
const toolPermission: McpToolPermission = { connectionId, connectionRevision: 7, toolName: 'search', schemaHash, fixedArguments: {} }
const call: McpBoundToolCall = { connectionId, connectionRevision: 7, toolName: 'search', schemaHash, arguments: { query: 'otters' } }
const work: CommissionMcpWork = { itemId: 'work-item-a', subGoal: 'Search the reviewed source', type: 'mcp.mutate', target: 'search', note: '' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture(overrides: Partial<CommissionMcpExecutionPort> = {}, initialExtraWorks: CommissionMcpWork[] = []) {
  const registry = new CommissionMcpRegistry()
  const usage = new UsageRegistry(() => now, () => tenantId)
  const agent = { id: agentId, label: 'Private Agent', systemPrompt: 'system', instructions: 'instructions', tools: ['search'], providerId: execution.providerId } as unknown as Agent
  const project = { id: projectId, name: 'Private Project', description: 'Definition', instructions: 'Project instructions', tenantId, shared: false } as unknown as Project
  const commission = { id: commissionId, projectId, agentId, tenantId, configurationRevision: 4, role: 'writer' } as unknown as Commission
  const provider = { id: execution.providerId, tenantId, kind: 'endpoint', label: 'Private Provider', modelFamily: 'test', models: [], defaultModelId: execution.modelId } as unknown as ModelProvider
  let currentWork: CommissionMcpWork | undefined = structuredClone(work)
  let currentAgent = agent
  let currentProject = project
  let currentCommission = commission
  let extraWorks: CommissionMcpWork[] = structuredClone(initialExtraWorks)
  let visible = [{ connectionId, connectionRevision: 7, connectionLabel: 'Private MCP', schemaHash, tool: definition }]
  let blockedReason: string | null = null
  let reachable = true
  const source = (id: string, tenant: string, person: string, model?: { providerId: string; modelId: string }): CommissionMcpLiveSource | undefined => {
    if (!reachable || id !== commissionId || tenant !== tenantId || person !== ownerUserId) return undefined
    return { tenantId, ownerUserId, scope: { tenantId, ownerUserId, commissionId, projectId, agentId }, commission: currentCommission,
      agent: currentAgent, project: currentProject, provider, parentProvider: undefined,
      execution: model ? { agentId, ...model } : null, projectContext: { work: [...(currentWork ? [currentWork] : []), ...extraWorks] },
      audience: { tenantId, shared: currentProject.shared }, tools: structuredClone(visible), blockedReason }
  }
  const connection: McpConnectionView = { id: connectionId, label: 'Private MCP', status: 'connected', revision: 7,
    authentication: 'none', protocolVersion: '2026-07-28', inspectedAt: now, tools: [definition], execution: 'approval-required', executableTools: ['search'] }
  const port: CommissionMcpExecutionPort = {
    registry, usage, ready: () => true, source, connection: () => connection, commit: operation => operation(), changed: () => {}, now: () => now,
    work: (_project, item) => structuredClone([...(currentWork ? [currentWork] : []), ...extraWorks].find(row => row.itemId === item)),
    capacity: () => true, budgetAvailable: (source, id) => usage.reservationWithinLimits(id, source.scope.tenantId,
      [source.commission.grant, source.agent.budget, source.parentProvider?.plan, source.provider?.plan]),
    providerConfig: id => ({ id, kind: 'endpoint', label: 'provider', models: [] } as unknown as ModelProvider),
    lease: () => ({ valid: () => true, release: () => {} }),
    generate: async (_input, _provider, _signal, report) => { report({ inputTokens: 12, outputTokens: 4 }); return structuredClone(call) },
    execute: async () => ({ status: 'done', summary: 'complete', result: { resultType: 'complete', content: [{ type: 'text', text: 'found' }], isError: false } }),
    complete: () => {}, ...overrides,
  }
  const reviewedSource = source(commissionId, tenantId, ownerUserId, execution)!
  const review = commissionMcpReviewFacts(reviewedSource)
  registry.approve({ tenantId, ownerUserId, projectId, commissionId, agentId }, {
    expectedRevision: 0, expectedConfigurationRevision: 4, reviewHash: review.reviewHash, execution,
    expiresAt: now + 60_000, maxWorkItems: 3, tools: [toolPermission],
  }, { configurationRevision: 4, reviewHash: review.reviewHash, now, connection: () => connection })
  const live = source(commissionId, tenantId, ownerUserId, execution)!
  const approveAgain = () => {
    const current = registry.policy(live.scope)!
    const facts = commissionMcpReviewFacts(source(commissionId, tenantId, ownerUserId, execution)!)
    return registry.approve(live.scope, { expectedRevision: current.policy.revision,
      expectedConfigurationRevision: current.policy.approval?.configurationRevision ?? 4,
      reviewHash: facts.reviewHash, execution, expiresAt: now + 60_000, maxWorkItems: 3, tools: [toolPermission] },
    { configurationRevision: current.policy.approval?.configurationRevision ?? 4, reviewHash: facts.reviewHash, now, connection: () => connection })
  }
  return { port, registry, usage, run: (itemId = work.itemId, timeout = 60_000) => new CommissionMcpExecution(port, timeout).run(commissionId, tenantId, ownerUserId, itemId),
    allowanceTokens: prepareCommissionMcpInput({ agent, project, work, tool: definition, permission: toolPermission }).allowanceTokens,
    setWork: (next: CommissionMcpWork | undefined) => { currentWork = next }, setAgent: (next: Agent) => { currentAgent = next },
    setProject: (next: Project) => { currentProject = next }, setCommission: (next: Commission) => { currentCommission = next },
    setTools: (next: typeof visible) => { visible = next }, setBlockedReason: (next: string | null) => { blockedReason = next },
    setReachable: (next: boolean) => { reachable = next }, addWork: (next: CommissionMcpWork) => { extraWorks.push(next) }, approveAgain }
}

test('durable claim and usage hold precede generation; reported usage settles before effect receipt and tool I/O', async () => {
  const order: string[] = []
  let f!: ReturnType<typeof fixture>
  f = fixture({
    commit: operation => { const value = operation(); order.push('commit'); return value },
    generate: async (_input, _provider, _signal, report) => {
      const claim = f.registry.claim(projectId, work.itemId)!
      assert.equal(claim.phase, 'preparing')
      assert.equal(f.usage.snapshotReservations()[0]?.status, 'active')
      order.push('generate')
      report({ inputTokens: 12, outputTokens: 4 })
      assert.equal(f.usage.snapshotReservations()[0]?.status, 'settled')
      order.push('usage')
      return structuredClone(call)
    },
    execute: async (_tenant, _call, allowed) => {
      const claim = f.registry.claim(projectId, work.itemId)!
      assert.equal(claim.phase, 'effect')
      assert.equal(claim.phase === 'effect' && claim.attempt.status, 'pending')
      assert.equal(f.usage.snapshotReservations()[0]?.status, 'settled')
      assert.equal(allowed(), true)
      order.push('tool')
      return { status: 'done', summary: 'complete', result: { resultType: 'complete', content: [{ type: 'text', text: 'found' }], isError: false } }
    },
    complete: () => { order.push('complete') },
  })
  const result = await f.run()
  assert.equal(result.phase, 'effect')
  assert.deepEqual(order.slice(0, 2), ['commit', 'generate'])
  assert.ok(order.indexOf('usage') < order.indexOf('tool'))
  assert.ok(order.indexOf('tool') < order.indexOf('complete'))
  assert.equal(f.usage.snapshotReservations()[0]?.status, 'settled')
  assert.ok(f.registry.policy({ tenantId, ownerUserId, projectId, commissionId, agentId })?.policy.approval)
})

test('a represented work claim never invokes another model or MCP call', async () => {
  let generations = 0
  let tools = 0
  const f = fixture({ generate: async (_i, _p, _s, report) => { generations++; report({ inputTokens: 1, outputTokens: 1 }); return structuredClone(call) },
    execute: async () => { tools++; return { status: 'uncertain', summary: 'unknown' } } }, [{ ...work, itemId: 'work-item-b' }])
  await f.run()
  const replay = await f.run()
  assert.equal(replay.phase, 'effect')
  assert.equal(generations, 1)
  assert.equal(tools, 1)
  assert.equal(f.registry.policy({ tenantId, ownerUserId, projectId, commissionId, agentId })?.policy.approval, null)
  await assert.rejects(f.run('work-item-b'))
  assert.equal(f.usage.snapshotReservations().length, 1)
})

test('concurrent work admission respects the agent cap without leaving an orphan usage hold', async () => {
  const second = { ...work, itemId: 'work-item-b' }
  const gate = deferred<McpBoundToolCall>()
  let reportUsage: ((usage: { inputTokens: number; outputTokens: number }) => void) | undefined
  const f = fixture({ generate: async (_input, _provider, _signal, report) => { reportUsage = report; return gate.promise } }, [second])
  const first = f.run(work.itemId)
  await new Promise(resolve => setTimeout(resolve, 0))
  await assert.rejects(f.run(second.itemId))
  assert.ok(f.registry.claim(projectId, work.itemId))
  assert.equal(f.registry.claim(projectId, second.itemId), undefined)
  assert.equal(f.usage.snapshotReservations().length, 1)
  reportUsage!({ inputTokens: 2, outputTokens: 1 })
  gate.resolve(structuredClone(call))
  await first
})

test('budget denial leaves no claim or usage hold', async () => {
  let generated = false
  const f = fixture({ generate: async () => { generated = true; return structuredClone(call) } })
  f.usage.record(1_000_000, 0, tenantId)
  await assert.rejects(f.run())
  assert.equal(f.registry.claim(projectId, work.itemId), undefined)
  assert.deepEqual(f.usage.snapshotReservations(), [])
  assert.equal(generated, false)
})

test('the exact remaining usage allowance admits one execution', async () => {
  let generated = 0
  const f = fixture({ generate: async (_input, _provider, _signal, report) => {
    generated++
    report({ inputTokens: 12, outputTokens: 4 })
    return structuredClone(call)
  } })
  const consumed = f.usage.readForTenant(tenantId).snapshot().fiveHour.consumed
  const ceiling = f.usage.readForTenant(tenantId).planCeilings().find(row => row.label === '5-hour limit')!.ceiling
  f.usage.record(ceiling - consumed - f.allowanceTokens, 0, tenantId)
  const result = await f.run()
  assert.equal(result.phase, 'effect')
  assert.equal(generated, 1)
})

test('changed live work after model usage closes the claim without starting MCP I/O', async () => {
  let f!: ReturnType<typeof fixture>
  let tools = 0
  f = fixture({ generate: async (_i, _p, _s, report) => {
    report({ inputTokens: 2, outputTokens: 1 })
    f.setWork({ ...work, note: 'changed after approval' })
    return structuredClone(call)
  }, execute: async () => { tools++; return { status: 'uncertain', summary: 'no' } } })
  const result = await f.run()
  assert.equal(result.phase, 'closed')
  assert.equal(result.phase === 'closed' && result.status, 'failed')
  assert.equal(tools, 0)
  assert.equal(f.usage.snapshotReservations()[0]?.status, 'settled')
})

test('role, reach, schema hash, membership, work, and revocation changes after generation stop MCP I/O', async t => {
  const cases: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
    ['role', f => { f.setCommission({ ...f.port.source(commissionId, tenantId, ownerUserId)!.commission, role: 'observer' } as Commission) }],
    ['reach', f => { f.setBlockedReason('outside current reach') }],
    ['schema hash', f => { f.setTools([{ connectionId, connectionRevision: 7, connectionLabel: 'Private MCP', schemaHash: 'd'.repeat(64), tool: definition }]) }],
    ['membership', f => { f.setReachable(false) }],
    ['work', f => { f.setWork({ ...work, subGoal: 'replacement work' }) }],
    ['revocation', f => { f.registry.revoke({ tenantId, ownerUserId, projectId, commissionId, agentId }, 1) }],
  ]
  for (const [label, invalidate] of cases) await t.test(label, async () => {
    let f!: ReturnType<typeof fixture>
    let tools = 0
    f = fixture({ generate: async (_input, _provider, _signal, report) => {
      report({ inputTokens: 1, outputTokens: 1 })
      invalidate(f)
      return structuredClone(call)
    }, execute: async () => { tools++; return { status: 'uncertain', summary: 'unexpected' } } })
    const result = await f.run()
    assert.equal(result.phase, 'closed')
    assert.equal(tools, 0)
  })
})

test('authority callback becomes false after an await and prevents the external effect', async () => {
  let f!: ReturnType<typeof fixture>
  let allowedDuringTool = false
  let completed = false
  f = fixture({ execute: async (_tenant, _call, allowed) => {
    await Promise.resolve()
    f.setWork({ ...work, note: 'changed while effect callback was awaiting' })
    allowedDuringTool = allowed()
    return { status: 'done', summary: 'late', result: { resultType: 'complete', content: [{ type: 'text', text: 'found' }], isError: false } }
  }, complete: () => { completed = true } })
  const result = await f.run()
  assert.equal(allowedDuringTool, false)
  assert.equal(result.phase, 'effect')
  assert.equal(result.phase === 'effect' && result.attempt.status, 'done')
  assert.equal(completed, false)
})

test('model transport ambiguity keeps an uncertain usage hold and closes without MCP I/O', async () => {
  let tools = 0
  const f = fixture({ generate: async () => { throw new Error('transport lost') }, execute: async () => { tools++; return { status: 'uncertain', summary: 'no' } } })
  const result = await f.run()
  assert.equal(result.phase, 'closed')
  assert.equal(result.phase === 'closed' && result.status, 'uncertain')
  assert.equal(f.usage.snapshotReservations()[0]?.status, 'uncertain')
  assert.equal(tools, 0)
  assert.equal(f.registry.policy({ tenantId, ownerUserId, projectId, commissionId, agentId })?.policy.approval, null)
})

test('timeout charges a late model usage report but never executes its late draft', async () => {
  let lateReport: ((usage: { inputTokens: number; outputTokens: number }) => void) | undefined
  let finish!: (value: McpBoundToolCall) => void
  const late = new Promise<McpBoundToolCall>(resolve => { finish = resolve })
  let tools = 0
  const f = fixture({ generate: async (_input, _provider, _signal, report) => { lateReport = report; return late },
    execute: async () => { tools++; return { status: 'uncertain', summary: 'unexpected' } } })
  const before = f.usage.readForTenant(tenantId).snapshot().fiveHour.consumed
  const result = await new CommissionMcpExecution(f.port, 5).run(commissionId, tenantId, ownerUserId, work.itemId)
  assert.equal(result.phase, 'closed')
  assert.equal(result.phase === 'closed' && result.status, 'uncertain')
  assert.equal(f.usage.snapshotReservations()[0]?.status, 'uncertain')
  lateReport!({ inputTokens: 9, outputTokens: 3 })
  finish(structuredClone(call))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(f.usage.snapshotReservations()[0]?.status, 'settled')
  assert.equal(f.usage.readForTenant(tenantId).snapshot().fiveHour.consumed, before + 12)
  assert.equal(tools, 0)
})

test('invalid MCP result is retained as uncertain and never completes work', async () => {
  let completed = false
  const f = fixture({ execute: async () => ({ status: 'done', summary: 'bad', result: { resultType: 'complete', content: [], isError: 'nope' } } as never),
    complete: () => { completed = true } })
  const result = await f.run()
  assert.equal(result.phase, 'effect')
  assert.equal(result.phase === 'effect' && result.attempt.status, 'uncertain')
  assert.equal(completed, false)
  assert.equal(f.registry.policy({ tenantId, ownerUserId, projectId, commissionId, agentId })?.policy.approval, null)
})

test('uncertain MCP outcome cannot revoke an approval that replaced the claim revision in flight', async () => {
  let f!: ReturnType<typeof fixture>
  f = fixture({ execute: async () => {
    f.registry.revoke({ tenantId, ownerUserId, projectId, commissionId, agentId }, 1)
    f.approveAgain()
    return { status: 'uncertain', summary: 'remote outcome unknown' }
  } })
  const result = await f.run()
  assert.equal(result.phase, 'effect')
  assert.equal(result.phase === 'effect' && result.attempt.status, 'uncertain')
  const current = f.registry.policy({ tenantId, ownerUserId, projectId, commissionId, agentId })!
  assert.equal(current.policy.revision, 3)
  assert.ok(current.policy.approval)
})

test('failed MCP outcome withdraws the current approval and blocks other work', async () => {
  const f = fixture({ execute: async () => ({ status: 'failed', summary: 'tool returned an error' }) }, [{ ...work, itemId: 'work-item-b' }])
  const result = await f.run()
  assert.equal(result.phase, 'effect')
  assert.equal(result.phase === 'effect' && result.attempt.status, 'failed')
  assert.equal(f.registry.policy({ tenantId, ownerUserId, projectId, commissionId, agentId })?.policy.approval, null)
  await assert.rejects(f.run('work-item-b'))
  assert.equal(f.usage.snapshotReservations().length, 1)
})

test('failed durable claim commit never starts generation', async () => {
  let generated = false
  const f = fixture({ commit: () => { throw new Error('disk full') }, generate: async () => { generated = true; return structuredClone(call) } })
  await assert.rejects(f.run())
  assert.equal(generated, false)
  assert.equal(f.registry.claim(projectId, work.itemId), undefined)
  assert.deepEqual(f.usage.snapshotReservations(), [])
})

test('failed usage commit never starts the next model or tool operation', async () => {
  let commits = 0
  let tools = 0
  const f = fixture({ commit: operation => { if (++commits === 2) throw new Error('usage commit failed'); return operation() },
    execute: async () => { tools++; return { status: 'uncertain', summary: 'unexpected' } } })
  const result = await f.run()
  assert.equal(result.phase, 'closed')
  assert.equal(result.phase === 'closed' && result.status, 'uncertain')
  assert.equal(tools, 0)
})
