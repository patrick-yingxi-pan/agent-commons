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
import { startModelServer } from '../server/model/index.ts'
import { store } from '../server/store.ts'
import { executeTool, TOOL_NAMES, type ToolContext } from '../server/model/tools.ts'
import { opKey } from '../contract/index.ts'
import { call, callRaw } from './helpers/http.ts'

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
  { tool: 'save_artifact', input: { name: 'n.md', project: 'Vibe Coding Guide' }, expect: (op) => assert.equal(op.projectId, 'p-vibe-coding-guide') },
  { tool: 'refile_artifact', input: { artifact: 'vibe-outline.md', project: 'Vibe Coding Guide' }, expect: (op) => assert.equal(op.artifactId, 'art-x') },
  { tool: 'scope_context', input: { connector: 'Figma', project: 'Vibe Coding Guide' }, expect: (op) => assert.equal(op.projectId, 'p-vibe-coding-guide') },
  { tool: 'unscope_context', input: { context: 'Figma', project: 'Vibe Coding Guide' }, expect: (op) => assert.equal(op.projectId, 'p-vibe-coding-guide') },
  { tool: 'set_project_instructions', input: { project: 'Vibe Coding Guide', instructions: 'x' }, expect: (op) => assert.equal(op.projectId, 'p-vibe-coding-guide') },
  { tool: 'set_project_readme', input: { project: 'Vibe Coding Guide', readme: 'x' }, expect: (op) => assert.equal(op.projectId, 'p-vibe-coding-guide') },
  { tool: 'link_schedule_project', input: { schedule: 'Nightly vibe digest', project: 'Vibe Coding Guide' }, expect: (op) => assert.equal(op.scheduleId, 'sch-x') },
  { tool: 'set_artifact_source', input: { artifact: 'vibe-outline.md', context: 'kit/' }, expect: (op) => assert.equal(op.artifactId, 'art-x') },
  { tool: 'set_schedule_session', input: { schedule: 'Nightly vibe digest' }, expect: (op) => assert.equal(op.scheduleId, 'sch-x') },
  { tool: 'set_schedule_artifact', input: { schedule: 'Nightly vibe digest', artifact: 'd.md' }, expect: (op) => assert.equal(op.scheduleId, 'sch-x') },
  { tool: 'schedule_add_tool', input: { schedule: 'Nightly vibe digest', tool: 'Slack' }, expect: (op) => assert.equal(op.scheduleId, 'sch-x') },
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
  { tool: 'save_artifact', input: { name: 'n.md', project: 'No Such Project' } },
  { tool: 'refile_artifact', input: { artifact: 'no-such.md', project: 'Vibe Coding Guide' } },
  { tool: 'refile_artifact', input: { artifact: 'vibe-outline.md', project: 'No Such Project' } },
  { tool: 'scope_context', input: { connector: 'Figma', project: 'No Such Project' } },
  { tool: 'unscope_context', input: { context: 'Figma', project: 'No Such Project' } },
  { tool: 'set_project_instructions', input: { project: 'No Such Project', instructions: 'x' } },
  { tool: 'set_project_readme', input: { project: 'No Such Project', readme: 'x' } },
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
  await new Promise<void>((r) => server.on('listening', () => r()))
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

// ── I3 — the consent card's verdict persists on the message record ────────────
test('the verdict route stamps relationsResolved on the message; it survives a re-read (I3)', async () => {
  const s = store.createSession('verdict persistence')
  await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'Save the recap of this as verdict-recap.md' })
  const thread = (await call('GET', `/sessions/${s.id}`)).json.messages ?? []
  const carrier = thread.find((m: { relationActions?: unknown[] }) => (m.relationActions ?? []).length > 0)
  assert.ok(carrier, 'the save proposal persisted on its message')
  const key = opKey(carrier.relationActions[0])

  const ok = await call('POST', `/sessions/${s.id}/messages/${carrier.id}/relations`, { key, verdict: 'confirmed' })
  assert.equal(ok.status, 200)
  const reread = (await call('GET', `/sessions/${s.id}`)).json.messages.find((m: { id: string }) => m.id === carrier.id)
  assert.equal(reread.relationsResolved[key], 'confirmed', 'the verdict is on the record, not in component state')

  // A skip is a verdict too (the "Not now" that once evaporated on reload).
  const skip = await call('POST', `/sessions/${s.id}/messages/${carrier.id}/relations`, { key, verdict: 'skipped' })
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
