/** Transport-neutral acknowledgement FIFO for append/action commands.
 *
 * Unlike a revisioned edit, an action has no document to rebase. It still owns
 * one logical idempotency key, keeps later intent behind an uncertain head,
 * reconciles before declaring failure or Dismiss complete, and drops late work
 * when the account scope changes. */
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
  type RevisionedMutationStatus,
} from './revisionedMutationCore.ts'

export interface AcknowledgedActionMutationDeps<Input, Baseline> {
  resourceId: (input: Input) => string
  snapshot: (input: Input) => Baseline
  mutate: (input: Input, idempotencyKey: string) => Promise<void>
  /** Return true when authoritative state proves the held action already landed. */
  reconcile: (input: Input, baseline: Baseline, idempotencyKey: string) => Promise<boolean>
  /** A represented business refusal may release its form immediately after the
   * reconciliation read proves the desired state absent. Transport uncertainty
   * must return undefined so Retry/Dismiss retains the logical action. */
  settleRejected?: (error: unknown, input: Input) => RevisionedMutationOutcome | undefined
  /** Most action queues may release after Dismiss cannot complete its final
   * truth read. Identity transitions cannot: losing that read would expose a
   * world whose cookie and client belief may differ. */
  discardReconcileFailure?: 'release' | 'retain'
  describeFailure: (error: unknown, input: Input) => RevisionedMutationFailure
  setStatus: (status: RevisionedMutationStatus) => void
  /** Derive or mint the one retry identity for this exact logical input. */
  mintIdempotencyKey: (input: Input) => string
}

interface QueueEntry<Input, Baseline> {
  input: Input
  resourceId: string
  baseline: Baseline
  idempotencyKey: string
  settle: (outcome: RevisionedMutationOutcome) => void
}

export { IDLE_REVISIONED_MUTATION as IDLE_ACKNOWLEDGED_ACTION_MUTATION }

export function createAcknowledgedActionMutationController<Input, Baseline>(
  deps: AcknowledgedActionMutationDeps<Input, Baseline>,
) {
  let queue: QueueEntry<Input, Baseline>[] = []
  let running = false
  let failure: RevisionedMutationFailure | null = null
  let generation = 0

  const publish = (): void => {
    deps.setStatus({
      ...IDLE_REVISIONED_MUTATION,
      busy: running,
      error: failure?.message ?? null,
      retryable: failure?.retryable ?? false,
      activeResourceId: queue[0]?.resourceId ?? null,
      pendingCount: queue.length,
    })
  }

  const complete = (
    entry: QueueEntry<Input, Baseline>,
    outcome: RevisionedMutationOutcome,
  ): void => {
    if (queue[0] !== entry) return
    running = false
    failure = null
    queue.shift()
    entry.settle(outcome)
    publish()
    drain()
  }

  const drain = (): void => {
    if (running || failure || queue.length === 0) return
    const entry = queue[0]!
    const issuedGeneration = generation
    running = true
    publish()
    void deps.mutate(entry.input, entry.idempotencyKey).then(
      () => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        complete(entry, 'applied')
      },
      async (error: unknown) => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        let realized = false
        try {
          realized = await deps.reconcile(entry.input, entry.baseline, entry.idempotencyKey)
        } catch {
          // Preserve the original mutation error. Retry or Dismiss will make a
          // fresh bounded truth read rather than replacing it with a read error.
        }
        if (generation !== issuedGeneration || queue[0] !== entry) return
        if (realized) return complete(entry, 'applied')
        const rejected = deps.settleRejected?.(error, entry.input)
        if (rejected) return complete(entry, rejected)
        running = false
        failure = deps.describeFailure(error, entry.input)
        publish()
      },
    )
  }

  const enqueue = (input: Input): Promise<RevisionedMutationOutcome> => {
    const outcome = new Promise<RevisionedMutationOutcome>((settle) => {
      queue.push({
        input,
        resourceId: deps.resourceId(input),
        baseline: deps.snapshot(input),
        idempotencyKey: deps.mintIdempotencyKey(input),
        settle,
      })
    })
    publish()
    drain()
    return outcome
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
    void deps.reconcile(entry.input, entry.baseline, entry.idempotencyKey).then(
      (realized) => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        complete(entry, realized ? 'applied' : 'discarded')
      },
      (error: unknown) => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        if (deps.discardReconcileFailure === 'retain') {
          running = false
          failure = deps.describeFailure(error, entry.input)
          publish()
          return
        }
        complete(entry, 'discarded')
      },
    )
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

  return { enqueue, retry, discard, clearAll }
}
