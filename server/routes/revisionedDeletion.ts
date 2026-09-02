/** Strict shared parser for revision-pinned DELETE request bodies. */
import { ValidationError } from '../conflict.ts'

export interface RevisionedDeleteRequest {
  expectedRevision?: number
}

export function revisionedDelete(
  value: unknown,
  subject: string,
): RevisionedDeleteRequest {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`A ${subject} deletion precondition must be an object.`)
  }
  const input = value as Record<string, unknown>
  const unknown = Object.keys(input).filter((field) => field !== 'expectedRevision')
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown ${subject} deletion field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`)
  }
  if (!Object.hasOwn(input, 'expectedRevision')) return {}
  if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
    throw new ValidationError('expectedRevision must be a non-negative safe integer.')
  }
  return { expectedRevision: input.expectedRevision as number }
}
