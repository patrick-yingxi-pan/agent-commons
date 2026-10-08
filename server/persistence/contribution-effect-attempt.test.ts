import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contributionEffectExecutionId } from '../contributionEffectExecutionIdentity.ts'
import {
  CONTRIBUTION_EFFECT_ATTEMPT_MAX,
  createContributionEffectAttempt,
  settleContributionEffectAttempt,
  type ContributionEffectIntent,
  type StoredContributionEffectAttempt,
} from '../contributionEffectState.ts'
import { STORE_VERSION, hasCorePersistedShape, type PersistedState } from './format.ts'

const tenantId = 'tenant-effect-owner'
const projectId = 'project-effect-owner'
const contributionId = 'contribution-effect-row'
const connectionId = `mcp-connection-${'a'.repeat(32)}`
const schemaHash = 'b'.repeat(64)
const call = () => ({
  connectionId,
  connectionRevision: 4,
  toolName: 'create_event',
  schemaHash,
  arguments: { title: 'Planning', tags: ['work', 'weekly'] },
})

function rebindAttempt(
  existing: StoredContributionEffectAttempt,
  patch: Partial<ContributionEffectIntent>,
): StoredContributionEffectAttempt {
  const { id, tenantId, projectId, contributionId, envelopeVersion, lineId, actor, connectionLabel, call: boundCall, startedAt } = existing
  return createContributionEffectAttempt({
    id, tenantId, projectId, contributionId, envelopeVersion, lineId, actor, connectionLabel, call: boundCall, startedAt,
    ...patch,
  })
}

function attempt(key: string, status: 'pending' | 'failed' | 'done' | 'uncertain' = 'pending'): StoredContributionEffectAttempt {
  const pending = createContributionEffectAttempt({
    id: contributionEffectExecutionId(tenantId, projectId, contributionId, key),
    tenantId,
    projectId,
    contributionId,
    envelopeVersion: 2,
    lineId: 'line-effect-1',
    actor: 'Owner',
    connectionLabel: 'Calendar connection',
    call: call(),
    startedAt: 100 + Number(key.replace(/\D/g, '') || 0),
  })
  if (status === 'pending') return pending
  return settleContributionEffectAttempt(pending, status === 'done'
    ? { status, summary: 'not persisted from caller', result: { resultType: 'complete', content: [{ type: 'text', text: 'Created.' }], isError: false } }
    : status === 'failed'
      ? { status, summary: 'not persisted from caller' }
      : { status, summary: 'not persisted from caller' }, pending.startedAt + 1)
}

function preview() {
  return {
    connectionLabel: 'Calendar connection',
    toolName: 'create_event',
    arguments: { title: 'Planning', tags: ['work', 'weekly'] },
  }
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    status: 'approved',
    proposedBy: 'Owner',
    proposedAt: 10,
    approvedBy: 'Owner',
    approvedAt: 20,
    approvedVersion: 2,
    lines: [{
      id: 'line-effect-1',
      type: 'mcp.mutate',
      target: 'create_event',
      cardinality: 1,
      harness: 'explicit-call',
      note: 'One reviewed call.',
      used: 1,
      mcp: preview(),
      mcpAuthority: { tenantId, call: call() },
    }],
    ...overrides,
  }
}

function contribution(overrides: Record<string, unknown> = {}) {
  return {
    id: contributionId,
    projectId,
    title: 'Effect persistence fixture',
    summary: '',
    contributor: 'Owner',
    contributorTenant: tenantId,
    status: 'open',
    effectsFired: true,
    openedAt: 1,
    envelope: envelope(),
    effectAttempts: [attempt('run-1', 'pending')],
    events: [{
      id: 'proposal-v2', kind: 'envelope-proposed', envelopeVersion: 2, proposedByTenant: tenantId,
      envelopeProposalLines: [{ type: 'mcp.mutate', target: 'create_event', cardinality: 1,
        harness: 'explicit-call', note: 'One reviewed call.',
        mcp: { connectionId, connectionRevision: 4, toolName: 'create_event', arguments: call().arguments } }],
    }, { id: 'approval-v2', kind: 'envelope-approved', envelopeVersion: 2, at: 20, actor: 'Owner', body: 'v2' }],
    ...overrides,
  }
}

function state(row = contribution()): PersistedState {
  return {
    version: STORE_VERSION,
    initialWorld: 'clean',
    sessions: [], bindings: [], workspaces: [], schedules: [],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: {
      sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {},
      artifactSource: {}, scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {},
      extraArtifacts: [], extraProjects: [], standingApprovals: {},
    },
    seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
    contributions: [row],
  } as unknown as PersistedState
}

test('legacy absence remains valid; a current private MCP-bound attempt is admitted', () => {
  const legacy = state(contribution({ envelope: undefined, effectAttempts: undefined }))
  assert.equal(hasCorePersistedShape(legacy), true, 'snapshots predating the optional receipt slice remain valid')
  assert.equal(hasCorePersistedShape(state(contribution({ effectAttempts: undefined,
    envelope: envelope({ lines: [{ ...envelope().lines[0], used: 0 }] }) }))), true,
  'a newly approved explicit-call line starts with no consumed slots')
  assert.equal(hasCorePersistedShape(state()), true)
})

test('current MCP envelope requires the exact ordered proposal event and private proposer binding', () => {
  const malformedProposal = (mutate: (row: any) => void) => {
    const row = structuredClone(contribution()) as any
    mutate(row)
    return hasCorePersistedShape(state(row))
  }
  assert.equal(malformedProposal((row) => { delete row.events[0].envelopeProposalLines }), false)
  assert.equal(malformedProposal((row) => { row.events[0].proposedByTenant = 'other-tenant' }), false)
  assert.equal(malformedProposal((row) => { row.events[0].envelopeProposalLines[0].mcp.arguments.title = 'different' }), false)
  assert.equal(malformedProposal((row) => { row.events[0].envelopeProposalLines[0].cardinality = 2 }), false)
})

test('an approved MCP envelope requires its durable approval event', () => {
  const invalid = (mutate: (row: any) => void) => {
    const row = structuredClone(contribution()) as any
    mutate(row)
    return hasCorePersistedShape(state(row))
  }
  assert.equal(invalid((row) => { row.events = row.events.filter((event: any) => event.kind !== 'envelope-approved') }), false,
    'approved fields alone cannot authorize a persisted exact-call envelope')
  assert.equal(invalid((row) => { row.events.find((event: any) => event.kind === 'envelope-approved').envelopeVersion = 1 }), false)
  assert.equal(invalid((row) => { row.events.find((event: any) => event.kind === 'envelope-approved').at = 19 }), false)
  assert.equal(invalid((row) => { row.events.find((event: any) => event.kind === 'envelope-approved').body = 'v1' }), false)
  assert.equal(invalid((row) => { row.events.push({ ...row.events.at(-1), id: 'duplicate-approval' }) }), false,
    'one version cannot acquire multiple approval receipts')
})

test('rejects public-only effects and readiness flags from persisted state', () => {
  assert.equal(hasCorePersistedShape(state(contribution({ effects: [] }))), false,
    'public effects are projected from the private attempt rows, never stored')
  assert.equal(hasCorePersistedShape(state(contribution({ effectAttempts: null }))), false,
    'a malformed present slice cannot collapse into legacy absence')

  const persistedReadiness = structuredClone(contribution()) as any
  persistedReadiness.envelope.lines[0].mcp.canRun = true
  assert.equal(hasCorePersistedShape(state(persistedReadiness)), false,
    'canRun is current server readiness, not durable authority')
})

test('requires explicit-call mcp.mutate lines with an exact coherent preview and private binding', () => {
  const mutateEnvelope = (mutate: (value: any) => void) => {
    const row = structuredClone(contribution()) as any
    mutate(row.envelope.lines[0])
    if (row.envelope.lines[0].cardinality !== 1) row.events[0].envelopeProposalLines[0].cardinality = row.envelope.lines[0].cardinality
    return hasCorePersistedShape(state(row))
  }
  assert.equal(mutateEnvelope((line) => { line.harness = 'draft-escrow' }), false)
  assert.equal(mutateEnvelope((line) => { delete line.mcpAuthority }), false)
  assert.equal(mutateEnvelope((line) => { line.type = 'connector.write' }), false)
  assert.equal(mutateEnvelope((line) => { line.target = 'delete_event' }), false)
  assert.equal(mutateEnvelope((line) => { line.cardinality = 2 }), true,
    'a per-call separately confirmed line may reserve multiple acts')
  assert.equal(mutateEnvelope((line) => { line.mcp.arguments.title = 'changed' }), false)
  assert.equal(mutateEnvelope((line) => { line.mcpAuthority.tenantId = 'other-tenant' }), false)
  assert.equal(mutateEnvelope((line) => { line.mcpAuthority.call.schemaHash = 'malformed' }), false)
  assert.equal(mutateEnvelope((line) => { line.mcpAuthority.call.extra = 'private extra' }), false)
  assert.equal(mutateEnvelope((line) => { line.extra = 'unknown' }), false)
  assert.equal(mutateEnvelope((line) => { line.mcp.connectionId = connectionId }), false,
    'private connection identity must not leak into the Project-visible preview')
  const legacyAttemptOnExplicitLine = contribution({ effectAttempts: undefined,
    envelope: envelope({ lines: [{ ...envelope().lines[0], used: 1 }] }) })
  assert.equal(hasCorePersistedShape(state(legacyAttemptOnExplicitLine)), false,
    'the legacy simulated effect route cannot increment a real MCP line without a receipt')
})

test('attempt admission binds its containing row, approved envelope version, exact current line and call', () => {
  const badContribution = (mutate: (row: any) => void) => {
    const row = structuredClone(contribution()) as any
    mutate(row)
    return hasCorePersistedShape(state(row))
  }
  assert.equal(badContribution((row) => { row.effectAttempts[0] = rebindAttempt(row.effectAttempts[0], { projectId: 'other-project' }) }), false)
  assert.equal(badContribution((row) => { row.effectAttempts[0] = rebindAttempt(row.effectAttempts[0], { contributionId: 'other-contribution' }) }), false)
  assert.equal(badContribution((row) => { row.effectAttempts[0] = rebindAttempt(row.effectAttempts[0], { tenantId: 'other-tenant' }) }), false,
    'the attempt actor must own the envelope-bound MCP connection')
  assert.equal(badContribution((row) => { row.effectAttempts[0] = rebindAttempt(row.effectAttempts[0], { envelopeVersion: 1 }) }), false)
  assert.equal(badContribution((row) => { row.effectAttempts[0] = rebindAttempt(row.effectAttempts[0], { lineId: 'another-line' }) }), false)
  assert.equal(badContribution((row) => {
    const changedCall = { ...row.effectAttempts[0].call, arguments: { ...row.effectAttempts[0].call.arguments, title: 'different' } }
    row.effectAttempts[0] = rebindAttempt(row.effectAttempts[0], { call: changedCall })
  }), false)
  assert.equal(badContribution((row) => { row.envelope.approvedVersion = 1 }), false)
  assert.equal(badContribution((row) => { row.envelope.status = 'proposed' }), false)
  assert.equal(badContribution((row) => { row.envelope.lines[0].used = 0 }), false,
    'the stored cardinality count must agree with slot-consuming receipts')
  assert.equal(badContribution((row) => { row.effectsFired = false }), false,
    'even a known pre-submit failure permanently stamps that an explicit effect was attempted')

  const stalePending = contribution({ effectAttempts: [attempt('run-2')] }) as any
  stalePending.envelope = envelope({ version: 3, status: 'proposed', lines: [{ ...envelope().lines[0], used: 0 }] })
  delete stalePending.envelope.approvedVersion
  delete stalePending.envelope.approvedAt
  delete stalePending.envelope.approvedBy
  stalePending.events = [
    { id: 'proposal-v2', kind: 'envelope-proposed', envelopeVersion: 2, proposedByTenant: tenantId,
      envelopeProposalLines: [{ type: 'mcp.mutate', target: 'create_event', cardinality: 1, harness: 'explicit-call',
        note: 'One reviewed call.', mcp: { connectionId, connectionRevision: 4, toolName: 'create_event', arguments: call().arguments } }] },
    { id: 'approval-v2', kind: 'envelope-approved', envelopeVersion: 2, approvedByTenant: tenantId },
    { id: 'proposal-v3', kind: 'envelope-proposed', envelopeVersion: 3, proposedByTenant: tenantId,
      envelopeProposalLines: [{ type: 'mcp.mutate', target: 'create_event', cardinality: 1, harness: 'explicit-call',
        note: 'One reviewed call.', mcp: { connectionId, connectionRevision: 4, toolName: 'create_event', arguments: call().arguments } }] },
  ]
  assert.equal(hasCorePersistedShape(state(stalePending)), false,
    'a pending external call cannot belong to an amended, superseded version')
  assert.equal(hasCorePersistedShape(state(contribution({ status: 'landed' }))), false,
    'a pending external call cannot survive on a landed Contribution')

  const malformedEnvelope = structuredClone(contribution()) as any
  malformedEnvelope.envelope.lines = null
  assert.equal(hasCorePersistedShape(state(malformedEnvelope)), false,
    'malformed outer envelope state fails admission without throwing while checking attempts')

  const twiceConfirmed = contribution({
    effectAttempts: [attempt('run-1'), attempt('run-2')],
    envelope: envelope({ lines: [{ ...envelope().lines[0], cardinality: 2, used: 2 }] }),
    events: [{
      id: 'proposal-v2', kind: 'envelope-proposed', envelopeVersion: 2, proposedByTenant: tenantId,
      envelopeProposalLines: [{ type: 'mcp.mutate', target: 'create_event', cardinality: 2,
        harness: 'explicit-call', note: 'One reviewed call.',
        mcp: { connectionId, connectionRevision: 4, toolName: 'create_event', arguments: call().arguments } }],
    }, { id: 'approval-v2', kind: 'envelope-approved', envelopeVersion: 2, at: 20, actor: 'Owner', body: 'v2' }],
  })
  assert.equal(hasCorePersistedShape(state(twiceConfirmed)), true,
    'slot count is the exact number of separately confirmed, slot-consuming receipts')

  const staleTerminal = contribution({ effectAttempts: [attempt('run-2', 'failed')] }) as any
  staleTerminal.envelope = envelope({ version: 3, status: 'proposed', lines: [{ ...envelope().lines[0], used: 0 }] })
  delete staleTerminal.envelope.approvedVersion
  delete staleTerminal.envelope.approvedAt
  delete staleTerminal.envelope.approvedBy
  staleTerminal.events = [
    { id: 'proposal-v2', kind: 'envelope-proposed', envelopeVersion: 2, proposedByTenant: tenantId,
      envelopeProposalLines: [{ type: 'mcp.mutate', target: 'create_event', cardinality: 1, harness: 'explicit-call',
        note: 'One reviewed call.', mcp: { connectionId, connectionRevision: 4, toolName: 'create_event', arguments: call().arguments } }] },
    { id: 'approval-v2', kind: 'envelope-approved', envelopeVersion: 2, approvedByTenant: tenantId },
    { id: 'proposal-v3', kind: 'envelope-proposed', envelopeVersion: 3, proposedByTenant: tenantId,
      envelopeProposalLines: [{ type: 'mcp.mutate', target: 'create_event', cardinality: 1, harness: 'explicit-call',
        note: 'One reviewed call.', mcp: { connectionId, connectionRevision: 4, toolName: 'create_event', arguments: call().arguments } }] },
  ]
  assert.equal(hasCorePersistedShape(state(staleTerminal)), true,
    'a terminal older-version receipt survives an amendment without authorizing the new version')
})

test('attempt ids cannot collide with other attempts, timeline events, review receipts, or judgment receipts', () => {
  const candidate = attempt('run-1')
  const collidingRow = (rowOverrides: Record<string, unknown>) => contribution({
    ...rowOverrides,
    effectAttempts: [candidate],
  })
  assert.equal(hasCorePersistedShape(state(collidingRow({ events: [{ id: candidate.id, kind: 'note', at: 1, actor: 'Owner' }] }))), false)
  assert.equal(hasCorePersistedShape(state(collidingRow({ reviewAttempts: [{ id: candidate.id }] }))), false)
  assert.equal(hasCorePersistedShape(state(collidingRow({ judgmentAttempts: [{ id: candidate.id }] }))), false)
  assert.equal(hasCorePersistedShape(state(contribution({
    effectAttempts: [candidate, { ...candidate, envelopeVersion: 3 }],
  }))), false)
})

test('caps retained receipts without pruning exact retry identities', () => {
  assert.equal(CONTRIBUTION_EFFECT_ATTEMPT_MAX, 100)
  const failed = Array.from({ length: CONTRIBUTION_EFFECT_ATTEMPT_MAX }, (_, index) => attempt(`run-${index + 1}`, 'failed'))
  const maxed = contribution({ effectAttempts: failed, envelope: envelope({ lines: [{ ...envelope().lines[0], used: 0 }] }) })
  assert.equal(hasCorePersistedShape(state(maxed)), true)
  assert.equal(hasCorePersistedShape(state(contribution({ effectAttempts: [...failed, attempt('run-101', 'failed')],
    envelope: envelope({ lines: [{ ...envelope().lines[0], used: 0 }] }) }))), false)
})
