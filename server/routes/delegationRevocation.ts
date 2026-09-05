/** Strict parser for an immutable Delegation's deletion precondition. */
import type { DeleteDelegationRequest } from '../../contract/index.ts'
import { ValidationError } from '../conflict.ts'

export function delegationRevocation(value: unknown): DeleteDelegationRequest {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('A delegation revocation precondition must be an object.')
  }
  const input = value as Record<string, unknown>
  const unknown = Object.keys(input).filter((field) => field !== 'expectedCreatedAt')
  if (unknown.length > 0) {
    throw new ValidationError(
      `Unknown delegation revocation field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`,
    )
  }
  if (!Object.hasOwn(input, 'expectedCreatedAt')) return {}
  if (!Number.isSafeInteger(input.expectedCreatedAt) || (input.expectedCreatedAt as number) < 0) {
    throw new ValidationError('expectedCreatedAt must be a non-negative safe integer.')
  }
  return { expectedCreatedAt: input.expectedCreatedAt as number }
}
