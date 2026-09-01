/** Strict validation for the public system-prompt definition mutation domain. */
import {
  MAX_SYSTEM_PROMPT_BODY_CHARS,
  type CreateSystemPromptRequest,
  type SystemPromptDefinitionPatch,
} from '../../contract/index.ts'
import { ValidationError } from '../conflict.ts'

const CREATE_FIELDS = ['label', 'body', 'targetFamily', 'isDefault'] as const
const UPDATE_FIELDS = [...CREATE_FIELDS, 'expectedRevision'] as const
const MAX_LABEL_CHARS = 160
const MAX_FAMILY_CHARS = 160

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(message)
  return value as Record<string, unknown>
}

function rejectUnknown(input: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(input).find((field) => !allowed.includes(field))
  if (unknown) throw new ValidationError(`Unknown system prompt field '${unknown}'.`)
}

function cleanString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} must be a non-empty string.`)
  const clean = value.trim()
  if (clean.length > max) throw new ValidationError(`${field} is too long.`)
  return clean
}

function cleanDefault(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ValidationError('isDefault must be a boolean.')
  return value
}

export function systemPromptCreate(value: unknown): CreateSystemPromptRequest {
  const input = record(value, 'A system prompt definition is required.')
  rejectUnknown(input, CREATE_FIELDS)
  const request: CreateSystemPromptRequest = {
    label: cleanString(input.label, 'label', MAX_LABEL_CHARS),
    body: cleanString(input.body, 'body', MAX_SYSTEM_PROMPT_BODY_CHARS),
    targetFamily: cleanString(input.targetFamily, 'targetFamily', MAX_FAMILY_CHARS),
  }
  if (Object.hasOwn(input, 'isDefault')) request.isDefault = cleanDefault(input.isDefault)
  return request
}

export interface SystemPromptDefinitionUpdate {
  patch: SystemPromptDefinitionPatch
  isDefault?: boolean
  expectedRevision?: number
}

export function systemPromptDefinitionUpdate(value: unknown): SystemPromptDefinitionUpdate {
  const input = record(value, 'A system prompt definition patch is required.')
  rejectUnknown(input, UPDATE_FIELDS)
  if (!Object.keys(input).length) throw new ValidationError('Name at least one system prompt field to update.')

  const patch: SystemPromptDefinitionPatch = {}
  if (Object.hasOwn(input, 'label')) patch.label = cleanString(input.label, 'label', MAX_LABEL_CHARS)
  if (Object.hasOwn(input, 'body')) patch.body = cleanString(input.body, 'body', MAX_SYSTEM_PROMPT_BODY_CHARS)
  if (Object.hasOwn(input, 'targetFamily')) {
    patch.targetFamily = cleanString(input.targetFamily, 'targetFamily', MAX_FAMILY_CHARS)
  }

  let isDefault: boolean | undefined
  if (Object.hasOwn(input, 'isDefault')) isDefault = cleanDefault(input.isDefault)

  let expectedRevision: number | undefined
  if (Object.hasOwn(input, 'expectedRevision')) {
    if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
      throw new ValidationError('expectedRevision must be a non-negative safe integer.')
    }
    expectedRevision = input.expectedRevision as number
  }

  if (Object.keys(patch).length === 0 && isDefault === undefined) {
    throw new ValidationError('Name at least one system prompt field to update.')
  }

  return {
    patch,
    ...(isDefault !== undefined ? { isDefault } : {}),
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
  }
}
