/** Strict validation for commission creation and editable configuration. */
import {
  PROJECT_ROLES,
  type Authority,
  type Budget,
  type CommissionConfigurationPatch,
  type CreateCommissionRequest,
} from '../../contract/index.ts'
import { ValidationError } from '../conflict.ts'

const CREATE_FIELDS = ['agentId', 'projectId', 'role', 'authority', 'grant', 'standing'] as const
const UPDATE_FIELDS = ['role', 'authority', 'grant', 'standing', 'expectedRevision'] as const
const AUTHORITY_FIELDS = ['tools', 'connectors', 'scopes'] as const
const BUDGET_FIELDS = ['windows'] as const
const WINDOW_FIELDS = ['label', 'ceiling'] as const
const MAX_ID_CHARS = 256
const MAX_GRANT_ITEMS = 128
const MAX_GRANT_ITEM_CHARS = 512
const MAX_BUDGET_WINDOWS = 32

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(message)
  return value as Record<string, unknown>
}

function rejectUnknown(input: Record<string, unknown>, allowed: readonly string[], kind: string): void {
  const unknown = Object.keys(input).find((field) => !allowed.includes(field))
  if (unknown) throw new ValidationError(`Unknown ${kind} field '${unknown}'.`)
}

function cleanString(value: unknown, field: string, max = MAX_GRANT_ITEM_CHARS): string {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} must be a non-empty string.`)
  const clean = value.trim()
  if (clean.length > max) throw new ValidationError(`${field} is too long.`)
  return clean
}

function cleanStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_GRANT_ITEMS) {
    throw new ValidationError(`${field} must be an array with at most ${MAX_GRANT_ITEMS} entries.`)
  }
  const clean = value.map((item) => cleanString(item, field))
  if (new Set(clean).size !== clean.length) throw new ValidationError(`${field} must not contain duplicates.`)
  return clean
}

function cleanAuthority(value: unknown): Authority {
  const input = record(value, 'authority must be an object.')
  rejectUnknown(input, AUTHORITY_FIELDS, 'authority')
  const result: Authority = {}
  for (const field of AUTHORITY_FIELDS) {
    if (Object.hasOwn(input, field)) result[field] = cleanStringList(input[field], `authority.${field}`)
  }
  return result
}

function cleanBudget(value: unknown): Budget {
  const input = record(value, 'grant must be an object.')
  rejectUnknown(input, BUDGET_FIELDS, 'grant')
  if (!Array.isArray(input.windows) || input.windows.length > MAX_BUDGET_WINDOWS) {
    throw new ValidationError(`grant.windows must be an array with at most ${MAX_BUDGET_WINDOWS} entries.`)
  }
  const windows = input.windows.map((value, index) => {
    const window = record(value, `grant.windows[${index}] must be an object.`)
    rejectUnknown(window, WINDOW_FIELDS, `grant.windows[${index}]`)
    const ceiling = window.ceiling
    if (!Number.isSafeInteger(ceiling) || (ceiling as number) < 0) {
      throw new ValidationError(`grant.windows[${index}].ceiling must be a non-negative safe integer.`)
    }
    return {
      label: cleanString(window.label, `grant.windows[${index}].label`),
      ceiling: ceiling as number,
    }
  })
  if (new Set(windows.map((window) => window.label)).size !== windows.length) {
    throw new ValidationError('grant.windows must not contain duplicate labels.')
  }
  return { windows }
}

function cleanRole(value: unknown) {
  if (typeof value !== 'string' || !PROJECT_ROLES.includes(value as never)) {
    throw new ValidationError(`Unknown role '${String(value ?? '')}'.`)
  }
  return value as CreateCommissionRequest['role']
}

function cleanStanding(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ValidationError('standing must be a boolean.')
  return value
}

export function commissionCreate(value: unknown): CreateCommissionRequest {
  const input = record(value, 'A commission definition is required.')
  rejectUnknown(input, CREATE_FIELDS, 'commission')
  const request: CreateCommissionRequest = {
    agentId: cleanString(input.agentId, 'agentId', MAX_ID_CHARS),
    projectId: cleanString(input.projectId, 'projectId', MAX_ID_CHARS),
    role: cleanRole(input.role),
  }
  if (Object.hasOwn(input, 'authority')) request.authority = cleanAuthority(input.authority)
  if (Object.hasOwn(input, 'grant')) request.grant = cleanBudget(input.grant)
  if (Object.hasOwn(input, 'standing')) request.standing = cleanStanding(input.standing)
  return request
}

export interface CommissionConfigurationUpdate {
  patch: CommissionConfigurationPatch
  expectedRevision?: number
}

export function commissionConfigurationUpdate(value: unknown): CommissionConfigurationUpdate {
  const input = record(value, 'A commission configuration patch is required.')
  rejectUnknown(input, UPDATE_FIELDS, 'commission')
  const patch: CommissionConfigurationPatch = {}
  if (Object.hasOwn(input, 'role')) patch.role = cleanRole(input.role)
  if (Object.hasOwn(input, 'authority')) patch.authority = cleanAuthority(input.authority)
  if (Object.hasOwn(input, 'grant')) patch.grant = cleanBudget(input.grant)
  if (Object.hasOwn(input, 'standing')) patch.standing = cleanStanding(input.standing)
  if (Object.keys(patch).length === 0) throw new ValidationError('Name at least one commission field to update.')

  let expectedRevision: number | undefined
  if (Object.hasOwn(input, 'expectedRevision')) {
    if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
      throw new ValidationError('expectedRevision must be a non-negative safe integer.')
    }
    expectedRevision = input.expectedRevision as number
  }
  return { patch, ...(expectedRevision !== undefined ? { expectedRevision } : {}) }
}
