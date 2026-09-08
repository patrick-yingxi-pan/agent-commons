import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapshotMcpJson, McpJsonError } from './mcpJson.ts'

const limits = { maxBytes: 1024, maxDepth: 8, maxNodes: 32 }
test('MCP JSON snapshots preserve exact JSON data without references or prototype setters', () => {
  const source = JSON.parse('{"__proto__":{"polluted":true},"nested":[null,true,4,"世界\\n"]}')
  const copy = snapshotMcpJson(source, limits)
  assert.deepEqual(copy, source)
  assert.equal(Object.getPrototypeOf(copy), Object.prototype)
  assert.equal(Object.hasOwn(copy, '__proto__'), true)
  source.nested[3] = 'changed'
  assert.equal(copy.nested[3], '世界\n')
  assert.equal(({}).polluted, undefined)
})

test('MCP JSON rejects non-JSON values without invoking accessors or serialization hooks', () => {
  let invoked = 0
  const accessor = { get secret() { invoked++; return 'private' } }
  const hook = { toJSON() { invoked++; return {} } }
  const sparse = new Array(2)
  const custom = [1]; custom.extra = 2
  const hidden = Object.defineProperty({}, 'secret', { value: 1 })
  const symbol = { [Symbol('secret')]: 1 }
  const cyclic = {}; cyclic.self = cyclic
  for (const candidate of [undefined, NaN, Infinity, 1n, () => {}, Symbol(), new Date(), accessor, hook, sparse, custom, hidden, symbol, cyclic]) {
    assert.throws(() => snapshotMcpJson(candidate, limits), McpJsonError)
  }
  assert.equal(invoked, 0)
})

test('MCP JSON charges actual encoded bytes and structural limits at their exact boundaries', () => {
  for (const value of ['世界\n"', '\ud800', { a: [null, false, 100] }, -0]) {
    const bytes = Buffer.byteLength(JSON.stringify(value))
    assert.deepEqual(snapshotMcpJson(value, { ...limits, maxBytes: bytes }), JSON.parse(JSON.stringify(value)))
    assert.throws(() => snapshotMcpJson(value, { ...limits, maxBytes: bytes - 1 }), McpJsonError)
  }
  assert.deepEqual(snapshotMcpJson({ a: [1] }, { ...limits, maxDepth: 3, maxNodes: 3 }), { a: [1] })
  assert.throws(() => snapshotMcpJson({ a: [1] }, { ...limits, maxDepth: 2 }), McpJsonError)
  assert.throws(() => snapshotMcpJson({ a: [1] }, { ...limits, maxNodes: 2 }), McpJsonError)
  for (const bad of [0, -1, NaN, 1.5, Infinity]) {
    assert.throws(() => snapshotMcpJson({}, { ...limits, maxBytes: bad }), McpJsonError)
  }
})
