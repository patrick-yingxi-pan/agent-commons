/** Strict, bounded validation for the form-only MCP Multi Round-Trip Request
 * foundation. This module validates data only; it never displays forms,
 * supplies defaults, interprets requestState, or continues a request. */
import type {
  McpFormArraySchema,
  McpFormChoice,
  McpFormInputRequired,
  McpFormInputRequest,
  McpFormInputResponse,
  McpFormInputResponses,
  McpFormPrimitive,
  McpFormPropertySchema,
  McpFormSchema,
} from '../contract/mcpElicitation.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import type { McpJsonValue } from './mcpJson.ts'

export type {
  McpFormAcceptedResponse,
  McpFormArraySchema,
  McpFormBooleanSchema,
  McpFormChoice,
  McpFormDeclinedResponse,
  McpFormInputRequired,
  McpFormInputRequest,
  McpFormInputResponse,
  McpFormInputResponses,
  McpFormNumberSchema,
  McpFormPrimitive,
  McpFormPropertySchema,
  McpFormSchema,
  McpFormStringSchema,
} from '../contract/mcpElicitation.ts'

export const MCP_FORM_INPUT_MAX_BYTES = 65_536
export const MCP_FORM_INPUT_MAX_DEPTH = 16
export const MCP_FORM_INPUT_MAX_NODES = 8_192
export const MCP_FORM_REQUEST_MAX_COUNT = 4
export const MCP_FORM_FIELDS_PER_REQUEST_MAX = 32
export const MCP_FORM_FIELDS_TOTAL_MAX = 64
export const MCP_FORM_ENUM_MAX_COUNT = 64
export const MCP_FORM_TEXT_MAX_CHARS = 4_096
export const MCP_FORM_MESSAGE_MAX_CHARS = 2_048
export const MCP_FORM_ID_MAX_CHARS = 128
export const MCP_FORM_TITLE_MAX_CHARS = 256
export const MCP_FORM_DESCRIPTION_MAX_CHARS = 1_024
export const MCP_FORM_REQUEST_STATE_MAX_BYTES = 8_192

export class McpFormError extends Error {
  readonly code = 'invalid_mcp_form' as const
  constructor() {
    super('The MCP server returned an unsupported or invalid form request.')
    this.name = 'McpFormError'
  }
}

const encoder = new TextEncoder()
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const own = (value: object, key: string): boolean => Object.hasOwn(value, key)
const reject = (): never => { throw new McpFormError() }

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []): boolean {
  const keys = Object.keys(value)
  return keys.every(key => allowed.includes(key)) && required.every(key => own(value, key))
}

function text(value: unknown, maxChars: number, multiline = false): value is string {
  if (typeof value !== 'string' || Array.from(value).length > maxChars) return false
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= value.length || value.charCodeAt(i + 1) < 0xdc00 || value.charCodeAt(i + 1) > 0xdfff) return false
      i += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
    else if ((code < 0x20 && !(multiline && (code === 0x09 || code === 0x0a || code === 0x0d))) || (code >= 0x7f && code <= 0x9f)) return false
  }
  return true
}

function validKey(value: string): boolean {
  return value.length <= MCP_FORM_ID_MAX_CHARS && text(value, MCP_FORM_ID_MAX_CHARS) && value.length > 0
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!
}

function validDateTime(value: string): boolean {
  // Deliberately supports the RFC3339 calendar/time subset but not leap seconds.
  const match = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!match || !validDate(match[1]!)) return false
  const hour = Number(match[2]), minute = Number(match[3]), second = Number(match[4])
  const zoneHour = match[7] === undefined ? 0 : Number(match[7])
  const zoneMinute = match[8] === undefined ? 0 : Number(match[8])
  const canonical = value.replace('t', 'T').replace(/z$/, 'Z')
  return hour < 24 && minute < 60 && second < 60 && zoneHour < 24 && zoneMinute < 60 && Number.isFinite(Date.parse(canonical))
}

function validFormat(format: unknown, value: string): boolean {
  switch (format) {
    case undefined: return true
    // Conservative ASCII dot-atom mailbox subset; quoted local parts, comments,
    // address literals and internationalized domains are intentionally absent.
    case 'email': {
      if (value.length > 254 || !/^[\x21-\x7e]+$/.test(value)) return false
      const parts = value.split('@')
      if (parts.length !== 2) return false
      const [local, domain] = parts as [string, string]
      if (local.length > 64 || domain.length > 253 || !/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/.test(local)) return false
      const labels = domain.split('.')
      return labels.length >= 2 && labels.every(label => label.length >= 1 && label.length <= 63 &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label))
    }
    case 'uri':
      if (!value || value.length > 4_096 || /\s/.test(value) || /%(?![0-9A-Fa-f]{2})/.test(value)) return false
      try { const parsed = new URL(value); return parsed.protocol.length > 1 }
      catch { return false }
    case 'date': return validDate(value)
    case 'date-time': return validDateTime(value)
    default: return false
  }
}

function uniqueStrings(values: unknown, min = 1): values is string[] {
  return Array.isArray(values) && values.length >= min && values.length <= MCP_FORM_ENUM_MAX_COUNT &&
    values.every(value => text(value, MCP_FORM_TEXT_MAX_CHARS, true)) && new Set(values).size === values.length
}

function choices(value: unknown): value is McpFormChoice[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MCP_FORM_ENUM_MAX_COUNT) return false
  const seen = new Set<string>()
  return value.every(option => {
    if (!record(option) || !exactKeys(option, ['const', 'title'], ['const', 'title']) ||
      !text(option.const, MCP_FORM_TEXT_MAX_CHARS, true) || !text(option.title, MCP_FORM_TITLE_MAX_CHARS) || !option.title.length || seen.has(option.const)) return false
    seen.add(option.const)
    return true
  })
}

function optionalLabels(value: Record<string, unknown>): boolean {
  return (value.title === undefined || text(value.title, MCP_FORM_TITLE_MAX_CHARS)) &&
    (value.description === undefined || text(value.description, MCP_FORM_DESCRIPTION_MAX_CHARS, true))
}

function validateArraySchema(value: Record<string, unknown>): boolean {
  const allowed = ['type', 'title', 'description', 'minItems', 'maxItems', 'default', 'items']
  if (!exactKeys(value, allowed, ['type', 'items']) || value.type !== 'array' || !optionalLabels(value)) return false
  const min = value.minItems === undefined ? 0 : value.minItems
  const max = value.maxItems === undefined ? MCP_FORM_ENUM_MAX_COUNT : value.maxItems
  if (typeof min !== 'number' || !Number.isSafeInteger(min) || min < 0 || min > MCP_FORM_ENUM_MAX_COUNT ||
    typeof max !== 'number' || !Number.isSafeInteger(max) || max < 0 || max > MCP_FORM_ENUM_MAX_COUNT || min > max) return false
  if (!record(value.items)) return false
  let values: string[]
  if (exactKeys(value.items, ['type', 'enum'], ['type', 'enum']) && value.items.type === 'string' && uniqueStrings(value.items.enum)) {
    values = value.items.enum
  } else if (exactKeys(value.items, ['anyOf'], ['anyOf']) && choices(value.items.anyOf)) {
    values = value.items.anyOf.map(option => option.const)
  } else return false
  if (min > values.length) return false
  const schema = value as unknown as McpFormArraySchema
  return value.default === undefined || validateValue(schema, value.default)
}

function validateProperty(value: unknown): value is McpFormPropertySchema {
  if (!record(value) || !optionalLabels(value) || typeof value.type !== 'string') return false
  if (value.type === 'array') return validateArraySchema(value)
  if (value.type === 'string') {
    const allowed = ['type', 'title', 'description', 'default', 'minLength', 'maxLength', 'format', 'enum', 'oneOf']
    if (!exactKeys(value, allowed, ['type']) || !optionalLabels(value)) return false
    const min = value.minLength === undefined ? 0 : value.minLength
    const max = value.maxLength === undefined ? MCP_FORM_TEXT_MAX_CHARS : value.maxLength
    if (typeof min !== 'number' || !Number.isSafeInteger(min) || min < 0 || min > MCP_FORM_TEXT_MAX_CHARS ||
      typeof max !== 'number' || !Number.isSafeInteger(max) || max < 0 || max > MCP_FORM_TEXT_MAX_CHARS || min > max) return false
    if (value.enum !== undefined && (!uniqueStrings(value.enum) || value.oneOf !== undefined)) return false
    if (value.oneOf !== undefined && !choices(value.oneOf)) return false
    if (value.format !== undefined && (typeof value.format !== 'string' || !['email', 'uri', 'date', 'date-time'].includes(value.format))) return false
    const schema = value as unknown as McpFormPropertySchema
    if (schema.type === 'string' && schema.enum?.some(item => !validateValue(schema, item))) return false
    if (schema.type === 'string' && schema.oneOf?.some(item => !validateValue(schema, item.const))) return false
    return value.default === undefined || validateValue(schema, value.default)
  }
  if (value.type === 'number' || value.type === 'integer') {
    const allowed = ['type', 'title', 'description', 'default', 'minimum', 'maximum']
    if (!exactKeys(value, allowed, ['type']) || !optionalLabels(value)) return false
    if ((value.minimum !== undefined && !validNumber(value.minimum)) || (value.maximum !== undefined && !validNumber(value.maximum)) ||
      (value.minimum !== undefined && value.maximum !== undefined && value.minimum > value.maximum)) return false
    const schema = value as unknown as McpFormPropertySchema
    return value.default === undefined || validateValue(schema, value.default)
  }
  if (value.type === 'boolean') {
    return exactKeys(value, ['type', 'title', 'description', 'default'], ['type']) && optionalLabels(value) &&
      (value.default === undefined || typeof value.default === 'boolean')
  }
  return false
}

function validateValue(schema: McpFormPropertySchema, value: unknown): value is McpFormPrimitive | string[] {
  if (schema.type === 'string') {
    if (!text(value, MCP_FORM_TEXT_MAX_CHARS, true)) return false
    const length = Array.from(value).length
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? MCP_FORM_TEXT_MAX_CHARS) || !validFormat(schema.format, value)) return false
    if (schema.enum && !schema.enum.includes(value)) return false
    if (schema.oneOf && !schema.oneOf.some(option => option.const === value)) return false
    return true
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (!validNumber(value) || (schema.type === 'integer' && !Number.isSafeInteger(value))) return false
    return (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum)
  }
  if (schema.type === 'boolean') return typeof value === 'boolean'
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? MCP_FORM_ENUM_MAX_COUNT) ||
      value.some(item => typeof item !== 'string' || !text(item, MCP_FORM_TEXT_MAX_CHARS, true))) return false
    const allowed = 'enum' in schema.items ? schema.items.enum : schema.items.anyOf.map(option => option.const)
    return new Set(value).size === value.length && value.every(item => allowed.includes(item))
  }
  return false
}

function parseSchema(value: unknown): McpFormSchema | null {
  if (!record(value) || !exactKeys(value, ['type', 'title', 'description', 'properties', 'required'], ['type', 'properties']) ||
    value.type !== 'object' || !optionalLabels(value) || !record(value.properties)) return null
  const names = Object.keys(value.properties)
  if (names.length < 1 || names.length > MCP_FORM_FIELDS_PER_REQUEST_MAX || !names.every(validKey)) return null
  const properties: Record<string, McpFormPropertySchema> = {}
  for (const name of names) {
    const candidate = value.properties[name]
    if (!validateProperty(candidate)) return null
    Object.defineProperty(properties, name, { value: candidate, enumerable: true, writable: true, configurable: true })
  }
  let required: string[] | undefined
  if (value.required !== undefined) {
    if (!Array.isArray(value.required) || value.required.some(name => typeof name !== 'string' || !names.includes(name)) || new Set(value.required).size !== value.required.length) return null
    required = [...value.required]
  }
  return {
    type: 'object',
    ...(value.title === undefined ? {} : { title: value.title as string }),
    ...(value.description === undefined ? {} : { description: value.description as string }),
    properties,
    ...(required === undefined ? {} : { required }),
  }
}

function parseRequest(id: string, value: unknown): McpFormInputRequest | null {
  if (!validKey(id) || !record(value) || !exactKeys(value, ['method', 'params'], ['method', 'params']) || value.method !== 'elicitation/create' || !record(value.params)) return null
  const params = value.params
  if (!exactKeys(params, ['mode', 'message', 'requestedSchema'], ['message', 'requestedSchema']) ||
    (params.mode !== undefined && params.mode !== 'form') || !text(params.message, MCP_FORM_MESSAGE_MAX_CHARS, true)) return null
  const requestedSchema = parseSchema(params.requestedSchema)
  if (!requestedSchema) return null
  return { method: 'elicitation/create', params: { ...(params.mode === undefined ? {} : { mode: 'form' }), message: params.message, requestedSchema } }
}

function detached(value: unknown): McpJsonValue {
  try { return snapshotMcpJson(value, { maxBytes: MCP_FORM_INPUT_MAX_BYTES, maxDepth: MCP_FORM_INPUT_MAX_DEPTH, maxNodes: MCP_FORM_INPUT_MAX_NODES }) }
  catch { return reject() }
}

export function parseMcpFormInputRequired(value: unknown): McpFormInputRequired {
  const input = detached(value)
  if (!record(input) || !exactKeys(input, ['resultType', 'inputRequests', 'requestState', '_meta'], ['resultType', 'inputRequests']) || input.resultType !== 'input_required' ||
    (input._meta !== undefined && !record(input._meta)) ||
    !record(input.inputRequests) || (input.requestState !== undefined && (typeof input.requestState !== 'string' || encoder.encode(input.requestState).byteLength > MCP_FORM_REQUEST_STATE_MAX_BYTES))) return reject()
  const ids = Object.keys(input.inputRequests)
  if (ids.length < 1 || ids.length > MCP_FORM_REQUEST_MAX_COUNT) return reject()
  const requests: Record<string, McpFormInputRequest> = {}
  let totalFields = 0
  for (const id of ids) {
    const request = parseRequest(id, input.inputRequests[id])
    if (!request) return reject()
    totalFields += Object.keys(request.params.requestedSchema.properties).length
    if (totalFields > MCP_FORM_FIELDS_TOTAL_MAX) return reject()
    Object.defineProperty(requests, id, { value: request, enumerable: true, writable: true, configurable: true })
  }
  return {
    resultType: 'input_required',
    inputRequests: requests,
    ...(input.requestState === undefined ? {} : { requestState: input.requestState }),
  }
}

function parseResponse(request: McpFormInputRequest, value: unknown): McpFormInputResponse | null {
  if (!record(value) || typeof value.action !== 'string') return null
  if (value.action === 'decline' || value.action === 'cancel') {
    return exactKeys(value, ['action'], ['action']) ? { action: value.action } : null
  }
  if (value.action !== 'accept' || !exactKeys(value, ['action', 'content'], ['action', 'content']) || !record(value.content)) return null
  const schema = request.params.requestedSchema
  const contentNames = Object.keys(value.content)
  if (contentNames.some(name => !own(schema.properties, name))) return null
  const required = new Set(schema.required ?? [])
  if ([...required].some(name => !own(value.content as object, name))) return null
  const content: Record<string, McpFormPrimitive | string[]> = {}
  for (const name of contentNames) {
    const fieldSchema = schema.properties[name]!
    const fieldValue = value.content[name]
    if (!validateValue(fieldSchema, fieldValue)) return null
    Object.defineProperty(content, name, {
      value: Array.isArray(fieldValue) ? [...fieldValue] : fieldValue,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return { action: 'accept', content }
}

export function parseMcpFormResponses(pending: McpFormInputRequired, value: unknown): McpFormInputResponses {
  const normalized = parseMcpFormInputRequired(pending)
  const input = detached(value)
  if (!record(input)) return reject()
  const expectedIds = Object.keys(normalized.inputRequests)
  const responseIds = Object.keys(input)
  if (responseIds.length !== expectedIds.length || responseIds.some(id => !own(normalized.inputRequests, id))) return reject()
  const responses: McpFormInputResponses = {}
  for (const id of expectedIds) {
    const response = parseResponse(normalized.inputRequests[id]!, input[id])
    if (!response) return reject()
    Object.defineProperty(responses, id, { value: response, enumerable: true, writable: true, configurable: true })
  }
  return responses
}
