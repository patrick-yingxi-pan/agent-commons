import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routineAgentSelection } from './routineAgentSelection.ts'

const agents = [{ id: 'other', label: 'First Agent' }, { id: 'agent-default', label: 'Default agent' }]

test('legacy Routine absence inherits the fixed default, independently of registry order', () => {
  assert.deepEqual(routineAgentSelection(agents), { agentId: 'agent-default', agent: agents[1] })
  assert.deepEqual(routineAgentSelection([agents[0]!]), { agentId: 'agent-default', agent: undefined })
})

test('missing and cold Routine selections retain their identity until explicit live repair', () => {
  assert.deepEqual(routineAgentSelection(agents, 'deleted'), { agentId: 'deleted', agent: undefined })
  assert.deepEqual(routineAgentSelection([], 'other'), { agentId: 'other', agent: undefined })
  assert.deepEqual(routineAgentSelection(agents, 'other'), { agentId: 'other', agent: agents[0] })
  assert.deepEqual(routineAgentSelection(agents.slice(1), 'other'), { agentId: 'other', agent: undefined })
  assert.deepEqual(routineAgentSelection(agents, ''), { agentId: '', agent: undefined })
})
