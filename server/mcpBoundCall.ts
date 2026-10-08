/** Detached, strictly bounded intent for one bound external MCP call. The
 * argument budget is independent of anchor metadata and matches tools/call. */
import { isExternalMcpId } from '../contract/mcpConnections.ts'
import type { McpBoundToolCall, McpJsonValue } from '../contract/mcpExecution.ts'
import { snapshotMcpJson } from './mcpJson.ts'

const BOUND_FIELDS = ['connectionId', 'connectionRevision', 'toolName', 'schemaHash', 'arguments'] as const
const TOOL_NAME_CONTROL = /^[\u0000-\u001f\u007f-\u009f\ud800-\udfff]$/

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validToolName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Array.from(value).length <= 128 &&
    !Array.from(value).some((char) => TOOL_NAME_CONTROL.test(char))
}

/** Returns undefined for malformed, accessor-backed, oversized, or extra-field
 * input. Neither caller getters nor serialization hooks are invoked. */
export function snapshotMcpBoundToolCall(value: unknown): McpBoundToolCall | undefined {
  try {
    // The envelope carries only ~300 bytes of anchors around args. Its separate
    // ceiling leaves ample room for the valid 49,152-byte argument budget and
    // allows the args' own 4,096 nodes plus these five envelope nodes.
    const envelope = snapshotMcpJson(value, { maxBytes: 65_536, maxDepth: 33, maxNodes: 8_192 })
    if (!record(envelope) || Object.keys(envelope).length !== BOUND_FIELDS.length ||
        Object.keys(envelope).some((key) => !(BOUND_FIELDS as readonly string[]).includes(key)) ||
        typeof envelope.connectionId !== 'string' || !isExternalMcpId(envelope.connectionId) ||
        !Number.isSafeInteger(envelope.connectionRevision) || Number(envelope.connectionRevision) < 0 ||
        !validToolName(envelope.toolName) || typeof envelope.schemaHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(envelope.schemaHash) || !record(envelope.arguments)) return undefined

    const args = snapshotMcpJson(envelope.arguments, { maxBytes: 49_152, maxDepth: 32, maxNodes: 4_096 })
    if (!record(args)) return undefined
    return {
      connectionId: envelope.connectionId,
      connectionRevision: envelope.connectionRevision as number,
      toolName: envelope.toolName,
      schemaHash: envelope.schemaHash,
      arguments: args as Record<string, McpJsonValue>,
    }
  } catch { return undefined }
}
