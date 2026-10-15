import assert from 'node:assert/strict'
import test from 'node:test'
import fastUri from 'fast-uri'
import { validateMcpSchema } from './mcpSchema.ts'

test('fast-uri parses, normalizes, and compares percent-encoded scheme-relative hosts consistently', () => {
  const encoded = '//%41.example'
  const plain = '//a.example'

  assert.equal(fastUri.parse(encoded).host, 'a.example')
  assert.equal(fastUri.parse(encoded).host, fastUri.parse(plain).host)
  assert.equal(fastUri.normalize(encoded), fastUri.normalize(plain))
  assert.equal(fastUri.equal(encoded, plain), true)
})

test('scheme-relative schema resources resolve locally without admitting an unregistered remote reference', async () => {
  const schema = {
    $id: 'https://schemas.example/root',
    type: 'object',
    required: ['value'],
    properties: { value: { $ref: '//schemas.example/embedded/integer' } },
    $defs: {
      integer: { $id: '//%53chemas.example/embedded/integer', type: 'integer' },
    },
  }

  assert.deepEqual(await validateMcpSchema(schema, { value: { value: 7 } }), { ok: true })
  assert.deepEqual(await validateMcpSchema(schema, { value: { value: '7' } }),
    { ok: false, code: 'invalid_value' })
  assert.deepEqual(await validateMcpSchema({ $ref: '//remote.example/unregistered-schema' }),
    { ok: false, code: 'invalid_schema' })
})
