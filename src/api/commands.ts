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
  type ContextTypeId,
  type EffectReport,
  type SyncEffectsResult,
  type RecentsSnapshot,
  type RelationGraph,
  type RelationOp,
  type ReplyStreamEvent,
  type RunSessionEntry,
  type ScheduledTask,
  type SendMessageRequest,
  type Session,
  type SessionContext,
} from '../../contract/index.ts'
import { API_BASE, apiDelete, apiPatch, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'

/** Callbacks for a streamed assistant turn. Each fires as its event arrives. */
export interface SendHandlers {
  /** The (empty) assistant message shell — append it, then fill via deltas. */
  onStart?: (messageId: string, message: Extract<ReplyStreamEvent, { type: 'message.start' }>['message']) => void
  /** A chunk of assistant text to append to the message. */
  onDelta?: (messageId: string, text: string) => void
  /** A mid-turn escalation (attach a workspace / repo). */
  onEscalate?: (messageId: string, escalate: 'workspace' | 'repo') => void
  /** A mid-turn relation proposal (render the confirm card). */
  onRelations?: (messageId: string, relationActions: Extract<ReplyStreamEvent, { type: 'message.relations' }>['relationActions']) => void
  /** The final, complete assistant message (authoritative). */
  onEnd?: (message: Extract<ReplyStreamEvent, { type: 'message.end' }>['message']) => void
}

/** Send a turn and stream the reply. Resolves when the stream ends. The optional
 *  AbortSignal lets the caller cancel an in-flight turn (e.g. on session switch). */
export async function sendMessage(
  sessionId: string,
  text: string,
  handlers: SendHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const body: SendMessageRequest = { text }
  const res = await fetch(`${API_BASE}${paths.session(sessionId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`send failed: ${res.status}`)

  const reader = res.body.getReader()
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

let optSeq = 0

/** Apply a confirmed relation edit. Optimistically patches the cached graph so
 *  the card flips instantly, then reconciles with the server's authoritative
 *  graph (which also broadcasts the change to other clients). `attach-context`
 *  is a live-session effect, not a graph edit, and is handled by the caller. */
export async function applyRelationOp(op: RelationOp): Promise<void> {
  mutate<RelationGraph>(keys.relations, (g) =>
    applyGraphOp(g ?? emptyGraph(), op, () => `art-opt-${(optSeq += 1)}`),
  )
  try {
    const body: ApplyOpRequest = { op }
    const updated = await apiPost<RelationGraph>(paths.relationOps, body)
    setData(keys.relations, updated)
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

/** Set a routine's enabled state (omit to toggle server-side). */
export async function toggleScheduleEnabled(id: string, enabled?: boolean): Promise<void> {
  await apiPatch(paths.schedule(id), { enabled })
  invalidate(keys.schedules)
  invalidate(keys.recentRuns)
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

/** Patch a session's row fields — rename / pin / archive — from the row menu.
 *  Optimistically patches the cached list (the row updates instantly), then PATCHes;
 *  the server's `session.updated` event reconciles every client. */
export async function patchSession(
  id: string,
  patch: { title?: string; status?: 'active' | 'archived'; pinned?: boolean },
): Promise<void> {
  mutate<Session[]>(keys.sessions, (list) =>
    (list ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)),
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
  apiPost(paths.recentsType(type), { id }).catch(() => invalidate(keys.recents))
}

// ── Native capabilities ─────────────────────────────────────────────────────

/** Invoke a capability on a connected agent's host — the addressed + routed call
 *  `(agent, capability, target)`. A write/effect command, not a read, so it goes
 *  here rather than through a hook; the agent enforces its scoped grant (D3) and
 *  the call rejects with `forbidden` / `capability_unavailable` accordingly.
 *  Returns the recorded effect; pass a stable `commandId` for idempotent retries. */
export async function invokeCapability(
  agentId: string,
  request: CapabilityRequest,
): Promise<CapabilityEffect> {
  const effect = await apiPost<CapabilityEffect>(paths.agentInvoke(agentId), request)
  invalidate(keys.agentEffects(agentId))
  return effect
}

/** Replay an agent's outbox to the server — effects it executed out-of-band (the
 *  co-located fast path, or while offline). Merged idempotently by commandId. */
export async function syncAgentEffects(
  agentId: string,
  effects: EffectReport[],
): Promise<SyncEffectsResult> {
  const result = await apiPost<SyncEffectsResult>(paths.agentSync(agentId), { effects })
  invalidate(keys.agentEffects(agentId))
  return result
}

function dispatch(event: ReplyStreamEvent, h: SendHandlers): void {
  switch (event.type) {
    case 'message.start':
      h.onStart?.(event.message.id, event.message)
      break
    case 'message.delta':
      h.onDelta?.(event.messageId, event.text)
      break
    case 'message.escalate':
      h.onEscalate?.(event.messageId, event.escalate)
      break
    case 'message.relations':
      h.onRelations?.(event.messageId, event.relationActions)
      break
    case 'message.end':
      h.onEnd?.(event.message)
      break
  }
}
