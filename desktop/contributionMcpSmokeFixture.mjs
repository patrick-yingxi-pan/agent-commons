import { createServer } from 'node:http'
import { MCP_MODERN_VERSION } from '../server/mcpProtocol.ts'

const MAX_REQUEST_BYTES = 65_536
const MAX_RESPONSE_BYTES = 8_192

export const CONTRIBUTION_MCP_SMOKE_TOOL = Object.freeze({
  name: 'write_record',
  description: 'Write one record to the isolated Contribution smoke fixture.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({ text: Object.freeze({ type: 'string' }) }),
    required: Object.freeze(['text']),
    additionalProperties: false,
  }),
  outputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      accepted: Object.freeze({ type: 'boolean' }),
      recordId: Object.freeze({ type: 'string' }),
    }),
    required: Object.freeze(['accepted', 'recordId']),
    additionalProperties: false,
  }),
  annotations: Object.freeze({ readOnlyHint: false }),
})

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  if (body.byteLength > MAX_RESPONSE_BYTES) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end('{"error":"fixture response exceeded its bound"}')
    return
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function success(requestId, result) {
  return { jsonrpc: '2.0', id: requestId, result }
}

async function readJson(req) {
  const declared = req.headers['content-length']
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    req.resume()
    return { error: 'too-large' }
  }
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.byteLength
      if (size > MAX_REQUEST_BYTES) {
        req.resume()
        return { error: 'too-large' }
      }
      chunks.push(bytes)
    }
  } catch {
    return { error: 'aborted' }
  }
  if (size === 0) return { error: 'invalid' }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { value }
      : { error: 'invalid' }
  } catch {
    return { error: 'invalid' }
  }
}

/** Deterministic, private loopback MCP peer for isolated desktop smoke only. */
export async function startContributionMcpSmokePeer({ bearer }) {
  if (typeof bearer !== 'string' || bearer.length === 0 || bearer.length > 8_192 || /[^\x21-\x7e]/.test(bearer)) {
    throw new TypeError('A bounded printable smoke bearer is required.')
  }

  const calls = []
  const authorizations = []
  const sockets = new Set()
  let mode = 'success'
  let closePromise
  let nextRecord = 0

  const server = createServer(async (req, res) => {
    const bodyResult = await readJson(req)
    if (bodyResult.error === 'aborted') return
    if (bodyResult.error === 'too-large') {
      json(res, 413, { error: 'request exceeds fixture bound' })
      return
    }
    if (bodyResult.error) {
      json(res, 400, { error: 'invalid fixture request' })
      return
    }

    const message = bodyResult.value
    const method = typeof message.method === 'string' ? message.method : ''
    const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined
    authorizations.push({ method, value: authorization })
    if (authorization !== `Bearer ${bearer}`) {
      req.resume()
      json(res, 401, { error: 'unauthorized' })
      return
    }

    if (req.method !== 'POST' || req.url !== '/mcp' || message.jsonrpc !== '2.0') {
      json(res, 400, { error: 'invalid fixture request' })
      return
    }

    if (method === 'server/discover') {
      json(res, 200, success(message.id, {
        resultType: 'complete',
        supportedVersions: [MCP_MODERN_VERSION],
        capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'contribution-smoke', version: '1' } },
      }))
      return
    }
    if (method === 'initialize') {
      json(res, 200, success(message.id, {
        protocolVersion: MCP_MODERN_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'contribution-smoke', version: '1' },
      }))
      return
    }
    if (method === 'notifications/initialized') {
      res.writeHead(202, { 'cache-control': 'no-store' })
      res.end()
      return
    }
    if (method === 'tools/list') {
      json(res, 200, success(message.id, { resultType: 'complete', tools: [CONTRIBUTION_MCP_SMOKE_TOOL] }))
      return
    }
    if (method === 'tools/call') {
      const params = message.params
      if (!params || params.name !== CONTRIBUTION_MCP_SMOKE_TOOL.name ||
          !params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments)) {
        json(res, 400, { error: 'invalid tool call' })
        return
      }
      calls.push({ name: params.name, arguments: structuredClone(params.arguments) })
      if (mode === 'hold') return
      nextRecord += 1
      json(res, 200, success(message.id, {
        resultType: 'complete',
        content: [{ type: 'text', text: 'The isolated fixture accepted one record.' }],
        structuredContent: { accepted: true, recordId: `smoke-record-${nextRecord}` },
      }))
      return
    }
    json(res, 400, { error: 'unsupported fixture method' })
  })

  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('The local MCP fixture did not receive a TCP port.')
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    calls,
    authorizations,
    setMode(next) {
      if (next !== 'success' && next !== 'hold') throw new TypeError('Unsupported MCP fixture mode.')
      mode = next
    },
    close() {
      closePromise ??= new Promise(resolve => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
        server.closeAllConnections?.()
      })
      return closePromise
    },
  }
}
