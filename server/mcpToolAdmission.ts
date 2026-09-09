/** Code-owned catalog admission, separate from remote discovery metadata.
 * A persisted stamp is a readiness hint, never permission to execute. Each
 * proposed/approved call still validates its exact arguments in the worker. */
import { createHash } from 'node:crypto'
import type { McpDiscoveredTool } from '../contract/mcpConnections.ts'
import { snapshotMcpJson, type McpJsonValue } from './mcpJson.ts'
import { parseMcpHeaderParameters } from './mcpHeaderParameters.ts'
import { validateMcpSchema } from './mcpSchema.ts'

export const MCP_SCHEMA_ADMISSION_VERSION = 1
export interface McpSchemaAdmission { version: number; hashes: string[] }
export class McpSchemaAdmissionError extends Error {
  readonly code: 'cancelled' | 'unavailable' | 'limit'
  constructor(code: McpSchemaAdmissionError['code']) { super(`MCP catalog admission ${code}.`); this.code = code }
}

function canonical(value: McpJsonValue): McpJsonValue {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

function snapshot(tool: McpDiscoveredTool): McpDiscoveredTool {
  return snapshotMcpJson(tool, { maxBytes: 196_608, maxDepth: 36, maxNodes: 12_288 }) as unknown as McpDiscoveredTool
}

/** A change of connection revision or this hash invalidates reviewed consent.
 * Descriptions and readOnly/destructive annotations can never change authority. */
export function mcpToolSchemaHash(tool: McpDiscoveredTool): string {
  const exact = snapshot(tool)
  const identity = { name: exact.name, inputSchema: exact.inputSchema, ...(exact.outputSchema === undefined ? {} : { outputSchema: exact.outputSchema }) }
  return createHash('sha256').update(JSON.stringify(canonical(identity as McpJsonValue))).digest('hex')
}

export async function admitMcpTool(tool: McpDiscoveredTool, options: { signal?: AbortSignal } = {}): Promise<{ ok: true } | { ok: false; code: string }> {
  let exact: McpDiscoveredTool
  try {
    exact = snapshot(tool)
    if (!exact.name || typeof exact.name !== 'string' || !exact.inputSchema || exact.inputSchema.type !== 'object') return { ok: false, code: 'invalid_schema' }
    // Invalid modern header definitions exclude this tool on every protocol;
    // reconnecting with an older version must not bypass catalog admission.
    parseMcpHeaderParameters(exact.inputSchema)
  } catch { return { ok: false, code: 'invalid_schema' } }
  const input = await validateMcpSchema(exact.inputSchema, undefined, options)
  if (!input.ok) return input
  if (exact.outputSchema !== undefined) return validateMcpSchema(exact.outputSchema, undefined, options)
  return { ok: true }
}

/** Invalid individual tools stay visible as inert catalog metadata, but never
 * enter executableTools. Cancellation/capacity is not an unsupported schema:
 * it refuses the inspection instead of persisting a partial capability set. */
export async function admitMcpCatalog(tools: McpDiscoveredTool[], options: { signal?: AbortSignal } = {}): Promise<McpSchemaAdmission> {
  if (!Array.isArray(tools) || tools.length > 128) throw new McpSchemaAdmissionError('limit')
  const hashes: Array<string | undefined> = new Array(tools.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      if (options.signal?.aborted) throw new McpSchemaAdmissionError('cancelled')
      const index = next++
      if (index >= tools.length) return
      const result = await admitMcpTool(tools[index], options)
      if (result.ok) hashes[index] = mcpToolSchemaHash(tools[index])
      else if (result.code === 'cancelled' || result.code === 'unavailable') throw new McpSchemaAdmissionError(result.code)
    }
  }
  await Promise.all([worker(), worker()])
  if (options.signal?.aborted) throw new McpSchemaAdmissionError('cancelled')
  return { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: hashes.filter((hash): hash is string => hash !== undefined) }
}
