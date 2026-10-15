import { MCP_LEGACY_VERSIONS, MCP_MODERN_VERSION, isMcpProtocolVersion } from './mcpProtocol.ts'
import { snapshotMcpJson, type McpJsonValue } from './mcpJson.ts'
import type {
  McpToolAudioContent,
  McpToolContent,
  McpToolImageContent,
  McpToolResult,
} from '../contract/mcpExecution.ts'
export type {
  McpToolAudioContent,
  McpToolContent,
  McpToolImageContent,
  McpToolResourceContent,
  McpToolResourceLinkContent,
  McpToolResult,
  McpToolTextContent,
} from '../contract/mcpExecution.ts'

export { MCP_MODERN_VERSION as MCP_TOOL_RESULT_MODERN_VERSION, MCP_LEGACY_VERSIONS as MCP_TOOL_RESULT_LEGACY_VERSIONS }
export const MCP_TOOL_RESULT_MAX_BYTES = 1_048_576
export const MCP_TOOL_RESULT_MAX_CONTENT = 128

export type McpToolResultErrorCode = 'result' | 'input_required'

export class McpToolResultError extends Error {
  readonly code: McpToolResultErrorCode

  constructor(code: McpToolResultErrorCode) {
    super(code === 'input_required' ? 'MCP tool input is required.' : 'Invalid MCP tool result.')
    this.name = 'McpToolResultError'
    this.code = code
  }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
/** Body data is not a display label: valid Unicode controls (for example a
 * file's form feeds) stay exact. The JSON snapshot already charges escaped
 * bytes; this check retains the existing malformed-Unicode refusal. */
function unicodeText(value: unknown, max: number): value is string {
  if (typeof value !== 'string' || Array.from(value).length > max) return false
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length || value.charCodeAt(index + 1) < 0xdc00 || value.charCodeAt(index + 1) > 0xdfff) return false
      index += 1
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}
function printable(value: unknown, max = 4096, multiline = false): value is string {
  if (!unicodeText(value, max)) return false
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 && !(multiline && (code === 0x09 || code === 0x0a || code === 0x0d))) return false
    if (code >= 0x7f && code <= 0x9f) return false
  }
  return true
}
const optionalText = (value: unknown, max = 4096, multiline = false): value is string | undefined => value === undefined || printable(value, max, multiline)
const mime = (value: unknown): value is string => typeof value === 'string' && value.length <= 256 && printable(value) && /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=[^;\s][^;\u0000-\u001f\u007f-\u009f]*)*$/.test(value)
const uri = (value: unknown): value is string => {
  if (!printable(value, 8192) || value.length === 0) return false
  try { const parsed = new URL(value); return parsed.protocol.length > 1 }
  catch { return false }
}
const fail = (): never => { throw new McpToolResultError('result') }

function encoded(value: unknown): value is string {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false
  try { atob(value); return true } catch { return false }
}

function annotation(value: unknown): McpJsonValue | undefined {
  if (value === undefined) return undefined
  if (!record(value)) return fail()
  if (value.audience !== undefined && (!Array.isArray(value.audience) || value.audience.some((item) => item !== 'user' && item !== 'assistant'))) return fail()
  if (value.priority !== undefined && (typeof value.priority !== 'number' || !Number.isFinite(value.priority) || value.priority < 0 || value.priority > 1)) return fail()
  if (value.lastModified !== undefined && !printable(value.lastModified, 128)) return fail()
  return value as McpJsonValue
}

function contentBlock(value: unknown): McpToolContent {
  if (!record(value) || typeof value.type !== 'string') return fail()
  const annotations = annotation(value.annotations)
  switch (value.type) {
    case 'text':
      if (!unicodeText(value.text, MCP_TOOL_RESULT_MAX_BYTES)) return fail()
      return { type: 'text', text: value.text, ...(annotations === undefined ? {} : { annotations }) }
    case 'image':
    case 'audio':
      if (!encoded(value.data) || !mime(value.mimeType)) return fail()
      return { type: value.type, data: value.data, mimeType: value.mimeType, ...(annotations === undefined ? {} : { annotations }) } as McpToolImageContent | McpToolAudioContent
    case 'resource_link': {
      const size = value.size
      if (!uri(value.uri) || !printable(value.name, 1024) || value.name.length === 0 || !optionalText(value.title, 1024) ||
        !optionalText(value.description, 8192, true) || !optionalText(value.mimeType, 256) ||
        (value.mimeType !== undefined && !mime(value.mimeType)) ||
        (size !== undefined && (!Number.isSafeInteger(size) || typeof size !== 'number' || size < 0))) return fail()
      return { type: 'resource_link', uri: value.uri, name: value.name,
        ...(value.title === undefined ? {} : { title: value.title }), ...(value.description === undefined ? {} : { description: value.description }),
        ...(value.mimeType === undefined ? {} : { mimeType: value.mimeType }), ...(size === undefined ? {} : { size }),
        ...(annotations === undefined ? {} : { annotations }) }
    }
    case 'resource': {
      if (!record(value.resource)) return fail()
      const resource = value.resource
      if (!uri(resource.uri) || !optionalText(resource.mimeType, 256) || (resource.mimeType !== undefined && !mime(resource.mimeType))) return fail()
      const resourceUri = resource.uri
      const resourceMime = resource.mimeType
      const resourceAnnotations = annotation(resource.annotations)
      if (typeof resource.text === 'string' && resource.blob === undefined && unicodeText(resource.text, MCP_TOOL_RESULT_MAX_BYTES)) {
        const text = resource.text
        return { type: 'resource', resource: { uri: resourceUri, ...(resourceMime === undefined ? {} : { mimeType: resourceMime }), text, ...(resourceAnnotations === undefined ? {} : { annotations: resourceAnnotations }) }, ...(annotations === undefined ? {} : { annotations }) }
      }
      if (typeof resource.blob === 'string' && resource.text === undefined && encoded(resource.blob)) {
        const blob = resource.blob
        return { type: 'resource', resource: { uri: resourceUri, ...(resourceMime === undefined ? {} : { mimeType: resourceMime }), blob, ...(resourceAnnotations === undefined ? {} : { annotations: resourceAnnotations }) }, ...(annotations === undefined ? {} : { annotations }) }
      }
      return fail()
    }
    default: return fail()
  }
}

export function parseMcpToolResult(value: unknown, protocolVersion: string): McpToolResult {
  if (!isMcpProtocolVersion(protocolVersion)) return fail()
  let detached: McpJsonValue
  try { detached = snapshotMcpJson(value, { maxBytes: MCP_TOOL_RESULT_MAX_BYTES, maxDepth: 32, maxNodes: 16_384 }) }
  catch { return fail() }
  if (!record(detached)) return fail()
  const modern = protocolVersion === MCP_MODERN_VERSION
  if (detached.resultType === 'input_required') throw new McpToolResultError('input_required')
  if (modern ? detached.resultType !== 'complete' : detached.resultType !== undefined && detached.resultType !== 'complete') return fail()
  if (!Array.isArray(detached.content) || detached.content.length > MCP_TOOL_RESULT_MAX_CONTENT) return fail()
  const content = detached.content.map(contentBlock)
  if (detached.isError !== undefined && typeof detached.isError !== 'boolean') return fail()
  let structuredContent: McpJsonValue | undefined
  if (detached.structuredContent !== undefined) structuredContent = detached.structuredContent as McpJsonValue
  const meta = detached._meta
  if (meta !== undefined && !record(meta)) return fail()
  const normalized: McpToolResult = { resultType: 'complete', content, isError: detached.isError ?? false,
    ...(structuredContent === undefined ? {} : { structuredContent }), ...(meta === undefined ? {} : { _meta: meta }) }
  return normalized
}
