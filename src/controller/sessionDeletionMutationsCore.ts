/** Acknowledgement-gated, revision-pinned conversation deletion.
 *
 * The pure core keeps destructive intent queued until server truth says the
 * conversation is gone. A conflict refreshes the reviewed row for explicit
 * Retry; an uncertain response reconciles absence before it reports failure.
 */
import type { Session } from '../../contract/index.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
  type RevisionedMutationStatus,
} from './revisionedMutationCore.ts'

export interface SessionDeletionMutationDeps {
  reconcile: (sessionId: string) => Promise<Session | null>
  mutate: (sessionId: string, expectedRevision: number, idempotencyKey: string) => Promise<void>
  describeFailure: (error: unknown) => RevisionedMutationFailure & { rebaseOnRetry: boolean }
  setStatus: (status: RevisionedMutationStatus) => void
  mintIdempotencyKey: () => string
}

interface QueueEntry {
  sessionId: string
  expectedRevision: number
  idempotencyKey: string
  settle: Array<(outcome: RevisionedMutationOutcome) => void>
}

/** Translate the HTTP face without importing the browser API client into the
 * pure queue. Busy conflicts preserve the server's actionable explanation and
 * do not expand the revision the person confirmed; stale conflicts alone may
 * rebase a later explicit Retry after reconciliation. */
export function describeSessionDeletionHttpFailure(
  status: number,
  message: string,
): RevisionedMutationFailure & { rebaseOnRetry: boolean } {
  if (status === 409) {
    if (/current reply|current summary/i.test(message)) {
      return { message, retryable: true, rebaseOnRetry: false }
    }
    return {
      message: 'This conversation changed elsewhere. The latest version is loaded—review it, then retry deletion.',
      retryable: true,
      rebaseOnRetry: true,
    }
  }
  if (status === 400 || status === 404) {
    return { message: 'That conversation is no longer available. Dismiss the deletion to continue.', retryable: false, rebaseOnRetry: false }
  }
  if (status === 401 || status === 403) {
    return { message: 'You no longer have permission to delete that conversation. Dismiss it to continue.', retryable: false, rebaseOnRetry: false }
  }
  if (status === 429) {
    return { message: 'Too many changes at once. Retry deletion in a moment.', retryable: true, rebaseOnRetry: false }
  }
  return {
    message: 'Couldn’t confirm deletion. The conversation remains open—retry when the connection recovers.',
    retryable: true,
    rebaseOnRetry: false,
  }
}

export function createSessionDeletionMutationController(deps: SessionDeletionMutationDeps) {
  let queue: QueueEntry[] = []
  let running = false
  let failure: RevisionedMutationFailure | null = null
  let generation = 0

  const publish = (): void => {
    deps.setStatus({
      busy: running,
      error: failure?.message ?? null,
      retryable: failure?.retryable ?? false,
      activeResourceId: queue[0]?.sessionId ?? null,
      pendingCount: queue.length,
    })
  }

  const settleHead = (entry: QueueEntry, outcome: RevisionedMutationOutcome): void => {
    queue.shift()
    for (const settle of entry.settle) settle(outcome)
    publish()
    drain()
  }

  const drain = (): void => {
    if (running || failure || queue.length === 0) return
    const entry = queue[0]!
    const issuedGeneration = generation
    running = true
    publish()

    void (async () => {
      await deps.mutate(entry.sessionId, entry.expectedRevision, entry.idempotencyKey)
    })().then(
      () => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        running = false
        settleHead(entry, 'applied')
      },
      async (error: unknown) => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        let current: Session | null | undefined
        try {
          current = await deps.reconcile(entry.sessionId)
        } catch {
          // Preserve the originating error. Retry or Dismiss reconciles again.
        }
        if (generation !== issuedGeneration || queue[0] !== entry) return
        running = false
        // A response can be lost after commit. Authoritative absence completes
        // the logical deletion instead of presenting a false failure.
        if (current === null) {
          settleHead(entry, 'applied')
          return
        }
        const described = deps.describeFailure(error)
        // Reconciliation makes the newer row visible immediately, but only a
        // later explicit Retry uses it. Uncertain transport failures retain the
        // exact reviewed precondition and must encounter a 409 before rebasing.
        if (described.rebaseOnRetry && current) {
          entry.expectedRevision = current.metadataRevision ?? 0
        }
        failure = described
        publish()
      },
    )
  }

  const enqueue = (sessionId: string, expectedRevision: number): Promise<RevisionedMutationOutcome> => {
    const existing = queue.find((entry) => entry.sessionId === sessionId)
    if (existing) return new Promise((settle) => existing.settle.push(settle))
    const result = new Promise<RevisionedMutationOutcome>((settle) => {
      queue.push({ sessionId, expectedRevision, idempotencyKey: deps.mintIdempotencyKey(), settle: [settle] })
    })
    publish()
    drain()
    return result
  }

  const retry = (): void => {
    if (!failure || running || queue.length === 0 || !failure.retryable) return
    failure = null
    publish()
    drain()
  }

  const discard = (): void => {
    if (!failure || running || queue.length === 0) return
    const entry = queue[0]!
    const issuedGeneration = generation
    failure = null
    running = true
    publish()
    // Dismiss still resolves server truth before releasing later destructive
    // intent. If the delete landed, callers must evict; otherwise they retain it.
    void deps.reconcile(entry.sessionId).then(
      (current) => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        running = false
        settleHead(entry, current === null ? 'applied' : 'discarded')
      },
      () => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        running = false
        settleHead(entry, 'discarded')
      },
    )
  }

  const clearAll = (): void => {
    generation += 1
    running = false
    failure = null
    const abandoned = queue
    queue = []
    for (const entry of abandoned) {
      for (const settle of entry.settle) settle('discarded')
    }
    publish()
  }

  return { enqueue, retry, discard, clearAll }
}

export { IDLE_REVISIONED_MUTATION }
