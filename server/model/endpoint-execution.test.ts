import test from 'node:test'
import assert from 'node:assert/strict'
import { endpointExecution } from './endpointExecution.ts'

test('development inherits the local mock while a release-shaped empty environment is unconfigured', () => {
  assert.equal(endpointExecution({}, {}), 'mock')
  assert.equal(endpointExecution({}, { MODEL_INLINE: '0' }), 'unconfigured')
})

test('the ambient Anthropic endpoint needs its ambient credential', () => {
  const base = { MODEL_INLINE: '0', ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }
  assert.equal(endpointExecution({}, base), 'unconfigured')
  assert.equal(endpointExecution({}, { ...base, ANTHROPIC_API_KEY: 'secret' }), 'configured')
})

test('a custom endpoint may be credentialless, but a named credential must resolve', () => {
  const config = { baseURL: 'http://models.internal/v1' }
  assert.equal(endpointExecution(config, { MODEL_INLINE: '0' }), 'configured')
  assert.equal(endpointExecution({ ...config, apiKeyEnv: 'PROVIDER_TEAM_KEY' }, {}), 'unconfigured')
  assert.equal(
    endpointExecution({ ...config, apiKeyEnv: 'PROVIDER_TEAM_KEY' }, { PROVIDER_TEAM_KEY: 'secret' }),
    'configured',
  )
})

test('an explicitly supplied loopback endpoint remains usable when the inline mock is disabled', () => {
  assert.equal(
    endpointExecution({}, { MODEL_INLINE: '0', ANTHROPIC_BASE_URL: 'http://127.0.0.1:11434' }),
    'configured',
  )
})
