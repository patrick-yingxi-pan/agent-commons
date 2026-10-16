/** Agent authorship is distinct from the model that supplied the reply. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driverByline, DEFAULT_AGENT_ID } from './driverByline.ts'

const agents = [
  { id: 'agent-scout', label: 'Research scout' },
  { id: 'agent-default', label: 'Default agent' },
]

test('an unstamped legacy driver stays provider-neutral', () => {
  assert.equal(driverByline(undefined, agents), 'Assistant')
})

test('the default Agent uses its registered label rather than a model-vendor alias', () => {
  assert.equal(driverByline(DEFAULT_AGENT_ID, agents), 'Default agent')
  assert.equal(driverByline(DEFAULT_AGENT_ID, [{ id: DEFAULT_AGENT_ID, label: 'Workspace assistant' }]), 'Workspace assistant')
})

test('a non-default agent that drove the turn reads its own label — the hand-off is visible', () => {
  assert.equal(driverByline('agent-scout', agents), 'Research scout')
})

test('an unavailable driver never guesses a model vendor', () => {
  assert.equal(driverByline('agent-gone', agents), 'Assistant')
  assert.equal(driverByline('agent-scout', []), 'Assistant')
})
