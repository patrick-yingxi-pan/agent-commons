/** Transport and exact-receipt reconciliation for effect-envelope proposals. */
import type { Contribution, ContributionEvent, ProposeEnvelopeRequest } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { contributionEnvelopeProposalId } from './contributionEnvelopeProposalIdentity.ts'
import { keys, paths } from './keys.ts'

export interface ContributionEnvelopeProposalIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly contributionId: string
  readonly expectedVersion: number
  readonly lines: ProposeEnvelopeRequest['lines']
}

const receiptFor = (
  contribution: Contribution,
  expectedId: string,
): ContributionEvent | undefined => contribution.events.find((event) =>
  event.id === expectedId &&
  event.kind === 'envelope-proposed' &&
  Number.isSafeInteger(event.envelopeVersion) &&
  (event.envelopeVersion ?? 0) > 0)

const envelopeMatchesIntent = (
  intent: ContributionEnvelopeProposalIntent,
  contribution: Contribution,
  version: number,
): boolean => {
  const envelope = contribution.envelope
  if (!envelope || envelope.version !== version || envelope.status !== 'proposed') return false
  if (envelope.lines.length !== intent.lines.length) return false
  return intent.lines.every((line, index) => {
    const stored = envelope.lines[index]
    return stored !== undefined &&
      line.type === stored.type &&
      line.target.trim() === stored.target &&
      (line.cardinality ?? 1) === stored.cardinality &&
      (line.harness ?? 'draft-escrow') === stored.harness &&
      (line.note ?? '').trim() === stored.note
  })
}

/** Merge only the exact proposal receipt and a still-current matching envelope.
 * A later counter-proposal, approval, execution, or timeline entry wins. */
function rememberEnvelopeProposal(
  intent: ContributionEnvelopeProposalIntent,
  contribution: Contribution,
  expectedId: string,
): void {
  const receipt = receiptFor(contribution, expectedId)
  if (receipt && peek<Contribution[]>(keys.contributions(intent.projectId))) {
    mutate<Contribution[]>(keys.contributions(intent.projectId), (current) =>
      (current ?? []).map((candidate) => {
        if (candidate.id !== contribution.id) return candidate
        const events = candidate.events.some((event) => event.id === receipt.id)
          ? candidate.events
          : [...candidate.events, receipt].sort((a, b) => a.at - b.at)
        const mayAdoptEnvelope =
          receipt.envelopeVersion !== undefined &&
          (
            (candidate.envelope?.version ?? 0) < receipt.envelopeVersion ||
            (
              candidate.envelope?.version === receipt.envelopeVersion &&
              candidate.envelope.status === 'proposed'
            )
          ) &&
          envelopeMatchesIntent(intent, contribution, receipt.envelopeVersion)
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

export async function applyContributionEnvelopeProposal(
  intent: ContributionEnvelopeProposalIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await contributionEnvelopeProposalId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    idempotencyKey,
  )
  const contribution = await apiPost<Contribution>(
    paths.contributionEnvelope(intent.projectId, intent.contributionId),
    { lines: intent.lines, expectedVersion: intent.expectedVersion } satisfies ProposeEnvelopeRequest,
    { idempotencyKey },
  )
  if (!receiptFor(contribution, expectedId)) {
    throw new Error('The envelope acknowledgement did not match the exact proposal that was submitted.')
  }
  rememberEnvelopeProposal(intent, contribution, expectedId)
}

export async function reconcileContributionEnvelopeProposal(
  intent: ContributionEnvelopeProposalIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await contributionEnvelopeProposalId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    idempotencyKey,
  )
  const incoming = await apiGet<Contribution[]>(paths.contributions(intent.projectId))
  const contribution = incoming.find((candidate) => candidate.id === intent.contributionId)
  const receipt = contribution ? receiptFor(contribution, expectedId) : undefined
  if (!peek<Contribution[]>(keys.contributions(intent.projectId))) {
    setData(keys.contributions(intent.projectId), incoming)
  } else if (contribution && receipt) {
    rememberEnvelopeProposal(intent, contribution, expectedId)
  }
  return receipt !== undefined
}
