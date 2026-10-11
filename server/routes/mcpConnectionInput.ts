import type {
  McpConnectionCreateRequest,
  McpConnectionInspectionRequest,
  McpConnectionLifecycleRequest,
} from '../../contract/mcpConnections.ts'
import { ValidationError } from '../conflict.ts'
import { mcpConnectionEndpoint } from '../mcpConnections.ts'

const MAX_LOGICAL_KEY_CHARS = 128
const MAX_LABEL_CHARS = 256
const MAX_ENDPOINT_CHARS = 2_048
const REFERENCE_PATTERN = /^MCP_DESKTOP_[A-F0-9]{32}$/
const CREATE_FIELDS = ['creationId', 'label', 'endpoint', 'authentication'] as const
const INSPECTION_FIELDS = ['operationId', 'expectedRevision', 'credentialReference'] as const
const LIFECYCLE_FIELDS = ['expectedRevision'] as const

type Input = Record<string, unknown>

function invalid(subject: string): never {
  throw new ValidationError(`Invalid MCP connection ${subject} request.`)
}

function record(value: unknown, subject: string): Input {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(subject)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) invalid(subject)
  return value as Input
}

function exactFields(input: Input, allowed: readonly string[], subject: string): void {
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid(subject)
}

function logicalKey(value: unknown, subject: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_LOGICAL_KEY_CHARS || !/^[\x20-\x7e]+$/.test(value)) {
    invalid(subject)
  }
  return value
}

function label(value: unknown): string {
  if (typeof value !== 'string') invalid('create')
  const clean = value.trim()
  if (!clean || clean.length > MAX_LABEL_CHARS || /[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(clean)) invalid('create')
  return clean
}

function endpoint(value: unknown, allowLoopback: unknown): string {
  if (typeof allowLoopback !== 'boolean' || typeof value !== 'string' || value.length > MAX_ENDPOINT_CHARS) invalid('create')
  try {
    return mcpConnectionEndpoint(value, allowLoopback).endpoint
  } catch {
    invalid('create')
  }
}

function revision(value: unknown, subject: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(subject)
  return value as number
}

export function parseMcpConnectionCreate(value: unknown, allowLoopback = false): McpConnectionCreateRequest {
  const input = record(value, 'create')
  exactFields(input, CREATE_FIELDS, 'create')
  if (typeof allowLoopback !== 'boolean') invalid('create')
  const authentication = input.authentication
  if (authentication !== 'none' && authentication !== 'device-bearer' && authentication !== 'device-oauth') invalid('create')
  return {
    creationId: logicalKey(input.creationId, 'create'),
    label: label(input.label),
    endpoint: endpoint(input.endpoint, authentication === 'device-oauth' ? false : allowLoopback),
    authentication,
  }
}

export function parseMcpConnectionInspection(value: unknown): McpConnectionInspectionRequest {
  const input = record(value, 'inspection')
  exactFields(input, INSPECTION_FIELDS, 'inspection')
  const result: McpConnectionInspectionRequest = {
    operationId: logicalKey(input.operationId, 'inspection'),
    expectedRevision: revision(input.expectedRevision, 'inspection'),
  }
  if (Object.hasOwn(input, 'credentialReference')) {
    const credentialReference = input.credentialReference
    if (typeof credentialReference !== 'string' || !REFERENCE_PATTERN.test(credentialReference)) invalid('inspection')
    result.credentialReference = credentialReference
  }
  return result
}

export function parseMcpConnectionLifecycle(value: unknown): McpConnectionLifecycleRequest {
  const input = record(value, 'lifecycle')
  exactFields(input, LIFECYCLE_FIELDS, 'lifecycle')
  return { expectedRevision: revision(input.expectedRevision, 'lifecycle') }
}
