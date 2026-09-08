export interface McpDiscoveredTool {
  name: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
}

export const MCP_CATALOG_PAGE_MAX_TOOLS = 128
export const MCP_CATALOG_NAME_MAX_CHARS = 128
export const MCP_CATALOG_TITLE_MAX_CHARS = 256
export const MCP_CATALOG_DESCRIPTION_MAX_CHARS = 8192
export const MCP_CATALOG_CURSOR_MAX_CHARS = 2048
export const MCP_CATALOG_SCHEMA_MAX_BYTES = 64 * 1024
export const MCP_CATALOG_SCHEMA_MAX_DEPTH = 32
export const MCP_CATALOG_SCHEMA_MAX_NODES = 4096
export const MCP_CATALOG_PAGE_MAX_BYTES = 512 * 1024

export class McpCatalogError extends Error {
  readonly code = 'invalid_mcp_catalog' as const

  constructor() {
    super('Invalid MCP tool catalog.')
    this.name = 'McpCatalogError'
  }
}

const textEncoder = new TextEncoder()

function reject(): never {
  throw new McpCatalogError()
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validText(value: unknown, maxChars: number, nonempty: boolean, multiline = false): value is string {
  if (typeof value !== 'string') return false
  const chars = Array.from(value)
  if ((nonempty && chars.length === 0) || chars.length > maxChars) return false
  for (const char of chars) {
    const code = char.codePointAt(0)!
    const allowedWhitespace = multiline && (code === 0x09 || code === 0x0a || code === 0x0d)
    if ((!allowedWhitespace && code < 0x20) || (code >= 0x7f && code <= 0x9f) || (code >= 0xd800 && code <= 0xdfff)) return false
  }
  return true
}

function snapshotJson(value: unknown): { value: unknown; bytes: number } {
  let encoded: string | undefined
  try {
    encoded = JSON.stringify(value, (_key, item: unknown) => {
      if (item === undefined || typeof item === 'bigint' || typeof item === 'function' || typeof item === 'symbol') reject()
      if (typeof item === 'number' && !Number.isFinite(item)) reject()
      return item
    })
  } catch (error) {
    if (error instanceof McpCatalogError) throw error
    return reject()
  }
  if (encoded === undefined) return reject()
  const bytes = textEncoder.encode(encoded).byteLength
  if (bytes > MCP_CATALOG_PAGE_MAX_BYTES) return reject()
  try {
    return { value: JSON.parse(encoded), bytes }
  } catch {
    return reject()
  }
}

function schemaShape(value: unknown): value is Record<string, unknown> {
  return record(value)
}

function checkSchema(value: Record<string, unknown>): void {
  const encoded = JSON.stringify(value)
  if (textEncoder.encode(encoded).byteLength > MCP_CATALOG_SCHEMA_MAX_BYTES) reject()

  let nodes = 0
  const visit = (node: unknown, depth: number): void => {
    nodes += 1
    if (nodes > MCP_CATALOG_SCHEMA_MAX_NODES || depth > MCP_CATALOG_SCHEMA_MAX_DEPTH) reject()
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    if (record(node)) {
      for (const item of Object.values(node)) visit(item, depth + 1)
    }
  }
  visit(value, 1)
}

function parseTool(value: unknown): McpDiscoveredTool {
  if (!record(value) || !validText(value.name, MCP_CATALOG_NAME_MAX_CHARS, true)) reject()
  if (value.title !== undefined && !validText(value.title, MCP_CATALOG_TITLE_MAX_CHARS, false)) reject()
  if (value.description !== undefined && !validText(value.description, MCP_CATALOG_DESCRIPTION_MAX_CHARS, false, true)) reject()
  if (!schemaShape(value.inputSchema) || value.inputSchema.type !== 'object') reject()
  checkSchema(value.inputSchema)
  if (value.outputSchema !== undefined) {
    if (!schemaShape(value.outputSchema)) reject()
    checkSchema(value.outputSchema)
  }
  if (value.annotations !== undefined && !record(value.annotations)) reject()

  const tool: McpDiscoveredTool = {
    name: value.name,
    inputSchema: value.inputSchema,
  }
  if (value.title !== undefined) tool.title = value.title
  if (value.description !== undefined) tool.description = value.description
  if (value.outputSchema !== undefined) tool.outputSchema = value.outputSchema
  if (value.annotations !== undefined) tool.annotations = value.annotations
  return tool
}

/** Validate one remote MCP `tools/list` page, returning a detached JSON
 * snapshot. Schemas and annotations are preserved as untrusted presentation
 * data; this parser never follows `$ref` or infers authorization from them. */
export function parseMcpToolsPage(value: unknown): { tools: McpDiscoveredTool[]; nextCursor?: string } {
  const snapshot = snapshotJson(value).value
  if (!record(snapshot) || !Array.isArray(snapshot.tools) || snapshot.tools.length > MCP_CATALOG_PAGE_MAX_TOOLS) reject()
  if (snapshot.nextCursor !== undefined && !validText(snapshot.nextCursor, MCP_CATALOG_CURSOR_MAX_CHARS, true)) reject()

  const names = new Set<string>()
  const tools = snapshot.tools.map((candidate) => {
    const tool = parseTool(candidate)
    if (names.has(tool.name)) reject()
    names.add(tool.name)
    return tool
  })
  return snapshot.nextCursor === undefined ? { tools } : { tools, nextCursor: snapshot.nextCursor }
}
