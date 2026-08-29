/** Serialized, acknowledgement-gated proposal verdicts.
 *
 * A verdict changes authority-owned history and may apply a resource delta. One
 * account-wide FIFO retains the logical idempotency key across uncertain Retry,
 * reconciles before reporting failure, and never lets a later verdict jump a
 * failed head. The pure core owns no React, cache, or HTTP knowledge. */
import type { SocialEntityRef, SocialProposal } from '../../contract/index.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
  type RevisionedMutationStatus,
} from './revisionedMutationCore.ts'

export type ProposalVerdict = 'land' | 'decline'

export interface ProposalVerdictIntent {
  proposalId: string
  subject: SocialEntityRef
  verdict: ProposalVerdict
}

export interface ProposalVerdictMutationStatus extends RevisionedMutationStatus {
  activeVerdict: ProposalVerdict | null
  pendingProposalIds: readonly string[]
}

export interface ProposalVerdictMutationDeps {
  mutate: (intent: ProposalVerdictIntent, idempotencyKey: string) => Promise<SocialProposal>
  reconcile: (subject: SocialEntityRef) => Promise<SocialProposal[]>
  describeFailure: (
    error: unknown,
    intent: ProposalVerdictIntent,
    reconciled: SocialProposal | undefined,
  ) => RevisionedMutationFailure
  setStatus: (status: ProposalVerdictMutationStatus) => void
  mintIdempotencyKey: () => string
}

interface QueueEntry {
  intent: ProposalVerdictIntent
  idempotencyKey: string
  settle: Array<(outcome: RevisionedMutationOutcome) => void>
}

export const IDLE_PROPOSAL_VERDICT_MUTATION: ProposalVerdictMutationStatus = {
  ...IDLE_REVISIONED_MUTATION,
  activeVerdict: null,
  pendingProposalIds: [],
}

const acceptedState = (verdict: ProposalVerdict): SocialProposal['state'] =>
  verdict === 'land' ? 'landed' : 'declined'

export function createProposalVerdictMutationController(deps: ProposalVerdictMutationDeps) {
  let queue: QueueEntry[] = []
  let running = false
  let failure: RevisionedMutationFailure | null = null
  let generation = 0

  const publish = (): void => {
    const head = queue[0]
    deps.setStatus({
      busy: running,
      error: failure?.message ?? null,
      retryable: failure?.retryable ?? false,
      activeResourceId: head?.intent.proposalId ?? null,
      activeVerdict: head?.intent.verdict ?? null,
      pendingCount: queue.length,
      pendingProposalIds: queue.map((entry) => entry.intent.proposalId),
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

    void deps.mutate(entry.intent, entry.idempotencyKey).then(
      () => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        running = false
        settleHead(entry, 'applied')
      },
      async (error: unknown) => {
        if (generation !== issuedGeneration || queue[0] !== entry) return
        let reconciled: SocialProposal | undefined
        try {
          reconciled = (await deps.reconcile(entry.intent.subject))
            .find((proposal) => proposal.id === entry.intent.proposalId)
        } catch {
          // Preserve the originating error. A retry or Dismiss reconciles again.
        }
        if (generation !== issuedGeneration || queue[0] !== entry) return
        running = false
        // A response may be lost after commit. Authoritative terminal state is
        // stronger than transport failure and completes the logical action.
        if (reconciled?.state === acceptedState(entry.intent.verdict)) {
          settleHead(entry, 'applied')
          return
        }
        failure = deps.describeFailure(error, entry.intent, reconciled)
        publish()
      },
    )
  }

  const enqueue = (intent: ProposalVerdictIntent): Promise<RevisionedMutationOutcome> => {
    const existing = queue.find((entry) => entry.intent.proposalId === intent.proposalId)
    if (existing) {
      // One proposal can receive one terminal verdict. Duplicate clicks join the
      // pending logical action rather than creating a second request/key; an
      // opposite verdict is discarded because it cannot honestly share that
      // outcome (the rendered controls are disabled, this is the core guard).
      if (existing.intent.verdict !== intent.verdict) return Promise.resolve('discarded')
      return new Promise((settle) => existing.settle.push(settle))
    }
    const result = new Promise<RevisionedMutationOutcome>((settle) => {
      queue.push({ intent, idempotencyKey: deps.mintIdempotencyKey(), settle: [settle] })
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
    // A lost acknowledgement is uncertain. Reconcile once more before releasing
    // the queue, so the next action cannot plan from a stale proposal ledger.
    void deps.reconcile(entry.intent.subject).catch(() => {}).finally(() => {
      if (generation !== issuedGeneration || queue[0] !== entry) return
      running = false
      settleHead(entry, 'discarded')
    })
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
