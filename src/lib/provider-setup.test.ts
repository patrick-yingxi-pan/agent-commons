import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROVIDER_PROTOCOL_LABELS,
  PROVIDER_SETUP_DEFAULTS,
  providerProtocolLabel,
  providerSetupDefaults,
} from './providerSetup.ts'

test('provider setup presets declare only verified endpoint and protocol defaults', () => {
  assert.deepEqual(PROVIDER_SETUP_DEFAULTS.anthropic, {
    protocol: 'anthropic-messages',
    baseURL: 'https://api.anthropic.com',
    model: '',
    modelFamily: 'claude',
  })
  assert.deepEqual(PROVIDER_SETUP_DEFAULTS.openai, {
    protocol: 'openai-responses',
    baseURL: 'https://api.openai.com/v1',
    model: '',
    modelFamily: 'gpt',
  })
  assert.deepEqual(PROVIDER_SETUP_DEFAULTS.deepseek, {
    protocol: 'anthropic-messages',
    baseURL: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-flash',
    modelFamily: 'deepseek',
  })
  assert.deepEqual(PROVIDER_PROTOCOL_LABELS, {
    'anthropic-messages': 'Anthropic Messages',
    'openai-responses': 'OpenAI Responses',
  })
})

test('custom retains authored values and absent legacy protocol is presented as Anthropic Messages', () => {
  assert.equal(providerSetupDefaults('custom'), null)
  assert.equal(providerProtocolLabel(undefined), 'Anthropic Messages')
  assert.equal(providerProtocolLabel('openai-responses'), 'OpenAI Responses')
})
