/** Serialized, retryable context-state mutations.
 *
 * Context bindings authorize effects, so their visible panels do not land on
 * an optimistic promise. Each session owns one FIFO: the head is planned from
 * the latest acknowledged live state, binding operations + workspace commit in
 * one request, and only then projects the acknowledgement locally. A failed
 * head remains in place for an explicit retry; later user intents wait behind
 * it instead of racing or silently disappearing. */
import type {
  PanelFocus,
  SessionContextOperation,
  SessionContextState,
  UpdateSessionContextStateRequest,
} from '../../contract/index.ts'
import { focusValidIn, workspaceOf, type Live } from '../data/liveSession.ts'
import { sameFocus } from '../lib/focus.ts'
import type { ContextMutationStatus } from './conversationCore.ts'
import type { RefreshServedAttachmentRequest } from '../../contract/servedTextSnapshot.ts'
import { workspaceFolders } from '../../contract/workspaceFolders.ts'
import { attachmentSnapshotId } from '../../contract/attachmentInput.ts'

export interface ContextMutationSnapshot {
  live: Live
  focus: PanelFocus | null
}

export interface ContextMutationPlan {
  live: Live
  focus: PanelFocus | null
  operations: SessionContextOperation[]
  attachmentRefresh?: RefreshServedAttachmentRequest & {
    attachmentId: string
    reconciled?: boolean
    baselineSnapshotId?: string | null
  }
  folderRefresh?: RefreshServedAttachmentRequest & {
    folderId: string
    kind?: 'local'
    reconciled?: boolean
    baselineSnapshotId?: string | null
  }
}

export interface ContextMutationIntent {
  /** Account source captured when queued; retries must retain this precondition. */
  expectedSessionUserId?: string | null
  plan: (snapshot: ContextMutationSnapshot) => ContextMutationPlan
  /** Targeted refresh participates in the same FIFO without replacing stale
   * whole-workspace state on the server. It returns the usual acknowledgement. */
  mutate?: (snapshot: ContextMutationSnapshot, plan: ContextMutationPlan, expectedSessionUserId?: string | null) => Promise<SessionContextState>
  /** Read authoritative current state before an explicit safe dismissal. This
   *  is never called for retry-only intents and must not issue another write. */
  reconcile?: (snapshot: ContextMutationSnapshot, signal: AbortSignal) => Promise<SessionContextState>
  /** Runs only after the atomic server acknowledgement (recents promotion is
   * the earned example); it can never make a failed attachment look recent. */
  afterCommit?: () => void
}

export type ContextMutationOutcome = 'applied' | 'discarded'

export interface ContextMutationDeps {
  snapshot: (sessionId: string) => ContextMutationSnapshot
  mutate: (sessionId: string, request: UpdateSessionContextStateRequest, expectedSessionUserId?: string | null) => Promise<SessionContextState>
  commit: (
    sessionId: string,
    before: ContextMutationSnapshot,
    planned: ContextMutationPlan,
    returned: SessionContextState,
  ) => void
  setStatus: (sessionId: string, status: ContextMutationStatus) => void
}

interface QueueEntry {
  intents: Array<{
    intent: ContextMutationIntent
    settle: (outcome: ContextMutationOutcome) => void
  }>
  running: boolean
  failed: boolean
  failedPlan?: ContextMutationPlan
  reconcileController?: AbortController
}

const idle = (): ContextMutationStatus => ({ busy: false, error: null, retryable: false })

const equalFocus = (a: PanelFocus | null, b: PanelFocus | null): boolean =>
  a === null || b === null ? a === b : sameFocus(a, b)

/** Reconcile focus after an acknowledged context mutation. An own SSE echo may
 * have projected the planned focus first; it is still attributable to this
 * mutation and must be persisted. A genuinely different, valid user choice
 * made while the request was in flight wins. */
export function contextFocusAfterCommit(
  current: PanelFocus | null,
  before: PanelFocus | null,
  planned: PanelFocus | null,
  live: Live,
): { focus: PanelFocus | null; remember: boolean } {
  const followedPlan = equalFocus(current, planned)
  const startedUnchanged = equalFocus(current, before)
  let focus = startedUnchanged ? planned : current
  const invalidated = !!focus && !focusValidIn(live, focus)
  if (invalidated) focus = null
  return { focus, remember: startedUnchanged || followedPlan || invalidated }
}

function failureMessage(error: unknown): string {
  const detail = error instanceof Error && error.message.trim() ? ` ${error.message.trim()}` : ''
  return `Couldn’t confirm the context update.${detail}`
}

export function createContextMutationController(deps: ContextMutationDeps) {
  const queues = new Map<string, QueueEntry>()

  const drain = (sessionId: string, entry: QueueEntry): void => {
    if (entry.running || entry.failed || entry.intents.length === 0 || queues.get(sessionId) !== entry) return
    const queued = entry.intents[0]!
    const intent = queued.intent
    const before = deps.snapshot(sessionId)
    let planned: ContextMutationPlan
    entry.failedPlan = undefined
    try {
      planned = intent.plan(before)
    } catch (error) {
      entry.failed = true
      deps.setStatus(sessionId, { busy: false, error: failureMessage(error), retryable: true })
      return
    }
    entry.running = true
    deps.setStatus(sessionId, { busy: true, error: null, retryable: false })
    entry.failedPlan = planned
    void (intent.mutate
      ? intent.mutate(before, planned, intent.expectedSessionUserId)
      : deps.mutate(sessionId, { operations: planned.operations, workspace: workspaceOf(planned.live) }, intent.expectedSessionUserId))
      .then(
        (returned) => {
          // An account switch clears the queue; its late response belongs to a
          // world that no longer exists and must not recreate local state.
          if (queues.get(sessionId) !== entry) return
          entry.running = false
          entry.intents.shift()
          // A local projection or recents write must not turn a successful
          // server transaction into a fake transport failure.
          try {
            deps.commit(sessionId, before, planned, returned)
            intent.afterCommit?.()
          } catch {
            // The next authoritative session read still reconciles the result.
          }
          queued.settle('applied')
          if (entry.intents.length === 0) {
            queues.delete(sessionId)
            deps.setStatus(sessionId, idle())
            return
          }
          drain(sessionId, entry)
        },
        (error: unknown) => {
          if (queues.get(sessionId) !== entry) return
          entry.running = false
          entry.failed = true
          deps.setStatus(sessionId, {
            busy: false,
            error: failureMessage(error),
            retryable: true,
            ...(intent.reconcile ? { dismissible: true } : {}),
          })
        },
      )
  }

  const enqueue = (sessionId: string, intent: ContextMutationIntent): Promise<ContextMutationOutcome> => {
    let entry = queues.get(sessionId)
    if (!entry) {
      entry = { intents: [], running: false, failed: false }
      queues.set(sessionId, entry)
    }
    const result = new Promise<ContextMutationOutcome>((settle) => {
      entry!.intents.push({ intent, settle })
    })
    // A failed head stays visible and explicit; this new intent waits behind it
    // until Retry, preserving user order instead of skipping the failed act.
    if (!entry.failed) drain(sessionId, entry)
    return result
  }

  const retry = (sessionId: string): void => {
    const entry = queues.get(sessionId)
    if (!entry || !entry.failed || entry.running) return
    entry.failed = false
    drain(sessionId, entry)
  }

  const dismiss = (sessionId: string): void => {
    const entry = queues.get(sessionId)
    const queued = entry?.intents[0]
    const intent = queued?.intent
    const reconcile = intent?.reconcile
    if (!entry || !queued || !entry.failed || entry.running || !reconcile || !entry.failedPlan) return

    const before = deps.snapshot(sessionId)
    const plan = entry.failedPlan.attachmentRefresh
      ? {
          ...entry.failedPlan,
          focus: before.focus,
          attachmentRefresh: {
            ...entry.failedPlan.attachmentRefresh,
            reconciled: true,
            baselineSnapshotId: attachmentSnapshotId(before.live.attachments.find((item) => item.id === entry.failedPlan!.attachmentRefresh!.attachmentId)),
          },
        }
      : entry.failedPlan.folderRefresh
        ? {
            ...entry.failedPlan,
            focus: before.focus,
            folderRefresh: {
              ...entry.failedPlan.folderRefresh,
              reconciled: true,
              baselineSnapshotId: before.live.workspaces.flatMap((workspace) => workspaceFolders(workspace))
                .find((folder) => folder.id === entry.failedPlan!.folderRefresh!.folderId)
                ?.[entry.failedPlan.folderRefresh.kind === 'local' ? 'localSnapshot' : 'snapshot']?.snapshotId ?? null,
            },
          }
        : entry.failedPlan
    const controller = new AbortController()
    entry.reconcileController = controller
    entry.running = true
    deps.setStatus(sessionId, { busy: true, error: null, retryable: false, reconciling: true })

    void Promise.resolve()
      .then(() => {
        if (controller.signal.aborted || queues.get(sessionId) !== entry) {
          throw new Error('Context reconciliation was cancelled.')
        }
        return reconcile(before, controller.signal)
      })
      .then(
        (returned) => {
          if (queues.get(sessionId) !== entry) return
          entry.reconcileController = undefined
          entry.running = false
          entry.failed = false
          entry.failedPlan = undefined
          entry.intents.shift()
          // A canonical read is enough to release an abandoned intent, even if
          // its projection callback fails; a later session read can heal it.
          try { deps.commit(sessionId, before, plan, returned) } catch { /* keep server truth authoritative */ }
          queued.settle('discarded')
          if (entry.intents.length === 0) {
            queues.delete(sessionId)
            deps.setStatus(sessionId, idle())
            return
          }
          drain(sessionId, entry)
        },
        (error: unknown) => {
          if (queues.get(sessionId) !== entry) return
          entry.reconcileController = undefined
          entry.running = false
          entry.failed = true
          deps.setStatus(sessionId, {
            busy: false,
            error: `Couldn’t check the current context. ${error instanceof Error ? error.message : ''}`.trim(),
            retryable: true,
            dismissible: true,
          })
        },
      )
  }

  const clearAll = (): void => {
    for (const entry of queues.values()) {
      entry.reconcileController?.abort()
      for (const queued of entry.intents) queued.settle('discarded')
    }
    queues.clear()
  }

  return { enqueue, retry, dismiss, clearAll }
}
