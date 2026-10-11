import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpInputReview } from '../../contract/mcpInput.ts'
import { compileMcpInputDraft, emptyMcpInputDraft, mcpInputChoices } from './mcpInputDraft.ts'

const review: McpInputReview = { decisionId: 'decision', round: 1, expiresAt: 100,
  connectionLabel: 'Fixture', toolName: 'test', canContinue: true, inputRequests: {
    form: { method: 'elicitation/create', params: { message: 'Review', requestedSchema: {
      type: 'object', properties: {
        title: { type: 'string', default: 'Never automatic', maxLength: 2 },
        enabled: { type: 'boolean', default: true }, count: { type: 'integer', minimum: 0, maximum: 4 },
        choices: { type: 'array', minItems: 0, maxItems: 2, items: { anyOf: [{ const: '', title: 'Empty' }, { const: 'x', title: 'Ex' }] } },
      }, required: ['title', 'enabled'],
    } } },
  } }

test('empty form drafts do not answer remote defaults; required values need explicit input', () => {
  const draft = emptyMcpInputDraft(review)
  assert.deepEqual(draft.form!.fields, {})
  assert.throws(() => compileMcpInputDraft(review, draft), /title/)
  draft.form!.fields.title = ''
  assert.throws(() => compileMcpInputDraft(review, draft), /enabled/)
  draft.form!.fields.enabled = 'false'
  assert.deepEqual(compileMcpInputDraft(review, draft), { form: { action: 'accept', content: { title: '', enabled: false } } })
})

test('primitive and enum-array values preserve exact empty, zero, false, and Unicode answers', () => {
  assert.deepEqual(compileMcpInputDraft(review, { form: { action: 'accept', fields: {
    title: '😀😀', enabled: 'false', count: '0', choices: ['', 'x'],
  } } }), { form: { action: 'accept', content: { title: '😀😀', enabled: false, count: 0, choices: ['', 'x'] } } })
  assert.deepEqual(mcpInputChoices(review.inputRequests.form!.params.requestedSchema.properties.choices!), [
    { value: '', label: 'Empty' }, { value: 'x', label: 'Ex' },
  ])
})

test('invalid numeric and array draft values fail before dispatch without silent coercion', () => {
  const fields = { title: 'ok', enabled: 'true' }
  for (const count of [' ', '1.1', '5', 'Infinity']) assert.throws(() => compileMcpInputDraft(review, {
    form: { action: 'accept', fields: { ...fields, count } },
  }), /integer/)
  for (const choices of [['x', 'x'], ['outside'], ['', 'x', 'z']]) assert.throws(() => compileMcpInputDraft(review, {
    form: { action: 'accept', fields: { ...fields, choices } },
  }), /choices/)
})

test('decline and cancel contain no retained answers; prototype-like field names stay literal', () => {
  for (const action of ['decline', 'cancel'] as const) assert.deepEqual(compileMcpInputDraft(review, {
    form: { action, fields: { title: 'secret draft', enabled: 'true' } },
  }), { form: { action } })
  const special = structuredClone(review)
  special.inputRequests.form!.params.requestedSchema = {
    type: 'object', properties: Object.fromEntries([['constructor', { type: 'string' }], ['__proto__', { type: 'string' }]]),
  }
  assert.deepEqual(compileMcpInputDraft(special, emptyMcpInputDraft(special)), { form: { action: 'accept', content: {} } })
  const content = Object.fromEntries([['constructor', 'one'], ['__proto__', 'two']])
  assert.deepEqual(compileMcpInputDraft(special, { form: { action: 'accept', fields: content } }), { form: { action: 'accept', content } })
})
