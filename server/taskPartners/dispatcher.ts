import { isDeepStrictEqual } from 'node:util'
import type { TaskAction, TaskArtifact, TaskAsset } from '../../contract/taskPartnerWork.ts'
import type { PartnerRule } from '../../contract/taskPartners.ts'
import { fail, fields, record, tokenId } from './protocol.ts'

export function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
    return fail(400, 'bad_request', 'Use a SHA-256 digest in lowercase hexadecimal.')
  return value
}
export function asset(value: unknown): TaskAsset {
  const v = fields(value, ['assetId', 'unit', 'quantity'])
  if (typeof v.quantity !== 'string' || !/^[1-9][0-9]{0,37}$/.test(v.quantity))
    return fail(400, 'bad_request', 'Enter a whole number of the smallest deliverable unit.')
  return { assetId: tokenId(v.assetId), unit: tokenId(v.unit), quantity: v.quantity }
}
export type VerifiedOutcome =
  | { kind: 'unknown' | 'failed'; actionKind: TaskAction['kind']; reasonCode: string }
  | { kind: 'reserve'; reservationId: string; asset: TaskAsset; payerRef: string; grantRef: string; holdUntil: string }
  | {
      kind: 'run'
      providerRunId: string
      submissionId: string
      grantRef: string
      actualModel: string
      actualEffort?: string
      inputDigest: string
      output: TaskArtifact
    }
  | {
      kind: 'verify'
      verdict: 'passed' | 'rejected'
      submissionId: string
      submissionDigest: string
      rule: PartnerRule
      detailCode: string
    }
  | { kind: 'release' | 'return'; reservationId: string; asset: TaskAsset; transferRef: string }

/** Signature verification establishes who spoke. Only the command's frozen
 * inputs can establish what that statement proves. Unknown/failed are explicit
 * claims about this same effect and never assert that any value was delivered. */
export function validatePartnerOutcome(action: TaskAction, value: unknown): VerifiedOutcome {
  const row = record(value)
  const mismatch = (): never =>
    fail(422, 'receipt_mismatch', 'The signed outcome does not match the assigned operation.')
  if (row.kind === 'failed' || row.kind === 'unknown') {
    fields(row, ['kind', 'actionKind', 'reasonCode'])
    if (row.actionKind !== action.kind) mismatch()
    return { kind: row.kind, actionKind: action.kind, reasonCode: tokenId(row.reasonCode) }
  }
  if (action.kind !== row.kind) mismatch()
  function matches(expected: object) {
    for (const [key, wanted] of Object.entries(expected)) if (!isDeepStrictEqual(wanted, row[key])) mismatch()
  }
  switch (action.kind) {
    case 'reserve':
      fields(row, ['kind', 'asset', 'payerRef', 'grantRef', 'holdUntil', 'reservationId'])
      matches(action)
      tokenId(row.reservationId)
      break
    case 'return':
    case 'release':
      fields(row, [...Object.keys(action), 'transferRef'])
      matches(action)
      tokenId(row.transferRef)
      break
    case 'verify':
      fields(row, ['kind', 'submissionId', 'submissionDigest', 'rule', 'verdict', 'detailCode'])
      matches({ submissionId: action.submissionId, submissionDigest: action.submission.digest, rule: action.rule })
      if (row.verdict !== 'passed' && row.verdict !== 'rejected') mismatch()
      tokenId(row.detailCode)
      break
    case 'run': {
      fields(
        row,
        ['kind', 'providerRunId', 'grantRef', 'submissionId', 'inputDigest', 'actualModel', 'output'],
        ['actualEffort'],
      )
      tokenId(row.providerRunId)
      matches({
        grantRef: action.grantRef,
        submissionId: action.submissionId,
        inputDigest: action.input.digest,
        actualModel: action.model,
      })
      if (action.effort !== undefined && action.effort !== row.actualEffort) mismatch()
      if (row.actualEffort !== undefined) tokenId(row.actualEffort)
      const output = fields(row.output, ['artifactId', 'digest', 'mediaType'])
      tokenId(output.artifactId)
      digest(output.digest)
      if (typeof output.mediaType !== 'string' || !output.mediaType || output.mediaType.length > 128) mismatch()
    }
  }
  return row as VerifiedOutcome
}
