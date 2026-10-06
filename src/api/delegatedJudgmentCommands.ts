/** Transport and exact-receipt reconciliation for owner-initiated delegated judgment. */
import type {
  Contribution,
  DelegatedActKind,
  DelegatedJudgmentRequest,
  DelegatedJudgmentRun,
  EscalationTrigger,
} from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { delegatedJudgmentId } from './delegatedJudgmentIdentity.ts'
import { keys, paths } from './keys.ts'

export interface DelegatedJudgmentIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly contributionId: string
  readonly delegationId: string
  readonly delegationLabel: string
  readonly actKind: DelegatedActKind
  readonly mode: 'draft' | 'decide'
  readonly policy: string
  readonly escalation: readonly EscalationTrigger[]
  readonly judgment: DelegatedJudgmentRequest
  readonly reviewerLabel: string
  readonly providerLabel: string
  /** Resolved endpoint model identity; `modelLabel` is display-only. */
  readonly modelId: string
  readonly modelLabel: string
  readonly budgetLabel: string
}

function receiptFor(
  contribution: Contribution,
  intent: DelegatedJudgmentIntent,
  expectedId: string,
): DelegatedJudgmentRun | undefined {
  return contribution.judgments?.find((run) =>
    run.id === expectedId &&
    run.delegationId === intent.delegationId &&
    run.delegationRevision === intent.judgment.expectedDelegationRevision &&
    run.actKind === intent.actKind &&
    run.mode === intent.mode &&
    run.changesetVersion === intent.judgment.expectedChangesetVersion &&
    run.envelopeVersion === intent.judgment.expectedEnvelopeVersion &&
    run.reviewer === intent.reviewerLabel &&
    run.provider === intent.providerLabel &&
    run.model === intent.modelId)
}

function mergeRun(
  runs: DelegatedJudgmentRun[],
  incoming: DelegatedJudgmentRun,
): DelegatedJudgmentRun[] {
  const existing = runs.findIndex((run) => run.id === incoming.id)
  if (existing < 0) return [...runs, incoming].sort((a, b) => a.startedAt - b.startedAt)
  const prior = runs[existing]!
  const terminal = prior.status !== 'pending'
  if (terminal || incoming.status === 'pending') return runs
  return runs.map((run, index) => index === existing ? incoming : run)
}

/** Append only the keyed run/event and adopt its exact monotonic lifecycle act.
 *  A delayed acknowledgement cannot replace newer Contribution truth. */
function rememberJudgment(
  intent: DelegatedJudgmentIntent,
  contribution: Contribution,
  expectedId: string,
): void {
  const receipt = receiptFor(contribution, intent, expectedId)
  if (receipt && peek<Contribution[]>(keys.contributions(intent.projectId))) {
    mutate<Contribution[]>(keys.contributions(intent.projectId), (current) =>
      (current ?? []).map((candidate) => {
        if (candidate.id !== intent.contributionId) return candidate
        const events = [...candidate.events]
        for (const event of contribution.events) {
          if (!events.some((known) => known.id === event.id)) events.push(event)
        }
        events.sort((a, b) => a.at - b.at)
        const mayAdoptLanding =
          intent.actKind === 'land' && receipt.decision === 'approve' &&
          candidate.status === 'open' && contribution.status === 'landed'
        const mayAdoptEnvelope =
          intent.actKind === 'approve-envelope' && receipt.decision === 'approve' &&
          intent.judgment.expectedEnvelopeVersion !== null &&
          candidate.envelope?.version === intent.judgment.expectedEnvelopeVersion &&
          candidate.envelope.status === 'proposed' &&
          contribution.envelope?.version === intent.judgment.expectedEnvelopeVersion &&
          contribution.envelope.status === 'approved' &&
          contribution.envelope.approvedVersion === intent.judgment.expectedEnvelopeVersion
        return {
          ...candidate,
          events,
          judgments: mergeRun(candidate.judgments ?? [], receipt),
          ...(mayAdoptEnvelope ? { envelope: contribution.envelope } : {}),
          ...(mayAdoptLanding ? {
            status: contribution.status,
            landingNumber: contribution.landingNumber,
            landedAt: contribution.landedAt,
            landedBy: contribution.landedBy,
          } : {}),
        }
      }),
    )
  }
  invalidate(keys.contributions(intent.projectId))
  invalidate(keys.attention(intent.projectId))
}

async function expectedRunId(intent: DelegatedJudgmentIntent, idempotencyKey: string): Promise<string> {
  return delegatedJudgmentId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    intent.delegationId,
    idempotencyKey,
  )
}

export async function applyDelegatedJudgment(
  intent: DelegatedJudgmentIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await expectedRunId(intent, idempotencyKey)
  const contribution = await apiPost<Contribution>(
    paths.contributionDelegated(intent.projectId, intent.contributionId, intent.delegationId),
    { judgment: { ...intent.judgment, reviewer: { ...intent.judgment.reviewer } } },
    { idempotencyKey },
  )
  if (!receiptFor(contribution, intent, expectedId)) {
    throw new Error('The delegated judgment acknowledgement did not match this exact grant, reviewer, and visible version.')
  }
  rememberJudgment(intent, contribution, expectedId)
}

export async function reconcileDelegatedJudgment(
  intent: DelegatedJudgmentIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await expectedRunId(intent, idempotencyKey)
  const incoming = await apiGet<Contribution[]>(paths.contributions(intent.projectId))
  const contribution = incoming.find((candidate) => candidate.id === intent.contributionId)
  const receipt = contribution ? receiptFor(contribution, intent, expectedId) : undefined
  const cached = peek<Contribution[]>(keys.contributions(intent.projectId))
  if (!cached) setData(keys.contributions(intent.projectId), incoming)
  else if (contribution && receipt) rememberJudgment(intent, contribution, expectedId)
  else invalidate(keys.contributions(intent.projectId))
  return receipt !== undefined
}
