/** Strict parser for Provider removal's two-domain reviewed precondition. */
import type { DeleteProviderRequest } from '../../contract/index.ts'
import { ValidationError } from '../conflict.ts'

const FIELDS = ['expectedDefinitionRevision', 'expectedConnectionRevision'] as const

export function providerDelete(value: unknown): DeleteProviderRequest {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('A provider deletion precondition must be an object.')
  }
  const input = value as Record<string, unknown>
  const unknown = Object.keys(input).filter((field) => !FIELDS.includes(field as typeof FIELDS[number]))
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown provider deletion field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`)
  }
  const hasDefinition = Object.hasOwn(input, 'expectedDefinitionRevision')
  const hasConnection = Object.hasOwn(input, 'expectedConnectionRevision')
  if (hasDefinition !== hasConnection) {
    throw new ValidationError('Provider deletion revisions must be supplied together.')
  }
  if (!hasDefinition) return {}
  for (const field of FIELDS) {
    if (!Number.isSafeInteger(input[field]) || (input[field] as number) < 0) {
      throw new ValidationError(`${field} must be a non-negative safe integer.`)
    }
  }
  return {
    expectedDefinitionRevision: input.expectedDefinitionRevision as number,
    expectedConnectionRevision: input.expectedConnectionRevision as number,
  }
}
