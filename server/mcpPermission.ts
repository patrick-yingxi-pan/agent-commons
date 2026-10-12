/** Shared pure tool constraints. No workflow permission, owner inference,
 * transport, schema compilation or durable admission belongs here. */
import type { McpBoundToolCall, McpJsonValue, McpToolPermission } from '../contract/mcpExecution.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { snapshotMcpBoundToolCall } from './mcpBoundCall.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'

const record = (value: unknown): value is Record<string, McpJsonValue> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function canonical(value: McpJsonValue): McpJsonValue {
  if (Array.isArray(value)) return value.map(canonical)
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

/** Only for already detached, bounded JSON. Does not inspect arbitrary input. */
export const mcpPermissionJsonText = (value: unknown): string => JSON.stringify(canonical(value as McpJsonValue))
export const sameMcpPermissionJson = (a: unknown, b: unknown): boolean => mcpPermissionJsonText(a) === mcpPermissionJsonText(b)

export function snapshotMcpToolPermissions(value: unknown, maxTools: number): McpToolPermission[] | undefined {
  try {
    if (!Number.isSafeInteger(maxTools) || maxTools < 1 || maxTools > 16) return undefined
    const copy = snapshotMcpJson(value, { maxBytes: 262_144, maxDepth: 40, maxNodes: 20_000 })
    if (!Array.isArray(copy) || !copy.length || copy.length > maxTools) return undefined
    const permissions: McpToolPermission[] = []
    const seen = new Set<string>()
    for (const raw of copy) {
      if (!record(raw) || Object.keys(raw).length !== 5 ||
          !['connectionId', 'connectionRevision', 'toolName', 'schemaHash', 'fixedArguments'].every(key => Object.hasOwn(raw, key))) return undefined
      const call = snapshotMcpBoundToolCall({ connectionId: raw.connectionId, connectionRevision: raw.connectionRevision,
        toolName: raw.toolName, schemaHash: raw.schemaHash, arguments: raw.fixedArguments })
      if (!call) return undefined
      const identity = JSON.stringify([call.connectionId, call.toolName])
      if (seen.has(identity)) return undefined
      seen.add(identity)
      const { arguments: fixedArguments, ...anchor } = call
      permissions.push({ ...anchor, fixedArguments })
    }
    return permissions
  } catch { return undefined }
}

/** Call and permission must already have passed their strict snapshotters. */
export function mcpPermissionAllowsCall(permission: McpToolPermission, call: McpBoundToolCall): boolean {
  return permission.connectionId === call.connectionId && permission.connectionRevision === call.connectionRevision &&
    permission.toolName === call.toolName && permission.schemaHash === call.schemaHash &&
    Object.keys(permission.fixedArguments).every(key => Object.hasOwn(call.arguments, key) &&
      sameMcpPermissionJson(permission.fixedArguments[key], call.arguments[key]))
}

/** A registry read is not owner authority. The caller must supply a view from
 * its current person/tenant wall. Local-process launch is deliberately excluded. */
export function matchesHttpMcpPermission(permission: McpToolPermission, view: McpConnectionView | undefined): boolean {
  if (!view || view.transport === 'stdio' || view.id !== permission.connectionId || view.revision !== permission.connectionRevision ||
      view.status !== 'connected' || view.execution !== 'approval-required' || !view.executableTools?.includes(permission.toolName)) return false
  try {
    const matches = view.tools.filter(tool => tool.name === permission.toolName)
    return matches.length === 1 && mcpToolSchemaHash(matches[0]) === permission.schemaHash
  } catch { return false }
}
