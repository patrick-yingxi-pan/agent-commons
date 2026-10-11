import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { createMcpStdioSupervisor } from './mcpStdioSupervisor.mjs'

// Only this repository-authored, ephemeral Node program is launched. It has no
// imports of the application, profile, network, credential store or filesystem.
const fixture = `
  import readline from 'node:readline';
  const input = readline.createInterface({ input: process.stdin });
  input.on('line', line => {
    const row = JSON.parse(line);
    if (row.id === undefined) return;
    if (row.params.mode === 'exit') process.exit(9);
    if (row.params.mode === 'wait') return;
    const result = { method: row.method, params: row.params, env: process.env, cwd: process.cwd() };
    const bytes = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: row.id, result }) + '\\n');
    process.stderr.write('private fixture diagnostics, never returned\\n');
    process.stdout.write(bytes.subarray(0, 7));
    process.stdout.write(bytes.subarray(7));
  });
`

function setup(t, prefix = '') {
  const supervisor = createMcpStdioSupervisor()
  const connection = supervisor.open({ executable: process.execPath, args: ['--input-type=module', '-e', prefix + fixture], cwd: tmpdir(), env: { MCP_FIXTURE_ONLY: 'yes' } }, { isCurrent: () => true })
  t.after(async () => { supervisor.dispose(); await connection.closed })
  return connection
}

test('real owned stdio child sees only explicit environment and literal parameters, then closes on EOF', { skip: process.platform !== 'darwin', timeout: 10_000 }, async t => {
  const connection = setup(t)
  const params = { value: '世界🙂\nopaque\u0000state; $(not executed)' }
  const response = await connection.request('tools/call', params)
  assert.equal(response.result.method, 'tools/call')
  assert.deepEqual(response.result.params, params)
  // macOS CoreFoundation may synthesize this one runtime variable in Node;
  // it is not part of the parent's explicit spawn environment.
  const { __CF_USER_TEXT_ENCODING: encoding, ...environment } = response.result.env
  if (encoding !== undefined) assert.match(encoding, /^0x[0-9A-Fa-f]+:0x[0-9A-Fa-f]+:0x[0-9A-Fa-f]+$/)
  assert.deepEqual(environment, { MCP_FIXTURE_ONLY: 'yes' })
  assert.equal(response.result.cwd, realpathSync(tmpdir()))
  assert.deepEqual(await connection.close(), { code: 'closed' })
})

test('real owned child exit preserves possible submission and is not relaunched', { skip: process.platform !== 'darwin', timeout: 10_000 }, async t => {
  const connection = setup(t)
  await assert.rejects(connection.request('tools/call', { mode: 'exit' }), error => error.code === 'closed' && error.mayHaveSubmitted === true)
  assert.deepEqual(await connection.closed, { code: 'closed' })
  await assert.rejects(connection.request('tools/call'), error => error.code === 'closed' && error.mayHaveSubmitted === false)
})

test('real pending child is cancelled and reaped without publishing a late result', { skip: process.platform !== 'darwin', timeout: 10_000 }, async t => {
  const connection = setup(t), abort = new AbortController()
  const request = connection.request('tools/call', { mode: 'wait' }, { signal: abort.signal })
  const rejected = assert.rejects(request, error => error.code === 'cancelled' && error.mayHaveSubmitted === true)
  abort.abort()
  await rejected
  assert.deepEqual(await connection.closed, { code: 'cancelled' })
})

test('real uncooperative direct child is reaped after EOF and SIGTERM are ignored', { skip: process.platform !== 'darwin', timeout: 10_000 }, async t => {
  const connection = setup(t, "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n")
  await connection.request('server/discover') // prove handlers are installed
  const abort = new AbortController()
  const rejected = assert.rejects(connection.request('tools/call', { mode: 'wait' }, { signal: abort.signal }), error => error.code === 'cancelled' && error.mayHaveSubmitted === true)
  abort.abort()
  await rejected
  assert.deepEqual(await connection.closed, { code: 'cancelled' })
})
