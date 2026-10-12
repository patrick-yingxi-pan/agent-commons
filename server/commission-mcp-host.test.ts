import assert from 'node:assert/strict'
import test from 'node:test'
import type { CommissionMcpDecisionRequest } from '../contract/commissionMcpApi.ts'
import type { CommissionMcpApprovalIntent } from '../contract/commissionMcp.ts'
import type { Agent, Commission, ModelProvider, Project } from '../contract/index.ts'
import type { McpConnectionView, McpDiscoveredTool } from '../contract/mcpConnections.ts'
import type { McpToolPermission } from '../contract/mcpExecution.ts'
import { CommissionMcpHost, type CommissionMcpLiveSource } from './commissionMcpHost.ts'
import { CommissionMcpPolicyError, type CommissionMcpScope } from './commissionMcpPolicy.ts'
import { CommissionMcpRegistry } from './commissionMcpRegistry.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'

const now = 1_800_000_000_000
const tenantId = 'tenant-owner'
const ownerUserId = 'person-owner'
const projectId = 'project-private'
const commissionId = 'commission-private'
const agentId = 'agent-private'
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const execution = { agentId, providerId: 'provider-private', modelId: 'model-private' }

function schema(name: string): McpDiscoveredTool {
  return { name, inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: true } }
}
const primary = schema('search')
const sibling = schema('delete_record')
const permission = (tool: McpDiscoveredTool = primary): McpToolPermission => ({
  connectionId, connectionRevision: 7, toolName: tool.name, schemaHash: mcpToolSchemaHash(tool), fixedArguments: {},
})
const scope: CommissionMcpScope = { tenantId, ownerUserId, projectId, commissionId, agentId }

function fixture() {
  const registry = new CommissionMcpRegistry()
  const agent = { id: agentId, label: 'Private Agent', systemPrompt: 'system', instructions: 'instructions', tools: ['search'],
    providerId: execution.providerId, contributions: 1, forks: 2 } as unknown as Agent
  const project = { id: projectId, name: 'Private Project', description: 'Definition', instructions: 'Project instructions',
    updatedAt: 100, tenantId, shared: false, contexts: [], sessionIds: [], scheduled: [] } as unknown as Project
  const commission = { id: commissionId, projectId, agentId, tenantId, configurationRevision: 4, role: 'writer' } as unknown as Commission
  const provider = { id: execution.providerId, tenantId, kind: 'endpoint', label: 'Private Provider', modelFamily: 'test', models: [],
    defaultModelId: execution.modelId } as unknown as ModelProvider
  let visibleTools = [
    { connectionId, connectionRevision: 7, connectionLabel: 'Private MCP', schemaHash: mcpToolSchemaHash(primary), tool: primary },
  ]
  let blockedReason: string | null = null
  let changed = 0
  const liveConnection: McpConnectionView = { id: connectionId, label: 'Private MCP', status: 'connected', revision: 7,
    authentication: 'none', protocolVersion: '2026-07-28', inspectedAt: now, tools: [primary, sibling],
    execution: 'approval-required', executableTools: ['search', 'delete_record'] }
  const source = (id: string, tenant: string, person: string, model?: { providerId: string; modelId: string }): CommissionMcpLiveSource | undefined => {
    if (id !== commissionId || tenant !== tenantId || person !== ownerUserId) return undefined
    return {
      tenantId, ownerUserId, scope, commission, agent, project, provider, parentProvider: undefined,
      execution: model ? { agentId, ...model } : null,
      projectContext: { work: [] }, audience: { tenantId, shared: false }, tools: structuredClone(visibleTools), blockedReason,
    }
  }
  const host = new CommissionMcpHost({ registry, source,
    connection: (id, tenant, person) => id === connectionId && tenant === tenantId && person === ownerUserId ? liveConnection : undefined,
    commit: operation => operation(), changed: () => { changed += 1 }, now: () => now,
  })
  const approval = (tools: McpToolPermission[] = [permission()]): CommissionMcpApprovalIntent => {
    const review = host.review(commissionId, tenantId, ownerUserId, execution)!
    return { expectedRevision: review.policy.revision, expectedConfigurationRevision: review.configurationRevision,
      reviewHash: review.reviewHash, execution, expiresAt: now + 60_000, maxWorkItems: 3, tools }
  }
  const approveRequest = (requestId: string, tools?: McpToolPermission[]): CommissionMcpDecisionRequest =>
    ({ requestId, action: 'approve', approval: approval(tools) })
  return { registry, host, agent, project, commission, setVisibleTools: (tools: typeof visibleTools) => { visibleTools = tools },
    setBlockedReason: (value: string | null) => { blockedReason = value }, getChanged: () => changed, approveRequest }
}

function code(fn: () => unknown, expected: CommissionMcpPolicyError['code']) {
  assert.throws(fn, (error: unknown) => error instanceof CommissionMcpPolicyError && error.code === expected)
}

test('reviews and decisions are private to the exact tenant, person, and Commission', () => {
  const { host } = fixture()
  assert.ok(host.review(commissionId, tenantId, ownerUserId))
  assert.equal(host.review(commissionId, 'tenant-other', ownerUserId), undefined)
  assert.equal(host.review(commissionId, tenantId, 'person-other'), undefined)
  assert.equal(host.review('commission-other', tenantId, ownerUserId), undefined)
  const request = { requestId: 'private-decision', action: 'revoke', expectedRevision: 1 } as const
  assert.equal(host.decide(commissionId, 'tenant-other', request, ownerUserId), undefined)
  assert.equal(host.decide(commissionId, tenantId, request, 'person-other'), undefined)
})

test('review freshness follows configuration, not activity counters or Project touch time', () => {
  const { host, agent, project, commission } = fixture()
  const first = host.review(commissionId, tenantId, ownerUserId, execution)!
  agent.contributions = 99
  agent.forks = 88
  project.updatedAt += 1
  assert.equal(host.review(commissionId, tenantId, ownerUserId, execution)!.reviewHash, first.reviewHash)
  commission.configurationRevision = 5
  assert.notEqual(host.review(commissionId, tenantId, ownerUserId, execution)!.reviewHash, first.reviewHash)
})

test('approval POST cannot select a sibling tool hidden from the current review', () => {
  const { host, registry, approveRequest, getChanged } = fixture()
  const request = approveRequest('hidden-sibling', [permission(), permission(sibling)])
  code(() => host.decide(commissionId, tenantId, request, ownerUserId), 'unavailable')
  assert.equal(registry.policy(scope), undefined)
  assert.equal(getChanged(), 0)
})

test('an exact decision receipt replays after source blocking without a second change', () => {
  const { host, registry, approveRequest, setBlockedReason, getChanged } = fixture()
  const request = approveRequest('blocked-replay')
  const first = host.decide(commissionId, tenantId, request, ownerUserId)!
  assert.equal(first.review.policy.revision, 1)
  assert.equal(getChanged(), 1)
  setBlockedReason('provider unavailable')
  const replay = host.decide(commissionId, tenantId, request, ownerUserId)!
  assert.equal(replay.decisionId, first.decisionId)
  assert.equal(getChanged(), 1)
  assert.equal(replay.review.blockedReason, 'provider unavailable')
  const newRequest = approveRequest('new-while-blocked')
  code(() => host.decide(commissionId, tenantId, newRequest, ownerUserId), 'denied')
  assert.equal(registry.policy(scope)?.policy.revision, 1)
})

test('review policy, tools, and disclosures are detached from host-owned state', () => {
  const { host } = fixture()
  const review = host.review(commissionId, tenantId, ownerUserId, execution)!
  review.disclosures[0] = 'tampered'
  review.tools[0]!.tool.name = 'delete_record'
  review.policy.revision = 999
  const reread = host.review(commissionId, tenantId, ownerUserId, execution)!
  assert.notEqual(reread.disclosures[0], 'tampered')
  assert.equal(reread.tools[0]!.tool.name, 'search')
  assert.equal(reread.policy.revision, 0)
})
