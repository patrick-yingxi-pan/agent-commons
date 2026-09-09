import assert from 'node:assert/strict'
import test from 'node:test'
import { validateMcpSchema } from './mcpSchema.ts'

const objectSchema = {
  type: 'object',
  properties: { count: { type: 'integer' } },
  required: ['count'],
  additionalProperties: false,
}

test('admits JSON Schema 2020-12 and validates without mutating caller data', async () => {
  assert.deepEqual(await validateMcpSchema(objectSchema), { ok: true })

  const value = { count: 3 }
  assert.deepEqual(await validateMcpSchema(objectSchema, { value }), { ok: true })
  assert.deepEqual(value, { count: 3 })
  assert.deepEqual(await validateMcpSchema(objectSchema, { value: { count: '3' } }),
    { ok: false, code: 'invalid_value' })

  const defaults = {
    type: 'object', properties: { enabled: { type: 'boolean', default: true } }, required: ['enabled'],
  }
  const missing: Record<string, unknown> = {}
  assert.deepEqual(await validateMcpSchema(defaults, { value: missing }), { ok: false, code: 'invalid_value' })
  assert.deepEqual(missing, {})
})

test('preserves omitted, null, and undefined value semantics', async () => {
  assert.deepEqual(await validateMcpSchema({ type: 'null' }), { ok: true })
  assert.deepEqual(await validateMcpSchema({ type: 'null' }, { value: null }), { ok: true })
  assert.deepEqual(await validateMcpSchema({ type: 'null' }, { value: undefined }),
    { ok: false, code: 'invalid_value' })
  assert.deepEqual(await validateMcpSchema(false), { ok: true })
  assert.deepEqual(await validateMcpSchema(false, { value: null }), { ok: false, code: 'invalid_value' })
})

test('supports the 2020-12 dialect and local refs but no alternate dialect or remote dereferencing', async () => {
  const local = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: { identifier: { type: 'string', pattern: '^[a-z]+$' } },
    $ref: '#/$defs/identifier',
  }
  assert.deepEqual(await validateMcpSchema(local, { value: 'agent' }), { ok: true })
  assert.deepEqual(await validateMcpSchema(local, { value: 'Agent-1' }), { ok: false, code: 'invalid_value' })
  const embedded = {
    $defs: { identifier: { $id: 'https://schemas.example/identifier', type: 'integer' } },
    properties: { id: { $ref: 'https://schemas.example/identifier' } },
  }
  assert.deepEqual(await validateMcpSchema(embedded, { value: { id: 7 } }), { ok: true })
  assert.deepEqual(await validateMcpSchema(embedded, { value: { id: '7' } }), { ok: false, code: 'invalid_value' })
  assert.deepEqual(await validateMcpSchema({ $schema: 'http://json-schema.org/draft-07/schema#' }),
    { ok: false, code: 'unsupported_dialect' })
  assert.deepEqual(await validateMcpSchema({
    $defs: { legacy: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'string' } },
    $ref: '#/$defs/legacy',
  }), { ok: false, code: 'unsupported_dialect' })
  assert.deepEqual(await validateMcpSchema({ $ref: 'https://example.invalid/remote-schema' }),
    { ok: false, code: 'invalid_schema' })
})

test('keeps unknown annotations and format inert while rejecting invalid schemas and Ajv extensions', async () => {
  assert.deepEqual(await validateMcpSchema({
    type: 'string', format: 'email', 'x-remote-prompt': { $async: true, $data: 'inert', anything: true },
  }, { value: 'not an email' }), { ok: true })
  assert.deepEqual(await validateMcpSchema({ type: 'string', nullable: true }, { value: null }),
    { ok: false, code: 'invalid_value' }, 'Ajv/OpenAPI extensions remain inert under JSON Schema 2020-12')
  assert.deepEqual(await validateMcpSchema({ const: { $data: 'ordinary literal property' } }, {
    value: { $data: 'ordinary literal property' },
  }), { ok: true })
  assert.deepEqual(await validateMcpSchema({ type: 'not-a-json-type' }),
    { ok: false, code: 'invalid_schema' })
  assert.deepEqual(await validateMcpSchema({ $async: true, type: 'string' }),
    { ok: false, code: 'invalid_schema' })
  assert.deepEqual(await validateMcpSchema({ type: 'number', minimum: { $data: '1/minimum' } }),
    { ok: false, code: 'invalid_schema' })
  assert.deepEqual(await validateMcpSchema({
    $defs: { deferred: { $async: true, type: 'string' } }, $ref: '#/$defs/deferred',
  }), { ok: false, code: 'invalid_schema' })
  assert.deepEqual(await validateMcpSchema({
    type: 'string',
    examples: [{ $schema: 'http://json-schema.org/draft-07/schema#', $async: true }],
    'x-mcp': { $vocabulary: { 'https://vendor.example/inert': true } },
  }, { value: 'still valid' }), { ok: true })
})

test('inspects legacy schema containers and exact local ref targets outside ordinary schema keywords', async () => {
  assert.deepEqual(await validateMcpSchema({
    $ref: '#/vendorSchema', vendorSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'string' },
  }), { ok: false, code: 'unsupported_dialect' })
  assert.deepEqual(await validateMcpSchema({
    $ref: '#/vendorSchema', vendorSchema: { $async: true, type: 'string' },
  }), { ok: false, code: 'invalid_schema' })
  assert.deepEqual(await validateMcpSchema({
    $ref: '#/vendorSchema',
    vendorSchema: { $vocabulary: { 'https://vendor.example/mandatory': true } },
  }), { ok: false, code: 'invalid_schema' })
  assert.deepEqual(await validateMcpSchema({
    definitions: { legacy: { $async: true, type: 'string' } }, $ref: '#/definitions/legacy',
  }), { ok: false, code: 'invalid_schema' })
  assert.deepEqual(await validateMcpSchema({
    type: 'object', dependencies: { enabled: { $async: true, required: ['mode'] } },
  }), { ok: false, code: 'invalid_schema' })

  const canonicalRoot = 'https://schemas.example/catalog/root'
  for (const equivalentRootRef of [
    'https://schemas.example/catalog/child/../root#/vendorSchema',
    'https://schemas.example/catalog/%72oot#/vendorSchema',
  ]) {
    assert.deepEqual(await validateMcpSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: canonicalRoot,
      $ref: equivalentRootRef,
      vendorSchema: { $vocabulary: { 'https://vendor.example/mandatory': true }, type: 'string' },
    }), { ok: false, code: 'invalid_schema' }, 'URI-equivalent local references cannot bypass required-vocabulary admission')
    assert.deepEqual(await validateMcpSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: canonicalRoot,
      $ref: equivalentRootRef,
      vendorSchema: { nullable: true, type: 'string' },
    }, { value: null }), { ok: false, code: 'invalid_value' }, 'URI-equivalent local references cannot reactivate Ajv extensions')
  }
  assert.deepEqual(await validateMcpSchema({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $ref: 'https://schemas.example/embedded#/vendorSchema',
    $defs: {
      embedded: {
        $id: 'https://schemas.example/embedded',
        vendorSchema: { $vocabulary: { 'https://vendor.example/mandatory': true }, type: 'string' },
      },
    },
  }), { ok: false, code: 'invalid_schema' }, 'forward references use the embedded schema resource as their pointer root')
  assert.deepEqual(await validateMcpSchema({
    type: 'object', properties: { value: { $ref: '#hidden' } },
    vendorSchema: { $anchor: 'hidden', $vocabulary: { 'https://vendor.example/mandatory': true }, type: 'string' },
  }), { ok: false, code: 'invalid_schema' }, 'a referenced named anchor is a schema even under an otherwise unknown annotation keyword')
  assert.deepEqual(await validateMcpSchema({
    type: 'object', properties: { value: { $ref: '#hidden' } },
    vendorSchema: { $anchor: 'hidden', nullable: true, type: 'string' },
  }, { value: { value: null } }), { ok: false, code: 'invalid_value' }, 'named anchors cannot reactivate Ajv extensions')
  const nestedPointerTarget = (hidden: Record<string, unknown>) => ({
    type: 'object',
    properties: { value: { $ref: '#/vendor/target' } },
    vendor: {
      $id: 'nested/',
      target: { $ref: '#hidden' },
      hidden: { $anchor: 'hidden', type: 'string', ...hidden },
    },
  })
  assert.deepEqual(await validateMcpSchema(nestedPointerTarget({ nullable: true }), {
    value: { value: null },
  }), { ok: false, code: 'invalid_value' },
  'a JSON Pointer target retains its inherited embedded-resource base when following another ref')
  assert.deepEqual(await validateMcpSchema(nestedPointerTarget({
    $vocabulary: { 'https://vendor.example/mandatory': true },
  })), { ok: false, code: 'invalid_schema' },
  'a JSON Pointer target cannot hide a required vocabulary behind a nested resource anchor')
  assert.deepEqual(await validateMcpSchema({
    type: 'string', vendorSchema: {
      $anchor: 'unreferenced', nullable: true,
      $vocabulary: { 'https://vendor.example/mandatory': true },
    },
    literalMetadata: { $id: 7, $anchor: false },
  }, { value: 'ordinary' }), { ok: true }, 'unreferenced annotation payloads remain inert')
})

test('reference traversal preserves relative bases, resource identity and encoded pointer tokens', async () => {
  const ownResource = (ref: string, hidden: Record<string, unknown>) => ({
    $ref: ref,
    vendor: { target: {
      $id: 'nested/', $anchor: 'entry', type: 'object',
      properties: { value: { $ref: '#hidden' } },
      hidden: { $anchor: 'hidden', type: 'string', ...hidden },
    } },
  })
  const cases = [
    ...['#/vendor/target', 'nested/', 'nested/#entry'].map(ref => ({
      name: `relative resource ${ref}`, schema: (hidden: Record<string, unknown>) => ownResource(ref, hidden),
    })),
    { name: 'encoded slash stays within one pointer token', schema: (hidden: Record<string, unknown>) => ({
      type: 'object', properties: { value: { $ref: '#/vendor%2Fschema' } },
      'vendor/schema': { type: 'string', ...hidden },
    }) },
    ...['default', 'const'].map(keyword => ({
      name: `pointer through unregistered ${keyword} data`, schema: (hidden: Record<string, unknown>) => ({
        type: 'object', properties: { value: { $ref: `#/metadata/${keyword}/target` } },
        metadata: { [keyword]: { $id: 'nested/', target: { $ref: '#hidden' } } },
        vendor: { $id: 'nested/', hidden: { $anchor: 'hidden', type: 'string', ...hidden } },
      }),
    })),
  ]
  for (const fixture of cases) {
    const schema = fixture.schema({ nullable: true })
    assert.deepEqual(await validateMcpSchema(schema, { value: { value: 'valid' } }), { ok: true }, fixture.name)
    assert.deepEqual(await validateMcpSchema(schema, { value: { value: null } }),
      { ok: false, code: 'invalid_value' }, fixture.name)
    assert.deepEqual(await validateMcpSchema(fixture.schema({
      $vocabulary: { 'https://vendor.example/mandatory': true },
    })), { ok: false, code: 'invalid_schema' }, fixture.name)
    assert.deepEqual(await validateMcpSchema(fixture.schema({
      $schema: 'http://json-schema.org/draft-07/schema#',
    })), { ok: false, code: 'unsupported_dialect' }, fixture.name)
  }
})

test('rejects unsupported required vocabularies but leaves optional vocabularies inert', async () => {
  assert.deepEqual(await validateMcpSchema({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $vocabulary: { 'https://vendor.example/mandatory': true },
  }), { ok: false, code: 'invalid_schema' })
  assert.deepEqual(await validateMcpSchema({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $vocabulary: { 'https://vendor.example/optional': false },
    'vendor:annotation': { arbitrary: true },
  }), { ok: true })
})

test('snapshots without invoking getters and applies schema and value budgets', async () => {
  let getterCalls = 0
  const accessor: Record<string, unknown> = {}
  Object.defineProperty(accessor, 'secret', { enumerable: true, get() { getterCalls += 1; return 'leak' } })
  assert.deepEqual(await validateMcpSchema({}, { value: accessor }), { ok: false, code: 'invalid_value' })
  assert.equal(getterCalls, 0)

  const wrapper = Object.defineProperty({}, 'value', {
    enumerable: true, get() { getterCalls += 1; return { exposed: true } },
  }) as { value: unknown }
  assert.deepEqual(await validateMcpSchema({}, wrapper), { ok: false, code: 'invalid_value' })
  assert.equal(getterCalls, 0)
  assert.deepEqual(await validateMcpSchema({ type: 'object', required: ['toString'] }, { value: {} }),
    { ok: false, code: 'invalid_value' }, 'prototype properties do not satisfy object requirements')

  assert.deepEqual(await validateMcpSchema({ description: 's'.repeat(65_536) }),
    { ok: false, code: 'limit' })
  assert.deepEqual(await validateMcpSchema({}, { value: 'v'.repeat(1024 * 1024) }),
    { ok: false, code: 'limit' })

  let deep: unknown = null
  for (let index = 0; index < 32; index += 1) deep = [deep]
  assert.deepEqual(await validateMcpSchema({}, { value: deep }), { ok: false, code: 'limit' })
})

test('pre-abort, active cancellation, and deadline terminate worker validation', async () => {
  assert.deepEqual(await validateMcpSchema({}, undefined, { signal: AbortSignal.abort('private') }),
    { ok: false, code: 'cancelled' })

  const pathological = { type: 'string', pattern: '^(a+)+$' }
  const attack = { value: `${'a'.repeat(42)}!` }
  assert.deepEqual(await validateMcpSchema(pathological, attack, { timeoutMs: 100 }),
    { ok: false, code: 'limit' })

  const controller = new AbortController()
  const pending = validateMcpSchema(pathological, attack, { signal: controller.signal, timeoutMs: 5_000 })
  setTimeout(() => controller.abort('private'), 30)
  assert.deepEqual(await pending, { ok: false, code: 'cancelled' })
})

test('bounds active workers and releases capacity after cancellation', async () => {
  const pathological = { type: 'string', pattern: '^(a+)+$' }
  const attack = { value: `${'a'.repeat(42)}!` }
  const controllers = Array.from({ length: 4 }, () => new AbortController())
  const occupied = controllers.map(controller => validateMcpSchema(pathological, attack, {
    signal: controller.signal, timeoutMs: 5_000,
  }))

  assert.deepEqual(await validateMcpSchema({}, undefined, { timeoutMs: 1_000 }),
    { ok: false, code: 'unavailable' })
  for (const controller of controllers) controller.abort()
  assert.deepEqual(await validateMcpSchema({}, undefined, { timeoutMs: 1_000 }),
    { ok: false, code: 'unavailable' }, 'terminating workers continue to occupy their bounded slots')
  assert.deepEqual(await Promise.all(occupied), Array.from({ length: 4 }, () => ({ ok: false, code: 'cancelled' })))
  assert.deepEqual(await validateMcpSchema({}, undefined, { timeoutMs: 1_000 }), { ok: true })
})
