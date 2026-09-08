/** Bounded request-scoped JSON / SSE decoding, shared by HTTP MCP revisions.
 * This is transport only: it never executes a server request, follows resource
 * links, applies annotations as permissions, or treats remote text as authority. */
export const MAX_MCP_RESPONSE_BYTES = 1_048_576
export const MAX_MCP_SSE_EVENT_BYTES = 262_144
export const MAX_MCP_SSE_LAST_EVENT_ID_BYTES = 1_024

export type McpSseResumeState = { lastEventId: string; retryMs: number }

export class McpResponseError extends Error {
  readonly recognizedModernError: boolean
  constructor(recognizedModernError = false) {
    super('The MCP server returned an unsupported or invalid response.')
    this.recognizedModernError = recognizedModernError
  }
}

export const isModernMcpErrorCode = (code: unknown): boolean =>
  code === -32020 || code === -32021 || code === -32022

const invalidResponse = (row: Record<string, unknown>) =>
  new McpResponseError(isModernMcpErrorCode((row.error as Record<string, unknown> | undefined)?.code))

export function rpcResponse(value: unknown, expectedId: string | number, allowNullId = false): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new McpResponseError()
  const row = value as Record<string, unknown>
  const hasResult = Object.hasOwn(row, 'result')
  const hasError = Object.hasOwn(row, 'error')
  if (row.jsonrpc !== '2.0' || (row.id !== expectedId && !(allowNullId && (row.id === null || !Object.hasOwn(row, 'id')) && hasError)) ||
    hasResult === hasError || Object.hasOwn(row, 'method')) throw invalidResponse(row)
  if (hasError) {
    const error = row.error as Record<string, unknown> | null
    if (!error || typeof error !== 'object' || Array.isArray(error) || !Number.isInteger(error.code) || typeof error.message !== 'string') throw invalidResponse(row)
  }
  return row
}

export function parseRpcResponse(text: string, expectedId: string | number, allowNullId = false): Record<string, unknown> {
  try { return rpcResponse(JSON.parse(text), expectedId, allowNullId) } catch (error) {
    if (error instanceof McpResponseError) throw error
    throw new McpResponseError()
  }
}

/** Incremental SSE framing: CR, LF and split CRLF are equivalent, UTF-8 is
 * decoded outside this class, and event data may span multiple data lines.
 * Server requests are refused rather than dispatched into host capabilities. */
export function createMcpSseDecoder(expectedId: string | number, resume?: McpSseResumeState) {
  let line = ''
  let afterCr = false
  let data: string[] = []
  let eventBytes = 0
  let final: Record<string, unknown> | undefined
  const resumable = resume !== undefined
  const utf8 = new TextEncoder()
  if (resume !== undefined && (!resume || typeof resume !== 'object' || typeof resume.lastEventId !== 'string' || resume.lastEventId.includes('\u0000') ||
    utf8.encode(resume.lastEventId).byteLength > MAX_MCP_SSE_LAST_EVENT_ID_BYTES ||
    typeof resume.retryMs !== 'number' || !Number.isSafeInteger(resume.retryMs) || resume.retryMs < 0)) throw new McpResponseError()
  let lastEventId = resume?.lastEventId ?? ''
  let retryMs = resume?.retryMs ?? 0
  let pendingEventId: string | undefined
  const commitMetadata = () => {
    if (!resumable) return
    if (pendingEventId !== undefined) lastEventId = pendingEventId
    pendingEventId = undefined
  }
  const metadata = (field: string, value: string) => {
    if (!resumable) return
    if (field === 'id') {
      if (value.includes('\u0000')) return
      if (utf8.encode(value).byteLength > MAX_MCP_SSE_LAST_EVENT_ID_BYTES) throw new McpResponseError()
      pendingEventId = value
      return
    }
    if (field === 'retry' && /^[0-9]+$/.test(value)) {
      let parsed = Number(value)
      if (!Number.isSafeInteger(parsed)) parsed = Number.MAX_SAFE_INTEGER
      retryMs = parsed
    }
  }
  const dispatch = () => {
    if (!data.length) { commitMetadata(); eventBytes = 0; return }
    if (resumable && data.join('\n') === '') { data = []; commitMetadata(); eventBytes = 0; return }
    let value: unknown
    try { value = JSON.parse(data.join('\n')) } catch { throw new McpResponseError() }
    data = []
    eventBytes = 0
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new McpResponseError()
    const row = value as Record<string, unknown>
    if (row.jsonrpc !== '2.0') throw invalidResponse(row)
    if (Object.hasOwn(row, 'method')) {
      if (typeof row.method !== 'string' || !row.method.startsWith('notifications/') ||
        Object.hasOwn(row, 'id') || Object.hasOwn(row, 'result') || Object.hasOwn(row, 'error')) throw invalidResponse(row)
      commitMetadata()
      return // Progress/log notifications do not become tool results or authority.
    }
    const parsed = rpcResponse(row, expectedId)
    commitMetadata()
    final = parsed
  }
  const finishLine = () => {
    if (!line) dispatch()
    else if (line === 'data') data.push('')
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    else if (resumable) {
      const separator = line.indexOf(':')
      const field = separator < 0 ? line : line.slice(0, separator)
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '')
      metadata(field, value)
    }
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
    resumeState(): McpSseResumeState | undefined {
      if (!resumable) return undefined
      return { lastEventId, retryMs }
    },
  }
}
