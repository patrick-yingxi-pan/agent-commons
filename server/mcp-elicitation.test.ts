import assert from 'node:assert/strict'
import test from 'node:test'
import {
  McpFormError,
  MCP_FORM_ENUM_MAX_COUNT,
  MCP_FORM_FIELDS_TOTAL_MAX,
  MCP_FORM_INPUT_MAX_BYTES,
  MCP_FORM_REQUEST_MAX_COUNT,
  MCP_FORM_REQUEST_STATE_MAX_BYTES,
  parseMcpFormInputRequired,
  parseMcpFormResponses,
} from './mcpElicitation.ts'

const request = (requestedSchema: unknown = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }) => ({
  method: 'elicitation/create',
  params: { message: 'Please provide a name.', requestedSchema },
})
const pending = (requestedSchema?: unknown, requestState?: string) => ({
  resultType: 'input_required',
  inputRequests: { name: request(requestedSchema) },
  ...(requestState === undefined ? {} : { requestState }),
})
const invalidForm = (value: unknown) => assert.throws(() => parseMcpFormInputRequired(value), error => error instanceof McpFormError && error.message === 'The MCP server returned an unsupported or invalid form request.')
const invalidResponses = (requestValue: unknown, responseValue: unknown) => {
  const admitted = parseMcpFormInputRequired(requestValue)
  assert.throws(() => parseMcpFormResponses(admitted, responseValue), error => error instanceof McpFormError && error.message === 'The MCP server returned an unsupported or invalid form request.')
}

test('admits bounded form-only inputRequired envelopes and detaches schemas', () => {
  const input = pending({
    type: 'object',
    title: 'Profile',
    description: 'A small profile form.',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 30, default: 'Ada' },
      email: { type: 'string', format: 'email' },
      site: { type: 'string', format: 'uri' },
      date: { type: 'string', format: 'date' },
      at: { type: 'string', format: 'date-time' },
      age: { type: 'integer', minimum: 0, maximum: 120, default: 42 },
      score: { type: 'number', minimum: 0, maximum: 1 },
      enabled: { type: 'boolean', default: false },
      color: { type: 'string', oneOf: [{ const: 'r', title: 'Red' }, { const: 'b', title: 'Blue' }] },
      colors: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string', enum: ['red', 'blue'] }, default: ['red'] },
      labels: { type: 'array', items: { anyOf: [{ const: 'p', title: 'Primary' }, { const: 's', title: 'Secondary' }] } },
    },
    required: ['name', 'email'],
  }, '  opaque state 世界 🦦  ')
  const parsed = parseMcpFormInputRequired(input)
  assert.equal(parsed.requestState, '  opaque state 世界 🦦  ')
  assert.equal(parsed.inputRequests.name?.params.requestedSchema.properties.name?.type, 'string')
  ;(input.inputRequests.name.params.requestedSchema.properties.name as any).default = 'changed'
  assert.equal((parsed.inputRequests.name?.params.requestedSchema.properties.name as any).default, 'Ada')
  assert.equal(Object.hasOwn(parsed.inputRequests.name!.params.requestedSchema.properties, '__proto__'), false)
})

test('preserves omitted mode, present empty requestState, and hostile __proto__ keys safely', () => {
  const source = JSON.parse('{"resultType":"input_required","requestState":"","inputRequests":{"__proto__":{"method":"elicitation/create","params":{"message":"Enter value","requestedSchema":{"type":"object","properties":{"__proto__":{"type":"string"}}}}}}}')
  const parsed = parseMcpFormInputRequired(source)
  assert.equal(Object.hasOwn(parsed, 'requestState'), true)
  assert.equal(parsed.requestState, '')
  assert.equal(Object.hasOwn(parsed.inputRequests, '__proto__'), true)
  assert.equal(Object.getPrototypeOf(parsed.inputRequests), Object.prototype)
  const properties = parsed.inputRequests.__proto__!.params.requestedSchema.properties
  assert.equal(Object.hasOwn(properties, '__proto__'), true)
  assert.equal(({} as any).polluted, undefined)
  const responses = parseMcpFormResponses(parsed, JSON.parse('{"__proto__":{"action":"accept","content":{"__proto__":"safe"}}}'))
  assert.equal(Object.hasOwn(responses, '__proto__'), true)
  assert.equal(Object.hasOwn(responses.__proto__!.action === 'accept' ? responses.__proto__!.content : {}, '__proto__'), true)
  assert.equal(({} as any).polluted, undefined)
})

test('accepts bounded result _meta but drops it from the canonical form request', () => {
  const input = {
    ...pending(),
    _meta: {
      'io.modelcontextprotocol/serverInfo': { name: 'fixture', version: '1' },
      'vendor.example/debug': { request: 'display-only metadata' },
    },
  }
  const parsed = parseMcpFormInputRequired(input)
  assert.equal(Object.hasOwn(parsed, '_meta'), false)
  assert.deepEqual(parsed.inputRequests.name?.params.requestedSchema, { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] })
  invalidForm({ ...input, _meta: 'not an object' })
})

test('validates accepted values, required fields, enums, formats, arrays, and returns detached answers without defaults', () => {
  const requestValue = pending({
    type: 'object',
    properties: {
      email: { type: 'string', format: 'email' },
      color: { type: 'string', enum: ['red', 'blue'], default: 'red' },
      colors: { type: 'array', minItems: 1, maxItems: 2, items: { anyOf: [{ const: 'r', title: 'Red' }, { const: 'b', title: 'Blue' }] } },
      age: { type: 'integer', minimum: 0, maximum: 120 },
      score: { type: 'number', minimum: 0, maximum: 1 },
      enabled: { type: 'boolean' },
      day: { type: 'string', format: 'date' },
      timestamp: { type: 'string', format: 'date-time' },
      homepage: { type: 'string', format: 'uri' },
    },
    required: ['email', 'colors'],
  })
  const answer = {
    name: {
      action: 'accept',
      content: { email: 'a@example.test', colors: ['r', 'b'], age: 37, score: 0.5, enabled: true, day: '2024-02-29', timestamp: '2024-02-29t12:30:00z', homepage: 'mailto:ada@example.test' },
    },
  }
  const parsed = parseMcpFormResponses(requestValue as any, answer)
  assert.deepEqual(parsed.name, { action: 'accept', content: answer.name.content })
  assert.equal(Object.hasOwn(parsed.name!.action === 'accept' ? parsed.name!.content : {}, 'color'), false)
  answer.name.content.colors[0] = 'mutated'
  assert.deepEqual((parsed.name as any).content.colors, ['r', 'b'])
})

test('validates decline and cancel as explicit no-content responses', () => {
  const requestValue = { ...pending(), inputRequests: { name: request(), other: request({ type: 'object', properties: { ok: { type: 'boolean' } } }) } }
  assert.deepEqual(parseMcpFormResponses(requestValue as any, { name: { action: 'decline' }, other: { action: 'cancel' } }), {
    name: { action: 'decline' }, other: { action: 'cancel' },
  })
})

test('rejects wrong result shape, non-form requests, unsupported schema keywords, nesting, and malformed constraints', () => {
  const good = pending()
  invalidForm({ resultType: 'complete', inputRequests: { name: request() } })
  invalidForm({ resultType: 'input_required', requestState: 'state' })
  invalidForm({ ...good, extra: true })
  invalidForm({ ...good, inputRequests: {} })
  invalidForm({ ...good, inputRequests: { a: request(), b: request(), c: request(), d: request(), e: request() } })
  invalidForm({ ...good, inputRequests: { name: { method: 'sampling/createMessage', params: {} } } })
  invalidForm({ ...good, inputRequests: { name: { ...request(), params: { ...request().params, mode: 'url' } } } })
  invalidForm(pending({ type: 'object', properties: { x: { type: 'object', properties: {} } } }))
  invalidForm(pending({ type: 'object', properties: { x: { type: 'string', pattern: '.*' } } }))
  invalidForm(pending({ type: 'object', properties: { x: { type: 'string', format: 'password' } } }))
  invalidForm(pending({ type: 'object', properties: { x: { type: 'string', format: { toString: 'server supplied' } } } }))
  invalidForm(pending({ type: 'object', properties: { x: { type: 'string', minLength: 3, maxLength: 2 } } }))
  invalidForm(pending({ type: 'object', properties: { x: { type: 'integer', default: 1.5 } } }))
  invalidForm(pending({ type: 'object', properties: { x: { type: 'string', enum: ['a', 'a'] } } }))
  invalidForm(pending({ type: 'object', properties: { x: { type: 'string', format: 'date', enum: ['2025-02-29'] } } }))
  invalidForm(pending({ type: 'object', properties: { x: { type: 'string', minLength: 3, oneOf: [{ const: 'x', title: 'Short' }] } } }))
  invalidForm(pending({ type: 'object', properties: { x: { type: 'string', oneOf: [{ const: 'a', title: 'A' }, { const: 'a', title: 'Again' }] } } }))
  invalidForm(pending({ type: 'object', properties: { x: { type: 'array', items: { type: 'string', enum: ['a', 'a'] } } } }))
  invalidForm(pending({ type: 'object', properties: { x: { type: 'array', items: { anyOf: [{ const: 'a', title: 'A' }, { const: 'a', title: 'Again' }] } } } }))
  invalidForm(pending({ type: 'object', properties: { x: { type: 'string', format: 'date', default: '2025-02-29' } } }))
  invalidForm({ ...good, requestState: 'x'.repeat(MCP_FORM_REQUEST_STATE_MAX_BYTES + 1) })
  invalidForm({ ...good, inputRequests: { name: request({ type: 'object', properties: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`f${i}`, { type: 'boolean' }])) }) } })
  invalidForm({ ...good, inputRequests: Object.fromEntries(Array.from({ length: MCP_FORM_REQUEST_MAX_COUNT }, (_, i) => [`r${i}`, request({ type: 'object', properties: Object.fromEntries(Array.from({ length: 17 }, (_, j) => [`f${j}`, { type: 'boolean' }])) })])) })
  invalidForm({ ...good, inputRequests: { name: request({ type: 'object', properties: { x: { type: 'number', minimum: Number.MAX_SAFE_INTEGER + 1 } } }) } })
})

test('malformed JSON format values always produce the fixed parser error', () => {
  const malformed = [
    { type: 'object', properties: { x: { type: 'string', format: { toString: 'x' } } } },
    { type: 'object', properties: { x: { type: 'string', format: ['email'] } } },
    { type: 'object', properties: { x: { type: 'string', format: null } } },
  ]
  for (const schema of malformed) invalidForm(pending(schema))
})

test('rejects malformed, incomplete, extra-ID, extra-field, and invalid-value responses', () => {
  const requestValue = pending({ type: 'object', properties: { name: { type: 'string', minLength: 2 }, age: { type: 'integer', minimum: 0 }, colors: { type: 'array', items: { type: 'string', enum: ['red', 'blue', 'red\nblue'] } } }, required: ['name'] })
  const admitted = parseMcpFormInputRequired(requestValue)
  assert.deepEqual(parseMcpFormResponses(admitted, { name: { action: 'accept', content: { name: 'Ada', colors: ['red\nblue'] } } }), {
    name: { action: 'accept', content: { name: 'Ada', colors: ['red\nblue'] } },
  })
  invalidResponses(requestValue, {})
  invalidResponses(requestValue, { name: { action: 'accept', content: {} } })
  invalidResponses(requestValue, { name: { action: 'accept', content: { name: 'A' } } })
  invalidResponses(requestValue, { name: { action: 'accept', content: { name: 'Ada', secret: 'x' } } })
  invalidResponses(requestValue, { name: { action: 'accept', content: { name: 'Ada', age: Number.MAX_SAFE_INTEGER + 1 } } })
  invalidResponses(requestValue, { name: { action: 'accept', content: { name: 'Ada', age: 1.5 } } })
  invalidResponses(requestValue, { name: { action: 'accept', content: { name: 'Ada', colors: ['red', 'red'] } } })
  invalidResponses(requestValue, { name: { action: 'accept', content: { name: 'Ada', colors: ['green'] } } })
  invalidResponses(requestValue, { name: { action: 'decline', content: {} } })
  invalidResponses(requestValue, { name: { action: 'accept', content: { name: 'Ada' }, extra: true } })
  invalidResponses(requestValue, { name: { action: 'decline' }, unexpected: { action: 'cancel' } })
  invalidResponses(requestValue, { name: { action: 'accept', content: { name: 'Ada' } }, other: { action: 'cancel' } })
  invalidResponses(requestValue, { name: { action: 'maybe' } })
  const multiline = parseMcpFormResponses(pending(), { name: { action: 'accept', content: { name: 'line one\nline two' } } })
  assert.equal((multiline.name as any).content.name, 'line one\nline two')
})

test('format validation is deterministic and conservative without fetching URIs', () => {
  const uriRequest = pending({ type: 'object', properties: { target: { type: 'string', format: 'uri' } }, required: ['target'] })
  assert.deepEqual(parseMcpFormResponses(uriRequest as any, { name: { action: 'accept', content: { target: 'mailto:ada@example.test' } } }).name,
    { action: 'accept', content: { target: 'mailto:ada@example.test' } })
  for (const target of ['https://example.test/has space', 'https://example.test/%zz', 'relative/path']) {
    invalidResponses(uriRequest, { name: { action: 'accept', content: { target } } })
  }
  const emailRequest = pending({ type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'] })
  for (const email of ['a..b@example.test', '.a@example.test', 'a.@example.test', '"a b"@example.test', 'a@-bad.example', 'a@bad-.example', 'a@bad']) {
    invalidResponses(emailRequest, { name: { action: 'accept', content: { email } } })
  }
  const dateTimeRequest = pending({ type: 'object', properties: { at: { type: 'string', format: 'date-time' } }, required: ['at'] })
  assert.deepEqual(parseMcpFormResponses(dateTimeRequest as any, { name: { action: 'accept', content: { at: '2024-02-29t12:30:00z' } } }).name,
    { action: 'accept', content: { at: '2024-02-29t12:30:00z' } })
})

test('rejects accessor, prototype, oversized, cyclic and non-JSON inputs without invoking hostile code', () => {
  let invoked = false
  const accessor = { resultType: 'input_required', inputRequests: { name: request() } }
  Object.defineProperty(accessor, 'requestState', { enumerable: true, get() { invoked = true; return 'leak' } })
  invalidForm(accessor)
  assert.equal(invoked, false)
  invalidForm(Object.assign(Object.create({ inherited: true }), pending()))
  const cyclic: any = pending()
  cyclic.loop = cyclic
  invalidForm(cyclic)
  invalidForm({ ...pending(), unused: 'x'.repeat(MCP_FORM_INPUT_MAX_BYTES) })
  invalidResponses(pending(), { name: { action: 'accept', content: { name: NaN } } })
  invalidResponses(pending(), { name: { action: 'accept', content: new Date() } })
})

test('bounds multiform aggregate fields and requires every response ID exactly once', () => {
  const combined = {
    resultType: 'input_required',
    inputRequests: Object.fromEntries(Array.from({ length: MCP_FORM_REQUEST_MAX_COUNT }, (_, i) => [
      `r${i}`,
      request({ type: 'object', properties: Object.fromEntries(Array.from({ length: MCP_FORM_FIELDS_TOTAL_MAX / MCP_FORM_REQUEST_MAX_COUNT }, (_, j) => [`f${j}`, { type: 'boolean' }])) }),
    ])),
  }
  assert.equal(Object.keys(parseMcpFormInputRequired(combined).inputRequests).length, MCP_FORM_REQUEST_MAX_COUNT)
  const tooMany = structuredClone(combined)
  tooMany.inputRequests.r0.params.requestedSchema.properties.extra = { type: 'boolean' }
  invalidForm(tooMany)
  invalidResponses(combined, Object.fromEntries(Object.keys(combined.inputRequests).slice(1).map(id => [id, { action: 'cancel' }])))
})

test('enforces enum, character, byte, depth, and node limits without truncating valid data', () => {
  const choices = Array.from({ length: MCP_FORM_ENUM_MAX_COUNT }, (_, i) => `option-${i}`)
  const atLimit = pending({ type: 'object', properties: { option: { type: 'string', enum: choices }, text: { type: 'string', maxLength: 4_096 } } })
  assert.equal(parseMcpFormInputRequired(atLimit).inputRequests.name?.params.requestedSchema.properties.option?.type, 'string')
  invalidForm(pending({ type: 'object', properties: { option: { type: 'string', enum: [...choices, 'overflow'] } } }))
  invalidForm(pending({ type: 'object', properties: { text: { type: 'string', enum: ['x'.repeat(4_097)] } } }))
  invalidForm({ ...pending(), inputRequests: { name: { ...request(), params: { ...request().params, message: 'm'.repeat(2_049) } } } })
  invalidForm({ ...pending(), padding: Array.from({ length: 8_200 }, () => null) })
  let deep: unknown = 'leaf'
  for (let i = 0; i < 20; i += 1) deep = { nested: deep }
  invalidForm({ ...pending(), padding: deep })
})
