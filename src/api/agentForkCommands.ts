/** Lazy transport and exact-identity reconciliation for published Agent forks. */
import type { Agent } from '../../contract/index.ts'
import { ApiRequestError, apiGet, apiPost } from './client.ts'
import { invalidate, invalidatePrefix } from './cache.ts'
import { rememberCreatedAgent } from './agentCreationCommands.ts'
import { agentForkCreationId } from './agentCreationIdentity.ts'
import { keys, paths } from './keys.ts'

export interface AgentForkIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly sourceAgentId: string
}

function hasFrozenLineage(agent: Agent, intent: AgentForkIntent): boolean {
  return agent.forkedFrom?.agentId === intent.sourceAgentId
}

function publishFork(agent: Agent): void {
  rememberCreatedAgent(agent)
  invalidatePrefix(keys.directoryAgents())
  invalidatePrefix(keys.ownerProfile())
  invalidate(keys.notifications)
}

export async function applyAgentFork(
  intent: AgentForkIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await agentForkCreationId(intent.tenantId, idempotencyKey)
  const agent = await apiPost<Agent>(paths.agentFork(intent.sourceAgentId), {}, { idempotencyKey })
  if (agent.id !== expectedId || !hasFrozenLineage(agent, intent)) {
    throw new Error('The Agent fork acknowledgement did not match the requested definition.')
  }
  publishFork(agent)
}

/** Prove only the opaque row derived from this account and logical fork, and
 * require its stored lineage to match the source the person selected. */
export async function reconcileAgentFork(
  intent: AgentForkIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await agentForkCreationId(intent.tenantId, idempotencyKey)
  let agent: Agent
  try {
    agent = await apiGet<Agent>(paths.agent(expectedId))
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return false
    throw error
  }
  if (agent.id !== expectedId || !hasFrozenLineage(agent, intent)) return false
  publishFork(agent)
  return true
}
