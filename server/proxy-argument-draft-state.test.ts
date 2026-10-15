import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseProxyArgumentDraft,
  parseProxyArgumentDraftBinding,
  PROXY_ARGUMENT_DRAFT_MAX_BYTES,
  proxyArgumentReservationId,
} from './proxyArgumentDraftState.ts'

const binding = {
  agentRevision: 0,
  providerId: 'provider-example',
  providerRevision: 0,
  providerConnectionRevision: 0,
  model: 'model-example',
  connectionId: 'connection-example',
  connectionRevision: 4,
  toolName: 'lookup',
  schemaHash: 'a'.repeat(64),
  transport: 'http',
} as const
const inputHash = 'b'.repeat(64)

test('draft binding is an exact, non-credential coordinate set with legacy-zero revisions allowed', () => {
  assert.equal(proxyArgumentReservationId('agent-request-opaque'), 'agent-request-opaque:arguments')
  assert.deepEqual(parseProxyArgumentDraftBinding(binding), binding)
  assert.throws(() => parseProxyArgumentDraftBinding({ ...binding, credential: 'must not persist' }))
  assert.throws(() => parseProxyArgumentDraftBinding({ ...binding, providerConnectionRevision: -1 }))
  assert.throws(() => parseProxyArgumentDraftBinding({ ...binding, schemaHash: 'A'.repeat(64) }))
  assert.throws(() => parseProxyArgumentDraftBinding({ ...binding, transport: 'mock' }))
})

test('draft arguments are a bounded detached JSON object and receipt outcomes are strict', () => {
  const base = { revision: 2, status: 'done', binding, inputHash, startedAt: 10, finishedAt: 11 }
  const argumentsValue = { nested: [1, true, null], text: 'exact, private arguments' }
  const parsed = parseProxyArgumentDraft({ ...base, arguments: argumentsValue }, 10)
  assert.deepEqual(parsed.arguments, argumentsValue)
  assert.notEqual(parsed.arguments, argumentsValue)
  assert.throws(() => parseProxyArgumentDraft({ ...base, arguments: [] }, 10), 'root arrays are not argument objects')
  assert.throws(() => parseProxyArgumentDraft({ ...base, arguments: { text: 'x'.repeat(PROXY_ARGUMENT_DRAFT_MAX_BYTES) } }, 10),
    'oversize drafts are not stored')
  assert.throws(() => parseProxyArgumentDraft({ ...base, extra: true, arguments: argumentsValue }, 10))
  assert.throws(() => parseProxyArgumentDraft({ ...base, status: 'failed', arguments: argumentsValue }, 10))
  assert.throws(() => parseProxyArgumentDraft({ ...base, finishedAt: 9, arguments: argumentsValue }, 10))
  assert.deepEqual(parseProxyArgumentDraft({ revision: 1, status: 'pending', binding, inputHash, startedAt: 10 }, 10), {
    revision: 1, status: 'pending', binding, inputHash, startedAt: 10,
  })
})
