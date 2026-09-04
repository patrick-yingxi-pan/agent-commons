/** Transport and exact receipt reconciliation for Contribution effect attempts. */
import type { Contribution, ContributionEvent } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { contributionEffectExecutionId } from './contributionEffectExecutionIdentity.ts'
import { keys, paths } from './keys.ts'

export interface ContributionEffectExecutionIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly contributionId: string
  readonly lineId: string
}

const receiptFor = (
  contribution: Contribution,
  intent: ContributionEffectExecutionIntent,
  expectedId: string,
): ContributionEvent | undefined => contribution.events.find(
  (event) =>
    event.id === expectedId &&
    event.lineId === intent.lineId &&
    (event.kind === 'effect-executed' || event.kind === 'effect-refused'),
)

/** Merge only monotonic execution facts. A delayed acknowledgement must not
 * replace newer comments, an amended envelope, or another line's later spend. */
function rememberExecution(
  intent: ContributionEffectExecutionIntent,
  contribution: Contribution,
  expectedId: string,
): void {
  const receipt = receiptFor(contribution, intent, expectedId)
  if (receipt && peek<Contribution[]>(keys.contributions(intent.projectId))) {
    mutate<Contribution[]>(keys.contributions(intent.projectId), (current) =>
      (current ?? []).map((candidate) => {
        if (candidate.id !== contribution.id) return candidate
        const events = candidate.events.some((event) => event.id === receipt.id)
          ? candidate.events
          : [...candidate.events, receipt].sort((a, b) => a.at - b.at)
        const envelope =
          candidate.envelope &&
          contribution.envelope &&
          candidate.envelope.version === contribution.envelope.version
            ? {
                ...candidate.envelope,
                lines: candidate.envelope.lines.map((line) => {
                  const acknowledged = contribution.envelope?.lines.find((entry) => entry.id === line.id)
                  return acknowledged ? { ...line, used: Math.max(line.used, acknowledged.used) } : line
                }),
              }
            : candidate.envelope
        return {
          ...candidate,
          events,
          envelope,
          ...(candidate.effectsFired === true || contribution.effectsFired === true ? { effectsFired: true } : {}),
          ...(receipt.kind === 'effect-executed' ? { tier: contribution.tier } : {}),
        }
      }),
    )
  }
  invalidate(keys.contributions(intent.projectId))
  invalidate(keys.attention(intent.projectId))
}

export async function applyContributionEffectExecution(
  intent: ContributionEffectExecutionIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await contributionEffectExecutionId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    idempotencyKey,
  )
  const contribution = await apiPost<Contribution>(
    paths.contributionEffects(intent.projectId, intent.contributionId),
    { lineId: intent.lineId },
    { idempotencyKey },
  )
  if (receiptFor(contribution, intent, expectedId)?.kind !== 'effect-executed') {
    throw new Error('The effect acknowledgement did not match the requested envelope line.')
  }
  rememberExecution(intent, contribution, expectedId)
}

export async function reconcileContributionEffectExecution(
  intent: ContributionEffectExecutionIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await contributionEffectExecutionId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    idempotencyKey,
  )
  const incoming = await apiGet<Contribution[]>(paths.contributions(intent.projectId))
  const contribution = incoming.find((candidate) => candidate.id === intent.contributionId)
  const receipt = contribution ? receiptFor(contribution, intent, expectedId) : undefined
  if (!peek<Contribution[]>(keys.contributions(intent.projectId))) {
    setData(keys.contributions(intent.projectId), incoming)
  } else if (contribution && receipt) {
    rememberExecution(intent, contribution, expectedId)
  }
  return receipt?.kind === 'effect-executed'
}
