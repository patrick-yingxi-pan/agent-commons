import { createHash } from 'node:crypto'
import type { ChangesetVersion, ContributionReviewerBinding, ContributionReviewRun } from '../contract/index.ts'
import { MAX_CONTRIBUTION_REVIEWS } from '../contract/contributionReview.ts'
import { isContributionReviewId } from './contributionReviewIdentity.ts'
import { parseContributionReviewResult } from './contributionReviewResult.ts'

/** Private execution receipt. No credentials, endpoint, raw key or prompt copy. */
export interface StoredContributionReview extends ContributionReviewRun {
  tenantId: string
  binding: ContributionReviewerBinding
  changesetHash: string
}

export function reviewChangesetHash(version: ChangesetVersion): string {
  return createHash('sha256').update(JSON.stringify(version)).digest('hex')
}

export function validReviewerBinding(value: unknown): value is ContributionReviewerBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const b = value as Record<string, unknown>
  return Object.keys(b).length === 5 && ['agentId', 'providerId'].every((key) =>
    typeof b[key] === 'string' && b[key].length > 0 && b[key].length <= 200 && b[key].trim() === b[key]) &&
    ['agentRevision', 'providerRevision', 'connectionRevision'].every((key) =>
      Number.isSafeInteger(b[key]) && (b[key] as number) >= 0)
}

export function sameReviewerBinding(a: ContributionReviewerBinding, b: ContributionReviewerBinding): boolean {
  return a.agentId === b.agentId && a.agentRevision === b.agentRevision && a.providerId === b.providerId &&
    a.providerRevision === b.providerRevision && a.connectionRevision === b.connectionRevision
}

export function publicReviewRun(run: StoredContributionReview): ContributionReviewRun {
  const { tenantId: _tenant, binding: _binding, changesetHash: _hash, ...publicRun } = run
  return structuredClone(publicRun)
}

/** Strict when present; legacy absence means no real review authority. */
export function validStoredReviews(value: unknown, changeset: ChangesetVersion[] | undefined): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value) || value.length > MAX_CONTRIBUTION_REVIEWS) return false
  const ids = new Set<string>()
  let previousStart = -1
  const fields = new Set(['id', 'version', 'reviewer', 'provider', 'model', 'startedAt', 'finishedAt', 'status', 'summary', 'findings', 'tenantId', 'binding', 'changesetHash'])
  return value.every((run: StoredContributionReview) => {
    if (!run || typeof run !== 'object' || Array.isArray(run) || Object.keys(run).some((key) => !fields.has(key))) return false
    if (typeof run.id !== 'string' || !isContributionReviewId(run.id) || ids.has(run.id)) return false
    ids.add(run.id)
    if (!validReviewerBinding(run.binding) || !['reviewer', 'provider', 'model', 'tenantId'].every((key) => {
      const text = run[key as keyof StoredContributionReview]
      return typeof text === 'string' && text.trim().length > 0 && text.length <= 2000
    })) return false
    if (!Number.isSafeInteger(run.version) || run.version < 1 || !Array.isArray(changeset)) return false
    const version = changeset.find((entry) => entry?.version === run.version)
    if (!version || run.changesetHash !== reviewChangesetHash(version)) return false
    if (!Number.isSafeInteger(run.startedAt) || run.startedAt <= previousStart) return false
    previousStart = run.startedAt
    if (run.status === 'pending') return run.finishedAt === undefined && run.summary === undefined && run.findings === undefined
    if (!['passed', 'findings', 'failed', 'uncertain', 'stale'].includes(run.status) ||
      !Number.isSafeInteger(run.finishedAt) || run.finishedAt! < run.startedAt) return false
    if (run.status === 'failed' || run.status === 'uncertain') return run.summary === undefined && run.findings === undefined
    try {
      const result = parseContributionReviewResult(JSON.stringify({ summary: run.summary, findings: run.findings }), new Set(version.entries.map((e) => e.id)))
      return run.status === 'stale' || (run.status === 'passed' ? result.findings.length === 0 : result.findings.length > 0)
    } catch { return false }
  })
}

export function realReviewVersion(contribution: { changeset?: ChangesetVersion[]; reviewAttempts?: StoredContributionReview[] }): number | undefined {
  const latest = contribution.changeset?.at(-1)
  if (!latest) return undefined
  const run = contribution.reviewAttempts?.slice().reverse().find((attempt) => attempt.version === latest.version)
  return run?.status === 'passed' && run.changesetHash === reviewChangesetHash(latest) ? latest.version : undefined
}
