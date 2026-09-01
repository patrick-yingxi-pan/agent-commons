/** Serialized, acknowledgement-gated relation mutations.
 *
 * A relation response is the whole graph, so overlapping writes can otherwise
 * land out of order and rewind the client. One account owns one FIFO. Its failed
 * head remains explicit until Retry or Dismiss; retry reuses the same logical
 * idempotency key, and later intent never jumps the failed act. */
import {
  opKey,
  type CreateProjectRequest,
  type Project,
  type RelationGraph,
  type RelationOp,
} from '../../contract/index.ts'

export type RelationMutationOutcome = 'applied' | 'discarded'
export type ProjectCreationOutcome =
  | { kind: 'created'; resource: Project }
  | { kind: 'discarded' }

export interface RelationMutationFailure {
  message: string
  retryable: boolean
  /** A conflict-safe field must refresh its exact precondition before retry. */
  rebase?: boolean
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
  reconcile: (op: RelationOp) => Promise<unknown> | void
  rebase: (op: RelationOp) => Promise<RelationOp>
  describeFailure: (error: unknown, op: RelationOp) => RelationMutationFailure
  createProject: (input: CreateProjectRequest, idempotencyKey: string) => Promise<Project>
  reconcileProject: (input: CreateProjectRequest) => Promise<unknown> | void
  describeProjectFailure: (error: unknown) => RelationMutationFailure
  setStatus: (status: RelationMutationStatus) => void
  mintIdempotencyKey: () => string
}

interface QueueEntry {
  key: string
  execute: () => Promise<() => void>
  describeFailure: (error: unknown) => RelationMutationFailure
  reconcile: () => Promise<unknown> | void
  rebase?: () => Promise<void>
  discard: () => void
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
    void entry.execute().then(
      (complete) => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        running = false
        queue.shift()
        complete()
        publish()
        drain()
      },
      async (error: unknown) => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        let described = entry.describeFailure(error)
        if (described.rebase && entry.rebase) {
          try {
            await entry.rebase()
            described = { ...described, rebase: false }
          } catch {
            // Retry will make another bounded reconciliation attempt. Keep the
            // original conflict visible and the held queue head in place.
          }
        }
        if (generation !== issuedGeneration || queue[0] !== entry) return
        running = false
        failure = described
        publish()
      },
    )
  }

  const enqueue = (op: RelationOp): Promise<RelationMutationOutcome> => {
    const idempotencyKey = deps.mintIdempotencyKey()
    let currentOp = op
    const promise = new Promise<RelationMutationOutcome>((settle) => {
      queue.push({
        key: opKey(op),
        execute: () => {
          const issuedOp = currentOp
          return deps.mutate(issuedOp, idempotencyKey).then((returned) => () => {
            // Projection bugs after a successful server commit must not turn the
            // transport into a fake failure. Reconciliation still has the SSE/read path.
            try {
              deps.commit(issuedOp, returned)
            } catch {
              void Promise.resolve(deps.reconcile(issuedOp)).catch(() => {})
            }
            settle('applied')
          })
        },
        describeFailure: (error) => deps.describeFailure(error, currentOp),
        reconcile: () => deps.reconcile(currentOp),
        rebase: async () => {
          currentOp = await deps.rebase(currentOp)
        },
        discard: () => settle('discarded'),
      })
    })
    publish()
    drain()
    return promise
  }

  const enqueueProject = (input: CreateProjectRequest): Promise<ProjectCreationOutcome> => {
    const idempotencyKey = deps.mintIdempotencyKey()
    const promise = new Promise<ProjectCreationOutcome>((settle) => {
      queue.push({
        key: `direct-project:${idempotencyKey}`,
        execute: () => deps.createProject(input, idempotencyKey)
          .then((resource) => () => settle({ kind: 'created', resource })),
        describeFailure: deps.describeProjectFailure,
        reconcile: () => deps.reconcileProject(input),
        discard: () => settle({ kind: 'discarded' }),
      })
    })
    publish()
    drain()
    return promise
  }

  const retry = (): void => {
    if (!failure || running || queue.length === 0 || !failure.retryable) return
    const entry = queue[0]!
    if (failure.rebase && entry.rebase) {
      const issuedGeneration = generation
      running = true
      publish()
      void entry.rebase().then(
        () => {
          if (generation !== issuedGeneration || queue[0] !== entry) return
          running = false
          failure = null
          publish()
          drain()
        },
        () => {
          if (generation !== issuedGeneration || queue[0] !== entry) return
          running = false
          failure = {
            message: 'Couldn’t load the latest Project text. Your draft is still here—retry when the connection recovers.',
            retryable: true,
            rebase: true,
          }
          publish()
        },
      )
      return
    }
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
    // A transport failure is uncertain: the server may have committed before
    // the response was lost. Re-read BEFORE releasing later intent rather than
    // pretending dismissal undid it or letting the next op pin stale truth.
    void Promise.resolve(entry.reconcile()).catch(() => {}).finally(() => {
      if (generation !== issuedGeneration || queue[0] !== entry) return
      queue.shift()
      running = false
      entry.discard()
      publish()
      drain()
    })
  }

  const clearAll = (): void => {
    generation += 1
    running = false
    failure = null
    const abandoned = queue
    queue = []
    for (const entry of abandoned) entry.discard()
    publish()
  }

  return { enqueue, enqueueProject, retry, discard, clearAll }
}
