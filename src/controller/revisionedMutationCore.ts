/** A transport-neutral FIFO for optimistic-concurrency-controlled entity edits.
 *
 * Resource controllers provide how to read, reconcile, revise, and mutate one
 * entity. The shared queue preserves intent across an uncertain response,
 * rebases explicit Retry on authoritative truth, and fences old-account work.
 * It deliberately owns no React, cache, or HTTP knowledge. */

export type RevisionedMutationOutcome = 'applied' | 'discarded'

export interface RevisionedMutationFailure {
  message: string
  retryable: boolean
}

export interface RevisionedMutationStatus {
  busy: boolean
  error: string | null
  retryable: boolean
  activeResourceId: string | null
  pendingCount: number
}

export interface RevisionedMutationDeps<Resource, Patch> {
  snapshot: (resourceId: string) => Resource | undefined
  reconcile: (resourceId: string) => Promise<Resource>
  revision: (resource: Resource) => number
  mutate: (
    resourceId: string,
    patch: Patch,
    expectedRevision: number,
    idempotencyKey: string,
  ) => Promise<Resource>
  describeFailure: (error: unknown) => RevisionedMutationFailure
  /** Some mutations must keep their local intent held when Dismiss cannot
   *  establish authoritative truth. Returning true opts that patch into the
   *  hold; returning false treats the read error as safe to discard. */
  retainOnDismissReadFailure?: (patch: Readonly<Patch>, error?: unknown) => boolean
  setStatus: (status: RevisionedMutationStatus) => void
  mintIdempotencyKey: () => string
}

interface QueueEntry<Patch> {
  resourceId: string
  patch: Patch
  /** Optional user-reviewed base for the first attempt. It is consumed once:
   * an explicit Retry rebases on the authoritative reconciliation as before. */
  expectedRevision?: number
  idempotencyKey: string
  settle: (outcome: RevisionedMutationOutcome) => void
}

export const IDLE_REVISIONED_MUTATION: RevisionedMutationStatus = {
  busy: false,
  error: null,
  retryable: false,
  activeResourceId: null,
  pendingCount: 0,
}

export function createRevisionedMutationController<Resource, Patch>(
  deps: RevisionedMutationDeps<Resource, Patch>,
) {
  let queue: QueueEntry<Patch>[] = []
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

  const drain = (): void => {
    if (running || failure || queue.length === 0) return
    const entry = queue[0]!
    const issuedGeneration = generation
    running = true
    publish()

    void (async () => {
      const current = deps.snapshot(entry.resourceId) ?? await deps.reconcile(entry.resourceId)
      const expectedRevision = entry.expectedRevision ?? deps.revision(current)
      entry.expectedRevision = undefined
      return deps.mutate(
        entry.resourceId,
        entry.patch,
        expectedRevision,
        entry.idempotencyKey,
      )
    })().then(
      () => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        running = false
        queue.shift()
        entry.settle('applied')
        publish()
        drain()
      },
      async (error: unknown) => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        // A conflict and a lost acknowledgement both make the cached base
        // suspect. Re-read before offering Retry so it rebases on server truth.
        try {
          await deps.reconcile(entry.resourceId)
        } catch {
          // The original error is the actionable one; Retry can re-read again.
        }
        if (generation !== issuedGeneration || queue[0] !== entry) return
        running = false
        failure = deps.describeFailure(error)
        publish()
      },
    )
  }

  const enqueue = (
    resourceId: string,
    patch: Patch,
    expectedRevision?: number,
  ): Promise<RevisionedMutationOutcome> => {
    const result = new Promise<RevisionedMutationOutcome>((settle) => {
      queue.push({ resourceId, patch, expectedRevision, idempotencyKey: deps.mintIdempotencyKey(), settle })
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
    const retainOnReadFailure = deps.retainOnDismissReadFailure?.(entry.patch)
    // Legacy intents settle immediately, but keep their FIFO slot until the
    // read finishes. Binding intents settle only after confirmed truth. One
    // queue therefore owns every pending hold, including Dismiss recovery.
    if (!retainOnReadFailure) entry.settle('discarded')
    publish()
    const finish = (readFailed = false, error?: unknown): void => {
      if (generation !== issuedGeneration || queue[0] !== entry) return
      running = false
      if (readFailed && retainOnReadFailure && deps.retainOnDismissReadFailure?.(entry.patch, error)) {
        // Failed Dismiss offers another read, never a replay of the write.
        failure = { message: 'Couldn’t read saved changes. Dismiss again to recheck without resending.', retryable: false }
      } else {
        queue.shift()
        entry.settle('discarded')
      }
      publish()
      drain()
    }
    void deps.reconcile(entry.resourceId).then(() => finish(), (error: unknown) => finish(true, error))
  }

  const clearAll = (): void => {
    generation += 1
    running = false
    failure = null
    const abandoned = queue
    queue = []
    for (const entry of abandoned) entry.settle('discarded')
    publish()
  }

  const isPending = (resourceId: string, predicate?: (patch: Readonly<Patch>) => boolean): boolean => {
    const matches = (entry: QueueEntry<Patch>): boolean =>
      entry.resourceId === resourceId && (predicate === undefined || predicate(entry.patch))
    return queue.some(matches)
  }

  return { enqueue, retry, discard, clearAll, isPending }
}
