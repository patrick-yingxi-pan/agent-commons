/** The in-session interaction sweep (the 2026-07-15 relay-session audit).
 *
 *  A relayed "un-file this session from Vibe Coding Guide" landed as a proposal
 *  to FILE the session UNDER Insights dashboard — two compounding executor bugs:
 *    - I1: the wire declares `remove` as a STRING ("Set \"true\" …"), but the
 *      executor's bool() accepted only a genuine boolean, so remove was dropped;
 *    - I2: resolveProject/resolveArtifact/resolveSchedule read the SEED catalogs
 *      only and fell back to seed[0] on no match — a runtime-created project
 *      (graph.extraProjects) could never resolve, and the miss silently became
 *      the wrong entity (the INV-9 class: an invalid value must be refused
 *      loudly, never normalized to a mutable default).
 *  Plus the consent-card verdict living only in component/graph state (I3):
 *  a confirmed card flipped back to pending on reload once a later op moved the
 *  relation on — the verdict is HISTORY and now persists on the message.
 *
 *  This file locks the whole surface: input coercion for every string-declared
 *  flag, live-registry resolution for every name-taking tool, the uniform loud
 *  refusal on an unmatched name, the end-to-end route round-trips (mock model →
 *  tool call → proposal), and the verdict route. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { startModelServer } from './index.ts'
import { store } from '../store/index.ts'
import { executeTool, TOOL_NAMES, type ToolContext } from './tools.ts'
import { opKey, type Message, type RelationOp } from '../../contract/index.ts'
import { call, callFresh, callRaw } from '../testkit/http.ts'
import { relationActionDecisionId } from '../relationActionDecisionIdentity.ts'

// ── The live-registry context every resolution test uses: runtime-created
//    entities the seed catalogs do NOT contain. ────────────────────────────────
const LIVE: ToolContext = {
  session: { id: 's-live', title: 'A live thread' },
  commons: {
    providers: [{ id: 'provider-1', label: 'Anthropic' }],
    systemPrompts: [{ id: 'sp-1', label: 'Deep research' }],
    agents: [{ id: 'agent-7', label: 'Scout' }],
    commissions: [{ id: 'com-1', agentId: 'agent-7', projectId: 'p-vibe-coding-guide' }],
    projects: [{ id: 'p-vibe-coding-guide', name: 'Vibe Coding Guide' }],
    artifacts: [{ id: 'art-x', name: 'vibe-outline.md' }],
    schedules: [{ id: 'sch-x', name: 'Nightly vibe digest', cadence: 'daily' }],
    connectors: [{ id: 'mcp-custom', label: 'My Custom MCP' }],
  },
}
const SEED_ONLY: ToolContext = { session: LIVE.session }

// ── I1 — string-declared booleans coerce (every `remove` flag, both shapes) ──
const REMOVE_CASES: Array<{ tool: string; input: Record<string, unknown>; idField: string }> = [
  { tool: 'file_session', input: { project: 'Vibe Coding Guide' }, idField: 'projectId' },
  { tool: 'refile_artifact', input: { artifact: 'vibe-outline.md', project: 'Vibe Coding Guide' }, idField: 'projectId' },
  { tool: 'link_schedule_project', input: { schedule: 'Nightly vibe digest', project: 'Vibe Coding Guide' }, idField: 'projectId' },
]
for (const c of REMOVE_CASES) {
  test(`${c.tool}: remove works in BOTH wire shapes — string "true" (as declared) and boolean true (I1)`, () => {
    for (const remove of ['true', 'TRUE', true] as const) {
      const e = executeTool(c.tool, { ...c.input, remove }, LIVE)
      assert.ok(e.relationOps?.length === 1, `${c.tool} remove=${JSON.stringify(remove)} proposed an op`)
      assert.equal((e.relationOps![0] as never as Record<string, unknown>)[c.idField], null, `remove=${JSON.stringify(remove)} ⇒ ${c.idField} null`)
    }
    for (const remove of [undefined, 'false', false] as const) {
      const e = executeTool(c.tool, { ...c.input, ...(remove === undefined ? {} : { remove }) }, LIVE)
      assert.notEqual((e.relationOps![0] as never as Record<string, unknown>)[c.idField], null, `remove=${JSON.stringify(remove)} keeps the link`)
    }
  })
}

// ── I2 — every name-taking tool resolves the LIVE registry (runtime entities) ──
const LIVE_RESOLUTION: Array<{ tool: string; input: Record<string, unknown>; expect: (op: Record<string, unknown>) => void }> = [
  { tool: 'file_session', input: { project: 'Vibe Coding Guide' }, expect: (op) => assert.equal(op.projectId, 'p-vibe-coding-guide') },
  { tool: 'save_artifact', input: { name: 'n.md', body: 'A real body.', project: 'Vibe Coding Guide' }, expect: (op) => assert.equal(op.projectId, 'p-vibe-coding-guide') },
  { tool: 'refile_artifact', input: { artifact: 'vibe-outline.md', project: 'Vibe Coding Guide' }, expect: (op) => assert.equal(op.artifactId, 'art-x') },
  { tool: 'attach_context', input: { connector: 'My Custom MCP' }, expect: (op) => assert.equal(op.connectorId, 'mcp-custom') },
  { tool: 'scope_context', input: { connector: 'My Custom MCP', project: 'Vibe Coding Guide' }, expect: (op) => assert.equal(op.projectId, 'p-vibe-coding-guide') },
  { tool: 'unscope_context', input: { context: 'Figma', project: 'Vibe Coding Guide' }, expect: (op) => assert.equal(op.projectId, 'p-vibe-coding-guide') },
  { tool: 'set_project_instructions', input: { project: 'Vibe Coding Guide', instructions: 'x' }, expect: (op) => assert.equal(op.projectId, 'p-vibe-coding-guide') },
  { tool: 'set_project_description', input: { project: 'Vibe Coding Guide', description: 'x' }, expect: (op) => assert.equal(op.projectId, 'p-vibe-coding-guide') },
  { tool: 'link_schedule_project', input: { schedule: 'Nightly vibe digest', project: 'Vibe Coding Guide' }, expect: (op) => assert.equal(op.scheduleId, 'sch-x') },
  { tool: 'set_artifact_source', input: { artifact: 'vibe-outline.md', context: 'kit/' }, expect: (op) => assert.equal(op.artifactId, 'art-x') },
  { tool: 'set_schedule_session', input: { schedule: 'Nightly vibe digest' }, expect: (op) => assert.equal(op.scheduleId, 'sch-x') },
  { tool: 'set_schedule_artifact', input: { schedule: 'Nightly vibe digest', artifact: 'd.md' }, expect: (op) => assert.equal(op.scheduleId, 'sch-x') },
  { tool: 'schedule_add_tool', input: { schedule: 'Nightly vibe digest', tool: 'My Custom MCP' }, expect: (op) => assert.equal(op.scheduleId, 'sch-x') },
  { tool: 'commission_agent', input: { agent: 'Scout', project: 'Vibe Coding Guide' }, expect: (op) => assert.equal(op.projectId, 'p-vibe-coding-guide') },
  { tool: 'uncommission_agent', input: { agent: 'Scout', project: 'Vibe Coding Guide' }, expect: (op) => assert.equal(op.commissionId, 'com-1') },
  { tool: 'set_commission_cap', input: { project: 'Vibe Coding Guide', cap: 2 }, expect: (op) => assert.equal(op.projectId, 'p-vibe-coding-guide') },
]
for (const c of LIVE_RESOLUTION) {
  test(`${c.tool} resolves a RUNTIME-created entity through the live registry (I2)`, () => {
    const e = executeTool(c.tool, c.input, LIVE)
    assert.ok(e.relationOps?.length === 1, `${c.tool} proposed one op (got: ${e.summary})`)
    c.expect(e.relationOps![0] as never as Record<string, unknown>)
  })
}

// ── I2 — an unmatched name refuses loudly; NOTHING is substituted ─────────────
const REFUSALS: Array<{ tool: string; input: Record<string, unknown> }> = [
  { tool: 'file_session', input: { project: 'No Such Project' } },
  { tool: 'file_session', input: { project: 'No Such Project', remove: 'true' } },
  { tool: 'save_artifact', input: { name: 'n.md', body: 'A real body.', project: 'No Such Project' } },
  { tool: 'refile_artifact', input: { artifact: 'no-such.md', project: 'Vibe Coding Guide' } },
  { tool: 'refile_artifact', input: { artifact: 'vibe-outline.md', project: 'No Such Project' } },
  { tool: 'scope_context', input: { connector: 'My Custom MCP', project: 'No Such Project' } },
  // A connector name that matches nothing REFUSES — resolveConnector once minted
  // `{ id: slug(name), label: name }` on a miss, attaching a phantom connector
  // with no capability behind it (the catalog is a closed registry).
  { tool: 'attach_context', input: { connector: 'FooBar CRM' } },
  { tool: 'scope_context', input: { connector: 'FooBar CRM', project: 'Vibe Coding Guide' } },
  { tool: 'schedule_add_tool', input: { schedule: 'Nightly vibe digest', tool: 'FooBar CRM' } },
  { tool: 'unscope_context', input: { context: 'Figma', project: 'No Such Project' } },
  { tool: 'set_project_instructions', input: { project: 'No Such Project', instructions: 'x' } },
  { tool: 'set_project_description', input: { project: 'No Such Project', description: 'x' } },
  { tool: 'link_schedule_project', input: { schedule: 'No Such Schedule', project: 'Vibe Coding Guide' } },
  { tool: 'link_schedule_project', input: { schedule: 'Nightly vibe digest', project: 'No Such Project' } },
  { tool: 'set_artifact_source', input: { artifact: 'no-such.md', context: 'kit/' } },
  { tool: 'set_schedule_session', input: { schedule: 'No Such Schedule' } },
  { tool: 'set_schedule_artifact', input: { schedule: 'No Such Schedule' } },
  { tool: 'schedule_add_tool', input: { schedule: 'No Such Schedule', tool: 'Slack' } },
  { tool: 'commission_agent', input: { agent: 'Scout', project: 'No Such Project' } },
  { tool: 'uncommission_agent', input: { agent: 'Scout', project: 'No Such Project' } },
  { tool: 'set_commission_cap', input: { project: 'No Such Project', cap: 2 } },
]
for (const c of REFUSALS) {
  test(`${c.tool} REFUSES an unmatched name (${JSON.stringify(c.input)}) — no substituted entity (INV-9)`, () => {
    const e = executeTool(c.tool, c.input, LIVE)
    assert.equal(e.relationOps, undefined, 'no op proposed')
    assert.equal(e.escalation, undefined, 'no escalation proposed')
    assert.match(e.summary, /proposed nothing/i, 'the refusal is loud and fed back to the model')
  })
}

test('the regression itself: unfile from a runtime project proposes THAT unfile — never a refile to a seed default (I1+I2)', () => {
  // With the live registry: exactly the unfile the user asked for.
  const e = executeTool('file_session', { project: 'Vibe Coding Guide', remove: 'true' }, LIVE)
  const op = e.relationOps![0] as never as Record<string, unknown>
  assert.equal(op.kind, 'file-session')
  assert.equal(op.projectId, null, 'an UNFILE, not a filing')
  assert.equal(op.projectName, 'Vibe Coding Guide', 'named after the project the user meant')
  // Without it (seed fallback): a loud refusal — the old code proposed filing
  // under PROJECTS[0] ("Insights dashboard"), the exact observed bug.
  const miss = executeTool('file_session', { project: 'Vibe Coding Guide', remove: 'true' }, SEED_ONLY)
  assert.equal(miss.relationOps, undefined)
  assert.match(miss.summary, /proposed nothing/i)
})

// ── The end-to-end route round-trips (mock model → tool call → proposal) ──────
let server: Server
before(async () => {
  server = startModelServer(0, '127.0.0.1')
  // `listen(0)` may reach listening before this hook resumes on a fast host.
  // Observe the current state as well as the future event so the suite cannot
  // strand every route test behind a missed one-shot notification.
  if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
})
after(() => {
  delete process.env.ANTHROPIC_BASE_URL
  server.close()
})

test('E2E: a free-typed unfile proposes file-session with projectId null (the phrase that broke)', async () => {
  const created = await call('POST', '/relations/ops', { op: { kind: 'create-project', projectId: 'p-vibe-e2e', projectName: 'Vibe E2E', projectDescription: 'd' } })
  assert.equal(created.status, 200, 'the runtime project landed in the graph')
  const s = store.createSession('unfile round-trip')
  const { status, body } = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'Please remove this session from the Vibe E2E project.', ephemeral: true })
  assert.equal(status, 200)
  assert.match(body, /"type":"message\.relations"/, 'the proposal event streamed')
  assert.match(body, /"kind":"file-session"/, 'a session↔project edit (not unscope-context — the old mis-grab)')
  assert.match(body, /"projectId":null/, 'an UNFILE')
  assert.match(body, /"projectName":"Vibe E2E"/, 'of the runtime-created project the user named')
  assert.doesNotMatch(body, /"kind":"unscope-context"/)
})

test('E2E: filing under a project created EARLIER in the conversation resolves it (the live-registry read)', async () => {
  const created = await call('POST', '/relations/ops', { op: { kind: 'create-project', projectId: 'p-file-e2e', projectName: 'File Target', projectDescription: 'd' } })
  assert.equal(created.status, 200, 'the runtime project landed in the graph')
  const s = store.createSession('file round-trip')
  const { body } = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'File this under the File Target project.', ephemeral: true })
  assert.match(body, /"kind":"file-session"/)
  assert.match(body, /"projectId":"p-file-e2e"/, 'resolved to the runtime project, not a seed default')
})

test('E2E: an all-refused turn answers honestly — no consent-card narration over an empty proposal', async () => {
  const s = store.createSession('refusal prose')
  const { body } = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'Attach FooBar CRM to this session', ephemeral: true })
  assert.doesNotMatch(body, /"type":"message\.relations"/, 'nothing was proposed')
  assert.doesNotMatch(body, /confirm below/i, 'the prose does not narrate a card that does not exist')
  assert.match(body, /no connector matching/i, 'the refusal reason reaches the user')
})

// ── I3 — the consent card's verdict persists on the message record ────────────
function appendRelationProposal(sessionId: string, operation: RelationOp): { carrier: Message; key: string } {
  const carrier: Message = {
    id: store.mintMessageId('assistant'),
    role: 'assistant',
    content: 'I prepared one proposed change for your review.',
    relationActions: [operation],
  }
  assert.ok(store.appendMessage(sessionId, carrier))
  return { carrier, key: opKey(operation) }
}

test('the legacy unkeyed verdict route records only relationsResolved; it survives a re-read (I3)', async () => {
  const s = store.createSession('verdict persistence')
  await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'Save the recap of this as verdict-recap.md' })
  const thread = (await call('GET', `/sessions/${s.id}`)).json.messages ?? []
  const carrier = thread.find((m: { relationActions?: unknown[] }) => (m.relationActions ?? []).length > 0)
  assert.ok(carrier, 'the save proposal persisted on its message')
  const key = opKey(carrier.relationActions[0])
  const beforeArtifacts = store.relationGraph().extraArtifacts.filter((artifact) => artifact.name === 'verdict-recap.md').length

  const ok = await call('POST', `/sessions/${s.id}/messages/${carrier.id}/relations`, { key, verdict: 'confirmed' })
  assert.equal(ok.status, 200)
  const reread = (await call('GET', `/sessions/${s.id}`)).json.messages.find((m: { id: string }) => m.id === carrier.id)
  assert.equal(reread.relationsResolved[key], 'confirmed', 'the verdict is on the record, not in component state')
  assert.equal(reread.relationDecisionIds, undefined, 'legacy callers cannot mint a first-party receipt')
  assert.equal(store.relationGraph().extraArtifacts.filter((artifact) => artifact.name === 'verdict-recap.md').length, beforeArtifacts, 'legacy record-only compatibility does not execute the effect')

  const replay = await call('POST', `/sessions/${s.id}/messages/${carrier.id}/relations`, { key, verdict: 'confirmed' })
  assert.equal(replay.status, 200, 'a same-verdict legacy retry is harmless')
  const opposite = await call('POST', `/sessions/${s.id}/messages/${carrier.id}/relations`, { key, verdict: 'skipped' })
  assert.equal(opposite.status, 400, 'consent history is terminal even for an older unkeyed client')
  assert.equal(store.getSession(s.id)?.messages?.find((message) => message.id === carrier.id)?.relationsResolved?.[key], 'confirmed')

  // A skip is a terminal verdict too (the "Not now" that once evaporated on reload).
  const skipped = appendRelationProposal(s.id, {
    kind: 'file-session',
    sessionId: s.id,
    sessionTitle: s.title,
    projectId: null,
    projectName: 'Unfiled',
  })
  const skip = await call('POST', `/sessions/${s.id}/messages/${skipped.carrier.id}/relations`, { key: skipped.key, verdict: 'skipped' })
  assert.equal(skip.status, 200)
})

test('the verdict route refuses garbage: bad verdict 400, unknown key/message 404 (never minted onto arbitrary messages)', async () => {
  const s = store.createSession('verdict validation')
  await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'Save the recap of this as v2-recap.md' })
  const thread = (await call('GET', `/sessions/${s.id}`)).json.messages ?? []
  const carrier = thread.find((m: { relationActions?: unknown[] }) => (m.relationActions ?? []).length > 0)
  const key = opKey(carrier.relationActions[0])

  assert.equal((await call('POST', `/sessions/${s.id}/messages/${carrier.id}/relations`, { key, verdict: 'maybe' })).status, 400)
  assert.equal((await call('POST', `/sessions/${s.id}/messages/${carrier.id}/relations`, { verdict: 'confirmed' })).status, 400)
  assert.equal((await call('POST', `/sessions/${s.id}/messages/${carrier.id}/relations`, { key: 'no-such-op', verdict: 'confirmed' })).status, 404)
  assert.equal((await call('POST', `/sessions/${s.id}/messages/m-nope/relations`, { key, verdict: 'confirmed' })).status, 404)
  // The prose message (no proposals) refuses too — a verdict names a real proposal.
  const prose = thread.find((m: { relationActions?: unknown[]; role: string }) => m.role === 'user')
  assert.equal((await call('POST', `/sessions/${s.id}/messages/${prose.id}/relations`, { key, verdict: 'confirmed' })).status, 404)
})

test('a keyed confirm atomically executes the immutable proposal, records its exact receipt, and replays once', async () => {
  const s = store.createSession('atomic relation decision')
  const operation: RelationOp = {
    kind: 'save-artifact',
    artifact: { name: `atomic-${s.id}.md`, kind: 'doc', meta: 'Document', body: 'One durable body.' },
    sessionId: s.id,
    sessionTitle: s.title,
  }
  const { carrier, key } = appendRelationProposal(s.id, operation)
  const logicalKey = `confirm-${s.id}`
  const expectedId = relationActionDecisionId(store.defaultTenantId(), s.id, carrier.id, key, logicalKey)
  const before = store.relationGraph()
  const beforeCount = before.extraArtifacts.filter((artifact) => artifact.name === operation.artifact.name).length

  const first = await call(
    'POST',
    `/sessions/${s.id}/messages/${carrier.id}/relations`,
    { key, verdict: 'confirmed' },
    { 'idempotency-key': logicalKey },
  )
  assert.equal(first.status, 200)
  assert.deepEqual(first.json, { key, verdict: 'confirmed', decisionId: expectedId })
  const afterFirst = store.relationGraph()
  assert.equal(afterFirst.extraArtifacts.filter((artifact) => artifact.name === operation.artifact.name).length, beforeCount + 1)
  assert.equal(afterFirst.revision, (before.revision ?? 0) + 1)
  const recorded = store.getSession(s.id)?.messages?.find((message) => message.id === carrier.id)
  assert.equal(recorded?.relationsResolved?.[key], 'confirmed')
  assert.equal(recorded?.relationDecisionIds?.[key], expectedId)

  const replay = await call(
    'POST',
    `/sessions/${s.id}/messages/${carrier.id}/relations`,
    { key, verdict: 'confirmed' },
    { 'idempotency-key': logicalKey },
  )
  assert.equal(replay.status, first.status)
  assert.deepEqual(replay.json, first.json, 'the same logical click replays its exact public acknowledgement')
  assert.equal(replay.headers['idempotency-replayed'], undefined, 'durable replay does not depend on the process-local response cache')
  assert.equal(store.relationGraph().revision, afterFirst.revision, 'replay cannot execute the effect twice')
  assert.equal(store.relationGraph().extraArtifacts.filter((artifact) => artifact.name === operation.artifact.name).length, beforeCount + 1)

  const afterRestart = await callFresh(
    'POST',
    `/sessions/${s.id}/messages/${carrier.id}/relations`,
    { key, verdict: 'confirmed' },
    { 'idempotency-key': logicalKey },
  )
  assert.equal(afterRestart.status, first.status)
  assert.deepEqual(afterRestart.json, first.json, 'the stored receipt replays after the route cache is rebuilt')
  assert.equal(store.relationGraph().revision, afterFirst.revision, 'post-restart replay cannot execute the effect twice')

  const redirected = await call(
    'POST',
    `/sessions/${s.id}/messages/${carrier.id}/relations`,
    { key, verdict: 'skipped' },
    { 'idempotency-key': logicalKey },
  )
  assert.equal(redirected.status, 400, 'one decision identity cannot be redirected to the opposite verdict')
  const legacyRedirect = await call(
    'POST',
    `/sessions/${s.id}/messages/${carrier.id}/relations`,
    { key, verdict: 'skipped' },
  )
  assert.equal(legacyRedirect.status, 400, 'an older unkeyed client cannot corrupt a durable receipt')
  assert.equal(store.getSession(s.id)?.messages?.find((message) => message.id === carrier.id)?.relationsResolved?.[key], 'confirmed')
  const secondClick = await call(
    'POST',
    `/sessions/${s.id}/messages/${carrier.id}/relations`,
    { key, verdict: 'confirmed' },
    { 'idempotency-key': `${logicalKey}-different` },
  )
  assert.equal(secondClick.status, 400, 'a terminal proposal cannot acquire a second receipt')
})

test('keyed relation decisions require an exact body and conversation-owner authority', async () => {
  const strict = store.createSession('strict relation decision')
  const strictOp: RelationOp = {
    kind: 'file-session',
    sessionId: strict.id,
    sessionTitle: strict.title,
    projectId: null,
    projectName: 'Unfiled',
  }
  const strictProposal = appendRelationProposal(strict.id, strictOp)
  const malformed = await call(
    'POST',
    `/sessions/${strict.id}/messages/${strictProposal.carrier.id}/relations`,
    { key: strictProposal.key, verdict: 'confirmed', operation: strictOp },
    { 'idempotency-key': `strict-${strict.id}` },
  )
  assert.equal(malformed.status, 400)
  assert.equal(store.getSession(strict.id)?.messages?.find((message) => message.id === strictProposal.carrier.id)?.relationsResolved, undefined)

  const shared = store.createSession('shared relation decision')
  const sharedOp: RelationOp = {
    kind: 'save-artifact',
    artifact: { name: `reader-${shared.id}.md`, kind: 'doc', meta: 'Document' },
    sessionId: shared.id,
    sessionTitle: shared.title,
  }
  const sharedProposal = appendRelationProposal(shared.id, sharedOp)
  const grant = store.createGrant(
    {
      subject: { kind: 'session', id: shared.id },
      audience: { kind: 'org', orgId: 'tenant-beta' },
      tier: 'co-own',
    },
    store.defaultTenantId(),
  )
  assert.equal(typeof grant, 'object')
  const beforeCount = store.relationGraph().extraArtifacts.filter((artifact) => artifact.name === sharedOp.artifact.name).length
  const reader = await call(
    'POST',
    `/sessions/${shared.id}/messages/${sharedProposal.carrier.id}/relations`,
    { key: sharedProposal.key, verdict: 'confirmed' },
    { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta', 'idempotency-key': `reader-${shared.id}` },
  )
  assert.equal(reader.status, 403, 'visibility never widens consent over the owner’s graph or context')
  assert.equal(store.relationGraph().extraArtifacts.filter((artifact) => artifact.name === sharedOp.artifact.name).length, beforeCount)
  assert.equal(store.getSession(shared.id)?.messages?.find((message) => message.id === sharedProposal.carrier.id)?.relationsResolved, undefined)
})

test('a keyed context confirmation commits the attachment, workspace panel, verdict, and receipt together', async () => {
  const s = store.createSession('atomic context attachment')
  const operation: RelationOp = {
    kind: 'attach-context',
    sessionTitle: s.title,
    connectorId: 'slack',
    connectorLabel: 'Slack',
    connectorKind: 'connector',
  }
  const { carrier, key } = appendRelationProposal(s.id, operation)
  const logicalKey = `attach-${s.id}`
  const expectedId = relationActionDecisionId(store.defaultTenantId(), s.id, carrier.id, key, logicalKey)
  const response = await call(
    'POST',
    `/sessions/${s.id}/messages/${carrier.id}/relations`,
    { key, verdict: 'confirmed' },
    { 'idempotency-key': logicalKey },
  )
  assert.deepEqual(response.json, { key, verdict: 'confirmed', decisionId: expectedId })
  assert.equal(store.sessionContexts(s.id).filter((context) => context.id === 'slack').length, 1)
  assert.equal(store.sessionWorkspace(s.id).connectors.filter((connector) => connector.id === 'slack').length, 1)
  const recorded = store.getSession(s.id)?.messages?.find((message) => message.id === carrier.id)
  assert.equal(recorded?.relationsResolved?.[key], 'confirmed')
  assert.equal(recorded?.relationDecisionIds?.[key], expectedId)
})

test('keyed Not now executes no effect, while an effect conflict leaves the proposal open', async () => {
  const skipped = store.createSession('atomic relation skip')
  const skippedOp: RelationOp = {
    kind: 'save-artifact',
    artifact: { name: `skipped-${skipped.id}.md`, kind: 'doc', meta: 'Document' },
    sessionId: skipped.id,
    sessionTitle: skipped.title,
  }
  const skippedProposal = appendRelationProposal(skipped.id, skippedOp)
  const beforeSkip = store.relationGraph()
  const skip = await call(
    'POST',
    `/sessions/${skipped.id}/messages/${skippedProposal.carrier.id}/relations`,
    { key: skippedProposal.key, verdict: 'skipped' },
    { 'idempotency-key': `skip-${skipped.id}` },
  )
  assert.equal(skip.status, 200)
  assert.equal(store.relationGraph().revision, beforeSkip.revision, 'Not now records consent history without touching the graph')
  assert.equal(store.relationGraph().extraArtifacts.some((artifact) => artifact.name === skippedOp.artifact.name), false)

  const projectId = `p-relation-conflict-${skipped.id}`
  store.applyRelationOp({
    kind: 'create-project',
    projectId,
    projectName: 'Relation conflict target',
    projectDescription: 'Reviewed text',
  })
  const conflicted = store.createSession('atomic relation conflict')
  const conflictedOp: RelationOp = {
    kind: 'set-project-description',
    projectId,
    projectName: 'Relation conflict target',
    description: 'Proposed text',
    expectedDescription: 'Reviewed text',
  }
  const conflictedProposal = appendRelationProposal(conflicted.id, conflictedOp)
  store.applyRelationOp({ ...conflictedOp, description: 'Newer text', expectedDescription: 'Reviewed text' })
  const conflict = await call(
    'POST',
    `/sessions/${conflicted.id}/messages/${conflictedProposal.carrier.id}/relations`,
    { key: conflictedProposal.key, verdict: 'confirmed' },
    { 'idempotency-key': `conflict-${conflicted.id}` },
  )
  assert.equal(conflict.status, 409)
  assert.equal(store.relationGraph().projectDescriptions[projectId], 'Newer text')
  const carrier = store.getSession(conflicted.id)?.messages?.find((message) => message.id === conflictedProposal.carrier.id)
  assert.equal(carrier?.relationsResolved, undefined, 'a refused effect cannot manufacture a terminal verdict')
  assert.equal(carrier?.relationDecisionIds, undefined, 'nor can it mint a replay receipt')
})
