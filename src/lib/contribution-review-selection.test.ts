import test from 'node:test'
import assert from 'node:assert/strict'
import type { Agent, ModelProvider } from '../../contract/index.ts'
import { contributionReviewSelections } from './contributionReviewSelection.ts'

const agent = (id: string, providerId: string, tenantId?: string): Agent => ({
  id,
  providerId,
  ...(tenantId ? { tenantId } : {}),
  revision: 4,
  label: `Reviewer ${id}`,
  systemPrompt: '',
  tools: ['anything'],
  instructions: '',
})

const provider = (
  id: string,
  overrides: Partial<ModelProvider> = {},
): ModelProvider => ({
  id,
  label: `Provider ${id}`,
  modelFamily: 'test',
  effortLevels: [],
  execution: 'configured',
  definitionRevision: 3,
  connectionRevision: 8,
  defaultModelId: 'model-1',
  models: [{ id: 'model-1', label: 'Model One' }],
  ...overrides,
})

test('review selections include only visible Agents bound to configured endpoint models', () => {
  const agents = [
    agent('private-reviewer', 'endpoint'),
    agent('shared-reviewer', 'endpoint-shared', undefined),
    agent('foreign-agent', 'endpoint', 'other-tenant'),
    agent('session-agent', 'session'),
    agent('mock-agent', 'mock'),
    agent('unconfigured-agent', 'unconfigured'),
    agent('missing-model-agent', 'missing-model'),
    agent('unbound-agent', ''),
  ]
  const providers = [
    provider('endpoint', { tenantId: 'tenant-a' }),
    provider('endpoint-shared'),
    provider('session', { kind: 'session', execution: undefined }),
    provider('mock', { execution: 'mock' }),
    provider('unconfigured', { execution: 'unconfigured' }),
    provider('missing-model', { defaultModelId: undefined }),
  ]

  const choices = contributionReviewSelections(agents, providers, 'tenant-a')
  assert.deepEqual(choices.map(({ agent: reviewer, provider: source, modelId, modelLabel }) => ({
    agent: reviewer.id,
    provider: source.id,
    modelId,
    modelLabel,
  })), [
    { agent: 'private-reviewer', provider: 'endpoint', modelId: 'model-1', modelLabel: 'Model One' },
    { agent: 'shared-reviewer', provider: 'endpoint-shared', modelId: 'model-1', modelLabel: 'Model One' },
  ])
  assert.deepEqual(contributionReviewSelections(agents, providers, undefined), [])
})
