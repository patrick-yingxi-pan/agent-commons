import type { Agent } from '../../contract/workers.ts'
import type { ModelProvider } from '../../contract/providers.ts'

export interface ContributionReviewSelection {
  agent: Agent
  provider: ModelProvider
  modelId: string
  modelLabel: string
}

/** Only an explicit owner/shared Agent binding to a live configured endpoint can
 * be offered for a paid model review. Mock, Session, and unresolved models are
 * deliberately absent instead of being presented as an equivalent choice. */
export function contributionReviewSelections(
  agents: Agent[],
  providers: ModelProvider[],
  tenantId: string | undefined,
): ContributionReviewSelection[] {
  if (!tenantId) return []
  const visibleProvider = (provider: ModelProvider): boolean =>
    provider.tenantId === undefined || provider.tenantId === tenantId

  return agents.flatMap((agent) => {
    if (agent.tenantId !== undefined && agent.tenantId !== tenantId) return []
    if (!agent.providerId) return []
    const provider = providers.find((candidate) => candidate.id === agent.providerId)
    if (!provider || !visibleProvider(provider)) return []
    if ((provider.kind ?? 'endpoint') !== 'endpoint' || provider.execution !== 'configured') return []
    const modelId = provider.defaultModelId
    if (!modelId) return []
    const model = provider.models?.find((candidate) => candidate.id === modelId)
    return [{ agent, provider, modelId, modelLabel: model?.label ?? modelId }]
  })
}
