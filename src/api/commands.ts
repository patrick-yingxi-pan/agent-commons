/** ── Commands ──────────────────────────────────────────────────────────────
 *  The UI's writes. Reads come back through hooks + the cache; writes go here.
 *  Phase 3 starts with the streaming send — the one command whose response is
 *  itself a stream (the assistant turn), mirroring the Anthropic Messages API. */
import {
  type ApplyOpRequest,
  type ArtifactContent,
  type ArtifactContentLibrary,
  type ArtifactContentPatch,
  type ArtifactItem,
  type CapabilityEffect,
  type CapabilityRequest,
  type Agent,
  type AgentConfigurationPatch,
  type Commission,
  type CommissionConfigurationPatch,
  type CreateAgentRequest,
  type DeleteAgentRequest,
  type DeleteCommissionRequest,
  type DeleteProviderRequest,
  type DeleteSystemPromptRequest,
  type ProviderDeletionPrecondition as ProviderDeletePrecondition,
  type UpdateAgentRequest,
  type UpdateCommissionRequest,
  type CreatedProvider,
  type ModelProvider,
  type ProviderDefinitionMutationPatch,
  type UpdateProviderConnectionRequest,
  type UpdateProviderRequest,
  type SystemPromptEntry,
  type SystemPromptDefinitionMutationPatch,
  type UpdateSystemPromptRequest,
  type AppNotification,
  type OpenSubGoal,
  type Contribution,
  type Discussion,
  type ReportDiscussionPostResponse,
  type SetDiscussionReactionRequest,
  type SetFollowRequest,
  type MarkDiscussionReadRequest,
  type SocialProposal,
  type SocialEntityRef,
  type WatchState,
  type PromptProbeRequest,
  type PromptProbeResult,
  type ContextStatus,
  type DeleteSavedContextRequest,
  type DeleteScheduleRequest,
  type ContextTypeId,
  type EffectReport,
  type SyncEffectsResult,
  type PushRecentRequest,
  type Project,
  type RecentsSnapshot,
  type RelationGraph,
  type RelationOp,
  type Reservation,
  type ResourceStatus,
  type ReplyStreamEvent,
  type SavedContext,
  type SavedContextsSnapshot,
  type SchedulePatch,
  type ScheduledTask,
  type SendMessageRequest,
  type SetConnectorStatusRequest,
  type Session,
  type DeleteSessionRequest,
  type SessionMetadataPatch,
  type SessionContextState,
  type SessionPreferences,
  type UpdateScheduleRequest,
  type UpdateArtifactContentRequest,
  type UpdateSessionPreferencesRequest,
  type UpdateSessionRequest,
  type UpdateSessionContextStateRequest,
} from '../../contract/index.ts'
import { API_BASE, ApiRequestError, apiDelete, apiGet, apiPatch, apiPost } from './client.ts'
import { invalidate, invalidatePrefix, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { invalidateForCommonsOp } from './commonsInvalidation.ts'
import { MESSAGE_PAGE_SIZE } from './sessionPaging.ts'
import { readReplyEvents } from './replyStream.ts'
import { shouldAcceptRelationGraph } from './relationRevision.ts'
import { shouldAcceptEntityRevision } from './entityRevision.ts'
import {
  mergeScheduleDefinition,
} from './scheduleRevision.ts'
import { mergeArtifactContent } from './artifactContentRevision.ts'
import { mergeAgentConfiguration } from './agentRevision.ts'
import { mergeProviderConnection, mergeProviderDefinition } from './providerRevision.ts'
import { mergeSystemPromptDefinition } from './systemPromptRevision.ts'
import { newestCommissionConfiguration } from './commissionRevision.ts'
import { mergeCommissionIntoCachedRosters } from './commissionRosterCache.ts'
import { mergeSavedContextConnection, mergeSavedContextConnectionSnapshot } from './savedContextRevision.ts'

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

/** Send one logical turn and stream the reply. The caller may retain the
 *  `idempotencyKey` and pass it again after a transport failure; that is what
 *  lets the server attach/replay instead of duplicating work. `retryLastUser`
 *  additionally covers the process-restart/error case where the server kept
 *  the user row but no longer has a live/completed turn handle. */
export async function sendMessage(
  sessionId: string,
  text: string,
  handlers: SendHandlers,
  opts: {
    signal?: AbortSignal
    ephemeral?: boolean
    idempotencyKey?: string
    retryLastUser?: boolean
  } = {},
): Promise<void> {
  const { signal, ephemeral, retryLastUser } = opts
  const body: SendMessageRequest = {
    text,
    ...(ephemeral ? { ephemeral: true } : {}),
    ...(retryLastUser ? { retryLastUser: true as const } : {}),
  }
  let res: Response
  try {
    res = await fetch(`${API_BASE}${paths.sessionMessages(sessionId)}`, {
      method: 'POST',
      headers: {
        // Identity rides the session cookie (P6) — the browser attaches it to
        // this streamed fetch like any other request; nothing to inject.
        'Content-Type': 'application/json',
        // One key per LOGICAL send (design §5.4, invariant I4): a transport retry
        // of this call can never double-append the user turn or double-generate —
        // the server dedupes by (session, key) and attaches the retry to the live
        // turn (or replays the persisted result).
        'Idempotency-Key': opts.idempotencyKey ?? crypto.randomUUID(),
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new Error('Couldn’t reach Agent Commons. Your message is safe — retry when the connection returns.')
  }
  if (!res.ok || !res.body) {
    // Surface the server's own refusal copy (the pre-persist gates: a spend limit's
    // 429, a Session provider's relay_offline / relay_busy 503) — those messages are
    // written for the user ("Your session isn't answering — start its drain loop and
    // retry"), so the thrown error carries them to the retry affordance.
    const envelope = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(envelope?.error?.message ?? `send failed: ${res.status}`)
  }
  try {
    await readReplyEvents(res.body, (event) => dispatch(event, handlers))
  } catch {
    throw new Error('The connection closed before the reply finished. Your message is safe — retry to resume it.')
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
  let res: Response
  try {
    res = await fetch(`${API_BASE}${paths.turnStream(sessionId, turnId, after)}`, { signal })
  } catch {
    throw new Error('Couldn’t reconnect to the reply. Retry will reattach to the same generation.')
  }
  if (res.status === 404) {
    invalidate(keys.session(sessionId)) // finished while we were away — re-read the record
    return
  }
  if (!res.ok || !res.body) throw new Error(`reattach failed: ${res.status}`)
  try {
    await readReplyEvents(res.body, (event) => dispatch(event, handlers))
  } catch {
    throw new Error('The reply connection was interrupted. Retry will reattach to the same generation.')
  }
}

/** Deliberately stop a live turn (multi-account §5.2 — the explicit cancel, as
 *  opposed to merely detaching a view). The partial persists server-side. */
export async function cancelTurn(sessionId: string, turnId: string): Promise<void> {
  await apiPost(paths.turnCancel(sessionId, turnId))
}

// ── Sessions (the conversation, server-owned) ───────────────────────────────

/** Materialize a draft into a real persisted session on its first send. The
 *  server owns the id (deriving it from a logical key when supplied) and titles
 *  the row from the first message; we prime the caches so the controller can
 *  resolve the new session immediately and the sidebar shows it. */
export interface CreateSessionOptions {
  providerId?: string
  modelId?: string
  idempotencyKey?: string
  /** Commit the title seed as an unresolved first user turn in the same durable
   *  write as the Session. Reserved for recovery-safe handoffs; an ordinary
   *  draft still lets the send route append its first turn. */
  persistFirstMessage?: true
}

export async function createSession(
  firstMessage?: string,
  options: CreateSessionOptions = {},
): Promise<Session> {
  const session = await apiPost<Session>(
    paths.sessions,
    {
      firstMessage,
      providerId: options.providerId,
      modelId: options.modelId,
      persistFirstMessage: options.persistFirstMessage,
    },
    { idempotencyKey: options.idempotencyKey },
  )
  setData(keys.session(session.id), session)
  invalidate(keys.sessions)
  return session
}

/** Read a session's newest bounded thread tail from the server (the system of
 *  record) and prime the cache. The controller calls this on select; older pages
 *  are requested explicitly and merged in its keyed conversation store. */
export async function loadSession(id: string): Promise<Session> {
  const session = await apiGet<Session>(paths.session(id, { limit: MESSAGE_PAGE_SIZE }))
  setData(keys.session(id), session)
  return session
}

/** Continue a session's message stream toward its beginning. Deliberately does
 *  not replace the by-id cache: that cache represents the newest projection
 *  used by ownership/title readers, while the controller owns page merging. */
export function loadEarlierSession(id: string, cursor: string): Promise<Session> {
  return apiGet<Session>(paths.session(id, { limit: MESSAGE_PAGE_SIZE, cursor }))
}

/** Commit a session's effect-mediation bindings and visible workspace through
 * one atomic server transaction. The controller acknowledgement-gates its local
 * projection and owns serialized retry; this door only transports the contract
 * and refreshes the two read projections. */
export async function updateSessionContextState(
  id: string,
  request: UpdateSessionContextStateRequest,
): Promise<SessionContextState> {
  const next = await apiPatch<SessionContextState>(paths.sessionContextState(id), request)
  setData(keys.sessionContexts(id), next.contexts)
  // The open controller lands the acknowledged workspace directly. Other
  // readers reconcile through the bounded session projection / ambient event.
  invalidate(keys.session(id))
  return next
}

/** Persist this viewer's panel intent. Presentation preferences are deliberately
 * separate from the shared session PATCH: collaborators may view the same
 * conversation differently. The controller owns optimistic/offline retry. */
export function patchSessionPreferences(
  id: string,
  request: UpdateSessionPreferencesRequest,
): Promise<SessionPreferences> {
  return apiPatch<SessionPreferences>(paths.sessionPreferences(id), request)
}

/** Send one relation edit without projecting it. The controller serializes
 * these calls and retains `idempotencyKey` across an uncertain retry; only its
 * acknowledgement path may publish the returned full graph. */
export function applyRelationOp(op: RelationOp, idempotencyKey: string): Promise<RelationGraph> {
  const body: ApplyOpRequest = { op }
  return apiPost<RelationGraph>(paths.relationOps, body, { idempotencyKey })
}

/** Project an acknowledged relation mutation without letting an older full
 * response roll back a newer graph already obtained through ambient sync. */
export function acceptRelationOp(op: RelationOp, updated: RelationGraph): void {
  if (shouldAcceptRelationGraph(peek<RelationGraph>(keys.relations), updated)) {
    setData(keys.relations, updated)
  }
  // Agent Commons CRUD ops edit registries rather than graph slices.
  invalidateForCommonsOp(op)
  invalidateForProjectProse(op)
}

function invalidateForProjectProse(op: RelationOp): void {
  if (op.kind !== 'set-project-description') return
  invalidatePrefix(keys.ownerProfile())
  invalidatePrefix(keys.search())
  invalidatePrefix(keys.directoryProjects())
}

/** Re-read after a discarded/uncertain relation mutation. The server may have
 * committed even when the acknowledgement was lost. Return the newest accepted
 * snapshot so a conflict-safe caller can rebase a held field precondition. */
export async function reconcileRelationOp(op: RelationOp): Promise<RelationGraph> {
  const incoming = await apiGet<RelationGraph>(paths.relations)
  const cached = peek<RelationGraph>(keys.relations)
  const current = shouldAcceptRelationGraph(cached, incoming) ? incoming : (cached ?? incoming)
  if (current === incoming) setData(keys.relations, incoming)
  invalidateForCommonsOp(op)
  invalidateForProjectProse(op)
  return current
}

/** Refresh and replace only a Project prose precondition. The desired text is
 * held verbatim; Retry is therefore an explicit "apply mine over latest" act,
 * while unrelated relation operations never acquire invented preconditions. */
export async function rebaseRelationOp(op: RelationOp): Promise<RelationOp> {
  if (op.kind !== 'set-project-description' && op.kind !== 'set-project-instructions') return op
  const [graph, projects] = await Promise.all([
    reconcileRelationOp(op),
    apiGet<Project[]>(paths.projects),
  ])
  setData(keys.projects, projects)
  const project = graph.extraProjects.find((candidate) => candidate.id === op.projectId)
    ?? projects.find((candidate) => candidate.id === op.projectId)
  if (op.kind === 'set-project-description') {
    return {
      ...op,
      expectedDescription: graph.projectDescriptions[op.projectId] ?? project?.description ?? '',
    }
  }
  return {
    ...op,
    expectedInstructions: graph.projectInstructions[op.projectId] ?? project?.instructions ?? '',
  }
}

// ── Scheduled routines ──────────────────────────────────────────────────────

/** Project an acknowledged routine-definition response without replacing run
 * progress/history that a newer ambient fetch may already have published. */
export function acceptScheduleDefinition(task: ScheduledTask): void {
  mutate<ScheduledTask[]>(keys.schedules, (list) =>
    (list ?? []).map((candidate) =>
      candidate.id === task.id ? mergeScheduleDefinition(candidate, task) : candidate,
    ),
  )
}

/** Reconcile one routine definition after a conflict or uncertain
 * acknowledgement. The v1 surface has no by-id read, so we fetch the registry
 * but project only the addressed row: replacing the whole list here could let
 * this response rewind unrelated definition or run updates that landed while
 * the request was in flight. */
export async function reconcileScheduleDefinition(id: string): Promise<ScheduledTask | undefined> {
  const tasks = await apiGet<ScheduledTask[]>(paths.schedules)
  const incoming = tasks.find((candidate) => candidate.id === id)
  const currentList = peek<ScheduledTask[]>(keys.schedules)
  if (!currentList) {
    setData(keys.schedules, tasks)
    return incoming
  }
  if (!incoming) {
    mutate<ScheduledTask[]>(keys.schedules, (list) => (list ?? []).filter((task) => task.id !== id))
    return undefined
  }
  const current = currentList.find((candidate) => candidate.id === id)
  const accepted = current ? mergeScheduleDefinition(current, incoming) : incoming
  mutate<ScheduledTask[]>(keys.schedules, (list) =>
    (list ?? []).map((candidate) => candidate.id === id ? accepted : candidate),
  )
  return accepted
}

/** Transport one revision-checked routine definition edit. The controller owns
 * serialization and recovery; this door publishes only the acknowledgement. */
export async function patchSchedule(
  id: string,
  patch: SchedulePatch,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<ScheduledTask> {
  const task = await apiPatch<ScheduledTask>(
    paths.schedule(id),
    { ...patch, expectedRevision } satisfies UpdateScheduleRequest,
    { idempotencyKey },
  )
  acceptScheduleDefinition(task)
  return task
}

/** Delete one reviewed routine definition. The controller owns confirmation,
 * retry, reconciliation, and navigation; the cache publishes absence only
 * after the server acknowledges the complete run-session cascade. */
export async function deleteSchedule(
  id: string,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<void> {
  await apiDelete(
    paths.schedule(id),
    { expectedRevision } satisfies DeleteScheduleRequest,
    { idempotencyKey },
  )
  mutate<ScheduledTask[]>(keys.schedules, (tasks) =>
    (tasks ?? []).filter((task) => task.id !== id),
  )
  // Deletion also removes the routine's Project edge. Revalidate the graph
  // even when the routine had no run Session (and therefore no
  // `session.removed` event) to carry the ordinary relation refresh.
  invalidate(keys.relations)
}

/** Re-grant a commission (narrow / restore its Project-clamped reach, D12). Refreshes the
 *  Project's Contributor list, the global list, and the commission's effective authority. */
function acceptCommissionConfiguration(commission: Commission, projectId: string): Commission {
  mergeCommissionIntoCachedRosters(commission, projectId)
  return newestCommissionConfiguration(
    peek<Commission[]>(keys.commissions(projectId))?.find((row) => row.id === commission.id),
    peek<Commission[]>(keys.commissions())?.find((row) => row.id === commission.id),
  ) ?? commission
}

/** Publish one proven Contributor absence without replacing either roster.
 * Coordination refreshes with it because un-commissioning releases every work
 * item held by that assignment in the same server commit. */
function acceptCommissionAbsence(id: string, projectId: string): void {
  for (const key of [keys.commissions(projectId), keys.commissions()]) {
    mutate<Commission[]>(key, (rows) => (rows ?? []).filter((row) => row.id !== id))
  }
  invalidate(keys.commissionAuthority(id))
  invalidate(keys.projectSubGoals(projectId))
  invalidatePrefix(keys.directoryProjects())
}

/** Re-read only the addressed contributor before Retry/Dismiss. */
export async function reconcileCommissionConfiguration(
  id: string,
  projectId: string,
): Promise<Commission | undefined> {
  let incoming: Commission | undefined
  try {
    incoming = await apiGet<Commission>(paths.commission(id))
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 404) throw error
  }
  if (!incoming) {
    acceptCommissionAbsence(id, projectId)
    return undefined
  }
  return acceptCommissionConfiguration(incoming, projectId)
}

/** Patch sparse contributor intent against the revision the editor read. */
export async function patchCommissionConfiguration(
  id: string,
  projectId: string,
  patch: CommissionConfigurationPatch,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<Commission> {
  const request = { ...patch, expectedRevision } satisfies UpdateCommissionRequest
  const commission = await apiPatch<Commission>(paths.commission(id), request, { idempotencyKey })
  const accepted = acceptCommissionConfiguration(commission, projectId)
  invalidate(keys.commissionAuthority(id))
  invalidatePrefix(keys.directoryProjects())
  return accepted
}

/** Delete the reviewed Contributor assignment. The controller owns confirmation,
 * Retry/Dismiss, and reconciliation; absence is published only after an
 * acknowledgement or authoritative 404 proves the cascade landed. */
export async function deleteCommission(
  id: string,
  projectId: string,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<void> {
  await apiDelete(
    paths.commission(id),
    { expectedRevision } satisfies DeleteCommissionRequest,
    { idempotencyKey },
  )
  acceptCommissionAbsence(id, projectId)
}

// ── Model providers (the Agents hub — docs/agent-commons.md, D9) ─────────────

/** Rotate a Session provider's rendezvous secret — the kill switch (the old secret dies
 *  instantly; an in-flight relayed turn falls back). Returns the row + the NEW one-time
 *  secret, shown once like the mint's. */
export async function rotateProvider(id: string): Promise<CreatedProvider> {
  const rotated = await apiPost<CreatedProvider>(paths.providerRotate(id), {})
  invalidate(keys.providers)
  return rotated
}

/** Re-fetch a provider's model catalog from its endpoint's own list API (spec
 *  MODEL-16 — the 'listed' source stamp is earned only by this funnel). Rejects
 *  when the server refuses — a Session provider (nothing to list from, 409) or an
 *  endpoint that doesn't answer a model list (400) — so the card can surface the
 *  reason; the existing catalog stays untouched on failure. */
export async function refreshProviderModels(id: string): Promise<ModelProvider> {
  const provider = await apiPost<ModelProvider>(paths.providerModelsRefresh(id), {})
  invalidate(keys.providers)
  return provider
}

/** Replace selected write-only connection fields after the server has probed
 * the effective endpoint. No current endpoint, credential reference, or raw key
 * is ever returned to this client. */
export async function updateProviderConnection(
  id: string,
  patch: UpdateProviderConnectionRequest,
  idempotencyKey: string,
): Promise<ModelProvider> {
  const provider = await apiPatch<ModelProvider>(paths.providerConnection(id), patch, { idempotencyKey })
  return acceptProviderConnection(provider)
}

function acceptProviderConnection(provider: ModelProvider): ModelProvider {
  const rows = peek<ModelProvider[]>(keys.providers)
  const index = rows?.findIndex((candidate) => candidate.id === provider.id) ?? -1
  if (!rows || index < 0) return provider
  const merged = mergeProviderConnection(rows[index]!, provider)
  mutate<ModelProvider[]>(keys.providers, (rows) => {
    const current = rows ?? []
    return current.map((candidate) => candidate.id === provider.id ? merged : candidate)
  })
  return merged
}

function acceptProviderAbsence(id: string): void {
  mutate<ModelProvider[]>(keys.providers, (current) =>
    (current ?? []).filter((candidate) => candidate.id !== id))
}

async function readProviderExact(id: string): Promise<ModelProvider | undefined> {
  try {
    return await apiGet<ModelProvider>(paths.provider(id))
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 404) throw error
    acceptProviderAbsence(id)
    return undefined
  }
}

/** Re-read only the addressed provider after a conflict or uncertain response.
 * Other registry rows remain untouched so one reconciliation cannot rewind an
 * unrelated edit that landed while the list request was in flight. */
export async function reconcileProviderConnection(id: string): Promise<ModelProvider | undefined> {
  const incoming = await readProviderExact(id)
  if (!incoming) return undefined
  return acceptProviderConnection(incoming)
}

function acceptProviderDefinition(provider: ModelProvider): ModelProvider {
  const rows = peek<ModelProvider[]>(keys.providers)
  const index = rows?.findIndex((candidate) => candidate.id === provider.id) ?? -1
  if (!rows || index < 0) return provider
  const merged = mergeProviderDefinition(rows[index]!, provider)
  mutate<ModelProvider[]>(keys.providers, (current) =>
    (current ?? []).map((candidate) => candidate.id === provider.id ? merged : candidate),
  )
  return merged
}

/** Re-read only the addressed provider definition before a Retry/Dismiss. */
export async function reconcileProviderDefinition(id: string): Promise<ModelProvider | undefined> {
  const incoming = await readProviderExact(id)
  if (!incoming) return undefined
  return acceptProviderDefinition(incoming)
}

/** Patch the sparse provider definition against the revision the editor read. */
export async function patchProviderDefinition(
  id: string,
  patch: ProviderDefinitionMutationPatch,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<ModelProvider> {
  const request = { ...patch, expectedRevision } satisfies UpdateProviderRequest
  const provider = await apiPatch<ModelProvider>(paths.provider(id), request, { idempotencyKey })
  const accepted = acceptProviderDefinition(provider)
  // Default selection and server-computed projections have separate owners;
  // revalidate rather than accepting them from a possibly delayed definition ack.
  invalidate(keys.providers)
  return accepted
}

export type ProviderDeletionPrecondition = ProviderDeletePrecondition

/** Remove the reviewed provider across both definition and connection truth.
 * The deletion controller owns confirmation, device cleanup, and recovery. */
export async function deleteProvider(
  id: string,
  expected: ProviderDeletionPrecondition,
  idempotencyKey: string,
): Promise<void> {
  await apiDelete(paths.provider(id), expected, { idempotencyKey })
  acceptProviderAbsence(id)
}

// ── System-prompt library (the Agents hub — docs/agent-commons.md, D10) ──────

/** Run the opt-in prompt-fit probe (docs/agent-commons.md, D10/OQ5) — the deeper, scored
 *  upgrade beside the always-on static tag. An on-demand action (not a cached query), so it
 *  returns the result directly for the picker to show; nothing to invalidate. */
export async function probePrompt(id: string, providerId?: string): Promise<PromptProbeResult> {
  return apiPost<PromptProbeResult>(paths.systemPromptProbe(id), { providerId } satisfies PromptProbeRequest)
}

function acceptSystemPromptDefinition(prompt: SystemPromptEntry): SystemPromptEntry {
  const rows = peek<SystemPromptEntry[]>(keys.systemPrompts)
  const index = rows?.findIndex((candidate) => candidate.id === prompt.id) ?? -1
  if (!rows || index < 0) return prompt
  const merged = mergeSystemPromptDefinition(rows[index]!, prompt)
  mutate<SystemPromptEntry[]>(keys.systemPrompts, (current) =>
    (current ?? []).map((candidate) => candidate.id === prompt.id ? merged : candidate),
  )
  return merged
}

function acceptSystemPromptAbsence(id: string): void {
  mutate<SystemPromptEntry[]>(keys.systemPrompts, (current) =>
    (current ?? []).filter((candidate) => candidate.id !== id))
}

async function readSystemPromptExact(id: string): Promise<SystemPromptEntry | undefined> {
  try {
    return await apiGet<SystemPromptEntry>(paths.systemPrompt(id))
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 404) throw error
    acceptSystemPromptAbsence(id)
    return undefined
  }
}

/** Re-read only the addressed prompt definition before Retry/Dismiss. */
export async function reconcileSystemPromptDefinition(id: string): Promise<SystemPromptEntry | undefined> {
  const incoming = await readSystemPromptExact(id)
  if (!incoming) return undefined
  return acceptSystemPromptDefinition(incoming)
}

/** Patch sparse prompt intent against the revision the editor read. */
export async function patchSystemPromptDefinition(
  id: string,
  patch: SystemPromptDefinitionMutationPatch,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<SystemPromptEntry> {
  const request = { ...patch, expectedRevision } satisfies UpdateSystemPromptRequest
  const prompt = await apiPatch<SystemPromptEntry>(paths.systemPrompt(id), request, { idempotencyKey })
  const accepted = acceptSystemPromptDefinition(prompt)
  // Viewer-default state is independently stamped; refresh it after accepting
  // only the definition domain from this acknowledgement.
  invalidate(keys.systemPrompts)
  return accepted
}

/** Remove one reviewed reusable prompt. The deletion controller owns named
 * confirmation, Retry/Dismiss, and exact-absence reconciliation. */
export async function deleteSystemPrompt(
  id: string,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<void> {
  await apiDelete(
    paths.systemPrompt(id),
    { expectedRevision } satisfies DeleteSystemPromptRequest,
    { idempotencyKey },
  )
  acceptSystemPromptAbsence(id)
}

// ── Worker Agents (the Agents hub — docs/agent-commons.md, D6) ───────────────

/** Project an acknowledged Agent configuration without letting its response
 * rewind independently moving reputation/fork activity. */
export function acceptAgentConfiguration(agent: Agent): void {
  mutate<Agent[]>(keys.workerAgents, (rows) => {
    const current = rows ?? []
    const index = current.findIndex((candidate) => candidate.id === agent.id)
    // PATCH cannot create. If an ambient delete already removed this row while
    // the acknowledgement was in flight, never resurrect it from the delayed
    // response; the controller had loaded the addressed row before mutation.
    if (index < 0) return current
    return current.map((candidate, position) =>
      position === index ? mergeAgentConfiguration(candidate, agent) : candidate,
    )
  })
}

/** Publish one proven Agent absence and invalidate every public/private face
 * derived from that definition. Project delegation lists heal from the
 * server's project-addressed events because their ids are not carried here. */
function acceptAgentAbsence(id: string): void {
  mutate<Agent[]>(keys.workerAgents, (rows) =>
    (rows ?? []).filter((candidate) => candidate.id !== id))
  invalidate(keys.agentProposals(id))
  invalidatePrefix(keys.directoryAgents())
  invalidatePrefix(keys.agentForks())
  invalidatePrefix(keys.ownerProfile())
  invalidatePrefix(keys.search())
}

/** Re-read only the addressed Agent after conflict or uncertain acknowledgement.
 * Replacing the whole registry could rewind an unrelated row that moved while
 * this request was in flight. */
export async function reconcileAgentConfiguration(id: string): Promise<Agent | undefined> {
  let incoming: Agent
  try {
    incoming = await apiGet<Agent>(paths.agent(id))
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 404) throw error
    acceptAgentAbsence(id)
    return undefined
  }
  acceptAgentConfiguration(incoming)
  return incoming
}

/** Transport one revision-checked Agent configuration edit. The controller
 * owns serialization, retry, and recovery; this door publishes only an
 * acknowledgement that survives the monotonic cache fence. */
export async function patchAgent(
  id: string,
  patch: AgentConfigurationPatch,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<Agent> {
  const agent = await apiPatch<Agent>(
    paths.agent(id),
    { ...patch, expectedRevision } satisfies UpdateAgentRequest,
    { idempotencyKey },
  )
  acceptAgentConfiguration(agent)
  if ('published' in patch) {
    invalidatePrefix(keys.directoryAgents())
    invalidatePrefix(keys.agentForks())
  }
  return agent
}

/** Absolute URL of a published Agent's A2A card (D20) — a public GET, linkable
 *  from the UI so an owner can hand their agent's front door to a foreign peer.
 *  The card is handed OUT of this browser (pasted into a foreign framework), so a
 *  same-origin relative base must resolve against the page's origin — a bare
 *  `/api/v1/…` path is undialable by the peer and rejected by the import
 *  validator. `new URL` leaves an absolute `VITE_API_BASE` untouched. */
export function a2aAgentCardUrl(id: string): string {
  return new URL(`${API_BASE}${paths.a2aAgentCard(id)}`, window.location.origin).toString()
}

/** Redeem a share-link token (S6): the signed-in caller becomes audience at
 *  the grant's tier; returns the subject so the caller can land on its page.
 *  An unknown/rotated token throws (the 404). */
export async function redeemShareLink(token: string): Promise<{ subject: { kind: string; id: string }; tier: string }> {
  const out = await apiPost<{ subject: { kind: string; id: string }; tier: string }>(paths.grantRedeem(), { token })
  invalidatePrefix(keys.grants())
  invalidate(keys.projects)
  invalidate(keys.relations)
  invalidate(keys.commons)
  return out
}

/** ── The person layer (S7) ───────────────────────────────────────────────────
 *  Follow / unfollow a workspace by its public display name. Explicit state,
 *  never a toggle: two clients pressing at once must converge on what the user
 *  asked for. Invalidates the FEED as well as the list, because `followed` is a
 *  server-stamped field on every item — the Following lens would otherwise show
 *  a stale set until the next refetch. */
export async function setFollow(name: string, following: boolean): Promise<string[]> {
  const list = await apiPost<string[]>(paths.socialFollow(), { name, following } satisfies SetFollowRequest)
  invalidate(keys.follows)
  invalidate(keys.commons)
  invalidate(keys.ownerProfile(name))
  return list
}

/** Mark a thread read up to its newest post — what clears the inbox's unread
 *  dot. A private note to self: it rings nobody and moves no wall, so a failure
 *  is swallowed rather than surfaced (the `recordView` posture). */
export async function markDiscussionRead(did: string): Promise<void> {
  await apiPost<{ ok: true }>(paths.discussionRead(did), {} satisfies MarkDiscussionReadRequest)
  invalidate(keys.directMessages)
  invalidate(keys.discussion(did))
}

/** Set the caller's one thin reaction explicitly. A retry sends the same desired
 * state instead of toggling it back off. */
export async function reactToDiscussionPost(
  did: string,
  pid: string,
  anchorRef: { kind: string; id: string },
  reacted: boolean,
): Promise<void> {
  const d = await apiPost<Discussion>(
    paths.discussionReact(did, pid),
    { reacted } satisfies SetDiscussionReactionRequest,
    { idempotencyKey: crypto.randomUUID() },
  )
  const acknowledged = d.posts.find((post) => post.id === pid)
  if (
    d.id !== did ||
    d.anchor.ref.kind !== anchorRef.kind ||
    d.anchor.ref.id !== anchorRef.id ||
    !acknowledged ||
    (acknowledged.reacted === true) !== reacted
  ) {
    throw new Error('The endorsement acknowledgement did not match this post.')
  }
  mutate<Discussion>(keys.discussion(did), (current) => {
    if (!current) return d
    return {
      ...current,
      posts: current.posts.map((post) => {
        if (post.id !== pid) return post
        const { reacted: _reacted, ...rest } = post
        return {
          ...rest,
          reactions: acknowledged.reactions,
          ...(acknowledged.reacted ? { reacted: true } : {}),
        }
      }),
    }
  })
  invalidate(keys.discussions(anchorRef.kind, anchorRef.id))
  invalidate(keys.discussion(did))
}

/** Report a post to whoever holds the delete — the anchor's owner (S5: owner
 *  moderation first; instance-level escalation is S6). Rings their bell. */
export async function reportDiscussionPost(did: string, pid: string): Promise<void> {
  const response = await apiPost<ReportDiscussionPostResponse>(
    paths.discussionPostReport(did, pid),
    {},
    { idempotencyKey: crypto.randomUUID() },
  )
  const acknowledged = response.discussion.posts.find((post) => post.id === pid)
  if (response.ok !== true || response.discussion.id !== did || acknowledged?.reported !== true) {
    throw new Error('The report acknowledgement did not match this discussion.')
  }
  mutate<Discussion>(keys.discussion(did), (current) => {
    if (!current) return response.discussion
    return {
      ...current,
      posts: current.posts.map((post) => post.id === pid ? { ...post, reported: true } : post),
    }
  })
  invalidate(keys.discussions(response.discussion.anchor.ref.kind, response.discussion.anchor.ref.id))
  invalidate(keys.myDiscussions)
  invalidate(keys.directMessages)
  invalidate(keys.commons)
  invalidate(keys.discussion(did))
}

/** Publish one acknowledged proposal verdict into the addressed list without
 * waiting for its ambient echo. */
function acceptSocialProposal(subject: { kind: string; id: string }, proposal: SocialProposal): void {
  mutate<SocialProposal[]>(keys.socialProposals(subject.kind, subject.id), (list) => {
    if (!list) return [proposal]
    return list.map((candidate) => candidate.id === proposal.id ? proposal : candidate)
  })
}

/** Re-read one subject's proposal ledger after an uncertain verdict. */
export async function reconcileSocialProposals(subject: { kind: string; id: string }): Promise<SocialProposal[]> {
  const list = await apiGet<SocialProposal[]>(paths.socialProposals(subject.kind, subject.id))
  setData(keys.socialProposals(subject.kind, subject.id), list)
  return list
}

/** Land an offered proposal — the subject owner's consent (applies the frozen
 * reviewed delta). The controller retains `idempotencyKey` across Retry. */
export async function landSocialProposal(
  pid: string,
  subject: { kind: string; id: string },
  idempotencyKey: string,
): Promise<SocialProposal> {
  const p = await apiPost<SocialProposal>(paths.socialProposalLand(pid), {}, { idempotencyKey })
  acceptSocialProposal(subject, p)
  // Landing can make sibling proposals stale; retain this acknowledgement for
  // immediate paint, then reconcile the whole reviewed ledger.
  invalidate(keys.socialProposals(subject.kind, subject.id))
  invalidate(keys.relations)
  invalidate(keys.projects)
  // Applying deltas can rewrite a routine or artifact body. Heal the acting
  // client immediately; the advisory SSE arms do the same for other clients.
  invalidate(keys.schedules)
  invalidate(keys.artifactContent)
  return p
}

const cachedArtifactRows = (): ArtifactItem[] => [
  ...(peek<RelationGraph>(keys.relations)?.extraArtifacts ?? []),
  ...(peek<ArtifactItem[]>(keys.artifacts) ?? []),
]

function cachedArtifactBody(
  artifactId: string,
  library: ArtifactContentLibrary | undefined = peek<ArtifactContentLibrary>(keys.artifactContent),
): ArtifactContent | undefined {
  if (!library) return undefined
  const artifact = cachedArtifactRows().find((row) => row.id === artifactId)
  return library[artifactId] ?? (artifact ? library[artifact.name] : undefined)
}

/** Controller snapshot of the body currently projected for one artifact. */
export const peekArtifactContent = (artifactId: string): ArtifactContent | undefined =>
  cachedArtifactBody(artifactId)

/** Publish one acknowledged body without replacing unrelated bodies from the
 * full library. The exact id key is authoritative; the legacy name key is safe
 * to update only when it names one visible artifact. */
export function acceptArtifactContent(artifactId: string, incoming: ArtifactContent): ArtifactContent {
  const rows = cachedArtifactRows()
  const artifact = rows.find((row) => row.id === artifactId)
  const current = cachedArtifactBody(artifactId)
  const accepted = current ? mergeArtifactContent(current, incoming) : incoming
  const uniqueName = artifact
    ? rows.filter((row) => row.name === artifact.name).length === 1
    : false
  mutate<ArtifactContentLibrary>(keys.artifactContent, (library) => ({
    ...(library ?? {}),
    [artifactId]: accepted,
    ...(artifact && uniqueName ? { [artifact.name]: accepted } : {}),
  }))
  return accepted
}

/** Re-read the library after a conflict but project only this artifact. A full
 * response must not rewind a different body that moved while it was in flight. */
export async function reconcileArtifactContent(artifactId: string): Promise<ArtifactContent | undefined> {
  const incomingLibrary = await apiGet<ArtifactContentLibrary>(paths.artifactContent)
  const incoming = cachedArtifactBody(artifactId, incomingLibrary)
  if (!incoming) return undefined
  if (!peek<ArtifactContentLibrary>(keys.artifactContent)) {
    setData(keys.artifactContent, incomingLibrary)
    return incoming
  }
  return acceptArtifactContent(artifactId, incoming)
}

/** Transport one revision-checked block rewrite. The controller owns ordering,
 * retained intent, and retry; this door publishes only the acknowledgement. */
export async function patchArtifactContent(
  artifactId: string,
  patch: ArtifactContentPatch,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<ArtifactContent> {
  const body = await apiPatch<ArtifactContent>(
    paths.artifactContentEdit(artifactId),
    { ...patch, expectedRevision } satisfies UpdateArtifactContentRequest,
    { idempotencyKey },
  )
  acceptArtifactContent(artifactId, body)
  return body
}

/** Decline an offered proposal — the owner's polite no. */
export async function declineSocialProposal(
  pid: string,
  subject: { kind: string; id: string },
  idempotencyKey: string,
): Promise<SocialProposal> {
  const p = await apiPost<SocialProposal>(paths.socialProposalDecline(pid), {}, { idempotencyKey })
  acceptSocialProposal(subject, p)
  invalidate(keys.socialProposals(subject.kind, subject.id))
  return p
}

/** Exercise a Delegation on a contribution (CW8): mechanical escalation
 *  triggers first, then the mock decision — draft records, decide executes
 *  AS the delegator, dual-stamped. */
export async function runDelegation(projectId: string, cid: string, did: string): Promise<Contribution> {
  const c = await apiPost<Contribution>(paths.contributionDelegated(projectId, cid, did), {})
  invalidate(keys.contributions(projectId))
  return c
}

/** Watch / unwatch a Project (D24) — the bell subscription. */
export async function setProjectWatch(projectId: string, watching: boolean): Promise<WatchState> {
  const state = await apiPost<WatchState>(paths.projectWatch(projectId), { watching })
  setData(keys.projectWatch(projectId), state)
  // The feed carries each item's `watched` for the Commons' Watched lens (S4),
  // so a watch changed from the project page must not leave that lens stale.
  invalidate(keys.commons)
  return state
}

/** ── The Commons lens acts (S4) ──────────────────────────────────────────────
 *  Watched / Liked / Posted / Recently viewed are the viewer's own
 *  relationships to a feed item, stamped by the server on every read. These are
 *  the three writes that move them ("posted" needs none — it IS the actor). */

/** Like / unlike one feed item. The response is that item's fresh counts; the
 *  feed cache is invalidated so the card and the lens agree. */
export async function setCommonsLike(itemId: string, liked: boolean): Promise<{ likes: number; liked: boolean }> {
  const out = await apiPost<{ likes: number; liked: boolean }>(paths.commonsLike(itemId), { liked })
  invalidate(keys.commons)
  return out
}

/** Watch / unwatch ANY subject — the general door behind the feed card's toggle.
 *  A project subject also refreshes that project's own watch state, so the page
 *  and the card can never disagree about the same subscription. */
export async function setSocialWatch(subject: SocialEntityRef, watching: boolean): Promise<WatchState> {
  const state = await apiPost<WatchState>(paths.socialWatch(), { subject, watching })
  if (subject.kind === 'project') setData(keys.projectWatch(subject.id), state)
  invalidate(keys.commons)
  return state
}

/** Record that the caller opened a subject's page — the "Recently viewed" ledger.
 *  Fire-and-forget by design: it is a private note to self, so a failed write is
 *  never worth interrupting a page load over. */
export async function recordView(subject: SocialEntityRef): Promise<void> {
  try {
    await apiPost<{ ok: true }>(paths.socialViewed(), { subject })
    invalidate(keys.commons)
  } catch {
    /* a view is not worth an error */
  }
}

/** Mark inbox rows read (D24) — the named ids, or all. The server answers with the
 *  full refreshed inbox; seed it so the bell count settles without a refetch. */
export async function markNotificationsRead(ids?: string[]): Promise<AppNotification[]> {
  const inbox = await apiPost<AppNotification[]>(paths.notificationsRead, ids ? { ids } : {})
  setData(keys.notifications, inbox)
  return inbox
}

/** Remove the reviewed Agent definition. Confirmation and uncertainty remain
 * controller-owned; only acknowledgement or authoritative 404 publishes absence. */
export async function deleteAgent(
  id: string,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<void> {
  await apiDelete(
    paths.agent(id),
    { expectedRevision } satisfies DeleteAgentRequest,
    { idempotencyKey },
  )
  acceptAgentAbsence(id)
}

// ── Sessions (the sidebar row menu's edits) ─────────────────────────────────

/** Project an acknowledged session-metadata response into every live cache
 * without replacing the bounded transcript/workspace carried by a by-id read. */
export function acceptSessionMetadata(session: Session): void {
  const merge = (current: Session): Session =>
    shouldAcceptEntityRevision(current.metadataRevision, session.metadataRevision)
      ? {
          ...current,
          title: session.title,
          status: session.status,
          pinned: session.pinned,
          agentId: session.agentId,
          providerId: session.providerId,
          modelId: session.modelId,
          updatedAt: session.updatedAt,
          metadataRevision: session.metadataRevision,
        }
      : current
  mutate<Session[]>(keys.sessions, (list) =>
    (list ?? []).map((candidate) => (candidate.id === session.id ? merge(candidate) : candidate)),
  )
  mutate<Session>(keys.session(session.id), (current) => merge(current ?? session))
}

/** Patch a session's row fields with the revision the controller read. The
 * controller owns serialization/retry; this backend door transports one
 * logical mutation and publishes only its acknowledged response. */
export async function patchSession(
  id: string,
  patch: SessionMetadataPatch,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<Session> {
  const session = await apiPatch<Session>(
    paths.session(id),
    { ...patch, expectedRevision } satisfies UpdateSessionRequest,
    { idempotencyKey },
  )
  acceptSessionMetadata(session)
  // A model pick changes what the usage gauge measures against (the provider-
  // sourced context window) — refresh the snapshot the composer strip reads.
  if (patch.providerId !== undefined || patch.modelId !== undefined) invalidate(keys.usage(id))
  return session
}

/** Delete one reviewed conversation row. The controller owns retry,
 * reconciliation, and pane eviction; this door publishes absence only after
 * the server acknowledges the pinned logical mutation. */
export async function deleteSession(
  id: string,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<void> {
  await apiDelete(
    paths.session(id),
    { expectedRevision } satisfies DeleteSessionRequest,
    { idempotencyKey },
  )
  mutate<Session[]>(keys.sessions, (list) => (list ?? []).filter((session) => session.id !== id))
  invalidate(keys.session(id))
}

/** Compact a session's context (MODEL-32) — server-owned; the selected provider
 *  prepares a continuation brief and the backend archives older originals only after
 *  compare-before-commit. Returns the bounded active session; invalidates that session,
 *  usage, and every archive page so the thread and composer's token overlay refresh. */
export async function compactSession(sessionId: string): Promise<Session> {
  const session = await apiPost<Session>(paths.sessionCompact(sessionId), {})
  invalidate(keys.session(sessionId))
  invalidate(keys.usage(sessionId))
  invalidatePrefix(keys.sessionCompactedMessages(sessionId))
  return session
}

// ── Saved contexts (the Contexts page) ──────────────────────────────────────

/** Publish one status acknowledgement through its orthogonal monotonic fence.
 * A removed row is never resurrected by a late response. */
function acceptSavedContextConnection(incoming: SavedContext): SavedContext {
  const current = peek<SavedContextsSnapshot>(keys.savedContexts)
    ?.contexts.find((context) => context.id === incoming.id)
  const accepted = current ? mergeSavedContextConnection(current, incoming) : incoming
  mutate<SavedContextsSnapshot>(keys.savedContexts, (snapshot) =>
    snapshot
      ? mergeSavedContextConnectionSnapshot(snapshot, incoming.id, incoming)
      : snapshot as unknown as SavedContextsSnapshot,
  )
  return accepted
}

/** Re-read only one Context connection after conflict or uncertainty. The GET is
 * a full registry for API compatibility, but applying it cannot rewind sibling
 * rows or resurrect a locally acknowledged removal. */
export async function reconcileSavedContextConnection(id: string): Promise<SavedContext | undefined> {
  const incomingSnapshot = await apiGet<SavedContextsSnapshot>(paths.savedContexts)
  const incoming = incomingSnapshot.contexts.find((context) => context.id === id)
  const currentSnapshot = peek<SavedContextsSnapshot>(keys.savedContexts)
  if (!currentSnapshot) {
    setData(keys.savedContexts, incomingSnapshot)
    return incoming
  }
  mutate<SavedContextsSnapshot>(keys.savedContexts, (snapshot) =>
    snapshot
      ? mergeSavedContextConnectionSnapshot(snapshot, id, incoming)
      : snapshot as unknown as SavedContextsSnapshot,
  )
  return incoming
}

/** Transport one revision-checked connect/disconnect intent. The controller
 * owns serialization and recovery; this door publishes only acknowledged state. */
export async function patchSavedContextConnection(
  id: string,
  status: ContextStatus,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<SavedContext> {
  const snapshot = await apiPatch<SavedContextsSnapshot>(
    paths.savedContext(id),
    { status, expectedRevision } satisfies SetConnectorStatusRequest,
    { idempotencyKey },
  )
  const incoming = snapshot.contexts.find((context) => context.id === id)
  if (!incoming) throw new ApiRequestError('internal', 'The updated context was missing from its acknowledgement.', 500)
  return acceptSavedContextConnection(incoming)
}

/** Save a context to the set-up registry (the Contexts page's Add). Optimistic —
 *  the row appears instantly — then POSTs the canonical write (idempotent by id;
 *  the server broadcasts `savedcontext.changed` for every other client). */
export async function addSavedContext(context: SavedContext): Promise<void> {
  mutate<SavedContextsSnapshot>(keys.savedContexts, (snap) => {
    if (!snap) return snap as unknown as SavedContextsSnapshot
    if (snap.contexts.some((c) => c.id === context.id)) return snap
    return { ...snap, contexts: [context, ...snap.contexts] }
  })
  try {
    await apiPost(paths.savedContexts, { context })
    invalidate(keys.savedContexts)
  } catch {
    invalidate(keys.savedContexts)
  }
}

/** Delete one reviewed reusable setup. The controller owns confirmation,
 * retry, and lost-ack reconciliation; absence is published only after the
 * server acknowledges the pinned logical mutation. */
export async function deleteSavedContext(
  id: string,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<void> {
  await apiDelete(
    paths.savedContext(id),
    { expectedRevision } satisfies DeleteSavedContextRequest,
    { idempotencyKey },
  )
  mutate<SavedContextsSnapshot>(keys.savedContexts, (snapshot) =>
    snapshot
      ? mergeSavedContextConnectionSnapshot(snapshot, id, undefined)
      : snapshot as unknown as SavedContextsSnapshot,
  )
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
