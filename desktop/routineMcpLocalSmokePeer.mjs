/** Deterministic local JSON-RPC peer for packaged Routine acceptance. */
import { appendFileSync, readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
if (args.length !== 2 || args.some(path => typeof path !== 'string' || !isAbsolute(path))) process.exit(64)
const [tracePath, controlPath] = args

let control
try {
  control = JSON.parse(readFileSync(controlPath, 'utf8'))
} catch {
  process.exit(64)
}
if (!control || !['normal', 'hold-startup', 'hold-call'].includes(control.mode) ||
  Object.keys(control).some(key => key !== 'mode')) process.exit(64)

const mode = control.mode
const trace = row => appendFileSync(tracePath, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 })
trace({ kind: 'process-start', pid: process.pid, mode, environmentKeys: Object.keys(process.env).sort() })

let successfulCalls = 0
let pendingLineBytes = 0
process.stdin.on('data', chunk => {
  const lastNewline = chunk.lastIndexOf(0x0a)
  pendingLineBytes = lastNewline < 0 ? pendingLineBytes + chunk.length : chunk.length - lastNewline - 1
  if (pendingLineBytes > 1_048_576) process.exit(65)
})
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', line => {
  if (Buffer.byteLength(line, 'utf8') > 1_048_576) process.exit(65)
  let message
  try { message = JSON.parse(line) } catch { process.exit(65) }
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') process.exit(65)
  trace({ kind: 'request', method: message.method, ...(message.id === undefined ? {} : { id: message.id }),
    ...(message.params === undefined ? {} : { params: message.params }) })
  if (message.id === undefined) return

  if (mode === 'hold-startup' && message.method === 'server/discover') return
  if (mode === 'hold-call' && message.method === 'tools/call') return

  let result
  if (message.method === 'server/discover') {
    result = { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Agent Commons Routine local fixture', version: '1' } } }
  } else if (message.method === 'tools/list') {
    result = { resultType: 'complete', tools: [{ name: 'records.search', description: 'Search local Routine fixture records',
      inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 128 } },
        required: ['query'], additionalProperties: false } }] }
  } else if (message.method === 'tools/call') {
    const params = message.params
    const callArgs = params?.arguments
    const valid = successfulCalls === 0 && params?.name === 'records.search' &&
      callArgs && Object.keys(callArgs).length === 1 && callArgs.query === 'routine-native-smoke'
    if (valid) successfulCalls += 1
    result = valid
      ? { resultType: 'complete', isError: false,
        content: [{ type: 'text', text: 'Local fixture result for: routine-native-smoke' }] }
      : { resultType: 'complete', isError: true, content: [{ type: 'text', text: 'Fixture request was not admitted.' }] }
  } else {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id,
      error: { code: -32601, message: 'Method not found' } })}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
})

input.on('close', () => process.exit(0))
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => {
  input.close()
  process.exit(0)
})
