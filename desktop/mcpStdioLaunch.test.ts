import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MCP_STDIO_LAUNCH_LIMITS, snapshotMcpStdioLaunch, mcpStdioReviewLiteral } from './mcpStdioLaunch.mjs'

const valid = () => ({ executable: '/usr/local/bin/example-mcp', args: ['--mode', 'read only'],
  cwd: '/Users/example/project', env: { LANG: 'C.UTF-8', TOKEN: 'explicit-only' } })

test('native review escapes invisible and bidi formatting without changing exact launch data', () => {
  const input = { ...valid(), args: ['\u061c\u200e\u200f\u202e\u2066\ufeff\u{e0001}', 'line\nnext\u2028\u2029', 'literal \\u202e 😀'] }
  const rendered = mcpStdioReviewLiteral(input)
  assert.deepEqual(JSON.parse(rendered), input)
  assert.doesNotMatch(rendered, /[\u007f-\u009f\u2028\u2029]|\p{Cf}/u)
  assert.match(rendered, /\\u061c\\u200e\\u200f\\u202e\\u2066\\ufeff\\udb40\\udc01/)
  assert.ok(rendered.includes('\n  "args"'), 'pretty-print layout remains readable')
})

test('stdio launch config is a detached, deeply frozen exact snapshot', () => {
  const source = valid()
  const snapshot = snapshotMcpStdioLaunch(source)
  assert.ok(snapshot)
  assert.deepEqual(snapshot, valid())
  assert.notEqual(snapshot, source)
  assert.notEqual(snapshot.args, source.args)
  assert.notEqual(snapshot.env, source.env)
  assert.ok(Object.isFrozen(snapshot))
  assert.ok(Object.isFrozen(snapshot.args))
  assert.ok(Object.isFrozen(snapshot.env))
  source.executable = '/changed'
  source.cwd = '/changed'
  source.args[0] = 'changed'
  source.env.TOKEN = 'changed'
  assert.deepEqual(snapshot, valid())
  assert.deepEqual(Object.keys(snapshot.env), ['LANG', 'TOKEN'])
  assert.equal(Object.hasOwn(snapshot.env, 'PATH'), false, 'no ambient PATH is inherited')
})

test('literal spaces and shell-looking characters in argument values are data, not shell expansion', () => {
  const config = valid()
  config.args = ['two words', '$(touch marker); * `echo nope`', '$HOME', 'a\nb']
  assert.deepEqual(snapshotMcpStdioLaunch(config)?.args, config.args)
})

test('plain records require exact own data fields and never invoke accessors or toJSON', () => {
  let calls = 0
  const config = valid()
  Object.defineProperty(config, 'executable', { enumerable: true, get() { calls += 1; return '/tmp/x' } })
  assert.equal(snapshotMcpStdioLaunch(config), null)
  const withToJSON = valid()
  Object.defineProperty(withToJSON, 'toJSON', { enumerable: false, value() { calls += 1; return valid() } })
  assert.equal(snapshotMcpStdioLaunch(withToJSON), null)
  const symbol = valid()
  Object.defineProperty(symbol, Symbol('extra'), { value: true })
  assert.equal(snapshotMcpStdioLaunch(symbol), null)
  assert.equal(calls, 0)
})

test('custom prototypes, extra fields, and hostile nested records are rejected', () => {
  const inherited = Object.assign(Object.create({ PATH: '/ambient' }), valid())
  assert.equal(snapshotMcpStdioLaunch(inherited), null)
  assert.equal(snapshotMcpStdioLaunch({ ...valid(), shell: true }), null)
  const env = Object.assign(Object.create({ INHERITED: 'no' }), { EXPLICIT: 'yes' })
  assert.equal(snapshotMcpStdioLaunch({ ...valid(), env }), null)
  assert.equal(snapshotMcpStdioLaunch({ ...valid(), env: Object.assign(Object.create(null), { EXPLICIT: 'yes' }) })?.env.EXPLICIT, 'yes')
})

test('argument arrays must be dense plain arrays of own data values with no extra keys', () => {
  const sparse = valid()
  sparse.args = new Array(1)
  assert.equal(snapshotMcpStdioLaunch(sparse), null)
  const custom = valid()
  custom.args = Object.assign(['ok'], { extra: 'bad' })
  assert.equal(snapshotMcpStdioLaunch(custom), null)
  const accessor = valid()
  Object.defineProperty(accessor.args, '0', { enumerable: true, get() { throw new Error('must not run') } })
  assert.equal(snapshotMcpStdioLaunch(accessor), null)
  const subclass = valid()
  subclass.args = new (class extends Array {})('bad')
  assert.equal(snapshotMcpStdioLaunch(subclass), null)
})

test('paths must be absolute and all strings must be well-formed and NUL-free', () => {
  for (const change of [
    { executable: 'bin/example' }, { cwd: 'relative' }, { executable: '/tmp/a\0b' },
    { executable: 'C:\\Tools\\example.exe' }, { cwd: '\\\\server\\share\\project' },
    { cwd: '/tmp/\ud800' }, { args: ['bad\udc00'] }, { env: { OK: 'bad\ud800' } },
  ]) assert.equal(snapshotMcpStdioLaunch({ ...valid(), ...change }), null)
})

test('environment keys are bounded identifiers and reject prototype-sensitive names', () => {
  for (const key of ['__proto__', 'prototype', 'constructor', 'BAD-KEY', '1BAD', '']) {
    assert.equal(snapshotMcpStdioLaunch({ ...valid(), env: { [key]: 'value' } }), null, key)
  }
})

test('declared entry, per-string, and aggregate UTF-8 byte bounds are enforced', () => {
  const limits = MCP_STDIO_LAUNCH_LIMITS
  assert.ok(Object.isFrozen(limits))
  assert.ok(snapshotMcpStdioLaunch({ ...valid(), args: Array(limits.maxArgs).fill('x') }))
  assert.equal(snapshotMcpStdioLaunch({ ...valid(), args: Array(limits.maxArgs + 1).fill('x') }), null)
  assert.ok(snapshotMcpStdioLaunch({ ...valid(), args: ['é'.repeat(Math.floor(limits.maxArgBytes / 2))] }))
  assert.equal(snapshotMcpStdioLaunch({ ...valid(), args: ['x'.repeat(limits.maxArgBytes + 1)] }), null)
  assert.ok(snapshotMcpStdioLaunch({ ...valid(), env: Object.fromEntries(Array.from({ length: limits.maxEnvEntries }, (_, i) => [`K${i}`, 'x'])) }))
  assert.equal(snapshotMcpStdioLaunch({ ...valid(), env: Object.fromEntries(Array.from({ length: limits.maxEnvEntries + 1 }, (_, i) => [`K${i}`, 'x'])) }), null)
  assert.equal(snapshotMcpStdioLaunch({ ...valid(), env: { VALUE: 'x'.repeat(limits.maxEnvValueBytes + 1) } }), null)
  assert.equal(snapshotMcpStdioLaunch({ ...valid(), args: Array(8).fill('x'.repeat(limits.maxArgBytes)) }), null,
    'aggregate bound includes argument framing even when each argument is individually valid')
})

test('required fields and argument/environment shapes fail closed', () => {
  for (const value of [null, [], {}, { ...valid(), args: null }, { ...valid(), env: [] },
    { ...valid(), args: [1] }, { ...valid(), env: { TOKEN: 1 } }, { ...valid(), executable: '' },
    { ...valid(), cwd: '' }, { ...valid(), cwd: '   ' }]) {
    assert.equal(snapshotMcpStdioLaunch(value), null)
  }
})
