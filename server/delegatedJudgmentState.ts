import { createHash } from 'node:crypto'
import { MAX_DELEGATED_JUDGMENTS, MAX_JUDGMENT_SUMMARY_CHARS, type DelegatedJudgmentRequest, type DelegatedJudgmentRun } from '../contract/delegatedJudgment.ts'
import { sameReviewerBinding, validReviewerBinding } from './contributionReviewState.ts'
import { isDelegatedJudgmentId } from './delegatedJudgmentIdentity.ts'

/** Private proof of one accepted request, not authority to resume execution. */
export interface StoredDelegatedJudgment extends DelegatedJudgmentRun {
  tenantId: string
  request: DelegatedJudgmentRequest
  delegationCreatedAt: number
  contextHash: string
}

export function validJudgmentRequest(value: unknown): value is DelegatedJudgmentRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  return Object.keys(request).length === 4 && validReviewerBinding(request.reviewer) &&
    Number.isSafeInteger(request.expectedDelegationRevision) && (request.expectedDelegationRevision as number) >= 0 &&
    ['expectedChangesetVersion', 'expectedEnvelopeVersion'].every((key) => request[key] === null ||
      (Number.isSafeInteger(request[key]) && (request[key] as number) >= 1))
}

export function sameJudgmentRequest(a: DelegatedJudgmentRequest, b: DelegatedJudgmentRequest): boolean {
  return a.expectedDelegationRevision === b.expectedDelegationRevision &&
    a.expectedChangesetVersion === b.expectedChangesetVersion && a.expectedEnvelopeVersion === b.expectedEnvelopeVersion &&
    sameReviewerBinding(a.reviewer, b.reviewer)
}

export const judgmentContextHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** A model may quote the private policy; do not leak its explanation to readers. */
export function publicJudgmentRun(run: StoredDelegatedJudgment, viewerTenant?: string): DelegatedJudgmentRun {
  const { tenantId, request: _request, delegationCreatedAt: _created, contextHash: _hash, summary, ...publicRun } = run
  return structuredClone({ ...publicRun, ...(tenantId === viewerTenant && summary !== undefined ? { summary } : {}) })
}

export function validStoredJudgments(value: unknown): value is StoredDelegatedJudgment[] | undefined {
  if (value === undefined) return true
  if (!Array.isArray(value) || value.length > MAX_DELEGATED_JUDGMENTS) return false
  const ids = new Set<string>()
  let lastStart = -1
  const fields = new Set(['id', 'delegationId', 'delegationRevision', 'actKind', 'mode', 'changesetVersion', 'envelopeVersion',
    'reviewer', 'provider', 'model', 'startedAt', 'finishedAt', 'status', 'decision', 'summary', 'tenantId', 'request', 'delegationCreatedAt', 'contextHash'])
  return value.every((run: StoredDelegatedJudgment) => {
    if (!run || typeof run !== 'object' || Array.isArray(run) || Object.keys(run).some((key) => !fields.has(key))) return false
    if (typeof run.id !== 'string' || !isDelegatedJudgmentId(run.id) || ids.has(run.id)) return false
    ids.add(run.id)
    if (!validJudgmentRequest(run.request) || run.delegationRevision !== run.request.expectedDelegationRevision ||
      run.changesetVersion !== run.request.expectedChangesetVersion || run.envelopeVersion !== run.request.expectedEnvelopeVersion) return false
    if (!['land', 'approve-envelope'].includes(run.actKind) || !['draft', 'decide'].includes(run.mode)) return false
    if (!['delegationId', 'tenantId', 'reviewer', 'provider', 'model'].every((key) => {
      const text = run[key as keyof StoredDelegatedJudgment]
      return typeof text === 'string' && !!text.trim() && text.length <= 2000
    })) return false
    if (!Number.isSafeInteger(run.delegationCreatedAt) || run.delegationCreatedAt < 0 ||
      typeof run.contextHash !== 'string' || !/^[a-f0-9]{64}$/.test(run.contextHash) ||
      !Number.isSafeInteger(run.startedAt) || run.startedAt <= lastStart) return false
    lastStart = run.startedAt
    if (run.status === 'pending') return run.finishedAt === undefined && run.decision === undefined && run.summary === undefined
    if (!Number.isSafeInteger(run.finishedAt) || run.finishedAt! < run.startedAt) return false
    if (run.status === 'failed' || run.status === 'uncertain') return run.decision === undefined && run.summary === undefined
    if (!['draft', 'decided', 'declined', 'escalated', 'stale'].includes(run.status) ||
      !['approve', 'decline', 'escalate'].includes(run.decision ?? '') ||
      typeof run.summary !== 'string' || !run.summary.trim() || run.summary.length > MAX_JUDGMENT_SUMMARY_CHARS) return false
    return run.status === 'stale' ||
      (run.status === 'draft' && run.mode === 'draft' && run.decision === 'approve') ||
      (run.status === 'decided' && run.mode === 'decide' && run.decision === 'approve') ||
      (run.status === 'declined' && run.decision === 'decline') ||
      (run.status === 'escalated' && run.decision === 'escalate')
  })
}
