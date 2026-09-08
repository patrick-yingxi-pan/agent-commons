/** Bounded request-scoped JSON / SSE decoding, shared by HTTP MCP revisions.
 * This is transport only: it never executes a server request, follows resource
 * links, applies annotations as permissions, or treats remote text as authority. */
export const MAX_MCP_RESPONSE_BYTES = 1_048_576
export const MAX_MCP_SSE_EVENT_BYTES = 262_144

export class McpResponseError extends Error {
  constructor() { super('The MCP server returned an unsupported or invalid response.') }
}

export function rpcResponse(value: unknown, expectedId: string | number, allowNullId = false): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new McpResponseError()
  const row = value as Record<string, unknown>
  const hasResult = Object.hasOwn(row, 'result')
  const hasError = Object.hasOwn(row, 'error')
  if (row.jsonrpc !== '2.0' || (row.id !== expectedId && !(allowNullId && row.id === null && hasError)) ||
    hasResult === hasError || Object.hasOwn(row, 'method')) throw new McpResponseError()
  if (hasError) {
    const error = row.error as Record<string, unknown> | null
    if (!error || typeof error !== 'object' || Array.isArray(error) || !Number.isInteger(error.code) || typeof error.message !== 'string') throw new McpResponseError()
  }
  return row
}

export function parseRpcResponse(text: string, expectedId: string | number, allowNullId = false): Record<string, unknown> {
  try { return rpcResponse(JSON.parse(text), expectedId, allowNullId) } catch { throw new McpResponseError() }
}

/** Incremental SSE framing: CR, LF and split CRLF are equivalent, UTF-8 is
 * decoded outside this class, and event data may span multiple data lines.
 * Server requests are refused rather than dispatched into host capabilities. */
export function createMcpSseDecoder(expectedId: string | number) {
  let line = ''
  let afterCr = false
  let data: string[] = []
  let eventBytes = 0
  let final: Record<string, unknown> | undefined
  const dispatch = () => {
    if (!data.length) { eventBytes = 0; return }
    let value: unknown
    try { value = JSON.parse(data.join('\n')) } catch { throw new McpResponseError() }
    data = []
    eventBytes = 0
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new McpResponseError()
    const row = value as Record<string, unknown>
    if (row.jsonrpc !== '2.0') throw new McpResponseError()
    if (Object.hasOwn(row, 'method')) {
      if (typeof row.method !== 'string' || !row.method.startsWith('notifications/') ||
        Object.hasOwn(row, 'id') || Object.hasOwn(row, 'result') || Object.hasOwn(row, 'error')) throw new McpResponseError()
      return // Progress/log notifications do not become tool results or authority.
    }
    final = rpcResponse(row, expectedId)
  }
  const finishLine = () => {
    if (!line) dispatch()
    else if (line === 'data') data.push('')
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    line = ''
  }
  return {
    push(text: string): Record<string, unknown> | undefined {
      if (final) throw new McpResponseError()
      for (const char of text) {
        const code = char.codePointAt(0)!
        eventBytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
        if (eventBytes > MAX_MCP_SSE_EVENT_BYTES) throw new McpResponseError()
        // CRLF consumes two wire bytes although it is one framing delimiter.
        // A dispatch at CR may conservatively charge its LF to the next event.
        if (afterCr) { afterCr = false; if (char === '\n') continue }
        if (char === '\r' || char === '\n') {
          finishLine()
          afterCr = char === '\r'
          if (final) return final
        } else line += char
      }
      return undefined
    },
    end(): never { throw new McpResponseError() }, // EOF is not an SSE dispatch.
  }
}
