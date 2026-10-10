import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { McpBoundToolCall, McpToolResult } from '../../contract/mcpExecution.ts'
import type { RoutineMcpApprovalIntent, RoutineMcpCallReceipt } from '../../contract/routineMcp.ts'
import type { RoutineMcpReview } from '../../contract/routineMcpApi.ts'
import { store } from './index.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { RoutineMcpPolicyError } from '../routineMcpPolicy.ts'
import { ConflictError } from '../conflict.ts'
import { executeBoundMcpCall, type McpBoundExecutionOutcome } from '../mcpBoundExecution.ts'
import { runSessionId } from '../../contract/ids.ts'

const owner = 'tenant-personal'
const audience = 'tenant-beta'
const tool = {
  name: 'search',
  inputSchema: {
    type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false,
  },
}
const result: McpToolResult = { resultType: 'complete', content: [{ type: 'text', text: 'found it' }], isError: false }

function provision() {
  const source = store.listSchedules(owner)[0]!
  const { id: _id, tenantId: _tenantId, ...seed } = structuredClone(source)
  const task = store.addSchedule({ ...seed, tenantId: owner, name: `Routine MCP ${Date.now()} ${Math.random()}`,
    runs: [], enabled: false, steps: [], delivery: { tool: { id: 'assistant', label: 'Assistant', tone: 'claude' }, target: 'Run conversation' } })
  const connectionId = `mcp-connection-${Date.now().toString(16).padStart(32, '0').slice(-32)}`
  const schemaHash = mcpToolSchemaHash(tool)
  store.createMcpConnection({ id: connectionId, label: 'Reviewed search', endpoint: 'https://8.8.8.8/mcp', authentication: 'none' }, owner)
  store.commitMcpInspection(connectionId, owner, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
  }, Date.now())

  const review = (): RoutineMcpReview => {
    const current = store.routineMcpReview(task.id, owner)
    assert.ok(current, 'owner sees its private Routine MCP review')
    return current
  }
  const approve = (current = review(), requestId = `approval-${Date.now()}-${Math.random()}`) => {
    const approval: RoutineMcpApprovalIntent = {
      expectedRevision: current.policy.revision,
      expectedDefinitionRevision: current.definitionRevision,
      reviewHash: current.reviewHash,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      maxCallsPerRun: 2,
      tools: [{ connectionId, connectionRevision: 1, toolName: tool.name, schemaHash, fixedArguments: { query: 'approved' } }],
    }
    const decision = store.decideRoutineMcp(task.id, owner, { requestId, action: 'approve', approval })
    assert.ok(decision)
    return decision.review
  }
  const call: McpBoundToolCall = {
    connectionId, connectionRevision: 1, toolName: tool.name, schemaHash, arguments: { query: 'approved' },
  }
  const cleanup = () => { try { store.removeSchedule(task.id) } catch {} ; try { store.removeMcpConnection(connectionId, owner, 1) } catch {} }
  return { task, connectionId, schemaHash, review, approve, call, cleanup }
}

function finishRun(taskId: string, runId: string): void {
  const context = store.routineExecutionContext(taskId, runId)!
  store.completeScheduleRun(taskId, runId, { id: `finish-${runId}`, role: 'assistant', content: 'Done.' },
    { agentId: context.agent.id, providerId: context.provider.id })
}

test('queued run without approval cannot inherit a late grant; later run captures the approved permission', async () => {
  const fixture = provision()
  try {
    const queued = store.runSchedule(fixture.task.id)!
    assert.equal(store.routineExecutionContext(fixture.task.id, queued.id)?.routineMcp, undefined)
    fixture.approve()
    assert.equal(store.routineExecutionContext(fixture.task.id, queued.id)?.routineMcp, undefined,
      'approval after queue time is not inherited by a run with no frozen permission')
    await assert.rejects(store.executeRoutineMcpCall(fixture.task.id, queued.id, fixture.call, 'late-call', undefined,
      async () => { assert.fail('late approval must not dispatch') }), RoutineMcpPolicyError)
    finishRun(fixture.task.id, queued.id)
    const next = store.runSchedule(fixture.task.id)!
    const context = store.routineExecutionContext(fixture.task.id, next.id)
    assert.ok(context?.routineMcp)
    assert.deepEqual(context.externalMcpConnections?.map(connection => connection.id), [fixture.connectionId])
  } finally { fixture.cleanup() }
})

test('Routine MCP review and decisions are owner-only even when the routine is shared', () => {
  const fixture = provision()
  try {
    const grant = store.createGrant({ subject: { kind: 'schedule', id: fixture.task.id },
      audience: { kind: 'org', orgId: audience }, tier: 'view' }, owner)
    assert.ok(grant && typeof grant === 'object')
    assert.equal(store.scheduleVisibleToTenant(fixture.task, audience), true)
    assert.equal(store.routineMcpReview(fixture.task.id, audience), undefined)
    assert.equal(store.decideRoutineMcp(fixture.task.id, audience, { requestId: 'foreign', action: 'revoke', expectedRevision: 0 }), undefined)
    assert.equal(store.routineMcpReview(fixture.task.id, 'tenant-harbor'), undefined)
    assert.ok(store.routineMcpReview(fixture.task.id, owner))
    store.revokeGrant(grant.id, owner)
  } finally { fixture.cleanup() }
})

test('unstamped legacy Routine MCP permissions resolve ownership to the default tenant', () => {
  const source = store.listSchedules(owner)[0]!
  const { id: _id, tenantId: _tenantId, ...seed } = structuredClone(source)
  const task = store.addSchedule({ ...seed, tenantId: undefined, name: `Legacy Routine MCP ${Date.now()} ${Math.random()}`,
    runs: [], enabled: false, steps: [], delivery: { tool: { id: 'assistant', label: 'Assistant', tone: 'claude' }, target: 'Run conversation' } })
  const defaultTenant = store.identity().tenant.id
  try {
    assert.equal(store.routineMcpReview(task.id, 'tenant-acme'), undefined,
      'seed visibility is not sufficient authority to review a default-owned legacy Routine')
    assert.ok(store.routineMcpReview(task.id, defaultTenant), 'the canonical default owner retains access')
    assert.equal(store.decideRoutineMcp(task.id, 'tenant-acme', { requestId: 'legacy-foreign', action: 'revoke', expectedRevision: 0 }), undefined)
  } finally { store.removeSchedule(task.id) }
})

test('Routine MCP review hash tracks Agent configuration, not independent contribution credit', () => {
  const fixture = provision()
  const agent = store.getAgent(fixture.task.agentId)
  const originalInstructions = agent.instructions
  let changedAgentRevision: number | undefined
  try {
    const beforeCredit = fixture.review()
    const contributions = agent.contributions ?? 0
    store.recordContribution('commission-insights-default')
    assert.equal(store.getAgent(agent.id).contributions, contributions + 1)
    const afterCredit = fixture.review()
    assert.equal(afterCredit.reviewHash, beforeCredit.reviewHash,
      'independent project-effect reputation does not invalidate Routine MCP consent')

    fixture.approve(afterCredit)
    const currentAgent = store.getAgent(agent.id)
    const edited = store.updateAgentFromRequest(agent.id, {
      instructions: `${originalInstructions} Routine MCP review configuration change.`,
    }, currentAgent.revision ?? 0)
    assert.ok(edited)
    changedAgentRevision = edited.revision
    const afterConfigEdit = fixture.review()
    assert.notEqual(afterConfigEdit.reviewHash, afterCredit.reviewHash,
      'an Agent instruction change invalidates the reviewed execution configuration')
    assert.equal(afterConfigEdit.active, false)
  } finally {
    if (changedAgentRevision !== undefined) {
      store.updateAgentFromRequest(agent.id, { instructions: originalInstructions }, changedAgentRevision)
    }
    fixture.cleanup()
  }
})

test('reapproval cannot replace the permission frozen into an already queued run', async () => {
  const fixture = provision()
  try {
    const approved = fixture.approve()
    const queued = store.runSchedule(fixture.task.id)!
    assert.equal(store.routineExecutionContext(fixture.task.id, queued.id)?.blocked, undefined)
    store.decideRoutineMcp(fixture.task.id, owner, {
      requestId: 'revoke-frozen-run', action: 'revoke', expectedRevision: approved.policy.revision,
    })
    const afterRevoke = fixture.review()
    const replacement = fixture.approve(afterRevoke, 'approve-after-revoke')
    assert.equal(replacement.active, true)
    let dispatches = 0
    await assert.rejects(store.executeRoutineMcpCall(fixture.task.id, queued.id, fixture.call, 'frozen-call', undefined,
      async () => { dispatches += 1; return { status: 'done', summary: 'No', result } }), RoutineMcpPolicyError)
    assert.equal(dispatches, 0)
    assert.equal(store.routineExecutionContext(fixture.task.id, queued.id)?.blocked?.code, 'authority_denied')
  } finally { fixture.cleanup() }
})

test('definition, destination relation, or sharing changes invalidate the reviewed context hash', () => {
  const fixture = provision()
  try {
    const first = fixture.approve()
    assert.equal(first.active, true)
    store.applyRelationOp({ kind: 'set-schedule-session', scheduleId: fixture.task.id,
      scheduleName: fixture.task.name, cadence: fixture.task.cadence, sessionLabel: 'Run destination' }, owner)
    const changedRelation = fixture.review()
    assert.notEqual(changedRelation.reviewHash, first.reviewHash)
    assert.equal(changedRelation.active, false, 'a changed conversation destination requires renewed review')
    assert.ok(changedRelation.disclosures.includes('Configured conversation label: Run destination. Each run creates its own conversation; this label is not an existing conversation destination.'))
    const relationReviewed = fixture.approve(changedRelation)
    assert.equal(relationReviewed.active, true)
    store.updateSchedule(fixture.task.id, { prompt: 'Changed routine prompt.' })
    const changedDefinition = fixture.review()
    assert.notEqual(changedDefinition.reviewHash, relationReviewed.reviewHash)
    assert.equal(changedDefinition.active, false)

    const reapproved = fixture.approve(changedDefinition)
    assert.equal(reapproved.active, true)
    const grant = store.createGrant({ subject: { kind: 'schedule', id: fixture.task.id },
      audience: { kind: 'org', orgId: audience }, tier: 'view' }, owner)
    assert.ok(grant && typeof grant === 'object')
    const changedAudience = fixture.review()
    assert.notEqual(changedAudience.reviewHash, reapproved.reviewHash)
    assert.equal(changedAudience.active, false, 'a changed sharing audience requires renewed review')
    store.revokeGrant(grant.id, owner)
  } finally { fixture.cleanup() }
})

test('sharing a run conversation invalidates consent before publishing model output there', () => {
  const fixture = provision()
  try {
    const approved = fixture.approve()
    const run = store.runSchedule(fixture.task.id)!
    assert.equal(fixture.review().reviewHash, approved.reviewHash, 'minting a private run conversation does not change consent')
    const grant = store.createGrant({ subject: { kind: 'session', id: runSessionId(fixture.task.id, run.id) },
      audience: { kind: 'org', orgId: audience }, tier: 'view' }, owner)
    assert.ok(grant && typeof grant === 'object')
    assert.equal(fixture.review().active, false, 'the actual run conversation is a model-output destination')
    assert.ok(fixture.review().disclosures.some(line => line.includes('session →')))
    finishRun(fixture.task.id, run.id)
    assert.equal(run.status, 'failed')
    assert.notEqual(run.detail, 'Done.')
    store.revokeGrant(grant.id, owner)
  } finally { fixture.cleanup() }
})

test('reservation is durably visible before executor; same-key replay never dispatches twice', async () => {
  const fixture = provision()
  try {
    fixture.approve()
    const run = store.runSchedule(fixture.task.id)!
    let dispatches = 0
    const injected: typeof executeBoundMcpCall = async (_executionStore, tenantId, exact, authorize) => {
      dispatches += 1
      assert.equal(tenantId, owner)
      assert.equal(authorize(), true)
      const pending = store.routineMcpReview(fixture.task.id, owner)!.runs.find(row => row.runId === run.id)!.calls[0]!
      assert.equal(pending.status, 'pending', 'the receipt was committed before external execution')
      assert.equal(store.routineMcpRunMayRetry(fixture.task.id, run.id), false)
      assert.deepEqual(exact, fixture.call)
      return { status: 'done', summary: 'Complete.', result }
    }
    const first = await store.executeRoutineMcpCall(fixture.task.id, run.id, fixture.call, 'stable-host-key', undefined, injected)
    assert.equal(first.status, 'done')
    store.decideRoutineMcp(fixture.task.id, owner, {
      requestId: 'revoke-after-call', action: 'revoke', expectedRevision: fixture.review().policy.revision,
    })
    const replay = await store.executeRoutineMcpCall(fixture.task.id, run.id, fixture.call, 'stable-host-key', undefined,
      async () => { dispatches += 1; assert.fail('same-key represented replay must not dispatch even after revocation') })
    assert.deepEqual(replay, first)
    assert.equal(dispatches, 1)
    await assert.rejects(store.executeRoutineMcpCall(fixture.task.id, run.id,
      { ...fixture.call, arguments: { query: 'different' } }, 'stable-host-key', undefined, injected), RoutineMcpPolicyError)
    assert.equal(dispatches, 1, 'changed input under a represented host key is refused')
  } finally { fixture.cleanup() }
})

test('revocation during execution closes the dispatch authorization wall', async () => {
  const fixture = provision()
  try {
    const approved = fixture.approve()
    const run = store.runSchedule(fixture.task.id)!
    let authorizationAfterRevoke = true
    const injected: typeof executeBoundMcpCall = async (_executionStore, _tenant, _call, authorize) => {
      store.decideRoutineMcp(fixture.task.id, owner, {
        requestId: 'revoke-during-call', action: 'revoke', expectedRevision: approved.policy.revision,
      })
      authorizationAfterRevoke = authorize()
      return { status: 'failed', summary: 'Refused before dispatch.' }
    }
    const receipt = await store.executeRoutineMcpCall(fixture.task.id, run.id, fixture.call, 'revocation-key', undefined, injected)
    assert.equal(authorizationAfterRevoke, false)
    assert.equal(receipt.status, 'failed')
    assert.equal(receipt.result, undefined)
    assert.equal(store.routineMcpRunMayRetry(fixture.task.id, run.id), false,
      'known pre-submit refusal still consumes the run slot')
  } finally { fixture.cleanup() }
})

test('abort settles pending work uncertain, pauses Routine, refuses removal and blocks new cadence', async () => {
  const fixture = provision()
  try {
    fixture.approve()
    const run = store.runSchedule(fixture.task.id)!
    const controller = new AbortController()
    let resolveExecution!: (outcome: McpBoundExecutionOutcome) => void
    let authorize!: () => boolean
    const pending = store.executeRoutineMcpCall(fixture.task.id, run.id, fixture.call, 'abort-key', controller.signal,
      async (_executionStore, _tenant, _call, allow) => {
        authorize = allow
        return await new Promise<McpBoundExecutionOutcome>(resolve => { resolveExecution = resolve })
      })
    for (let index = 0; index < 50 && fixture.review().runs.find(row => row.runId === run.id)?.calls[0]?.status !== 'pending'; index += 1) {
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    assert.equal(fixture.review().runs.find(row => row.runId === run.id)?.calls[0]?.status, 'pending')
    assert.throws(() => store.removeSchedule(fixture.task.id), ConflictError,
      'a pending external call holds routine removal')
    controller.abort()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(authorize(), false)
    const interrupted = fixture.review().runs.find(row => row.runId === run.id)
    assert.equal(interrupted?.calls[0]?.status, 'uncertain')
    assert.equal(interrupted?.phase, 'interrupted')
    assert.equal(run.status, 'failed')
    assert.equal(interrupted?.status, 'failed', 'the public ledger projection agrees with the failed run')
    assert.equal(fixture.task.enabled, false)
    assert.equal(fixture.review().policy.approval, null)
    resolveExecution({ status: 'done', summary: 'Late ignored success.', result })
    const receipt: RoutineMcpCallReceipt = await pending
    assert.equal(receipt.status, 'uncertain', 'late completion cannot overwrite the abort verdict')
    const next = store.runSchedule(fixture.task.id)!
    assert.equal(store.routineExecutionContext(fixture.task.id, next.id)?.blocked?.code, 'authority_denied')
    assert.equal(store.routineMcpRunMayRetry(fixture.task.id, next.id), true,
      'new run ledger is empty, while unresolved history blocks it through routine context')
    store.failScheduleRun(fixture.task.id, next.id, 'authority_denied', 'Blocked by unresolved previous call.')
    assert.equal(store.removeSchedule(fixture.task.id), true)
  } finally { fixture.cleanup() }
})

test('a completed call consumes the full per-run capacity', async () => {
  const fixture = provision()
  try {
    const initial = fixture.review()
    const intent: RoutineMcpApprovalIntent = {
      expectedRevision: initial.policy.revision, expectedDefinitionRevision: initial.definitionRevision,
      reviewHash: initial.reviewHash, expiresAt: Date.now() + 24 * 60 * 60 * 1000, maxCallsPerRun: 1,
      tools: [{ connectionId: fixture.connectionId, connectionRevision: 1, toolName: tool.name,
        schemaHash: fixture.schemaHash, fixedArguments: { query: 'approved' } }],
    }
    assert.ok(store.decideRoutineMcp(fixture.task.id, owner, { requestId: 'one-slot', action: 'approve', approval: intent }))
    const run = store.runSchedule(fixture.task.id)!
    let dispatches = 0
    const injected: typeof executeBoundMcpCall = async () => {
      dispatches += 1
      return { status: 'done', summary: 'Complete.', result }
    }
    assert.equal((await store.executeRoutineMcpCall(fixture.task.id, run.id, fixture.call, 'slot-one', undefined, injected)).status, 'done')
    assert.equal(store.routineMcpRunMayRetry(fixture.task.id, run.id), false)
    await assert.rejects(store.executeRoutineMcpCall(fixture.task.id, run.id, fixture.call, 'slot-two', undefined, injected), RoutineMcpPolicyError)
    assert.equal(dispatches, 1, 'completed slots are not silently refunded')
  } finally { fixture.cleanup() }
})

test('failed external result is detected from its private receipt and pauses the routine', async () => {
  const fixture = provision()
  try {
    fixture.approve()
    const run = store.runSchedule(fixture.task.id)!
    const errorResult: McpToolResult = { resultType: 'complete', content: [{ type: 'text', text: 'remote error' }], isError: true }
    const injected: typeof executeBoundMcpCall = async () => ({ status: 'failed', summary: 'Remote tool error.', result: errorResult })
    const receipt = await store.executeRoutineMcpCall(fixture.task.id, run.id, fixture.call, 'failed-result', undefined, injected)
    assert.equal(receipt.status, 'failed')
    assert.equal(receipt.result?.isError, true)
    assert.equal(run.status, 'failed')
    assert.equal(fixture.task.enabled, false)
    assert.equal(fixture.review().policy.approval, null)
  } finally { fixture.cleanup() }
})

test('live permission is rechecked before publishing done external work or applying standing output', async () => {
  for (const change of ['audience', 'definition', 'revoke'] as const) {
    const fixture = provision()
    try {
      const artifactName = `routine-mcp-live-check-${change}-${fixture.task.id}.md`
      store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: fixture.task.id,
        scheduleName: fixture.task.name, cadence: fixture.task.cadence, artifactName }, owner)
      fixture.approve()

      const priorRun = store.runSchedule(fixture.task.id)!
      const priorContext = store.routineExecutionContext(fixture.task.id, priorRun.id)!
      const completeCall: typeof executeBoundMcpCall = async () => ({ status: 'done', summary: 'Completed.', result })
      const priorReceipt = await store.executeRoutineMcpCall(fixture.task.id, priorRun.id, fixture.call,
        `prior-${change}`, undefined, completeCall)
      assert.equal(priorReceipt.status, 'done')
      const priorReview = fixture.review().runs.find(row => row.runId === priorRun.id)
      assert.equal(priorReview?.phase, 'active')
      assert.equal(priorReview?.status, 'running')
      store.completeScheduleRun(fixture.task.id, priorRun.id,
        { id: `prior-output-${priorRun.id}`, role: 'assistant', content: 'Previously approved digest.' },
        { agentId: priorContext.agent.id, providerId: priorContext.provider.id })
      assert.equal(priorRun.status, 'ok')
      assert.equal(fixture.review().runs.find(row => row.runId === priorRun.id)?.phase, 'active')
      assert.equal(fixture.review().runs.find(row => row.runId === priorRun.id)?.status, 'ok')

      const previousArtifact = store.listArtifacts(owner).find(row => row.sourceScheduleId === fixture.task.id)
      assert.ok(previousArtifact, 'the earlier successful run created the standing artifact')
      const previousBody = structuredClone(store.artifactContent(owner)[previousArtifact.id])
      const run = store.runSchedule(fixture.task.id)!
      const context = store.routineExecutionContext(fixture.task.id, run.id)!
      const receipt = await store.executeRoutineMcpCall(fixture.task.id, run.id, fixture.call,
        `late-${change}`, undefined, completeCall)
      assert.equal(receipt.status, 'done')

      if (change === 'audience') {
        const grant = store.createGrant({ subject: { kind: 'schedule', id: fixture.task.id },
          audience: { kind: 'org', orgId: audience }, tier: 'view' }, owner)
        assert.ok(grant && typeof grant === 'object')
      } else if (change === 'definition') {
        store.updateSchedule(fixture.task.id, { prompt: `Changed after execution: ${change}` })
      } else {
        const current = fixture.review()
        store.decideRoutineMcp(fixture.task.id, owner, {
          requestId: `revoke-before-publish-${fixture.task.id}`,
          action: 'revoke', expectedRevision: current.policy.revision,
        })
      }

      const unpublished = 'This model output must not be published after permission drift.'
      store.completeScheduleRun(fixture.task.id, run.id,
        { id: `unpublished-${run.id}`, role: 'assistant', content: unpublished },
        { agentId: context.agent.id, providerId: context.provider.id })
      assert.equal(run.status, 'failed', `${change} drift rejects late output`)
      assert.match(run.detail ?? '', /no output was published/i)
      assert.deepEqual(store.artifactContent(owner)[previousArtifact.id], previousBody,
        `${change} drift leaves the standing artifact unchanged`)
      assert.equal(store.listArtifacts(owner).filter(row => row.sourceScheduleId === fixture.task.id).length, 1)
      const runSession = store.getSession(context.sessionId)
      assert.ok(runSession)
      assert.equal(runSession.messages?.some(message => message.content.includes(unpublished)), false,
        'the late model output never enters the saved run conversation')
      const privateRow = fixture.review().runs.find(row => row.runId === run.id)
      assert.equal(privateRow?.calls[0]?.status, 'done', 'the committed call receipt remains available privately')
      assert.equal(privateRow?.status, 'failed')
      const publicRow = store.listSchedules(owner).find(row => row.id === fixture.task.id)!.runs.find(row => row.id === run.id)!
      assert.equal(Object.hasOwn(publicRow, 'calls'), false)
      assert.equal(Object.hasOwn(publicRow, 'routineMcp'), false, 'shared Routine rows do not expose private receipts')
    } finally { fixture.cleanup() }
  }
})
