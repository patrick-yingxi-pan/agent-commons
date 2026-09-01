import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Agent } from '../../contract/index.ts'
import { mergeAgentConfiguration } from './agentRevision.ts'

const agent = (revision: number, label: string, contributions = 0, forks = 0): Agent => ({
  id: 'agent-revision',
  revision,
  label,
  systemPrompt: 'prompt',
  tools: [],
  instructions: '',
  contributions,
  forks,
})

test('newer Agent configuration lands without rewinding monotonic activity', () => {
  const current = agent(2, 'Old', 5, 3)
  const incoming = agent(3, 'New', 2, 4)
  assert.deepEqual(mergeAgentConfiguration(current, incoming), agent(3, 'New', 5, 4))
})

test('an older Agent acknowledgement cannot rewind configuration or activity', () => {
  const current = agent(4, 'Current', 5, 3)
  const delayed = agent(3, 'Delayed', 7, 1)
  assert.deepEqual(mergeAgentConfiguration(current, delayed), agent(4, 'Current', 7, 3))
})
