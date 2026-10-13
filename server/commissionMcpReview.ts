/** Pure reviewed facts. Activity counters and secrets are deliberately absent;
 * changing configuration, the selected model or the Project audience requires
 * a new review. This digest is freshness evidence, not authentication. */
import { createHash } from 'node:crypto'
import type { Agent, Commission, ModelProvider, Project } from '../contract/index.ts'
import type { DispatchBinding } from '../contract/dispatchExecution.ts'
import type { StoredCommissionMcpClaim } from './commissionMcpClaim.ts'
import type { CommissionMcpClaimView } from '../contract/commissionMcpApi.ts'
import { mcpPermissionJsonText } from './mcpPermission.ts'

function providerFacts(provider: ModelProvider | undefined) {
  return provider ? {
    id: provider.id, tenantId: provider.tenantId ?? null, kind: provider.kind ?? 'endpoint',
    definitionRevision: provider.definitionRevision ?? 0, connectionRevision: provider.connectionRevision ?? 0,
    label: provider.label, modelFamily: provider.modelFamily, models: provider.models ?? null,
    defaultModelId: provider.defaultModelId ?? null, plan: provider.plan ?? null, authority: provider.authority ?? null,
  } : null
}

export function commissionMcpReviewFacts(input: {
  tenantId: string
  ownerUserId: string
  commission: Commission
  agent: Agent
  project: Project
  provider: ModelProvider | undefined
  parentProvider: ModelProvider | undefined
  execution: DispatchBinding | null
  projectContext: unknown
  audience: unknown
}): { reviewHash: string; disclosures: string[] } {
  const { commission, agent, project, provider, execution } = input
  const reviewHash = createHash('sha256').update(mcpPermissionJsonText({
    tenantId: input.tenantId, ownerUserId: input.ownerUserId,
    commission: { id: commission.id, agentId: commission.agentId, projectId: commission.projectId,
      revision: commission.configurationRevision ?? 0, role: commission.role ?? null,
      grant: commission.grant ?? null, authority: commission.authority ?? null },
    agent: { id: agent.id, revision: agent.revision ?? 0, tenantId: agent.tenantId ?? null,
      label: agent.label, systemPrompt: agent.systemPrompt, instructions: agent.instructions,
      tools: agent.tools, providerId: agent.providerId ?? null, authority: agent.authority ?? null, budget: agent.budget ?? null },
    provider: providerFacts(provider), parentProvider: providerFacts(input.parentProvider), execution,
    project: { id: project.id, name: project.name, description: project.description,
      instructions: project.instructions ?? '', tenantId: project.tenantId ?? null,
      shared: project.shared ?? false, guardianId: project.guardianId ?? null },
    projectContext: input.projectContext, audience: input.audience,
  })).digest('hex')
  return { reviewHash, disclosures: [
    `This Contributor uses ${agent.label}${provider && execution ? ` with ${provider.label} / ${execution.modelId}` : ' with an explicitly selected endpoint model'}. Your workspace pays for its model usage.`,
    `The model receives this Agent’s instructions, the readable definition of Project “${project.name}”, each matching open work item and the selected tool schema. No ambient conversations or attached resource contents are included.`,
    'The model drafts arguments for one selected MCP tool per work item. Fixed argument values cannot change. Every tool is treated as potentially effectful, regardless of its read-only label.',
    'Tool arguments go to the selected service or local program. Exact arguments and results stay in your private receipt history; successful work attribution is visible to people who can read the Project.',
    project.shared ? 'This Project is publicly shared. Its work-item completion and Contributor credit can be visible beyond your workspace.' : 'Project work-item completion and Contributor credit follow the Project’s current sharing.',
    'Calls use your connection and require your continued workspace membership. Existing standing settings, connection setup and another person’s permission never grant this approval.',
    'The work count includes failed and uncertain attempts. External services and model providers may charge fees; work limits and local token estimates are not monetary caps.',
    'Changing reviewed configuration, model, Project sharing or tool bindings requires renewed approval. Interrupted or uncertain work is not automatically replayed or reassigned.',
  ] }
}

export function publicCommissionMcpClaim(claim: StoredCommissionMcpClaim): CommissionMcpClaimView {
  const base = { id: claim.id, work: structuredClone(claim.work), startedAt: claim.startedAt, phase: claim.phase,
    ...(claim.permission.localConnectionIds?.includes(claim.tool.connectionId) ? { transport: 'stdio' as const } : {}) }
  if (claim.phase === 'preparing') return { ...base, status: 'pending' }
  if (claim.phase === 'closed') return { ...base, status: claim.status, finishedAt: claim.finishedAt }
  return { ...base, status: claim.attempt.status, call: structuredClone(claim.attempt.call),
    ...(claim.attempt.status !== 'pending' ? { finishedAt: claim.attempt.finishedAt } : {}),
    ...('result' in claim.attempt && claim.attempt.result ? { result: structuredClone(claim.attempt.result) } : {}) }
}
