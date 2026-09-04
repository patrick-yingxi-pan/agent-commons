/** Transport and exact authoritative reconciliation for Agent creation. */
import type { Agent } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { mergeAgentConfiguration } from './agentRevision.ts'
import { agentCreationId } from './agentCreationIdentity.ts'
import type { AgentCreationIntent } from './agentCreationRevision.ts'

/** Publish one proven newly owned Agent without replacing unrelated registry
 * truth. Shared by direct creation and definition forking. */
export function rememberCreatedAgent(agent: Agent): void {
  const cached = peek<Agent[]>(keys.workerAgents)
  if (cached) {
    mutate<Agent[]>(keys.workerAgents, (current) => {
      const rows = current ?? []
      const existing = rows.find((candidate) => candidate.id === agent.id)
      if (!existing) return [...rows, agent]
      const merged = mergeAgentConfiguration(existing, agent)
      return rows.map((candidate) => candidate.id === agent.id ? merged : candidate)
    })
  }
  // The list may have changed independently while the acknowledgement was in
  // flight. Publish the exact row now, then revalidate the collection owner.
  invalidate(keys.workerAgents)
}

export async function applyAgentCreation(
  intent: AgentCreationIntent,
  idempotencyKey: string,
): Promise<void> {
  const agent = await apiPost<Agent>(paths.agents, intent.request, { idempotencyKey })
  rememberCreatedAgent(agent)
}

/** Prove only the row derived from this tenant and logical form submission. */
export async function reconcileAgentCreation(
  intent: AgentCreationIntent,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await agentCreationId(intent.tenantId, idempotencyKey)
  const incoming = await apiGet<Agent[]>(paths.agents)
  const represented = incoming.find((agent) => agent.id === expectedId)
  const current = peek<Agent[]>(keys.workerAgents)
  if (!current) setData(keys.workerAgents, incoming)
  else if (represented) {
    mutate<Agent[]>(keys.workerAgents, (rows) => {
      const existing = rows ?? []
      return existing.some((agent) => agent.id === represented.id)
        ? existing.map((agent) => agent.id === represented.id ? represented : agent)
        : [...existing, represented]
    })
  }
  if (!represented) return false
  rememberCreatedAgent(represented)
  return true
}
