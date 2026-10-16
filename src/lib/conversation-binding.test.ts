import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conversationModelPick, isConversationBindingPatch } from './conversationBinding.ts'
import { DEFAULT_PROVIDER_ID } from '../../contract/index.ts'

const agents = [{ id: 'agent-default' }, { id: 'a', providerId: 'deepseek-local' }]

test('only explicit binding coordinates hold generation, including inheritance resets', () => {
  for (const patch of [{ agentId: 'a' }, { providerId: '' }, { modelId: '' }]) assert.equal(isConversationBindingPatch(patch), true)
  for (const patch of [{ title: 'Renamed' }, { pinned: true }, { archived: true }, { modelId: undefined }]) assert.equal(isConversationBindingPatch(patch), false)
})

test('conversation model projection inherits its Agent, then respects an explicit provider/model override', () => {
  assert.deepEqual(conversationModelPick({}, agents), { providerId: DEFAULT_PROVIDER_ID, modelId: undefined })
  assert.deepEqual(conversationModelPick({ agentId: 'a' }, agents), { providerId: 'deepseek-local', modelId: undefined })
  assert.deepEqual(conversationModelPick({ agentId: 'a', providerId: DEFAULT_PROVIDER_ID, modelId: 'exact' }, agents),
    { providerId: DEFAULT_PROVIDER_ID, modelId: 'exact' })
})
