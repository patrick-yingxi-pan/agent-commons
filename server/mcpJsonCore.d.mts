export class McpJsonError extends Error {
  readonly code: 'invalid' | 'limit'
  constructor(code?: 'invalid' | 'limit')
}

export function snapshotMcpJson(
  value: unknown,
  limits: { maxBytes: number; maxDepth: number; maxNodes: number },
): unknown
