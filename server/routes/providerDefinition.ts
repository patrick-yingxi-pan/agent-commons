/** Strict validation for the public provider-definition PATCH domain.
 *
 * Ordinary edits may change only human-authored definition fields. Identity,
 * tenancy, transport, catalog, credentials, computed posture, default stamping,
 * and both revision counters have separate owners and cannot ride a raw spread. */
import type {
  Authority,
  Budget,
  ProviderDefinitionPatch,
} from '../../contract/index.ts'
import { ValidationError } from '../conflict.ts'

const TOP_LEVEL_FIELDS = [
  'label',
  'modelFamily',
  'effortLevels',
  'plan',
  'authority',
  'isDefault',
  'expectedRevision',
] as const
const AUTHORITY_FIELDS = ['tools', 'connectors', 'scopes'] as const
const MAX_STRING = 160
const MAX_LIST_ITEMS = 64
const MAX_PLAN_WINDOWS = 32

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(message)
  return value as Record<string, unknown>
}

function unknownField(input: Record<string, unknown>, allowed: readonly string[], subject: string): void {
  const unknown = Object.keys(input).find((field) => !allowed.includes(field))
  if (unknown) throw new ValidationError(`Unknown ${subject} field '${unknown}'.`)
}

function cleanString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} must be a non-empty string.`)
  const clean = value.trim()
  if (clean.length > MAX_STRING) throw new ValidationError(`${field} is too long.`)
  return clean
}

function cleanStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array of strings.`)
  if (value.length > MAX_LIST_ITEMS) throw new ValidationError(`${field} has too many entries.`)
  const clean = value.map((entry) => cleanString(entry, field))
  if (new Set(clean).size !== clean.length) throw new ValidationError(`${field} must not contain duplicates.`)
  return clean
}

function cleanAuthority(value: unknown): Authority {
  const input = record(value, 'authority must be an object.')
  unknownField(input, AUTHORITY_FIELDS, 'authority')
  const authority: Authority = {}
  for (const field of AUTHORITY_FIELDS) {
    if (Object.hasOwn(input, field)) authority[field] = cleanStringList(input[field], `authority.${field}`)
  }
  return authority
}

function cleanPlan(value: unknown): Budget {
  const input = record(value, 'plan must be an object.')
  unknownField(input, ['windows'], 'plan')
  if (!Object.hasOwn(input, 'windows') || !Array.isArray(input.windows)) {
    throw new ValidationError('plan.windows must be an array.')
  }
  if (input.windows.length > MAX_PLAN_WINDOWS) throw new ValidationError('plan.windows has too many entries.')
  const windows = input.windows.map((value, index) => {
    const window = record(value, `plan.windows[${index}] must be an object.`)
    unknownField(window, ['label', 'ceiling'], `plan.windows[${index}]`)
    const label = cleanString(window.label, `plan.windows[${index}].label`)
    if (!Number.isSafeInteger(window.ceiling) || (window.ceiling as number) < 0) {
      throw new ValidationError(`plan.windows[${index}].ceiling must be a non-negative safe integer.`)
    }
    return { label, ceiling: window.ceiling as number }
  })
  if (new Set(windows.map((window) => window.label)).size !== windows.length) {
    throw new ValidationError('plan.windows must not contain duplicate labels.')
  }
  return { windows }
}

export interface ProviderDefinitionUpdate {
  patch: ProviderDefinitionPatch
  isDefault?: boolean
  expectedRevision?: number
}

export function providerDefinitionUpdate(value: unknown): ProviderDefinitionUpdate {
  const input = record(value, 'A provider definition patch is required.')
  unknownField(input, TOP_LEVEL_FIELDS, 'provider definition')
  if (!Object.keys(input).length) throw new ValidationError('Name at least one provider definition field to update.')

  const patch: ProviderDefinitionPatch = {}
  if (Object.hasOwn(input, 'label')) patch.label = cleanString(input.label, 'label')
  if (Object.hasOwn(input, 'modelFamily')) patch.modelFamily = cleanString(input.modelFamily, 'modelFamily')
  if (Object.hasOwn(input, 'effortLevels')) patch.effortLevels = cleanStringList(input.effortLevels, 'effortLevels')
  if (Object.hasOwn(input, 'plan')) patch.plan = cleanPlan(input.plan)
  if (Object.hasOwn(input, 'authority')) patch.authority = cleanAuthority(input.authority)

  let isDefault: boolean | undefined
  if (Object.hasOwn(input, 'isDefault')) {
    if (typeof input.isDefault !== 'boolean') throw new ValidationError('isDefault must be a boolean.')
    isDefault = input.isDefault
  }

  let expectedRevision: number | undefined
  if (Object.hasOwn(input, 'expectedRevision')) {
    if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
      throw new ValidationError('expectedRevision must be a non-negative safe integer.')
    }
    expectedRevision = input.expectedRevision as number
  }

  return {
    patch,
    ...(isDefault !== undefined ? { isDefault } : {}),
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
  }
}
