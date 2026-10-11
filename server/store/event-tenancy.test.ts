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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { store } from './index.ts'
import { ConflictError } from '../conflict.ts'
import type { ServerEvent } from '../../contract/index.ts'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

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

test('Contexts setup and recents events are stamped and delivered only to their viewer tenant', () => {
  const id = 'evt-private-context'
  const onAdd = emitted(() => store.addSavedContext({
    id,
    label: 'Private context',
    kind: 'connector',
    status: 'connected',
    detail: 'private',
    lastUsedAt: null,
    sessions: 0,
  }, OWNER))
  const added = onAdd.find((event) => event.type === 'savedcontext.changed')
  assert.ok(added?.type === 'savedcontext.changed')
  assert.equal(added.tenantId, OWNER)
  assert.equal(store.eventVisibleToTenant(added, OWNER), true)
  assert.equal(store.eventVisibleToTenant(added, OTHER), false)

  const onStatus = emitted(() => store.setConnectorStatus(id, 'needs-auth', OWNER))
  const status = onStatus.find((event) => event.type === 'connector.status')
  assert.ok(status?.type === 'connector.status')
  assert.equal(status.tenantId, OWNER)
  assert.equal(store.eventVisibleToTenant(status, OTHER), false)
  const revision = store.savedContexts(OWNER).contexts.find((context) => context.id === id)?.connectionRevision
  assert.equal(revision, 1)
  const onStatusReplay = emitted(() => store.setConnectorStatus(id, 'needs-auth', OWNER, 0))
  assert.ok(!onStatusReplay.some((event) => event.type === 'connector.status'), 'a converged replay emits no duplicate change')
  assert.equal(store.savedContexts(OWNER).contexts.find((context) => context.id === id)?.connectionRevision, 1)

  const onRecent = emitted(() => store.pushRecent('connector', id, OWNER))
  const recent = onRecent.find((event) => event.type === 'recents.changed')
  assert.ok(recent?.type === 'recents.changed')
  assert.equal(recent.tenantId, OWNER)
  assert.equal(store.eventVisibleToTenant(recent, OWNER), true)
  assert.equal(store.eventVisibleToTenant(recent, OTHER), false)

  const onStaleRemove = emitted(() => {
    assert.throws(() => store.removeSavedContext(id, OWNER, 0), ConflictError)
  })
  assert.ok(!onStaleRemove.some((event) => event.type === 'savedcontext.changed'), 'a stale removal emits nothing')
  assert.ok(store.savedContexts(OWNER).contexts.some((context) => context.id === id), 'a stale removal persists nothing')

  const onRemove = emitted(() => store.removeSavedContext(id, OWNER, 1))
  const removed = onRemove.find((event) => event.type === 'savedcontext.changed')
  assert.ok(removed?.type === 'savedcontext.changed')
  assert.equal(removed.tenantId, OWNER, 'delete remains gateable after its row is gone')
  assert.equal(store.eventVisibleToTenant(removed, OTHER), false)
})

test('Watch emits only on a real transition and stays private to its viewer tenant', () => {
  const subject = { kind: 'project', id: 'evt-watch-subject' } as const
  store.setWatch(subject, OWNER, false)
  const changed = emitted(() => store.setWatch(subject, OWNER, true))
  const event = changed.find((candidate) => candidate.type === 'watch.changed')
  assert.ok(event?.type === 'watch.changed')
  assert.equal(event.tenantId, OWNER)
  assert.deepEqual(event.subject, subject)
  assert.equal(store.eventVisibleToTenant(event, OWNER), true)
  assert.equal(store.eventVisibleToTenant(event, OTHER), false, 'the private subject never reaches another stream')

  const replay = emitted(() => store.setWatch(subject, OWNER, true))
  assert.equal(replay.some((candidate) => candidate.type === 'watch.changed'), false)
  store.setWatch(subject, OWNER, false)
})

test('DM read cursors emit only on advancement and stay private to the reader', () => {
  const reader = 'tenant-acme'
  const otherParty = 'tenant-beta'
  const thread = store.openDiscussion({
    anchor: { ref: { kind: 'principal', id: 'Ada Lovelace' } },
    firstPost: `private read event ${Date.now()}`,
  }, otherParty)
  assert.ok(thread && typeof thread === 'object')
  const target = thread.posts[thread.posts.length - 1]!

  const changed = emitted(() => { store.markDiscussionRead(thread.id, reader, target.id) })
  const event = changed.find((candidate) => candidate.type === 'discussion-reads.changed')
  assert.ok(event?.type === 'discussion-reads.changed')
  assert.equal(event.tenantId, reader)
  assert.equal(store.eventVisibleToTenant(event, reader), true)
  assert.equal(store.eventVisibleToTenant(event, otherParty), false, 'the other party receives no read receipt')
  assert.equal(store.eventVisibleToTenant(event, OTHER), false)

  const replay = emitted(() => { store.markDiscussionRead(thread.id, reader, target.id) })
  assert.equal(replay.some((candidate) => candidate.type === 'discussion-reads.changed'), false)
})

test('Commons Like emits only on a transition and mirrors its subject wall', () => {
  const reader = 'tenant-beta'
  const subject = { kind: 'project', id: 'evt-like-project' } as const
  store.applyRelationOp({
    kind: 'create-project',
    projectId: subject.id,
    projectName: 'Event Like Project',
    projectDescription: 'Visible to one invited reader.',
  }, OWNER)
  const grant = store.createGrant({
    subject,
    audience: { kind: 'org', orgId: reader },
    tier: 'view',
    note: 'Like event fixture.',
  }, OWNER)
  assert.ok(grant && typeof grant === 'object')
  const itemId = `share:${grant.id}`

  const changed = emitted(() => { store.setCommonsLike(itemId, reader, true) })
  const event = changed.find((candidate) => candidate.type === 'commons-like.changed')
  assert.ok(event?.type === 'commons-like.changed')
  assert.equal(event.itemId, itemId)
  assert.deepEqual(event.subject, subject)
  assert.equal(store.eventVisibleToTenant(event, OWNER), true, 'the owner sees the public count move')
  assert.equal(store.eventVisibleToTenant(event, reader), true, 'the granted reader sees their membership move')
  assert.equal(store.eventVisibleToTenant(event, OTHER), false, 'the private item id never crosses its wall')

  const replay = emitted(() => { store.setCommonsLike(itemId, reader, true) })
  assert.equal(replay.some((candidate) => candidate.type === 'commons-like.changed'), false)
  store.setCommonsLike(itemId, reader, false)
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
  const currentRevision = task!.revision ?? 0
  const onStaleRemove = emitted(() => {
    assert.throws(() => store.removeSchedule(task!.id, currentRevision - 1), ConflictError)
  })
  assert.deepEqual(onStaleRemove, [], 'a stale routine removal publishes no invalidation')
  assert.ok(store.listSchedules().some((candidate) => candidate.id === task!.id), 'a stale removal keeps the row')

  const onRemove = emitted(() => store.removeSchedule(task!.id, currentRevision))
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

test('Agent events keep private rows owner-only and directory invalidations free of raw owner ids', () => {
  let agent: ReturnType<typeof store.createAgent>
  const onCreate = emitted(() => {
    agent = store.createAgent(
      { label: 'Private event Agent', systemPrompt: 'x', tools: [], instructions: '' },
      OWNER,
    )
  })
  const privateEvent = onCreate.find((event) => event.type === 'agent.changed')
  assert.ok(privateEvent?.type === 'agent.changed')
  assert.equal(privateEvent.scope, 'owner')
  assert.equal(privateEvent.tenantId, OWNER)
  assert.equal(store.eventVisibleToTenant(privateEvent, OWNER), true)
  assert.equal(store.eventVisibleToTenant(privateEvent, OTHER), false)

  const onPublish = emitted(() => store.updateAgentFromRequest(agent!.id, { published: true }))
  const directoryEvent = onPublish.find((event) => event.type === 'agent.changed')
  assert.ok(directoryEvent?.type === 'agent.changed')
  assert.equal(directoryEvent.scope, 'directory')
  assert.equal(directoryEvent.tenantId, undefined, 'a public event carries no raw owner tenant id')
  assert.equal(store.eventVisibleToTenant(directoryEvent, OWNER), true)
  assert.equal(store.eventVisibleToTenant(directoryEvent, OTHER), true)

  const onUnpublish = emitted(() => store.updateAgentFromRequest(agent!.id, { published: false }))
  assert.ok(
    onUnpublish.some((event) => event.type === 'agent.changed' && event.scope === 'directory'),
    'removing a public face still refreshes every directory reader',
  )
  store.deleteAgent(agent!.id)

  let sharedAgent: ReturnType<typeof store.createAgent>
  const onSharedCreate = emitted(() => {
    sharedAgent = store.createAgent({ label: 'Shared event Agent', systemPrompt: 'x', tools: [], instructions: '' })
  })
  const sharedEvent = onSharedCreate.find((event) => event.type === 'agent.changed')
  assert.ok(sharedEvent?.type === 'agent.changed')
  assert.equal(sharedEvent.scope, 'owner')
  assert.equal(sharedEvent.tenantId, undefined)
  assert.equal(
    store.eventVisibleToTenant(sharedEvent, OTHER),
    true,
    'unstamped registry infrastructure follows registryVisible and refreshes every tenant',
  )
  store.deleteAgent(sharedAgent!.id)
})

test('provider events keep private rows and default pointers tenant-scoped while shared infrastructure reaches all readers', () => {
  let provider: ReturnType<typeof store.createProvider>
  const onCreate = emitted(() => {
    provider = store.createProvider(
      { label: 'Private event provider', modelFamily: 'claude', effortLevels: ['Low'] },
      {},
      OWNER,
    )
  })
  const privateEvent = onCreate.find((event) => event.type === 'provider.changed')
  assert.ok(privateEvent?.type === 'provider.changed')
  assert.equal(privateEvent.tenantId, OWNER)
  assert.equal(store.eventVisibleToTenant(privateEvent, OWNER), true)
  assert.equal(store.eventVisibleToTenant(privateEvent, OTHER), false)

  const onDefinition = emitted(() => store.updateProvider(provider!.id, { label: 'Renamed provider' }, 0))
  assert.ok(onDefinition.some((event) => event.type === 'provider.changed' && event.providerId === provider!.id))
  const onConnection = emitted(() => store.replaceProviderConnection(provider!.id, { model: 'new-model' }, undefined, 0))
  assert.ok(onConnection.some((event) => event.type === 'provider.changed' && event.providerId === provider!.id))

  const onDefault = emitted(() => store.setDefaultProvider(provider!.id, OWNER))
  const defaultEvent = onDefault.find((event) => event.type === 'provider.changed')
  assert.ok(defaultEvent?.type === 'provider.changed')
  assert.equal(defaultEvent.tenantId, OWNER, 'a viewer-relative pointer never broadcasts through a shared row')
  assert.equal(store.eventVisibleToTenant(defaultEvent, OTHER), false)

  const onDelete = emitted(() => store.deleteProvider(provider!.id))
  assert.ok(onDelete.some((event) => event.type === 'provider.changed' && event.tenantId === OWNER))

  let shared: ReturnType<typeof store.createProvider>
  const onShared = emitted(() => {
    shared = store.createProvider({ label: 'Shared event provider', modelFamily: 'claude', effortLevels: ['Low'] })
  })
  const sharedEvent = onShared.find((event) => event.type === 'provider.changed')
  assert.ok(sharedEvent?.type === 'provider.changed')
  assert.equal(sharedEvent.tenantId, undefined)
  assert.equal(store.eventVisibleToTenant(sharedEvent, OWNER), true)
  assert.equal(store.eventVisibleToTenant(sharedEvent, OTHER), true)
  store.deleteProvider(shared!.id)
})

test('system-prompt events keep private rows and default pointers tenant-scoped while shared infrastructure reaches all readers', () => {
  let prompt: ReturnType<typeof store.createSystemPrompt>
  const onCreate = emitted(() => {
    prompt = store.createSystemPrompt(
      { label: 'Private event prompt', body: 'Private body.', targetFamily: 'claude' },
      OWNER,
    )
  })
  const privateEvent = onCreate.find((event) => event.type === 'systemprompt.changed')
  assert.ok(privateEvent?.type === 'systemprompt.changed')
  assert.equal(privateEvent.tenantId, OWNER)
  assert.equal(store.eventVisibleToTenant(privateEvent, OWNER), true)
  assert.equal(store.eventVisibleToTenant(privateEvent, OTHER), false)

  const onDefinition = emitted(() => store.updateSystemPrompt(prompt!.id, { label: 'Renamed prompt' }, 0))
  assert.ok(onDefinition.some((event) => event.type === 'systemprompt.changed' && event.systemPromptId === prompt!.id))

  const onDefault = emitted(() => store.setDefaultSystemPrompt(prompt!.id, OWNER))
  const defaultEvent = onDefault.find((event) => event.type === 'systemprompt.changed')
  assert.ok(defaultEvent?.type === 'systemprompt.changed')
  assert.equal(defaultEvent.tenantId, OWNER, 'a viewer-relative pointer never broadcasts through a shared row')
  assert.equal(store.eventVisibleToTenant(defaultEvent, OTHER), false)

  const onDelete = emitted(() => store.deleteSystemPrompt(prompt!.id))
  assert.ok(onDelete.some((event) => event.type === 'systemprompt.changed' && event.tenantId === OWNER))

  let shared: ReturnType<typeof store.createSystemPrompt>
  const onShared = emitted(() => {
    shared = store.createSystemPrompt({ label: 'Shared event prompt', body: 'Shared body.', targetFamily: 'claude' })
  })
  const sharedEvent = onShared.find((event) => event.type === 'systemprompt.changed')
  assert.ok(sharedEvent?.type === 'systemprompt.changed')
  assert.equal(sharedEvent.tenantId, undefined)
  assert.equal(store.eventVisibleToTenant(sharedEvent, OWNER), true)
  assert.equal(store.eventVisibleToTenant(sharedEvent, OTHER), true)
  store.deleteSystemPrompt(shared!.id)
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
  const onNoop = emitted(() => store.updateCommission(commission!.id, { role: 'reader' }))
  assert.equal(onNoop.some((e) => e.type === 'commission.changed'), false, 'an effective no-op invents no event')
  emitted(() => store.updateCommission(commission!.id, { authority: { connectors: ['Linear', 'Figma'] } }))
  const revision = store.getCommission(commission!.id)?.configurationRevision
  const onReorderedGrant = emitted(() =>
    store.updateCommission(commission!.id, { authority: { connectors: ['Figma', 'Linear'] } }),
  )
  assert.equal(onReorderedGrant.some((e) => e.type === 'commission.changed'), false, 'set order is not a grant change')
  assert.equal(store.getCommission(commission!.id)?.configurationRevision, revision)
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
    const p = store.proposeAgentChange(agent.id, { fields: { systemPrompt: 'v2' } }, OTHER, undefined)
    pid = (p as { id: string }).id
  })
  const openEvt = onOpen.find((e) => e.type === 'proposal.changed')
  assert.ok(openEvt && openEvt.type === 'proposal.changed', 'proposeAgentChange broadcasts')
  assert.equal(openEvt.agentId, agent.id)
  assert.equal(store.eventVisibleToTenant(openEvt, OWNER), true, 'the owner’s stream gets it')
  assert.equal(store.eventVisibleToTenant(openEvt, OTHER), true, 'the proposer’s stream gets it')
  assert.equal(store.eventVisibleToTenant(openEvt, 'tenant-bystander'), false, 'a bystander’s never does')

  const onComment = emitted(() => store.commentOnAgentProposal(agent.id, pid, 'why this?', OWNER, undefined))
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

/** ── The gate is TOTAL over the event union (earned 2026-08-07) ──────────────
 *  `eventVisibleToTenant` is a switch ending in `default: return true`, so an
 *  event type with no arm is not a compile error — it is a silent BROADCAST to
 *  every open stream. That has now happened twice: `reservation.changed` leaked
 *  a private project's claim name (the C31 comment in store.ts records it), and
 *  S7's `follow.changed` shipped carrying two RAW tenant ids to every
 *  subscriber before review caught it.
 *
 *  So enumerate rather than remember: every `type:` literal declared in
 *  contract/events.ts must either have a `case` in the gate or be named below
 *  as deliberately global, with the reason. A new event forces that choice.
 *
 *  Source-scanned on purpose — the union is types-only, so there is no runtime
 *  array to iterate, and a hand-kept second list is the drift this prevents. */
test('every ServerEvent type is gated or explicitly declared global', () => {
  const events = readFileSync(join(ROOT, 'contract', 'events.ts'), 'utf8')
  const store = readFileSync(join(ROOT, 'server', 'store', 'index.ts'), 'utf8')

  // The union's members, from their discriminant literals.
  const declared = [...new Set([...events.matchAll(/^\s*type:\s*'([\w.-]+)'/gm)].map((m) => m[1]))]
  assert.ok(declared.length > 20, `found the event union (${declared.length} types) — the scan is not vacuous`)

  // The gate's arms. Bounded to the function so an unrelated switch elsewhere
  // in the file cannot make a missing arm look present.
  const start = store.indexOf('eventVisibleToTenant(e: ServerEvent, tenantId: string, actorUserId?: string): boolean {')
  assert.ok(start > 0, 'the gate exists in store.ts')
  const body = store.slice(start, store.indexOf('\n  },', start))
  const gated = new Set([...body.matchAll(/case '([\w.-]+)':/g)].map((m) => m[1]))

  /** Deliberately global: events that carry NO tenant-identifiable payload, so
   *  broadcasting them tells a subscriber nothing it could not already ask for.
   *  Adding a name here is a claim about that event's payload — check it. */
  const GLOBAL = new Set([
    'hello',
    'message.start', 'message.delta', 'message.relations', 'message.escalation',
    'message.toolActivity', 'message.end',
    'runner.connected', 'runner.disconnected', 'runner.capabilities.changed', 'runner.effect',
    'relay.connected', 'relay.disconnected', 'relay.activity',
    'dispatch.changed', 'notification.changed', 'session.contexts.changed',
  ])

  const ungoverned = declared.filter((t) => !gated.has(t) && !GLOBAL.has(t))
  assert.deepEqual(
    ungoverned,
    [],
    `these event types reach the gate's \`default: return true\` and broadcast to EVERY stream — add a case in eventVisibleToTenant, or name them GLOBAL here with the reason: ${ungoverned.join(', ')}`,
  )
})
