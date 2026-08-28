/** Serialized, acknowledgement-gated relation mutations.
 *
 * A relation response is the whole graph, so overlapping writes can otherwise
 * land out of order and rewind the client. One account owns one FIFO. Its failed
 * head remains explicit until Retry or Dismiss; retry reuses the same logical
 * idempotency key, and later intent never jumps the failed act. */
import { opKey, type RelationGraph, type RelationOp } from '../../contract/index.ts'

export type RelationMutationOutcome = 'applied' | 'discarded'

export interface RelationMutationFailure {
  message: string
  retryable: boolean
}

export interface RelationMutationStatus {
  busy: boolean
  error: string | null
  retryable: boolean
  activeKey: string | null
  failedKey: string | null
  pendingKeys: readonly string[]
}

export interface RelationMutationDeps {
  mutate: (op: RelationOp, idempotencyKey: string) => Promise<RelationGraph>
  commit: (op: RelationOp, returned: RelationGraph) => void
  reconcile: (op: RelationOp) => void
  describeFailure: (error: unknown) => RelationMutationFailure
  setStatus: (status: RelationMutationStatus) => void
  mintIdempotencyKey: () => string
}

interface QueueEntry {
  op: RelationOp
  key: string
  idempotencyKey: string
  settle: (outcome: RelationMutationOutcome) => void
}

export const IDLE_RELATION_MUTATION: RelationMutationStatus = {
  busy: false,
  error: null,
  retryable: false,
  activeKey: null,
  failedKey: null,
  pendingKeys: [],
}

export function createRelationMutationController(deps: RelationMutationDeps) {
  let queue: QueueEntry[] = []
  let running = false
  let failure: RelationMutationFailure | null = null
  let generation = 0

  const publish = (): void => {
    const head = queue[0]
    deps.setStatus({
      busy: running,
      error: failure?.message ?? null,
      retryable: failure?.retryable ?? false,
      activeKey: running ? (head?.key ?? null) : null,
      failedKey: failure ? (head?.key ?? null) : null,
      pendingKeys: queue.map((entry) => entry.key),
    })
  }

  const drain = (): void => {
    if (running || failure || queue.length === 0) return
    const entry = queue[0]!
    const issuedGeneration = generation
    running = true
    publish()
    void deps.mutate(entry.op, entry.idempotencyKey).then(
      (returned) => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        running = false
        queue.shift()
        // Projection bugs after a successful server commit must not turn the
        // transport into a fake failure. Reconciliation still has the SSE/read path.
        try {
          deps.commit(entry.op, returned)
        } catch {
          deps.reconcile(entry.op)
        }
        entry.settle('applied')
        publish()
        drain()
      },
      (error: unknown) => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        running = false
        failure = deps.describeFailure(error)
        publish()
      },
    )
  }

  const enqueue = (op: RelationOp): Promise<RelationMutationOutcome> => {
    const promise = new Promise<RelationMutationOutcome>((settle) => {
      queue.push({ op, key: opKey(op), idempotencyKey: deps.mintIdempotencyKey(), settle })
    })
    publish()
    drain()
    return promise
  }

  const retry = (): void => {
    if (!failure || running || queue.length === 0 || !failure.retryable) return
    failure = null
    publish()
    drain()
  }

  const discard = (): void => {
    if (!failure || running || queue.length === 0) return
    const entry = queue.shift()!
    failure = null
    // A transport failure is uncertain: the server may have committed before
    // the response was lost. Re-read rather than pretending dismissal undid it.
    deps.reconcile(entry.op)
    entry.settle('discarded')
    publish()
    drain()
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
