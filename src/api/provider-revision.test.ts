import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ModelProvider } from '../../contract/index.ts'
import { mergeProviderConnection, mergeProviderDefinition } from './providerRevision.ts'

const provider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  id: 'provider-revision',
  label: 'Provider',
  modelFamily: 'claude',
  effortLevels: ['Low'],
  definitionRevision: 2,
  connectionRevision: 4,
  models: [{ id: 'current-model', label: 'Current model' }],
  execution: 'configured',
  protocol: 'anthropic-messages',
  replyOutputTokens: 4096,
  online: true,
  activeConversations: 2,
  isDefault: true,
  ...overrides,
})

test('a newer provider definition preserves newer connection and live state', () => {
  const current = provider()
  const incoming = provider({
    label: 'Renamed',
    modelFamily: 'openai',
    definitionRevision: 3,
    connectionRevision: 1,
    models: [{ id: 'stale-model', label: 'Stale model' }],
    execution: 'unconfigured',
    protocol: 'openai-responses',
    replyOutputTokens: 8192,
    online: false,
    activeConversations: 0,
    isDefault: false,
  })
  const merged = mergeProviderDefinition(current, incoming)
  assert.equal(merged.label, 'Renamed')
  assert.equal(merged.modelFamily, 'openai')
  assert.equal(merged.connectionRevision, 4)
  assert.equal(merged.models?.[0]?.id, 'current-model')
  assert.equal(merged.execution, 'configured')
  assert.equal(merged.protocol, 'anthropic-messages', 'definition acknowledgement cannot replace connection protocol')
  assert.equal(merged.replyOutputTokens, 4096, 'definition acknowledgement cannot replace the current request limit')
  assert.equal(merged.online, true)
  assert.equal(merged.activeConversations, 2)
  assert.equal(merged.isDefault, true)
})

test('an older provider definition acknowledgement cannot rewind definition state', () => {
  const current = provider({ label: 'Current', definitionRevision: 5 })
  const delayed = provider({ label: 'Delayed', definitionRevision: 4, connectionRevision: 8 })
  assert.deepEqual(mergeProviderDefinition(current, delayed), current)
})

test('a newer provider connection preserves definition and live/default state', () => {
  const current = provider({ label: 'Current definition', definitionRevision: 7 })
  const incoming = provider({
    label: 'Stale definition',
    definitionRevision: 1,
    connectionRevision: 5,
    models: [{ id: 'new-model', label: 'New model' }],
    protocol: 'openai-responses',
    execution: 'unconfigured',
    replyOutputTokens: 16384,
    online: false,
    isDefault: false,
  })
  const merged = mergeProviderConnection(current, incoming)
  assert.equal(merged.label, 'Current definition')
  assert.equal(merged.definitionRevision, 7)
  assert.equal(merged.connectionRevision, 5)
  assert.equal(merged.models?.[0]?.id, 'new-model')
  assert.equal(merged.execution, 'unconfigured')
  assert.equal(merged.protocol, 'openai-responses', 'connection acknowledgement immediately publishes the selected protocol')
  assert.equal(merged.replyOutputTokens, 16384, 'connection acknowledgement publishes the selected reply limit')
  assert.equal(merged.online, true)
  assert.equal(merged.isDefault, true)
})

test('an older provider connection acknowledgement cannot rewind its catalog', () => {
  const current = provider({
    connectionRevision: 6,
    secretHint: 'cafe',
    secretRotationReceipt: { id: 'rotation-current', state: 'applied' },
  })
  const delayed = provider({
    connectionRevision: 5,
    models: [{ id: 'old', label: 'Old' }],
    protocol: 'openai-responses',
    secretHint: 'dead',
    secretRotationReceipt: { id: 'rotation-old', state: 'applied' },
  })
  assert.deepEqual(mergeProviderConnection(current, delayed), current)
})

test('an accepted connection without a protocol clears the stale cached projection', () => {
  const current = provider({ protocol: 'openai-responses' })
  const incoming = provider({ connectionRevision: 5, protocol: undefined, replyOutputTokens: undefined })
  const merged = mergeProviderConnection(current, incoming)
  assert.equal(Object.hasOwn(merged, 'protocol'), false)
  assert.equal(Object.hasOwn(merged, 'replyOutputTokens'), false)
  assert.equal(merged.connectionRevision, 5)
})

test('a newer provider connection carries the Session secret hint and exact receipt together', () => {
  const current = provider({
    connectionRevision: 6,
    secretHint: 'dead',
    secretRotationReceipt: { id: 'rotation-old', state: 'applied' },
  })
  const incoming = provider({
    connectionRevision: 7,
    secretHint: 'cafe',
    secretRotationReceipt: { id: 'rotation-current', state: 'cancelled' },
  })
  const merged = mergeProviderConnection(current, incoming)
  assert.equal(merged.secretHint, 'cafe')
  assert.deepEqual(merged.secretRotationReceipt, { id: 'rotation-current', state: 'cancelled' })
})
