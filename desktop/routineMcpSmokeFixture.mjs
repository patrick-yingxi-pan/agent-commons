import { createServer } from 'node:http'
import { MCP_MODERN_VERSION } from '../server/mcpProtocol.ts'

export const ROUTINE_MCP_SMOKE_TOOL = Object.freeze({
  name: 'inspect_records',
  description: 'Inspect records in the isolated Routine MCP acceptance fixture.',
  inputSchema: Object.freeze({
    type: 'object', properties: Object.freeze({ query: Object.freeze({ type: 'string' }) }),
    required: Object.freeze(['query']), additionalProperties: false,
  }),
  annotations: Object.freeze({ readOnlyHint: true }),
})

export async function startRoutineMcpSmokePeer() {
  const calls = []
  const sockets = new Set()
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let message
    try { message = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { res.writeHead(400).end(); return }
    const result = (value) => {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: value }))
    }
    if (message.method === 'server/discover') return result({ resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'routine-smoke', version: '1' } } })
    if (message.method === 'initialize') return result({ protocolVersion: MCP_MODERN_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'routine-smoke', version: '1' } })
    if (message.method === 'notifications/initialized') { res.writeHead(202).end(); return }
    if (message.method === 'tools/list') return result({ resultType: 'complete', tools: [ROUTINE_MCP_SMOKE_TOOL] })
    if (message.method === 'tools/call') {
      const params = message.params
      if (params?.name !== ROUTINE_MCP_SMOKE_TOOL.name || params.arguments?.query !== 'routine-native-smoke') {
        res.writeHead(400).end(); return
      }
      calls.push({ name: params.name, arguments: structuredClone(params.arguments) })
      return result({ resultType: 'complete', content: [{ type: 'text', text: 'Fixture records inspected.' }], structuredContent: { count: 1 } })
    }
    res.writeHead(404).end()
  })
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}/mcp`, calls,
    close: () => new Promise(resolve => { server.close(resolve); for (const socket of sockets) socket.destroy() }),
  }
}
