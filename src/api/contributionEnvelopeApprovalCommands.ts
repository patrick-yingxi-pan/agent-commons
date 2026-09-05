/** Transport and exact-version reconciliation for Contribution envelope approval. */
import type { ApproveEnvelopeRequest, Contribution, ContributionEvent } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { contributionEnvelopeApprovalId } from './contributionEnvelopeApprovalIdentity.ts'
import { keys, paths } from './keys.ts'

export interface ContributionEnvelopeApprovalIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly contributionId: string
  readonly envelopeVersion: number
}

const receiptFor = (
  contribution: Contribution,
  expectedId: string,
  envelopeVersion: number,
): ContributionEvent | undefined => contribution.events.find((event) =>
  event.id === expectedId &&
  event.kind === 'envelope-approved' &&
  event.envelopeVersion === envelopeVersion)

/** Merge only the exact approval receipt and its matching current envelope.
 * A later amendment or timeline entry remains authoritative. */
function rememberApproval(
  intent: ContributionEnvelopeApprovalIntent,
  contribution: Contribution,
  expectedId: string,
): void {
  const receipt = receiptFor(contribution, expectedId, intent.envelopeVersion)
  if (receipt && peek<Contribution[]>(keys.contributions(intent.projectId))) {
    mutate<Contribution[]>(keys.contributions(intent.projectId), (current) =>
      (current ?? []).map((candidate) => {
        if (candidate.id !== contribution.id) return candidate
        const events = candidate.events.some((event) => event.id === receipt.id)
          ? candidate.events
          : [...candidate.events, receipt].sort((a, b) => a.at - b.at)
        const mayAdoptEnvelope =
          candidate.envelope?.version === intent.envelopeVersion &&
          contribution.envelope?.version === intent.envelopeVersion &&
          contribution.envelope.status === 'approved' &&
          contribution.envelope.approvedVersion === intent.envelopeVersion
        return {
          ...candidate,
          events,
          ...(mayAdoptEnvelope ? { envelope: contribution.envelope } : {}),
          ...(mayAdoptEnvelope && contribution.tier ? { tier: contribution.tier } : {}),
        }
      }),
    )
  }
  invalidate(keys.contributions(intent.projectId))
  invalidate(keys.attention(intent.projectId))
}

export async function applyContributionEnvelopeApproval(
  intent: ContributionEnvelopeApprovalIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await contributionEnvelopeApprovalId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    idempotencyKey,
  )
  const contribution = await apiPost<Contribution>(
    paths.contributionEnvelopeApprove(intent.projectId, intent.contributionId),
    { expectedVersion: intent.envelopeVersion } satisfies ApproveEnvelopeRequest,
    { idempotencyKey },
  )
  if (!receiptFor(contribution, expectedId, intent.envelopeVersion)) {
    throw new Error('The approval acknowledgement did not match the envelope version that was reviewed.')
  }
  rememberApproval(intent, contribution, expectedId)
}

export async function reconcileContributionEnvelopeApproval(
  intent: ContributionEnvelopeApprovalIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await contributionEnvelopeApprovalId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    idempotencyKey,
  )
  const incoming = await apiGet<Contribution[]>(paths.contributions(intent.projectId))
  const contribution = incoming.find((candidate) => candidate.id === intent.contributionId)
  const receipt = contribution
    ? receiptFor(contribution, expectedId, intent.envelopeVersion)
    : undefined
  if (!peek<Contribution[]>(keys.contributions(intent.projectId))) {
    setData(keys.contributions(intent.projectId), incoming)
  } else if (contribution && receipt) {
    rememberApproval(intent, contribution, expectedId)
  }
  return receipt !== undefined
}
