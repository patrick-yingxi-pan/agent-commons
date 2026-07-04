/** Test helper: drive a relay-connector PROCESS over stdio JSON-RPC, against a
 *  minimal in-test relay backend. Shared by the source-form locks
 *  (tests/relay-connector.test.ts — spawns the checked-in TS via Node's native
 *  type stripping) and the served-form locks (tests/connector-serve.test.ts —
 *  spawns the byte-for-byte output of `GET /connector` with PLAIN node, proving
 *  the public install path runs without the repo or TypeScript). */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** A minimal relay backend: records every request, serves poll results from a
 *  queue (default idle) and accepts replies. */
export interface Seen {
  method: string
  path: string
  auth: string | undefined
  body: string
}
export interface RelayStub {
  url: string
  seen: Seen[]
  pollQueue: unknown[]
  close: () => Promise<void>
}

export async function startRelayStub(): Promise<RelayStub> {
  const seen: Seen[] = []
  const pollQueue: unknown[] = []
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += String(c)))
    req.on('end', () => {
      seen.push({ method: req.method ?? '', path: req.url ?? '', auth: req.headers.authorization, body })
      res.setHeader('content-type', 'application/json')
      if (req.url?.endsWith('/relay/poll')) res.end(JSON.stringify(pollQueue.shift() ?? { idle: true }))
      else if (req.url?.endsWith('/relay/reply')) res.end(JSON.stringify({ ok: true }))
      else {
        res.statusCode = 404
        res.end('{}')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/v1`,
    seen,
    pollQueue,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/** Spawn a connector script and speak newline-delimited JSON-RPC to it. */
export interface Connector {
  rpc: (method: string, params?: unknown) => Promise<{ result?: { content?: { text: string }[]; instructions?: string }; error?: unknown }>
  close: () => void
}

export function spawnConnector(scriptPath: string, env: Record<string, string> = {}): Connector {
  const cleanEnv: Record<string, string | undefined> = { ...process.env }
  delete cleanEnv.RELAY_SECRET
  delete cleanEnv.RELAY_URL
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [scriptPath], {
    env: { ...cleanEnv, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.resume() // drain the log lines
  const pending = new Map<number, (message: never) => void>()
  let buffer = ''
  child.stdout.on('data', (chunk) => {
    buffer += String(chunk)
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        const message = JSON.parse(line) as { id?: number }
        if (message.id !== undefined && pending.has(message.id)) {
          const resolve = pending.get(message.id)!
          pending.delete(message.id)
          resolve(message as never)
        }
      }
      newline = buffer.indexOf('\n')
    }
  })
  let nextId = 1
  return {
    rpc: (method, params) =>
      new Promise((resolve) => {
        const id = nextId++
        pending.set(id, resolve)
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      }),
    close: () => child.kill(),
  }
}

export const toolText = (reply: { result?: { content?: { text: string }[] } }): string => reply.result?.content?.[0]?.text ?? ''

export const callTool = (c: Connector, name: string, args?: Record<string, unknown>) =>
  c.rpc('tools/call', { name, arguments: args }).then(toolText)
