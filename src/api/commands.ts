/** ── Commands ──────────────────────────────────────────────────────────────
 *  The UI's writes. Reads come back through hooks + the cache; writes go here.
 *  Phase 3 starts with the streaming send — the one command whose response is
 *  itself a stream (the assistant turn), mirroring the Anthropic Messages API. */
import {
  applyGraphOp,
  emptyGraph,
  entryById,
  type ApplyOpRequest,
  type AttachContextRequest,
  type CapabilityEffect,
  type CapabilityRequest,
  type Agent,
  type Commission,
  type CreateAgentRequest,
  type UpdateAgentRequest,
  type CreateCommissionRequest,
  type UpdateCommissionRequest,
  type CreateProviderRequest,
  type CreatedProvider,
  type ModelProvider,
  type UpdateProviderRequest,
  type CreateSystemPromptRequest,
  type SystemPromptEntry,
  type UpdateSystemPromptRequest,
  type AgentChangeProposal,
  type AppNotification,
  type OpenSubGoal,
  type ProposeAgentChangeRequest,
  type WatchState,
  type PostOpenSubGoalRequest,
  type PromptProbeRequest,
  type PromptProbeResult,
  type ReserveSubGoalRequest,
  type ContextStatus,
  type ContextTypeId,
  type EffectReport,
  type SyncEffectsResult,
  type PushRecentRequest,
  type RecentsSnapshot,
  type RelationGraph,
  type RelationOp,
  type Reservation,
  type ResourceStatus,
  type ReplyStreamEvent,
  type RunSessionEntry,
  type SavedContextsSnapshot,
  type CreateDispatchRequest,
  type ScheduledTask,
  type SendMessageRequest,
  type SetConnectorStatusRequest,
  type Session,
  type SessionContext,
  type SessionWorkspace,
  type ToolActivity,
  type UpdateScheduleRequest,
} from '../../contract/index.ts'
import { API_BASE, apiDelete, apiGet, apiPatch, apiPost } from './client.ts'
import { invalidate, invalidatePrefix, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { invalidateForCommonsOp } from './commonsInvalidation.ts'
import { OPTIMISTIC_ID_PREFIX } from './ids.ts'

/** Callbacks for a streamed assistant turn. Each fires as its event arrives. */
export interface SendHandlers {
  /** The (empty) assistant message shell — append it, then fill via deltas.
   *  `turnId` is the server-owned turn handle (cancel / reattach); absent only
   *  from pre-turn-registry servers. */
  onStart?: (messageId: string, message: Extract<ReplyStreamEvent, { type: 'message.start' }>['message'], turnId?: string) => void
  /** A chunk of assistant text to append to the message. */
  onDelta?: (messageId: string, text: string) => void
  /** A mid-turn relation proposal (render the confirm card). */
  onRelations?: (messageId: string, relationActions: Extract<ReplyStreamEvent, { type: 'message.relations' }>['relationActions']) => void
  /** A mid-turn escalation proposal (open_workspace / connect_repo / create_project)
   *  — render the consent prompt; apply on approval. */
  onEscalation?: (messageId: string, escalation: Extract<ReplyStreamEvent, { type: 'message.escalation' }>['escalation']) => void
  /** Mid-turn connector/MCP tool activity (P6) — the tools the model called + their
   *  (mock) results; render the activity card (a read needs no consent). */
  onToolActivity?: (messageId: string, toolActivities: Extract<ReplyStreamEvent, { type: 'message.toolActivity' }>['toolActivities']) => void
  /** The final, complete assistant message (authoritative). */
  onEnd?: (message: Extract<ReplyStreamEvent, { type: 'message.end' }>['message']) => void
}

/** Send a turn and stream the reply. Resolves when the stream ends. `signal`
 *  cancels an in-flight turn (e.g. on session switch); `ephemeral` runs the full
 *  model + tool round-trip without persisting the turn (the guided tour). */
export async function sendMessage(
  sessionId: string,
  text: string,
  handlers: SendHandlers,
  opts: { signal?: AbortSignal; ephemeral?: boolean } = {},
): Promise<void> {
  const { signal, ephemeral } = opts
  const body: SendMessageRequest = ephemeral ? { text, ephemeral: true } : { text }
  const res = await fetch(`${API_BASE}${paths.session(sessionId)}/messages`, {
    method: 'POST',
    headers: {
      // Identity rides the session cookie (P6) — the browser attaches it to
      // this streamed fetch like any other request; nothing to inject.
      'Content-Type': 'application/json',
      // One key per LOGICAL send (design §5.4, invariant I4): a transport retry
      // of this call can never double-append the user turn or double-generate —
      // the server dedupes by (session, key) and attaches the retry to the live
      // turn (or replays the persisted result).
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    // Surface the server's own refusal copy (the pre-persist gates: a spend limit's
    // 429, a Session provider's relay_offline / relay_busy 503) — those messages are
    // written for the user ("Your session isn't answering — start its drain loop and
    // retry"), so the thrown error carries them to the retry affordance.
    const envelope = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(envelope?.error?.message ?? `send failed: ${res.status}`)
  }
  await readReplyStream(res.body, handlers)
}

/** Drain a reply-stream SSE body, dispatching each typed event — shared by the
 *  send and the reattach (they carry the same `ReplyStreamEvent` frames). */
async function readReplyStream(body: ReadableStream<Uint8Array>, handlers: SendHandlers): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE frames are separated by a blank line.
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      let event: ReplyStreamEvent
      try {
        event = JSON.parse(line.slice(5).trim()) as ReplyStreamEvent
      } catch {
        continue
      }
      dispatch(event, handlers)
    }
  }
}

/** Reattach to a turn already running server-side (multi-account §6.4/§6.5):
 *  the stream replays buffered frames after `after` (0 = from the top), then
 *  follows the live tail through the same `message.end` the original stream
 *  carries. A 404 means the turn already persisted — refetch the session; the
 *  record is the authority. Fetch-streamed (fetch CAN set headers; only
 *  EventSource can't), so it joins the standard identity policy. */
export async function reattachTurn(
  sessionId: string,
  turnId: string,
  after: number,
  handlers: SendHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}${paths.turnStream(sessionId, turnId, after)}`, { signal })
  if (res.status === 404) {
    invalidate(keys.session(sessionId)) // finished while we were away — re-read the record
    return
  }
  if (!res.ok || !res.body) throw new Error(`reattach failed: ${res.status}`)
  await readReplyStream(res.body, handlers)
}

/** Deliberately stop a live turn (multi-account §5.2 — the explicit cancel, as
 *  opposed to merely detaching a view). The partial persists server-side. */
export async function cancelTurn(sessionId: string, turnId: string): Promise<void> {
  await apiPost(paths.turnCancel(sessionId, turnId))
}

// ── Sessions (the conversation, server-owned) ───────────────────────────────

/** Materialize a draft into a real persisted session on its first send. The
 *  server mints the id + titles it from the first message; we prime the caches so
 *  the controller can resolve the new session immediately and the sidebar shows it. */
export async function createSession(firstMessage?: string, providerId?: string): Promise<Session> {
  const session = await apiPost<Session>(paths.sessions, { firstMessage, providerId })
  setData(keys.session(session.id), session)
  invalidate(keys.sessions)
  return session
}

/** Read a session's full thread from the server (the system of record) and prime
 *  the cache. The controller calls this on select to reconcile the open thread, so
 *  a persisted turn reappears after switching away and back. */
export async function loadSession(id: string): Promise<Session> {
  const session = await apiGet<Session>(paths.session(id))
  setData(keys.session(id), session)
  return session
}

/** Write a session's live workspace through to the server — the panels it has
 *  grown (the *content* of its attached contexts), assembled by the controller
 *  from the server-owned context catalogs. The server is the system of record, so
 *  a runtime attach survives a reload / shows on another client. Fire-and-forget
 *  (the optimistic `live` is the panel's instant driver); primes the session cache. */
export async function persistWorkspace(id: string, workspace: SessionWorkspace): Promise<void> {
  const session = await apiPatch<Session>(paths.sessionWorkspace(id), workspace)
  setData(keys.session(id), session)
}

let optSeq = 0

/** Apply a confirmed relation edit. Optimistically patches the cached graph so
 *  the card flips instantly, then reconciles with the server's authoritative
 *  graph (which also broadcasts the change to other clients). `attach-context`
 *  is a live-session effect, not a graph edit, and is handled by the caller. */
export async function applyRelationOp(op: RelationOp): Promise<void> {
  mutate<RelationGraph>(keys.relations, (g) =>
    applyGraphOp(g ?? emptyGraph(), op, () => `${OPTIMISTIC_ID_PREFIX}${(optSeq += 1)}`, Date.now()),
  )
  try {
    const body: ApplyOpRequest = { op }
    const updated = await apiPost<RelationGraph>(paths.relationOps, body)
    setData(keys.relations, updated)
    // An Agent Commons CRUD op edits a registry, not the graph (the patch above was a
    // no-op for it) — refresh the registry caches the Agents hub reads.
    invalidateForCommonsOp(op)
  } catch {
    // The POST failed — drop the optimistic patch by re-reading the server truth.
    invalidate(keys.relations)
  }
}

// ── Scheduled routines ──────────────────────────────────────────────────────

/** Run a routine now. The server appends the run + broadcasts run.* events, which
 *  invalidate the feed; we also nudge the local caches so it shows immediately. */
export async function runScheduleNow(id: string): Promise<void> {
  await apiPost(paths.scheduleRun(id))
  invalidate(keys.recentRuns)
  invalidate(keys.schedules)
}

/** Set a routine's enabled state. The caller passes the resolved value — the
 *  server applies the patch field verbatim (it doesn't infer a toggle), so the UI
 *  reads the current state and sends its negation. */
export async function toggleScheduleEnabled(id: string, enabled: boolean): Promise<void> {
  await apiPatch(paths.schedule(id), { enabled } satisfies UpdateScheduleRequest)
  invalidate(keys.schedules)
  invalidate(keys.recentRuns)
}

/** Patch a routine's own fields (name, prompt, cadence, model, notify-on-failure,
 *  …) — the entity edits behind the detail page. Optimistically merges the patch
 *  into the cached routine so the field updates instantly, then PATCHes and
 *  re-reads. Cross-entity bindings (deliver-to, add-tool) are NOT here — those go
 *  through applyRelationOp. */
export async function updateSchedule(id: string, patch: UpdateScheduleRequest): Promise<void> {
  mutate<ScheduledTask[]>(keys.schedules, (list) =>
    (list ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)),
  )
  await apiPatch(paths.schedule(id), patch)
  invalidate(keys.schedules)
}

/** Add a routine from a template's seed (lands paused); returns the new routine. */
export async function addScheduleFromSeed(seed: Omit<ScheduledTask, 'id'>): Promise<ScheduledTask> {
  const task = await apiPost<ScheduledTask>(paths.schedules, { seed })
  invalidate(keys.schedules)
  return task
}

/** Remove a routine. */
export async function removeSchedule(id: string): Promise<void> {
  await apiDelete(paths.schedule(id))
  invalidate(keys.schedules)
  invalidate(keys.recentRuns)
}

/** Kick off a one-off dispatch (a single on-demand agent run). The server mints it
 *  'running' and flips it to 'done' a beat later, broadcasting dispatch.changed each
 *  time; we also nudge the feed so it shows immediately. */
export async function createDispatch(title: string, detail?: string): Promise<void> {
  await apiPost(paths.dispatch, { title, detail } satisfies CreateDispatchRequest)
  invalidate(keys.dispatch)
}

/** Commission an Agent onto a Project (docs/agent-commons.md, D7/D13) — the leaf of
 *  the D8 cascade. The server funnel rejects an over-grant (400) / unknown ids (404);
 *  on success we refresh that Project's Contributor list. Returns the new commission. */
export async function createCommission(input: CreateCommissionRequest): Promise<Commission> {
  const commission = await apiPost<Commission>(paths.commissions(), input)
  invalidate(keys.commissions(input.projectId))
  invalidate(keys.commissions())
  return commission
}

/** Re-grant a commission (narrow / restore its Project-clamped reach, D12). Refreshes the
 *  Project's Contributor list, the global list, and the commission's effective authority. */
export async function updateCommission(
  id: string,
  projectId: string,
  patch: UpdateCommissionRequest,
): Promise<Commission> {
  const commission = await apiPatch<Commission>(paths.commission(id), patch)
  invalidate(keys.commissions(projectId))
  invalidate(keys.commissions())
  invalidate(keys.commissionAuthority(id))
  return commission
}

/** Un-commission an Agent from a Project. Refreshes both Contributor lists and the
 *  Project's coordination panel (a delete cascade-releases the Contributor's sub-goals). */
export async function deleteCommission(id: string, projectId: string): Promise<void> {
  await apiDelete(paths.commission(id))
  invalidate(keys.commissions(projectId))
  invalidate(keys.commissions())
  invalidate(keys.projectSubGoals(projectId))
}

// ── Model providers (the Agents hub — docs/agent-commons.md, D9) ─────────────

/** Register a Model provider. The server validates the plan against the account plan
 *  (the D8 cascade root) and rejects an over-plan request (bad_request); on success the
 *  provider list refreshes. Returns the new provider — for `kind:'session'` it carries
 *  the ONE-TIME rendezvous `secret` (never readable again; the caller must show it). */
export async function createProvider(input: CreateProviderRequest): Promise<CreatedProvider> {
  const provider = await apiPost<CreatedProvider>(paths.providers, input)
  invalidate(keys.providers)
  return provider
}

/** Rotate a Session provider's rendezvous secret — the kill switch (the old secret dies
 *  instantly; an in-flight relayed turn falls back). Returns the row + the NEW one-time
 *  secret, shown once like the mint's. */
export async function rotateProvider(id: string): Promise<CreatedProvider> {
  const rotated = await apiPost<CreatedProvider>(`${paths.provider(id)}/rotate`, {})
  invalidate(keys.providers)
  return rotated
}

/** Patch a provider's own fields; refreshes the provider list. */
export async function updateProvider(id: string, patch: UpdateProviderRequest): Promise<ModelProvider> {
  const provider = await apiPatch<ModelProvider>(paths.provider(id), patch)
  invalidate(keys.providers)
  return provider
}

/** Remove a provider. Rejects (so the caller can surface the message) when the server
 *  refuses — the default provider, or one an Agent still binds (409 conflict). */
export async function deleteProvider(id: string): Promise<void> {
  await apiDelete(paths.provider(id))
  invalidate(keys.providers)
}

// ── System-prompt library (the Agents hub — docs/agent-commons.md, D10) ──────

/** Add a library prompt; refreshes the prompt list. */
export async function createSystemPrompt(input: CreateSystemPromptRequest): Promise<SystemPromptEntry> {
  const entry = await apiPost<SystemPromptEntry>(paths.systemPrompts, input)
  invalidate(keys.systemPrompts)
  return entry
}

/** Run the opt-in prompt-fit probe (docs/agent-commons.md, D10/OQ5) — the deeper, scored
 *  upgrade beside the always-on static tag. An on-demand action (not a cached query), so it
 *  returns the result directly for the picker to show; nothing to invalidate. */
export async function probePrompt(id: string, providerId?: string): Promise<PromptProbeResult> {
  return apiPost<PromptProbeResult>(paths.systemPromptProbe(id), { providerId } satisfies PromptProbeRequest)
}

/** Patch a library prompt's fields; refreshes the prompt list. */
export async function updateSystemPrompt(id: string, patch: UpdateSystemPromptRequest): Promise<SystemPromptEntry> {
  const entry = await apiPatch<SystemPromptEntry>(paths.systemPrompt(id), patch)
  invalidate(keys.systemPrompts)
  return entry
}

/** Remove a library prompt. Rejects (so the caller can surface the message) when the
 *  server refuses — the default prompt, or one an Agent still references (409). */
export async function deleteSystemPrompt(id: string): Promise<void> {
  await apiDelete(paths.systemPrompt(id))
  invalidate(keys.systemPrompts)
}

// ── Worker Agents (the Agents hub — docs/agent-commons.md, D6) ───────────────

/** Create an Agent. The server resolves the prompt body, defaults tools, and validates
 *  authority/budget against the provider (D8); an over-grant rejects (bad_request). */
export async function createAgent(input: CreateAgentRequest): Promise<Agent> {
  const agent = await apiPost<Agent>(paths.agents, input)
  invalidate(keys.workerAgents)
  return agent
}

/** Patch an Agent; refreshes the agent list (and any Contributor row that resolves its
 *  label). A `published` flip (D18) also refreshes the agent directory — the row just
 *  appeared in / vanished from it. */
export async function updateAgent(id: string, patch: UpdateAgentRequest): Promise<Agent> {
  const agent = await apiPatch<Agent>(paths.agent(id), patch)
  invalidate(keys.workerAgents)
  if ('published' in patch) invalidatePrefix(keys.directoryAgents())
  return agent
}

/** Fork a published Agent's definition into the caller's account (docs/agent-commons.md,
 *  D18): a new private Agent with capability unbound (re-grant through your own funnel)
 *  and lineage stamped. Refreshes the agent list (the fork appears) and the directory
 *  (the source's fork counter moved). */
export async function forkAgent(id: string): Promise<Agent> {
  const fork = await apiPost<Agent>(paths.agentFork(id), {})
  invalidate(keys.workerAgents)
  invalidatePrefix(keys.directoryAgents())
  return fork
}

/** Import a remote A2A Agent Card as a private, unbound definition-stub Agent
 *  (docs/a2a-integration.md, D20) — the cross-instance sibling of `forkAgent`.
 *  The server does the fetch; failures surface as the server's message. */
export async function importAgentCard(url: string): Promise<Agent> {
  const agent = await apiPost<Agent>(paths.agentImportCard, { url })
  invalidate(keys.workerAgents)
  return agent
}

/** Absolute URL of a published Agent's A2A card (D20) — a public GET, linkable
 *  from the UI so an owner can hand their agent's front door to a foreign peer. */
export function a2aAgentCardUrl(id: string): string {
  return `${API_BASE}${paths.a2aAgentCard(id)}`
}

/** Post a work item onto a Project's backlog (docs/agent-commons.md, D19) — the
 *  issues-tray act. The server dispatches it to the Project's standing Contributors
 *  synchronously; the returned item is already `done` when one took it. Refreshes the
 *  backlog, the coordination panel, and the agent list (a taker earned a contribution). */
export async function postOpenSubGoal(projectId: string, input: PostOpenSubGoalRequest): Promise<OpenSubGoal> {
  const item = await apiPost<OpenSubGoal>(paths.openSubGoals(projectId), input)
  invalidate(keys.openSubGoals(projectId))
  invalidate(keys.projectSubGoals(projectId))
  invalidate(keys.workerAgents)
  invalidatePrefix(keys.directoryProjects())
  return item
}

/** Append a comment to a work item's discussion thread (D23). The thread rides
 *  the item, so refreshing the backlog refreshes the conversation. */
export async function commentOnWorkItem(projectId: string, itemId: string, body: string): Promise<OpenSubGoal> {
  const item = await apiPost<OpenSubGoal>(paths.openSubGoalComments(projectId, itemId), { body })
  invalidate(keys.openSubGoals(projectId))
  return item
}

/** Retract a work item (D23) — poster or project owner, open items only (the
 *  server enforces; a 403/409 surfaces as the thrown error). Open-work counts
 *  ride directory cards and profiles, so refresh those families too. */
export async function retractWorkItem(projectId: string, itemId: string): Promise<OpenSubGoal> {
  const item = await apiPost<OpenSubGoal>(paths.openSubGoalRetract(projectId, itemId), {})
  invalidate(keys.openSubGoals(projectId))
  invalidatePrefix(keys.directoryProjects())
  invalidatePrefix(keys.ownerProfile())
  invalidatePrefix(keys.search())
  return item
}

/** Open a change proposal against a published definition (D25). */
export async function proposeAgentChange(agentId: string, req: ProposeAgentChangeRequest): Promise<AgentChangeProposal> {
  const proposal = await apiPost<AgentChangeProposal>(paths.agentProposals(agentId), req)
  invalidate(keys.agentProposals(agentId))
  return proposal
}

/** The owner's verdict on a proposal (D25). A merge changes the PUBLISHED
 *  definition, so the registry and its public faces refresh too. */
export async function resolveAgentProposal(agentId: string, pid: string, action: 'merge' | 'decline', note?: string): Promise<AgentChangeProposal> {
  const proposal = await apiPost<AgentChangeProposal>(
    action === 'merge' ? paths.agentProposalMerge(agentId, pid) : paths.agentProposalDecline(agentId, pid),
    action === 'decline' && note ? { note } : {},
  )
  invalidate(keys.agentProposals(agentId))
  invalidate(keys.workerAgents)
  invalidatePrefix(keys.directoryAgents())
  return proposal
}

/** Watch / unwatch a Project (D24) — the bell subscription. */
export async function setProjectWatch(projectId: string, watching: boolean): Promise<WatchState> {
  const state = await apiPost<WatchState>(paths.projectWatch(projectId), { watching })
  setData(keys.projectWatch(projectId), state)
  return state
}

/** Mark inbox rows read (D24) — the named ids, or all. The server answers with the
 *  full refreshed inbox; seed it so the bell count settles without a refetch. */
export async function markNotificationsRead(ids?: string[]): Promise<AppNotification[]> {
  const inbox = await apiPost<AppNotification[]>(paths.notificationsRead, ids ? { ids } : {})
  setData(keys.notifications, inbox)
  return inbox
}

/** Remove an Agent. Rejects (so the caller can surface the message) when the server
 *  refuses — the default agent, or one a Commission still assigns (409). */
export async function deleteAgent(id: string): Promise<void> {
  await apiDelete(paths.agent(id))
  invalidate(keys.workerAgents)
}

/** Claim a sub-goal on a Project for a Contributor (docs/agent-commons.md, D11). The
 *  guardian refuses a *different* holder on the *same* sub-goal (409 conflict) — the
 *  caller surfaces that as a re-reason prompt. Refreshes the Project's coordination
 *  panel on success. Rejects (so the caller can catch the 409). */
export async function reserveSubGoal(projectId: string, holder: string, subGoal: string): Promise<Reservation> {
  const reservation = await apiPost<Reservation>(paths.projectSubGoals(projectId), {
    holder,
    subGoal,
  } satisfies ReserveSubGoalRequest)
  invalidate(keys.projectSubGoals(projectId))
  return reservation
}

/** Release a sub-goal claim, freeing it for another Contributor; refreshes the panel. */
export async function releaseSubGoal(reservationId: string, projectId: string): Promise<void> {
  await apiPost(paths.reservationRelease(reservationId))
  invalidate(keys.projectSubGoals(projectId))
}

/** Resolve a run session from the recent-runs feed cache — the controller uses
 *  this to open an `srun-*` session (including ones the daemon just created)
 *  without an extra fetch. */
export function runSessionFromCache(id: string): Session | undefined {
  return peek<RunSessionEntry[]>(keys.recentRuns)?.find((e) => e.session.id === id)?.session
}

/** Resolve a run session from the live schedules cache — which holds *every* run
 *  of every routine, not just the recent-feed top-two. The run switcher lists all
 *  of a routine's runs, so opening one (a live run-now, or an older seed run) must
 *  resolve against this full set. The cache is warm (the sidebar reads it). */
export function runSessionFromSchedules(id: string): Session | undefined {
  const schedules = peek<ScheduledTask[]>(keys.schedules)
  return schedules ? entryById(schedules, id)?.session : undefined
}

// ── Sessions (the sidebar row menu's edits) ─────────────────────────────────

/** Patch a session's row fields — rename / pin / archive, or the composer's model
 *  pick (`providerId`; empty string clears back to the Agent's provider).
 *  Optimistically patches the cached list (the row updates instantly), then PATCHes;
 *  the server's `session.updated` event reconciles every client. */
export async function patchSession(
  id: string,
  patch: { title?: string; status?: 'active' | 'archived'; pinned?: boolean; providerId?: string },
): Promise<void> {
  // The optimistic row mirrors the server's clear semantics: '' deletes the pick.
  const optimistic = patch.providerId === '' ? { ...patch, providerId: undefined } : patch
  mutate<Session[]>(keys.sessions, (list) =>
    (list ?? []).map((s) => (s.id === id ? { ...s, ...optimistic } : s)),
  )
  try {
    await apiPatch(paths.session(id), patch)
  } catch {
    invalidate(keys.sessions)
  }
}

/** Delete a session (the row menu's "Delete"). Optimistically drops it from the
 *  cached list, then DELETEs; a failed call re-reads the server truth. */
export async function deleteSession(id: string): Promise<void> {
  mutate<Session[]>(keys.sessions, (list) => (list ?? []).filter((s) => s.id !== id))
  try {
    await apiDelete(paths.session(id))
  } catch {
    invalidate(keys.sessions)
  }
}

/** Confirm or decline a proposed connector ACTION (P6 §2.1, PD43) — the consent gate
 *  for a connector/MCP write. A read runs at generation; an action only takes effect
 *  here, on approval. Returns the updated activity (status `done` + mock result, or
 *  `declined`); the server records an audit entry on confirm. Invalidates the session so
 *  a later reopen reflects the persisted status. */
export async function resolveToolActivity(
  sessionId: string,
  activityId: string,
  decision: 'confirm' | 'decline',
): Promise<ToolActivity> {
  const activity = await apiPost<ToolActivity>(paths.toolActivity(sessionId, activityId), { decision })
  invalidate(keys.session(sessionId))
  return activity
}

/** Compact a session's context (P5 / BROKER-EXP-3) — server-owned; the backend archives
 *  older messages behind a summary marker so the token count (and the usage gauge) drops
 *  back. Returns the compacted session; invalidates the session + its usage so caches
 *  refresh. The controller also swaps its live `messages` to the returned set so the open
 *  thread + the composer's live token overlay reflect the drop immediately. */
export async function compactSession(sessionId: string): Promise<Session> {
  const session = await apiPost<Session>(paths.sessionCompact(sessionId), {})
  invalidate(keys.session(sessionId))
  invalidate(keys.usage(sessionId))
  return session
}

// ── Session contexts (the attachment of record) ─────────────────────────────

/** Attach a context to a session — the persisted binding every effect routed
 *  through this session is mediated against (Primitive 1 of
 *  docs/shared-resource-coordination.md). Returns the new list; the
 *  `session.contexts.changed` event reconciles any other client. */
export async function attachContext(
  sessionId: string,
  context: AttachContextRequest,
): Promise<SessionContext[]> {
  const next = await apiPost<SessionContext[]>(paths.sessionContexts(sessionId), context)
  setData(keys.sessionContexts(sessionId), next)
  return next
}

/** Detach a context from a session. */
export async function detachContext(sessionId: string, contextId: string): Promise<void> {
  await apiDelete(paths.sessionContext(sessionId, contextId))
  invalidate(keys.sessionContexts(sessionId))
}

// ── Saved contexts (the Contexts page) ──────────────────────────────────────

/** Set a saved connector / MCP server's auth status (connect / disconnect on the
 *  Contexts page). Optimistically flips the cached status so the row updates
 *  instantly, then PATCHes; the server broadcasts `connector.status`, reconciling
 *  this client and every other one (and the Add-context "Connected" quick list). */
export async function setConnectorStatus(id: string, status: ContextStatus): Promise<void> {
  mutate<SavedContextsSnapshot>(keys.savedContexts, (snap) => {
    if (!snap) return snap as unknown as SavedContextsSnapshot
    return { ...snap, contexts: snap.contexts.map((c) => (c.id === id ? { ...c, status } : c)) }
  })
  try {
    const updated = await apiPatch<SavedContextsSnapshot>(
      paths.savedContext(id),
      { status } satisfies SetConnectorStatusRequest,
    )
    setData(keys.savedContexts, updated)
  } catch {
    invalidate(keys.savedContexts)
  }
}

// ── Recents (Add-context shortcut lists) ────────────────────────────────────

/** Promote an id to the front of its type's recents (non-evicting). Optimistic
 *  so the quick list flips instantly, then POSTs the canonical write (the server
 *  broadcasts recents.changed, reconciling this + any other client). */
export function pushRecentId(type: ContextTypeId, id: string): void {
  mutate<RecentsSnapshot>(keys.recents, (snap) => {
    if (!snap) return snap as unknown as RecentsSnapshot
    const cur = snap[type] ?? []
    return { ...snap, [type]: [id, ...cur.filter((x) => x !== id)] }
  })
  apiPost(paths.recentsType(type), { id } satisfies PushRecentRequest).catch(() => invalidate(keys.recents))
}

// ── Native capabilities ─────────────────────────────────────────────────────

/** Invoke a capability on a connected runner's host — the addressed + routed call
 *  `(runner, capability, target)`. A write/effect command, not a read, so it goes
 *  here rather than through a hook; the runner enforces its scoped grant (D3) and
 *  the call rejects with `forbidden` / `capability_unavailable` accordingly.
 *  Returns the recorded effect; pass a stable `commandId` for idempotent retries. */
export async function invokeCapability(
  runnerId: string,
  request: CapabilityRequest,
): Promise<CapabilityEffect> {
  const effect = await apiPost<CapabilityEffect>(paths.runnerInvoke(runnerId), request)
  invalidate(keys.runnerEffects(runnerId))
  return effect
}

/** Replay a runner's outbox to the server — effects it executed out-of-band (the
 *  co-located fast path, or while offline). Merged idempotently by commandId. */
export async function syncRunnerEffects(
  runnerId: string,
  effects: EffectReport[],
): Promise<SyncEffectsResult> {
  const result = await apiPost<SyncEffectsResult>(paths.runnerSync(runnerId), { effects })
  invalidate(keys.runnerEffects(runnerId))
  return result
}

// ── Resource guardians (reservations) ───────────────────────────────────────

/** Reserve a shared resource for a holder (a session) — the reversible escrow
 *  hold (D5). Re-entrant for the same holder; rejects with `conflict` when another
 *  session holds the resource at capacity. */
export async function reserveResource(key: string, holder: string, ttlMs?: number): Promise<Reservation> {
  const r = await apiPost<Reservation>(paths.resourceReserve(key), { holder, ttlMs })
  invalidate(keys.resourceStatus(key))
  return r
}

/** Commit a reservation — record the single irreversible step. */
export async function commitReservation(id: string): Promise<Reservation> {
  const r = await apiPost<Reservation>(paths.reservationCommit(id))
  invalidate(keys.resourceStatus(r.resourceId))
  return r
}

/** Release a reservation — free the slot for another session. */
export async function releaseReservation(id: string): Promise<Reservation> {
  const r = await apiPost<Reservation>(paths.reservationRelease(id))
  invalidate(keys.resourceStatus(r.resourceId))
  return r
}

/** Set how many distinct sessions may concurrently hold a resource (default 1). */
export async function setResourceCapacity(key: string, capacity: number): Promise<ResourceStatus> {
  const s = await apiPatch<ResourceStatus>(paths.resource(key), { capacity })
  invalidate(keys.resourceStatus(key))
  return s
}

function dispatch(event: ReplyStreamEvent, h: SendHandlers): void {
  switch (event.type) {
    case 'message.start':
      h.onStart?.(event.message.id, event.message, event.turnId)
      break
    case 'message.delta':
      h.onDelta?.(event.messageId, event.text)
      break
    case 'message.relations':
      h.onRelations?.(event.messageId, event.relationActions)
      break
    case 'message.escalation':
      h.onEscalation?.(event.messageId, event.escalation)
      break
    case 'message.toolActivity':
      h.onToolActivity?.(event.messageId, event.toolActivities)
      break
    case 'message.end':
      h.onEnd?.(event.message)
      break
  }
}
