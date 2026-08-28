/** Serialized, revision-checked conversation metadata mutations.
 *
 * The sidebar and every conversation pane can edit the same session row. One
 * client FIFO keeps those intents ordered; the server revision refuses a stale
 * cross-client write. A failed head remains visible until Retry or Dismiss,
 * and retry keeps its idempotency key while rebasing onto the latest read. */
import type { Session, SessionMetadataPatch } from '../../contract/index.ts'

export type SessionMetadataMutationOutcome = 'applied' | 'discarded'

export interface SessionMetadataMutationFailure {
  message: string
  retryable: boolean
}

export interface SessionMetadataMutationStatus {
  busy: boolean
  error: string | null
  retryable: boolean
  activeSessionId: string | null
  pendingCount: number
}

export interface SessionMetadataMutationDeps {
  snapshot: (sessionId: string) => Session | undefined
  reconcile: (sessionId: string) => Promise<Session>
  mutate: (
    sessionId: string,
    patch: SessionMetadataPatch,
    expectedRevision: number,
    idempotencyKey: string,
  ) => Promise<Session>
  describeFailure: (error: unknown) => SessionMetadataMutationFailure
  setStatus: (status: SessionMetadataMutationStatus) => void
  mintIdempotencyKey: () => string
}

interface QueueEntry {
  sessionId: string
  patch: SessionMetadataPatch
  idempotencyKey: string
  settle: (outcome: SessionMetadataMutationOutcome) => void
}

export const IDLE_SESSION_METADATA_MUTATION: SessionMetadataMutationStatus = {
  busy: false,
  error: null,
  retryable: false,
  activeSessionId: null,
  pendingCount: 0,
}

export function createSessionMetadataMutationController(deps: SessionMetadataMutationDeps) {
  let queue: QueueEntry[] = []
  let running = false
  let failure: SessionMetadataMutationFailure | null = null
  let generation = 0

  const publish = (): void => {
    deps.setStatus({
      busy: running,
      error: failure?.message ?? null,
      retryable: failure?.retryable ?? false,
      activeSessionId: queue[0]?.sessionId ?? null,
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
      const current = deps.snapshot(entry.sessionId) ?? await deps.reconcile(entry.sessionId)
      const expectedRevision = current.metadataRevision ?? 0
      return deps.mutate(entry.sessionId, entry.patch, expectedRevision, entry.idempotencyKey)
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
          await deps.reconcile(entry.sessionId)
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
    sessionId: string,
    patch: SessionMetadataPatch,
  ): Promise<SessionMetadataMutationOutcome> => {
    const result = new Promise<SessionMetadataMutationOutcome>((settle) => {
      queue.push({ sessionId, patch, idempotencyKey: deps.mintIdempotencyKey(), settle })
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
    const entry = queue.shift()!
    failure = null
    void deps.reconcile(entry.sessionId).catch(() => {})
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
