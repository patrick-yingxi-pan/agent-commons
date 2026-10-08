/** JSON values and bounded MCP tool results that may cross the product boundary.
 * Links and embedded media remain inert data; these shapes grant no fetch,
 * decode, credential, or continuation authority. */
export type McpJsonValue =
  | null
  | boolean
  | number
  | string
  | McpJsonValue[]
  | { [key: string]: McpJsonValue }

export type McpToolTextContent = { type: 'text'; text: string; annotations?: McpJsonValue }
export type McpToolImageContent = { type: 'image'; data: string; mimeType: string; annotations?: McpJsonValue }
export type McpToolAudioContent = { type: 'audio'; data: string; mimeType: string; annotations?: McpJsonValue }
export type McpToolResourceLinkContent = {
  type: 'resource_link'
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  size?: number
  annotations?: McpJsonValue
}
export type McpToolResourceContent = {
  type: 'resource'
  resource:
    | { uri: string; mimeType?: string; text: string; annotations?: McpJsonValue }
    | { uri: string; mimeType?: string; blob: string; annotations?: McpJsonValue }
  annotations?: McpJsonValue
}
export type McpToolContent =
  | McpToolTextContent
  | McpToolImageContent
  | McpToolAudioContent
  | McpToolResourceLinkContent
  | McpToolResourceContent

export interface McpToolResult {
  resultType: 'complete'
  content: McpToolContent[]
  isError: boolean
  structuredContent?: McpJsonValue
  _meta?: McpJsonValue
}

/** Immutable, non-secret authority reviewed when an external MCP call was
 * proposed. The private endpoint and credential remain server-owned. */
export interface McpToolExecutionAnchor {
  connectionRevision: number
  toolName: string
  schemaHash: string
}

/** One exact, non-credential MCP invocation bound to a tenant-owned inspected
 * connection. This is intent data, not authority or permission to execute. */
export interface McpBoundToolCall extends McpToolExecutionAnchor {
  connectionId: string
  arguments: Record<string, McpJsonValue>
}
