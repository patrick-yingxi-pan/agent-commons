/** A one-at-a-time acknowledgement controller for secret-creating ceremonies.
 *
 * A lost response is reconciled through a read that can recover the same secret.
 * Explicit dismissal is stronger than local forgetting: the server must
 * acknowledge cancellation before the held intent is released. */
import type {
  RevisionedMutationFailure,
  RevisionedMutationOutcome,
  RevisionedMutationStatus,
} from './revisionedMutationCore.ts'
import { IDLE_REVISIONED_MUTATION } from './revisionedMutationCore.ts'

export interface RecoverableSecretMutationDeps<Input, Result> {
  resourceId: (input: Input) => string
  mutate: (input: Input, idempotencyKey: string) => Promise<Result>
  recover: (input: Input, idempotencyKey: string) => Promise<Result | null>
  cancel: (input: Input, idempotencyKey: string) => Promise<void>
  accept: (input: Input, result: Result) => void
  describeFailure: (error: unknown) => RevisionedMutationFailure
  describeRecoveryAbsence: () => RevisionedMutationFailure
  describeCancelFailure: (error: unknown) => RevisionedMutationFailure
  setStatus: (status: RevisionedMutationStatus) => void
  mintIdempotencyKey: (input: Input) => string
}

interface Held<Input> {
  input: Input
  idempotencyKey: string
  recoverFirst: boolean
  settle: (outcome: RevisionedMutationOutcome) => void
}

export function createRecoverableSecretMutationController<Input, Result>(
  deps: RecoverableSecretMutationDeps<Input, Result>,
) {
  let held: Held<Input> | null = null
  let running = false
  let failure: RevisionedMutationFailure | null = null
  let generation = 0

  const publish = (): void => deps.setStatus({
    ...IDLE_REVISIONED_MUTATION,
    busy: running,
    error: failure?.message ?? null,
    retryable: failure?.retryable ?? false,
    activeResourceId: held ? deps.resourceId(held.input) : null,
    pendingCount: held ? 1 : 0,
  })

  const complete = (
    entry: Held<Input>,
    outcome: RevisionedMutationOutcome,
    result?: Result,
  ): void => {
    if (held !== entry) return
    if (result !== undefined) deps.accept(entry.input, result)
    held = null
    running = false
    failure = null
    entry.settle(outcome)
    publish()
  }

  const attempt = (): void => {
    if (!held || running || failure) return
    const entry = held
    const issuedGeneration = generation
    running = true
    publish()
    if (entry.recoverFirst) {
      entry.recoverFirst = false
      void deps.recover(entry.input, entry.idempotencyKey).then(
        (recovered) => {
          if (generation !== issuedGeneration || held !== entry) return
          if (recovered !== null) return complete(entry, 'applied', recovered)
          running = false
          failure = deps.describeRecoveryAbsence()
          publish()
        },
        (error: unknown) => {
          if (generation !== issuedGeneration || held !== entry) return
          running = false
          failure = deps.describeFailure(error)
          publish()
        },
      )
      return
    }
    void deps.mutate(entry.input, entry.idempotencyKey).then(
      (result) => {
        if (generation !== issuedGeneration || held !== entry) return
        complete(entry, 'applied', result)
      },
      async (error: unknown) => {
        if (generation !== issuedGeneration || held !== entry) return
        let recovered: Result | null = null
        try {
          recovered = await deps.recover(entry.input, entry.idempotencyKey)
        } catch {
          // The creation error remains the useful explanation; Retry repeats
          // the same key and recovery will be attempted again.
        }
        if (generation !== issuedGeneration || held !== entry) return
        if (recovered !== null) return complete(entry, 'applied', recovered)
        running = false
        failure = deps.describeFailure(error)
        publish()
      },
    )
  }

  const hold = (input: Input, recoverFirst: boolean): Promise<RevisionedMutationOutcome> => {
    if (held) return Promise.resolve('discarded')
    const outcome = new Promise<RevisionedMutationOutcome>((settle) => {
      held = { input, idempotencyKey: deps.mintIdempotencyKey(input), recoverFirst, settle }
    })
    publish()
    attempt()
    return outcome
  }

  const enqueue = (input: Input): Promise<RevisionedMutationOutcome> => hold(input, false)

  /** Resume a browser-retained ceremony by reading before any possible write.
   * An authoritative absence becomes a visible, same-key Retry choice. */
  const resume = (input: Input): Promise<RevisionedMutationOutcome> => hold(input, true)

  const retry = (): void => {
    if (!held || running || !failure?.retryable) return
    failure = null
    publish()
    attempt()
  }

  const cancel = (): void => {
    if (!held || running || !failure) return
    const entry = held
    const issuedGeneration = generation
    running = true
    failure = null
    publish()
    void deps.cancel(entry.input, entry.idempotencyKey).then(
      () => {
        if (generation !== issuedGeneration || held !== entry) return
        complete(entry, 'discarded')
      },
      (error: unknown) => {
        if (generation !== issuedGeneration || held !== entry) return
        running = false
        failure = deps.describeCancelFailure(error)
        publish()
      },
    )
  }

  const clearAll = (): void => {
    generation += 1
    const abandoned = held
    held = null
    running = false
    failure = null
    abandoned?.settle('discarded')
    publish()
  }

  return { enqueue, resume, retry, cancel, clearAll }
}
