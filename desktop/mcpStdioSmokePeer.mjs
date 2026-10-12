/** Repository-authored local MCP peer for disposable packaged stdio acceptance.
 * It is deterministic, performs no network I/O, and records only to an explicit
 * fixture-owned trace path supplied in the exact reviewed environment. */
import { appendFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const tracePath = process.argv[2]
if (process.argv.length !== 3 || typeof tracePath !== 'string' || !tracePath.startsWith('/')) process.exit(64)
const trace = row => appendFileSync(tracePath, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 })
const prior = () => {
  try { return readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) }
  catch { return [] }
}
trace({ kind: 'process-start', environmentKeys: Object.keys(process.env).sort() })

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', line => {
  if (Buffer.byteLength(line, 'utf8') > 1_048_576) process.exit(65)
  let message
  try { message = JSON.parse(line) } catch { process.exit(65) }
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') process.exit(65)
  trace({ kind: 'request', method: message.method, ...(message.id === undefined ? {} : { id: message.id }),
    ...(message.params === undefined ? {} : { params: message.params }) })
  if (message.id === undefined) return
  let result
  if (message.method === 'server/discover') {
    result = { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Agent Commons local fixture', version: '1' } } }
  } else if (message.method === 'tools/list') {
    result = { resultType: 'complete', tools: [{ name: 'records.search', description: 'records.search',
      inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 128 } }, required: ['query'], additionalProperties: false } }] }
  } else if (message.method === 'tools/call') {
    const calls = prior().filter(row => row.kind === 'request' && row.method === 'tools/call')
    const query = message.params?.arguments?.query
    const valid = message.params?.name === 'records.search' &&
      typeof query === 'string' && query.length > 0 && query.length <= 128 &&
      (calls.length === 1 || ['contribution-smoke-success', 'contribution-smoke-interrupt'].includes(query)) &&
      calls.filter(row => row.params?.arguments?.query === query).length === 1
    // Only this exact named fixture holds a request. Closing the application's
    // real native process supervisor ends it; there is no delayed success.
    if (valid && query === 'contribution-smoke-interrupt') return
    result = valid
      ? { resultType: 'complete', isError: false,
        content: [{ type: 'text', text: `Local fixture result for: ${message.params.arguments.query}` }] }
      : { resultType: 'complete', isError: true, content: [{ type: 'text', text: 'Fixture request was not admitted.' }] }
  } else {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id,
      error: { code: -32601, message: 'Method not found' } })}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
})
