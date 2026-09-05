/** Transport and exact-receipt reconciliation for delegated judgment. */
import type { Contribution, ContributionEvent, DelegatedActKind } from '../../contract/index.ts'
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
  readonly agentLabel: string
  readonly actKind: DelegatedActKind
  readonly envelopeVersion?: number
}

const receiptFor = (
  contribution: Contribution,
  expectedId: string,
  delegationId: string,
): ContributionEvent | undefined => contribution.events.find((event) =>
  event.id === expectedId &&
  event.delegationId === delegationId &&
  ['delegated-decision', 'delegated-draft', 'delegated-escalation'].includes(event.kind))

/** Append authoritative timeline facts and adopt only the monotonic lifecycle
 * effect or the still-current envelope version addressed by the frozen intent. */
function rememberJudgment(
  intent: DelegatedJudgmentIntent,
  contribution: Contribution,
  expectedId: string,
): void {
  const receipt = receiptFor(contribution, expectedId, intent.delegationId)
  if (receipt && peek<Contribution[]>(keys.contributions(intent.projectId))) {
    mutate<Contribution[]>(keys.contributions(intent.projectId), (current) =>
      (current ?? []).map((candidate) => {
        if (candidate.id !== contribution.id) return candidate
        const events = [...candidate.events]
        for (const event of contribution.events) {
          if (!events.some((known) => known.id === event.id)) events.push(event)
        }
        events.sort((a, b) => a.at - b.at)
        const mayAdoptLanding = candidate.status === 'open' && contribution.status === 'landed'
        const mayAdoptEnvelope =
          intent.actKind === 'approve-envelope' &&
          intent.envelopeVersion !== undefined &&
          candidate.envelope?.version === intent.envelopeVersion &&
          contribution.envelope?.version === intent.envelopeVersion &&
          contribution.envelope.status === 'approved' &&
          contribution.envelope.approvedVersion === intent.envelopeVersion
        return {
          ...candidate,
          events,
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

export async function applyDelegatedJudgment(
  intent: DelegatedJudgmentIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await delegatedJudgmentId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    intent.delegationId,
    idempotencyKey,
  )
  const contribution = await apiPost<Contribution>(
    paths.contributionDelegated(intent.projectId, intent.contributionId, intent.delegationId),
    {},
    { idempotencyKey },
  )
  if (!receiptFor(contribution, expectedId, intent.delegationId)) {
    throw new Error('The delegated judgment acknowledgement did not match the requested Delegation.')
  }
  rememberJudgment(intent, contribution, expectedId)
}

export async function reconcileDelegatedJudgment(
  intent: DelegatedJudgmentIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await delegatedJudgmentId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    intent.delegationId,
    idempotencyKey,
  )
  const incoming = await apiGet<Contribution[]>(paths.contributions(intent.projectId))
  const contribution = incoming.find((candidate) => candidate.id === intent.contributionId)
  const receipt = contribution
    ? receiptFor(contribution, expectedId, intent.delegationId)
    : undefined
  if (!peek<Contribution[]>(keys.contributions(intent.projectId))) {
    setData(keys.contributions(intent.projectId), incoming)
  } else if (contribution && receipt) {
    rememberJudgment(intent, contribution, expectedId)
  }
  return receipt !== undefined
}
