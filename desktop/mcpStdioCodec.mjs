/** Bounded newline-delimited JSON framing for a future native MCP stdio host.
 * This module owns only bytes and JSON values; transport/session authority is
 * deliberately outside this codec. */
import { McpJsonError, snapshotMcpJson } from '../server/mcpJsonCore.mjs'

export const MCP_STDIO_LIMITS = Object.freeze({
  maxFrameBytes: 1_048_576,
  maxTotalBytes: 8_388_608,
  maxMessages: 1_024,
  maxDepth: 40,
  maxNodes: 32_768,
})

export class McpStdioCodecError extends Error {
  constructor(code) {
    super(code === 'limit' ? 'MCP stdio input exceeded a fixed limit.' : 'Invalid MCP stdio message.')
    this.name = 'McpStdioCodecError'
    this.code = code
  }
}

function isMessage(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function createMcpStdioDecoder() {
  let totalBytes = 0
  let messages = 0
  let pending = Buffer.alloc(0)
  let pendingBytes = 0
  let ended = false
  let failed = false

  const fail = (code) => {
    failed = true
    throw new McpStdioCodecError(code)
  }
  const ready = () => {
    if (failed || ended) fail('invalid-message')
  }
  const decodeFrame = (frame) => {
    if (frame.length === 0 || frame.at(-1) !== 0x0a || messages >= MCP_STDIO_LIMITS.maxMessages) {
      fail(messages >= MCP_STDIO_LIMITS.maxMessages ? 'limit' : 'invalid-message')
    }
    let content = frame.subarray(0, -1)
    if (content.at(-1) === 0x0d) content = content.subarray(0, -1)
    if (content.length === 0) fail('invalid-message')
    let value
    try {
      // ignoreBOM preserves a leading BOM so JSON.parse rejects it; UTF-8
      // decoding is fatal and cannot silently replace malformed byte runs.
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content)
      value = JSON.parse(text)
    } catch {
      fail('invalid-message')
    }
    if (!isMessage(value)) fail('invalid-message')
    try {
      value = snapshotMcpJson(value, {
        maxBytes: MCP_STDIO_LIMITS.maxFrameBytes,
        maxDepth: MCP_STDIO_LIMITS.maxDepth,
        maxNodes: MCP_STDIO_LIMITS.maxNodes,
      })
    } catch (error) {
      if (error instanceof McpJsonError && error.code === 'limit') fail('limit')
      fail('invalid-message')
    }
    messages += 1
    return value
  }
  const appendPending = (bytes) => {
    const needed = pendingBytes + bytes.length
    // The delimiter still needs one byte; account for it while the frame is
    // incomplete so pending storage itself can never exceed maxFrameBytes.
    if (needed > MCP_STDIO_LIMITS.maxFrameBytes - 1) fail('limit')
    if (needed > pending.length) {
      const capacity = Math.min(MCP_STDIO_LIMITS.maxFrameBytes - 1, Math.max(64, needed, pending.length * 2))
      const expanded = Buffer.allocUnsafe(capacity)
      if (pendingBytes) pending.copy(expanded, 0, 0, pendingBytes)
      pending = expanded
    }
    bytes.copy(pending, pendingBytes)
    pendingBytes = needed
  }
  const completeFrame = (bytes) => {
    const frameLength = pendingBytes + bytes.length
    if (frameLength > MCP_STDIO_LIMITS.maxFrameBytes) fail('limit')
    if (pendingBytes === 0) return decodeFrame(bytes)
    const frame = Buffer.allocUnsafe(frameLength)
    pending.copy(frame, 0, 0, pendingBytes)
    bytes.copy(frame, pendingBytes)
    pending = Buffer.alloc(0)
    pendingBytes = 0
    return decodeFrame(frame)
  }

  return {
    push(chunk) {
      ready()
      if (!Buffer.isBuffer(chunk) || chunk.buffer instanceof SharedArrayBuffer) fail('invalid-message')
      if (chunk.length > MCP_STDIO_LIMITS.maxTotalBytes - totalBytes) fail('limit')
      totalBytes += chunk.length
      const decoded = []
      let start = 0
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] !== 0x0a) continue
        const segment = chunk.subarray(start, index + 1)
        if (pendingBytes + segment.length > MCP_STDIO_LIMITS.maxFrameBytes) fail('limit')
        decoded.push(completeFrame(segment))
        start = index + 1
      }
      if (start < chunk.length) appendPending(chunk.subarray(start))
      return decoded
    },
    end() {
      ready()
      ended = true
      if (pendingBytes !== 0) fail('invalid-message')
    },
  }
}

export function encodeMcpStdioMessage(value) {
  if (!isMessage(value)) throw new McpStdioCodecError('invalid-message')
  let snapshot
  try {
    snapshot = snapshotMcpJson(value, {
      maxBytes: MCP_STDIO_LIMITS.maxFrameBytes,
      maxDepth: MCP_STDIO_LIMITS.maxDepth,
      maxNodes: MCP_STDIO_LIMITS.maxNodes,
    })
  } catch (error) {
    throw new McpStdioCodecError(error instanceof McpJsonError && error.code === 'limit' ? 'limit' : 'invalid-message')
  }
  const frame = Buffer.from(`${JSON.stringify(snapshot)}\n`, 'utf8')
  if (frame.length > MCP_STDIO_LIMITS.maxFrameBytes) throw new McpStdioCodecError('limit')
  return frame
}
