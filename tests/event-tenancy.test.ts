/** The ambient-event fabric's tenancy + emission fixes from the at-HEAD review of the
 *  2026-07 commit range:
 *   - `run.*` events once fell through eventVisibleToTenant's global default, leaking
 *     every tenant's routine names + delivery summaries to every SSE stream (C31).
 *     They now gate on the owning routine, like the schedules read itself.
 *   - Schedule create/edit/pause/remove emitted NO event — another client's rail and
 *     Scheduled page stayed stale until reload (C13). `schedule.changed` now rides
 *     every mutator, stamped with the owning tenant.
 *   - Commission create/re-grant/delete emitted nothing — a cross-tenant Contributor
 *     arriving on a shared project (P8) was invisible to the owner (S2/C21).
 *     `commission.changed` mirrors the project's visibility, like openwork.changed.
 *   - The D25 proposal lifecycle rang bells but never refreshed the review queue —
 *     the bell's door opened a stale dialog (C17/C28/C33). `proposal.changed` now
 *     reaches exactly the two parties.
 *   - The Contexts page's add/remove was component state that evaporated (N1) —
 *     `savedcontext.changed` now broadcasts the server-owned mutation. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import type { ServerEvent } from '../contract/index.ts'

const OWNER = 'tenant-evt-owner'
const OTHER = 'tenant-evt-other'

/** Collect the events one synchronous store call emits. */
function emitted(act: () => void): ServerEvent[] {
  const out: ServerEvent[] = []
  const unsub = store.subscribe((e) => out.push(e))
  try {
    act()
  } finally {
    unsub()
  }
  return out
}

const scheduleSeed = (tenantId?: string) => {
  const base = store.listSchedules()[0]
  return { ...structuredClone(base), name: 'Evt test routine', runs: [], tenantId }
}

test('run.* events are gated to the owning routine’s tenant — no cross-tenant routine leak', () => {
  const task = store.addSchedule(scheduleSeed(OWNER))
  const run = { id: 'r1', status: 'running', duration: '—', reachedStep: 0, summary: 's', at: 1 } as never
  for (const e of [
    { type: 'run.started', taskId: task.id, taskName: task.name, sessionId: 's', run },
    { type: 'run.progress', taskId: task.id, runId: 'r1', reachedStep: 1, status: 'running' },
    { type: 'run.finished', taskId: task.id, taskName: task.name, sessionId: 's', run },
  ] as ServerEvent[]) {
    assert.equal(store.eventVisibleToTenant(e, OWNER), true, `${e.type} reaches the owner`)
    assert.equal(store.eventVisibleToTenant(e, OTHER), false, `${e.type} never reaches a foreign tenant`)
  }
  // An unresolvable task id falls back to the flagship rule (default tenant), the
  // same fallback the session.contexts.changed gate uses.
  const gone = { type: 'run.progress', taskId: 'no-such-task', runId: 'r', reachedStep: 1, status: 'running' } as ServerEvent
  assert.equal(store.eventVisibleToTenant(gone, 'tenant-personal'), true)
  assert.equal(store.eventVisibleToTenant(gone, OTHER), false)
  store.removeSchedule(task.id)
})

test('every schedule mutator emits schedule.changed, stamped with the owning tenant', () => {
  let task: ReturnType<typeof store.addSchedule>
  const onAdd = emitted(() => {
    task = store.addSchedule(scheduleSeed(OWNER))
  })
  assert.ok(
    onAdd.some((e) => e.type === 'schedule.changed' && e.taskId === task!.id && e.tenantId === OWNER),
    'addSchedule broadcasts',
  )
  const onToggle = emitted(() => store.setScheduleEnabled(task!.id, false))
  assert.ok(onToggle.some((e) => e.type === 'schedule.changed' && e.taskId === task!.id), 'setScheduleEnabled broadcasts')
  const onPatch = emitted(() => store.updateSchedule(task!.id, { name: 'renamed' }))
  assert.ok(onPatch.some((e) => e.type === 'schedule.changed' && e.taskId === task!.id), 'updateSchedule broadcasts')
  const onRemove = emitted(() => store.removeSchedule(task!.id))
  assert.ok(
    onRemove.some((e) => e.type === 'schedule.changed' && e.taskId === task!.id && e.tenantId === OWNER),
    'removeSchedule broadcasts, stamped from the removed row (the gate can no longer resolve the id)',
  )
  // The gate: stamped ⇒ owner-only; unstamped ⇒ the flagship seeds.
  const stamped = { type: 'schedule.changed', taskId: 't', tenantId: OWNER } as ServerEvent
  assert.equal(store.eventVisibleToTenant(stamped, OWNER), true)
  assert.equal(store.eventVisibleToTenant(stamped, OTHER), false)
  const unstamped = { type: 'schedule.changed', taskId: 't' } as ServerEvent
  assert.equal(store.eventVisibleToTenant(unstamped, 'tenant-personal'), true)
  assert.equal(store.eventVisibleToTenant(unstamped, OTHER), false)
})

test('commission mutators emit commission.changed; visibility mirrors the Project’s (the openwork rule)', () => {
  let commission: ReturnType<typeof store.createCommission>
  const onCreate = emitted(() => {
    commission = store.createCommission({ role: 'writer', agentId: 'agent-default', projectId: 'p-insights' })
  })
  assert.ok(
    onCreate.some((e) => e.type === 'commission.changed' && e.projectId === 'p-insights'),
    'createCommission broadcasts the roster change',
  )
  const onPatch = emitted(() => store.updateCommission(commission!.id, { role: 'reader' }))
  assert.ok(onPatch.some((e) => e.type === 'commission.changed' && e.projectId === 'p-insights'), 'updateCommission broadcasts')
  const onDelete = emitted(() => store.deleteCommission(commission!.id))
  assert.ok(onDelete.some((e) => e.type === 'commission.changed' && e.projectId === 'p-insights'), 'deleteCommission broadcasts')

  // Gate: an unknown project falls back to the flagship rule; a seed (unshared,
  // unstamped) project follows it too — and never reaches an unrelated tenant.
  const onSeed = { type: 'commission.changed', projectId: 'p-insights' } as ServerEvent
  assert.equal(store.eventVisibleToTenant(onSeed, 'tenant-personal'), true)
  assert.equal(store.eventVisibleToTenant(onSeed, OTHER), false)
})

test('the D25 proposal lifecycle emits proposal.changed to exactly its two parties', async () => {
  const agent = store.createAgent(
    { label: 'Evt evolvable', systemPrompt: 'v1', tools: [], instructions: '' },
    OWNER,
  )
  store.updateAgentFromRequest(agent.id, { published: true })
  let pid = ''
  const onOpen = emitted(() => {
    const p = store.proposeAgentChange(agent.id, { fields: { systemPrompt: 'v2' } }, OTHER)
    pid = (p as { id: string }).id
  })
  const openEvt = onOpen.find((e) => e.type === 'proposal.changed')
  assert.ok(openEvt && openEvt.type === 'proposal.changed', 'proposeAgentChange broadcasts')
  assert.equal(openEvt.agentId, agent.id)
  assert.equal(store.eventVisibleToTenant(openEvt, OWNER), true, 'the owner’s stream gets it')
  assert.equal(store.eventVisibleToTenant(openEvt, OTHER), true, 'the proposer’s stream gets it')
  assert.equal(store.eventVisibleToTenant(openEvt, 'tenant-bystander'), false, 'a bystander’s never does')

  const onComment = emitted(() => store.commentOnAgentProposal(agent.id, pid, 'why this?', OWNER))
  assert.ok(onComment.some((e) => e.type === 'proposal.changed' && e.agentId === agent.id), 'a comment broadcasts')
  const onVerdict = emitted(() => store.resolveAgentProposal(agent.id, pid, OWNER, 'merge'))
  assert.ok(onVerdict.some((e) => e.type === 'proposal.changed' && e.agentId === agent.id), 'the verdict broadcasts')
})

test('saved-context add/remove are server-owned mutations that broadcast (the Contexts page’s Add/Remove)', () => {
  const row = {
    id: 'evt-test-ctx',
    label: 'Evt test connector',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'test',
    lastUsedAt: 1,
    sessions: 0,
  } as never
  const onAdd = emitted(() => store.addSavedContext(row))
  assert.ok(onAdd.some((e) => e.type === 'savedcontext.changed' && e.id === 'evt-test-ctx'), 'add broadcasts')
  assert.ok(store.savedContexts().contexts.some((c) => c.id === 'evt-test-ctx'), 'the registry holds it')
  // Idempotent by id — a re-add returns the existing row and does not duplicate.
  store.addSavedContext(row)
  assert.equal(store.savedContexts().contexts.filter((c) => c.id === 'evt-test-ctx').length, 1)
  const onRemove = emitted(() => assert.equal(store.removeSavedContext('evt-test-ctx'), true))
  assert.ok(onRemove.some((e) => e.type === 'savedcontext.changed' && e.id === 'evt-test-ctx'), 'remove broadcasts')
  assert.ok(!store.savedContexts().contexts.some((c) => c.id === 'evt-test-ctx'), 'the registry drops it')
  assert.equal(store.removeSavedContext('evt-test-ctx'), false, 'a second remove reports unknown (→ 404)')
})
