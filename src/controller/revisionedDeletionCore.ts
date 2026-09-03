/** Acknowledgement-gated, revision-pinned deletion for any server resource.
 *
 * The pure FIFO keeps destructive intent until server truth says the row is
 * absent. A stale conflict may rebase only after reconciliation and an explicit
 * Retry; transport uncertainty retains the exact revision the person confirmed.
 */
import {
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
  type RevisionedMutationStatus,
} from './revisionedMutationCore.ts'

export interface RevisionedDeletionMutationDeps<Resource, Revision = number> {
  reconcile: (resourceId: string) => Promise<Resource | null>
  mutate: (resourceId: string, expectedRevision: Revision, idempotencyKey: string) => Promise<void>
  revision: (resource: Resource) => Revision
  describeFailure: (error: unknown) => RevisionedMutationFailure & { rebaseOnRetry: boolean }
  setStatus: (status: RevisionedMutationStatus) => void
  mintIdempotencyKey: () => string
}

interface QueueEntry<Revision> {
  resourceId: string
  expectedRevision: Revision
  idempotencyKey: string
  settle: Array<(outcome: RevisionedMutationOutcome) => void>
}

export function createRevisionedDeletionMutationController<Resource, Revision = number>(
  deps: RevisionedDeletionMutationDeps<Resource, Revision>,
) {
  let queue: QueueEntry<Revision>[] = []
  let running = false
  let failure: RevisionedMutationFailure | null = null
  let generation = 0

  const publish = (): void => {
    deps.setStatus({
      busy: running,
      error: failure?.message ?? null,
      retryable: failure?.retryable ?? false,
      activeResourceId: queue[0]?.resourceId ?? null,
      pendingCount: queue.length,
    })
  }

  const settleHead = (entry: QueueEntry<Revision>, outcome: RevisionedMutationOutcome): void => {
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

    // Preserve immediate FIFO dispatch while adapting a synchronous adapter
    // throw into the same reconciliation path as an async rejection.
    let mutation: Promise<void>
    try {
      mutation = deps.mutate(entry.resourceId, entry.expectedRevision, entry.idempotencyKey)
    } catch (error) {
      mutation = Promise.reject(error)
    }
    void mutation.then(
      () => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        running = false
        settleHead(entry, 'applied')
      },
      async (error: unknown) => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        let current: Resource | null | undefined
        try {
          current = await deps.reconcile(entry.resourceId)
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
        // Only an explicit stale-conflict recovery expands the reviewed
        // precondition. Uncertain transport retains the original consent.
        if (described.rebaseOnRetry && current) {
          entry.expectedRevision = deps.revision(current)
        }
        failure = described
        publish()
      },
    )
  }

  const enqueue = (resourceId: string, expectedRevision: Revision): Promise<RevisionedMutationOutcome> => {
    const existing = queue.find((entry) => entry.resourceId === resourceId)
    if (existing) return new Promise((settle) => existing.settle.push(settle))
    const result = new Promise<RevisionedMutationOutcome>((settle) => {
      queue.push({ resourceId, expectedRevision, idempotencyKey: deps.mintIdempotencyKey(), settle: [settle] })
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
    let reconciliation: Promise<Resource | null>
    try {
      reconciliation = deps.reconcile(entry.resourceId)
    } catch (error) {
      reconciliation = Promise.reject(error)
    }
    void reconciliation.then(
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
