/** ── Commands ──────────────────────────────────────────────────────────────
 *  The UI's writes. Reads come back through hooks + the cache; writes go here.
 *  Phase 3 starts with the streaming send — the one command whose response is
 *  itself a stream (the assistant turn), mirroring the Anthropic Messages API. */
import {
  applyGraphOp,
  emptyGraph,
  type ApplyOpRequest,
  type RelationGraph,
  type RelationOp,
  type ReplyStreamEvent,
  type RunSessionEntry,
  type ScheduledTask,
  type SendMessageRequest,
  type Session,
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
  const body: ApplyOpRequest = { op }
  const updated = await apiPost<RelationGraph>(paths.relationOps, body)
  setData(keys.relations, updated)
}

// ── Scheduled routines ──────────────────────────────────────────────────────

/** Run a routine now. The server appends the run + broadcasts run.* events, which
 *  invalidate the feed; we also nudge the local caches so it shows immediately. */
export async function runScheduleNow(id: string): Promise<void> {
  await apiPost(paths.scheduleRun(id))
  invalidate(keys.recentRuns)
  invalidate(keys.schedules)
}

/** Toggle a routine on/off. */
export async function toggleScheduleEnabled(id: string): Promise<void> {
  await apiPatch(paths.schedule(id), {})
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
