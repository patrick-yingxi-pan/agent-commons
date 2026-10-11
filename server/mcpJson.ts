/** Typed backend facade over the native-importable bounded JSON snapshotter. */
import { snapshotMcpJson as snapshotCore } from './mcpJsonCore.mjs'
import type { McpJsonValue } from '../contract/mcpExecution.ts'

export type { McpJsonValue } from '../contract/mcpExecution.ts'

export { McpJsonError } from './mcpJsonCore.mjs'

export function snapshotMcpJson(
  value: unknown,
  limits: { maxBytes: number; maxDepth: number; maxNodes: number },
): McpJsonValue {
  return snapshotCore(value, limits) as McpJsonValue
}
