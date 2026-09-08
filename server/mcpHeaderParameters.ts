/**
 * Validation and extraction for the Streamable HTTP `x-mcp-header` schema
 * extension.  This is deliberately separate from catalog admission: it only
 * builds the small, inert plan needed by a later tool call.
 */

import { snapshotMcpJson } from './mcpJson.ts'

export interface McpHeaderParameter {
  name: string
  path: string[]
  type: 'string' | 'integer' | 'boolean'
}

export const MCP_HEADER_PARAMETER_MAX_COUNT = 32
export const MCP_HEADER_PARAMETER_NAME_MAX_CHARS = 128
export const MCP_HEADER_PARAMETER_MAX_BYTES = 16 * 1024

const MAX_SCHEMA_NODES = 8_192
const MAX_SCHEMA_DEPTH = 64
const MAX_PATH_LENGTH = 64
const MAX_PATH_SEGMENT_CHARS = 1_024
const encoder = new TextEncoder()
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export class McpHeaderParameterError extends Error {
  readonly code = 'invalid_mcp_header_parameters' as const

  constructor() {
    super('Invalid MCP header parameter definition.')
    this.name = 'McpHeaderParameterError'
  }
}

function reject(): never {
  throw new McpHeaderParameterError()
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function own(value: object, key: string): boolean {
  return Object.hasOwn(value, key)
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length <= MCP_HEADER_PARAMETER_NAME_MAX_CHARS &&
    TOKEN.test(value)
}

function validType(value: unknown): value is McpHeaderParameter['type'] {
  return value === 'string' || value === 'integer' || value === 'boolean'
}

function validPathSegment(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PATH_SEGMENT_CHARS
}

function validatePlan(input: unknown): McpHeaderParameter[] {
  if (!Array.isArray(input) || input.length > MCP_HEADER_PARAMETER_MAX_COUNT) reject()
  const names = new Set<string>()
  const plan: McpHeaderParameter[] = []
  for (const candidate of input) {
    if (!record(candidate) || !own(candidate, 'name') || !own(candidate, 'path') || !own(candidate, 'type')) reject()
    if (!validToken(candidate.name)) reject()
    if (names.has(candidate.name.toLowerCase())) reject()
    names.add(candidate.name.toLowerCase())
    if (!Array.isArray(candidate.path) || candidate.path.length === 0 || candidate.path.length > MAX_PATH_LENGTH) reject()
    if (!candidate.path.every(validPathSegment)) reject()
    if (!validType(candidate.type)) reject()
    plan.push({ name: candidate.name, path: [...candidate.path], type: candidate.type })
  }
  return plan
}

type Visit = (value: unknown, path: string[], staticPath: boolean, depth: number) => void

function parsePlan(inputSchema: unknown): McpHeaderParameter[] {
  if (!record(inputSchema)) reject()
  const plan: McpHeaderParameter[] = []
  const names = new Set<string>()
  const active = new WeakSet<object>()
  let nodes = 0

  const visit: Visit = (value, path, staticPath, depth) => {
    if (value === null || typeof value !== 'object') return
    if (depth > MAX_SCHEMA_DEPTH || active.has(value)) reject()
    nodes += 1
    if (nodes > MAX_SCHEMA_NODES) reject()
    active.add(value)
    try {
      if (Array.isArray(value)) {
        if (value.length > MAX_SCHEMA_NODES) reject()
        for (const item of value) visit(item, path, false, depth + 1)
        return
      }
      if (!record(value)) reject()

      if (own(value, 'x-mcp-header')) {
        if (!staticPath || path.length === 0 || !validToken(value['x-mcp-header']) || !validType(value.type)) reject()
        const name = value['x-mcp-header']
        const key = name.toLowerCase()
        if (names.has(key) || plan.length >= MCP_HEADER_PARAMETER_MAX_COUNT) reject()
        names.add(key)
        plan.push({ name, path: [...path], type: value.type })
      }

      const visitMap = (candidate: unknown, nextStaticPath: boolean) => {
        if (!record(candidate)) return
        const keys = Object.keys(candidate)
        if (keys.length > MAX_SCHEMA_NODES) reject()
        for (const key of keys) visit(candidate[key], path, nextStaticPath, depth + 1)
      }
      const visitList = (candidate: unknown, nextStaticPath: boolean) => {
        if (!Array.isArray(candidate)) {
          visit(candidate, path, nextStaticPath, depth + 1)
          return
        }
        if (candidate.length > MAX_SCHEMA_NODES) reject()
        for (const item of candidate) visit(item, path, nextStaticPath, depth + 1)
      }

      // Only `properties` contributes a statically reachable path.  Every
      // other schema-bearing keyword is still traversed so an annotation in
      // an unsupported position cannot be silently accepted.
      if (own(value, 'properties')) {
        const properties = value.properties
        if (record(properties)) {
          const keys = Object.keys(properties)
          if (keys.length > MAX_SCHEMA_NODES) reject()
          for (const key of keys) visit(properties[key], [...path, key], staticPath, depth + 1)
        }
      }
      for (const key of ['patternProperties', '$defs', 'definitions', 'dependentSchemas']) {
        if (own(value, key)) visitMap(value[key], false)
      }
      for (const key of ['items', 'prefixItems', 'additionalItems', 'contains', 'propertyNames',
        'additionalProperties', 'unevaluatedItems', 'unevaluatedProperties', 'contentSchema',
        'not', 'if', 'then', 'else']) {
        if (own(value, key)) visitList(value[key], false)
      }
      for (const key of ['allOf', 'anyOf', 'oneOf']) {
        if (own(value, key)) visitList(value[key], false)
      }
      if (own(value, 'dependencies')) {
        const dependencies = value.dependencies
        if (record(dependencies)) {
          const keys = Object.keys(dependencies)
          if (keys.length > MAX_SCHEMA_NODES) reject()
          for (const key of keys) {
            const candidate = dependencies[key]
            if (record(candidate)) visit(candidate, path, false, depth + 1)
          }
        }
      }
    } finally {
      active.delete(value)
    }
  }

  visit(inputSchema, [], true, 0)
  return plan
}

/** Build an inert plan from a JSON Schema inputSchema. */
export function parseMcpHeaderParameters(inputSchema: unknown): McpHeaderParameter[] {
  try {
    const snapshot = snapshotMcpJson(inputSchema, { maxBytes: 65_536, maxDepth: 32, maxNodes: 4_096 })
    return parsePlan(snapshot)
  } catch (error) {
    if (error instanceof McpHeaderParameterError) throw error
    return reject()
  }
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

/** Encode one value according to the Streamable HTTP base64 sentinel rules. */
export function encodeMcpHeaderValue(value: string): string {
  if (typeof value !== 'string' || value.length > MCP_HEADER_PARAMETER_MAX_BYTES || hasUnpairedSurrogate(value)) reject()
  const plain = Array.from(value).every((char) => {
    const code = char.codePointAt(0)!
    return code === 0x09 || (code >= 0x20 && code <= 0x7e)
  }) && !/^[\t ]|[\t ]$/.test(value) &&
    !(value.startsWith('=?base64?') && value.endsWith('?='))
  if (plain) return value
  const base64 = Buffer.from(value, 'utf8').toString('base64')
  return `=?base64?${base64}?=`
}

function extractOwn(args: Record<string, unknown>, path: string[]): { present: boolean; value?: unknown } {
  let current: unknown = args
  for (const segment of path) {
    if (!record(current) || !own(current, segment)) return { present: false }
    const descriptor = Object.getOwnPropertyDescriptor(current, segment)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) reject()
    current = descriptor.value
  }
  return { present: true, value: current }
}

/** Extract and encode headers for one call's arguments. */
export function buildMcpParameterHeaders(planInput: unknown, args: unknown): Record<string, string> {
  try {
    const plan = validatePlan(snapshotMcpJson(planInput, { maxBytes: 65_536, maxDepth: 32, maxNodes: 4_096 }))
    if (!record(args)) reject()
    const headers: Record<string, string> = {}
    let totalBytes = 0
    for (const parameter of plan) {
      const extracted = extractOwn(args, parameter.path)
      if (!extracted.present || extracted.value === null) continue
      const value = extracted.value
      let text: string
      if (parameter.type === 'string') {
        if (typeof value !== 'string') reject()
        text = value
      } else if (parameter.type === 'integer') {
        if (!Number.isSafeInteger(value)) reject()
        text = String(value)
      } else {
        if (typeof value !== 'boolean') reject()
        text = value ? 'true' : 'false'
      }
      if (encoder.encode(text).byteLength > MCP_HEADER_PARAMETER_MAX_BYTES) reject()
      const headerName = `Mcp-Param-${parameter.name}`
      const headerValue = encodeMcpHeaderValue(text)
      totalBytes += encoder.encode(`${headerName}: ${headerValue}\r\n`).byteLength
      if (totalBytes > MCP_HEADER_PARAMETER_MAX_BYTES) reject()
      headers[headerName] = headerValue
    }
    return headers
  } catch (error) {
    if (error instanceof McpHeaderParameterError) throw error
    return reject()
  }
}
