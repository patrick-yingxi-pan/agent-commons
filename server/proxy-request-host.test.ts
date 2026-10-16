import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Agent } from '../contract/workers.ts'
import { beginProxyReplyDraft, createProxyRequest } from './proxyRequestState.ts'
import { ProxyRequestRegistry } from './proxyRequestRegistry.ts'
import { ProxyRequestHost } from './proxyRequestHost.ts'

const requester = { tenantId: 'tenant-a', userId: 'person-a', agentId: 'agent-a' }
const owner = { tenantId: 'tenant-b', userId: 'person-b', agentId: 'agent-b' }
const requesterActor = { tenantId: requester.tenantId, userId: requester.userId }
const ownerActor = { tenantId: owner.tenantId, userId: owner.userId }

test('reply draft receipt is owner-only and absent from both history summaries', () => {
  const registry = new ProxyRequestRegistry()
  const row = createProxyRequest({ id: `agent-request-${'a'.repeat(32)}`, requester, owner,
    task: 'Answer one question.', createdAt: 10 })
  registry.put(beginProxyReplyDraft(row, ownerActor, row.revision,
    { agentRevision: 1, providerId: 'provider-b', providerRevision: 2,
      providerConnectionRevision: 3, model: 'model-b' }, 'b'.repeat(64), '', 11))
  const agents = new Map<string, Agent>([
    [requester.agentId, { id: requester.agentId, tenantId: requester.tenantId, label: 'Requester', published: true } as Agent],
    [owner.agentId, { id: owner.agentId, tenantId: owner.tenantId, label: 'Owner', published: true } as Agent],
  ])
  const host = new ProxyRequestHost({ registry, agent: id => agents.get(id),
    ownership: id => id === requester.agentId ? { agentId: id, tenantId: requester.tenantId, ownerUserId: requester.userId } :
      id === owner.agentId ? { agentId: id, tenantId: owner.tenantId, ownerUserId: owner.userId } : undefined,
    active: () => true, visible: () => true, commit: operation => operation(), changed: () => {}, now: () => 12 })
  assert.equal(host.read(row.intent.id, ownerActor)?.replyDraft?.status, 'pending')
  assert.equal(Object.hasOwn(host.read(row.intent.id, requesterActor)!, 'replyDraft'), false)
  assert.equal(Object.hasOwn(host.list(ownerActor)[0]!, 'replyDraft'), false)
  assert.equal(Object.hasOwn(host.list(requesterActor)[0]!, 'replyDraft'), false)
})
