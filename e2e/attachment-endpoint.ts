import { createServer, type Server } from 'node:http'

export function sse(res: import('node:http').ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function startMessagesFixture() {
  const seen: string[] = []
  const documents: Array<{ attached_files?: Array<{ name: string; status: string; text?: string }>; omitted_items?: number }> = []
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as { messages?: Array<{ role: string; content: unknown }>; stream?: boolean } : {}
    if (req.method === 'GET' && (req.url ?? '').split('?')[0] === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'e2e-attachment-model', display_name: 'Attachment fixture' }] }))
      return
    }
    if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== '/v1/messages') {
      res.writeHead(404).end()
      return
    }
    const messages = body.messages ?? []
    const latest = [...messages].reverse().find((message) => message.role === 'user')?.content
    const text = typeof latest === 'string' ? latest : JSON.stringify(latest ?? '')
    seen.push(text)
    const marker = text.lastIndexOf('\n\n{"attached_files":')
    const document = marker >= 0 ? JSON.parse(text.slice(marker + 2)) as { attached_files?: Array<{ name: string; status: string; text?: string }>; omitted_items?: number } : undefined
    if (document) documents.push(document)
    const ready = document?.attached_files?.find((file) => file.status === 'ready')?.text
    const reply = ready ? `Read supplied attachment: ${ready}` : 'No supplied attachment text.'
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: `msg_fixture_${Date.now().toString(36)}`, type: 'message', role: 'assistant', model: 'e2e-attachment-model', content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
    const id = `msg_fixture_${Date.now().toString(36)}`
    sse(res, 'message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'e2e-attachment-model', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } })
    sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } })
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
    sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
    sse(res, 'message_stop', { type: 'message_stop' })
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { server, url: `http://127.0.0.1:${port}`, seen, documents }
}
