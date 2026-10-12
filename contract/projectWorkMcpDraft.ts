import type { McpDiscoveredTool } from './mcpConnections.ts'
import { isExternalMcpId } from './mcpConnections.ts'
import type { McpJsonValue } from './mcpExecution.ts'

export interface ProjectWorkMcpDraftSelection {
  connectionId: string
  connectionRevision: number
  toolName: string
}

/** Public, non-executable annotation for the exact tool binding used to draft. */
export interface ProjectWorkMcpDraftPreview {
  connectionLabel: string
  toolName: string
  bindingHash: string
  transport?: 'stdio'
}

export type ProjectWorkMcpDraftReply =
  | { ok: true; arguments: Record<string, McpJsonValue> }
  | { ok: false; message: string }

const SELECTION_KEYS = ['connectionId', 'connectionRevision', 'toolName'] as const
const PREVIEW_KEYS = ['connectionLabel', 'toolName', 'bindingHash'] as const
const MAX_ID_CHARS = 200
const MAX_NAME_CHARS = 128
const MAX_LABEL_CHARS = 2_000
const MAX_TEXT_BYTES = 64 * 1024
const MAX_ARGUMENT_BYTES = 48 * 1024
const MAX_JSON_DEPTH = 32
const MAX_JSON_NODES = 4_096
const MAX_SCHEMA_BYTES = 196_608
const MAX_SCHEMA_DEPTH = 36
const MAX_SCHEMA_NODES = 12_288

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactDataRecord(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> | undefined {
  if (!plainRecord(value)) return undefined
  const ownKeys = Reflect.ownKeys(value)
  const allowed = new Set([...keys, ...optional])
  if (ownKeys.length !== keys.length + optional.filter(key => Object.hasOwn(value, key)).length ||
      ownKeys.some(key => typeof key !== 'string' || !allowed.has(key)) ||
      !keys.every(key => Object.hasOwn(value, key))) return undefined
  const result: Record<string, unknown> = Object.create(null)
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined
    result[key] = descriptor.value
  }
  return result
}

function selectedDataProperties(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> | undefined {
  if (!plainRecord(value) || !keys.every(key => Object.hasOwn(value, key))) return undefined
  const result: Record<string, unknown> = Object.create(null)
  for (const key of [...keys, ...optional.filter(key => Object.hasOwn(value, key))]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined
    result[key] = descriptor.value
  }
  return result
}

function nonblank(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !!value.trim() && validUnicode(value)
}

function validToolName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Array.from(value).length <= MAX_NAME_CHARS &&
    !!value.trim() && validUnicode(value) && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
}

/** Parse an exact revision-pinned tool reference; this carries no arguments or authority. */
export function parseProjectWorkMcpDraftSelection(value: unknown): ProjectWorkMcpDraftSelection | undefined {
  try {
    const row = exactDataRecord(value, SELECTION_KEYS)
    if (!row || !nonblank(row.connectionId, MAX_ID_CHARS) || !isExternalMcpId(row.connectionId) ||
        typeof row.connectionRevision !== 'number' || !Number.isSafeInteger(row.connectionRevision) ||
        row.connectionRevision < 0 || !validToolName(row.toolName)) return undefined
    return { connectionId: row.connectionId, connectionRevision: row.connectionRevision, toolName: row.toolName }
  } catch { return undefined }
}

/** Parse a detached display-only binding annotation. */
export function parseProjectWorkMcpDraftPreview(value: unknown): ProjectWorkMcpDraftPreview | undefined {
  try {
    const row = exactDataRecord(value, PREVIEW_KEYS, ['transport'])
    if (!row || !nonblank(row.connectionLabel, MAX_LABEL_CHARS) || !validToolName(row.toolName) ||
        typeof row.bindingHash !== 'string' || !/^[0-9a-f]{64}$/.test(row.bindingHash) ||
        (Object.hasOwn(row, 'transport') && row.transport !== 'stdio')) return undefined
    return { connectionLabel: row.connectionLabel, toolName: row.toolName, bindingHash: row.bindingHash,
      ...(row.transport === 'stdio' ? { transport: 'stdio' as const } : {}) }
  } catch { return undefined }
}

function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

function canonicalJson(value: unknown, maxDepth: number, maxNodes: number, maxBytes: number): string {
  let nodes = 0
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > maxNodes || depth > maxDepth) throw new Error('invalid JSON value')
    if (item === null || typeof item === 'boolean') return item
    if (typeof item === 'string') {
      if (!validUnicode(item)) throw new Error('invalid Unicode')
      return item
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('non-finite number')
      return item
    }
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype || Reflect.ownKeys(item).length !== item.length + 1) {
        throw new Error('invalid array')
      }
      const result: unknown[] = []
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index))
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('invalid array')
        result.push(visit(descriptor.value, depth + 1))
      }
      return result
    }
    if (!plainRecord(item)) throw new Error('invalid record')
    const keys = Reflect.ownKeys(item)
    if (keys.some(key => typeof key !== 'string')) throw new Error('invalid key')
    const sorted = (keys as string[]).sort()
    const result: Record<string, unknown> = Object.create(null)
    for (const key of sorted) {
      if (!validUnicode(key)) throw new Error('invalid Unicode key')
      const descriptor = Object.getOwnPropertyDescriptor(item, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('invalid property')
      result[key] = visit(descriptor.value, depth + 1)
    }
    return result
  }
  const canonical = JSON.stringify(visit(value, 0))
  if (canonical === undefined || new TextEncoder().encode(canonical).byteLength > maxBytes) throw new Error('JSON value too large')
  return canonical
}

/** Canonical identity + admitted schema material, excluding presentation prose and permission. */
export function projectWorkMcpDraftBindingText(
  tenantId: string,
  userId: string,
  selection: ProjectWorkMcpDraftSelection,
  tool: McpDiscoveredTool,
): string {
  if (!nonblank(tenantId, MAX_ID_CHARS) || !nonblank(userId, MAX_ID_CHARS)) throw new TypeError('invalid Project-work MCP identity')
  const selected = parseProjectWorkMcpDraftSelection(selection)
  if (!selected) throw new TypeError('invalid Project-work MCP selection')
  const toolFields = selectedDataProperties(tool, ['name', 'inputSchema'], ['outputSchema'])
  if (!toolFields || toolFields.name !== selected.toolName || !plainRecord(toolFields.inputSchema) ||
      (Object.hasOwn(toolFields, 'outputSchema') && !plainRecord(toolFields.outputSchema))) {
    throw new TypeError('invalid admitted MCP tool schema')
  }
  const identity = {
    tenantId,
    userId,
    connectionId: selected.connectionId,
    connectionRevision: selected.connectionRevision,
    toolName: selected.toolName,
    inputSchema: JSON.parse(canonicalJson(toolFields.inputSchema, MAX_SCHEMA_DEPTH, MAX_SCHEMA_NODES, MAX_SCHEMA_BYTES)),
    ...(Object.hasOwn(toolFields, 'outputSchema')
      ? { outputSchema: JSON.parse(canonicalJson(toolFields.outputSchema, MAX_SCHEMA_DEPTH, MAX_SCHEMA_NODES, MAX_SCHEMA_BYTES)) }
      : {}),
  }
  return canonicalJson(identity, MAX_SCHEMA_DEPTH + 2, MAX_SCHEMA_NODES * 2, MAX_SCHEMA_BYTES * 2)
}

function noDuplicateObjectKeys(text: string): boolean {
  let cursor = 0
  const whitespace = () => { while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++ }
  const stringToken = (): string | undefined => {
    if (text[cursor] !== '"') return undefined
    const start = cursor++
    while (cursor < text.length) {
      const char = text[cursor++]
      if (char === '"') {
        try { return JSON.parse(text.slice(start, cursor)) as string } catch { return undefined }
      }
      if (char === '\\') cursor++
      else if (char.charCodeAt(0) < 0x20) return undefined
    }
    return undefined
  }
  const value = (depth: number): boolean => {
    if (depth > 40) return false
    whitespace()
    if (text[cursor] === '{') {
      cursor++
      whitespace()
      const keys = new Set<string>()
      if (text[cursor] === '}') { cursor++; return true }
      while (cursor < text.length) {
        whitespace()
        const key = stringToken()
        if (key === undefined || keys.has(key)) return false
        keys.add(key)
        whitespace()
        if (text[cursor++] !== ':') return false
        if (!value(depth + 1)) return false
        whitespace()
        const separator = text[cursor++]
        if (separator === '}') return true
        if (separator !== ',') return false
      }
      return false
    }
    if (text[cursor] === '[') {
      cursor++
      whitespace()
      if (text[cursor] === ']') { cursor++; return true }
      while (cursor < text.length) {
        if (!value(depth + 1)) return false
        whitespace()
        const separator = text[cursor++]
        if (separator === ']') return true
        if (separator !== ',') return false
      }
      return false
    }
    if (text[cursor] === '"') return stringToken() !== undefined
    const rest = text.slice(cursor)
    const primitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(rest)?.[0]
    if (!primitive) return false
    cursor += primitive.length
    return true
  }
  if (!value(0)) return false
  whitespace()
  return cursor === text.length
}

function validJsonValue(value: unknown, depth: number, count: { nodes: number }): value is McpJsonValue {
  if (++count.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'string') return validUnicode(value)
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(item => validJsonValue(item, depth + 1, count))
  if (!plainRecord(value)) return false
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && validUnicode(key) &&
    validJsonValue((value as Record<string, unknown>)[key], depth + 1, count))
}

/** Parse the model's closed JSON reply without interpreting prose as tool intent. */
export function parseProjectWorkMcpDraftReply(text: string, expectedToolName: string): ProjectWorkMcpDraftReply {
  const invalid = (): ProjectWorkMcpDraftReply => ({ ok: false, message: 'The draft reply was not one exact, bounded JSON tool-arguments object.' })
  try {
    if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES ||
        !validToolName(expectedToolName) || !noDuplicateObjectKeys(text)) return invalid()
    const parsed: unknown = JSON.parse(text)
    const row = exactDataRecord(parsed, ['toolName', 'arguments'])
    if (!row || row.toolName !== expectedToolName || !plainRecord(row.arguments)) return invalid()
    const count = { nodes: 0 }
    if (!validJsonValue(row.arguments, 0, count)) return invalid()
    const argumentJson = JSON.stringify(row.arguments)
    if (argumentJson === undefined || new TextEncoder().encode(argumentJson).byteLength > MAX_ARGUMENT_BYTES) return invalid()
    return { ok: true, arguments: row.arguments as Record<string, McpJsonValue> }
  } catch { return invalid() }
}
