/** Strict parser for a Delegation's identity and policy deletion preconditions. */
import type { DeleteDelegationRequest } from '../../contract/index.ts'
import { ValidationError } from '../conflict.ts'

export function delegationRevocation(value: unknown): DeleteDelegationRequest {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('A delegation revocation precondition must be an object.')
  }
  const input = value as Record<string, unknown>
  const unknown = Object.keys(input).filter((field) => field !== 'expectedCreatedAt' && field !== 'expectedRevision')
  if (unknown.length > 0) {
    throw new ValidationError(
      `Unknown delegation revocation field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`,
    )
  }
  const out: DeleteDelegationRequest = {}
  for (const field of ['expectedCreatedAt', 'expectedRevision'] as const) {
    if (!Object.hasOwn(input, field)) continue
    if (!Number.isSafeInteger(input[field]) || (input[field] as number) < 0) {
      throw new ValidationError(`${field} must be a non-negative safe integer.`)
    }
    out[field] = input[field] as number
  }
  return out
}
