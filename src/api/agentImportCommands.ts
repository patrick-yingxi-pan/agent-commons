/** Lazy transport and exact-origin reconciliation for remote Agent Card imports. */
import type { Agent, ImportAgentCardRequest } from '../../contract/index.ts'
import { ApiRequestError, apiGet, apiPost } from './client.ts'
import { rememberCreatedAgent } from './agentCreationCommands.ts'
import { agentImportCreationId } from './agentCreationIdentity.ts'
import { paths } from './keys.ts'

export interface AgentImportIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly request: ImportAgentCardRequest
}

function hasFrozenOrigin(agent: Agent, intent: AgentImportIntent): boolean {
  return agent.importedFrom?.url === intent.request.url
}

export async function applyAgentImport(
  intent: AgentImportIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await agentImportCreationId(intent.tenantId, idempotencyKey)
  const agent = await apiPost<Agent>(paths.agentImportCard, intent.request, { idempotencyKey })
  if (agent.id !== expectedId || !hasFrozenOrigin(agent, intent)) {
    throw new Error('The Agent import acknowledgement did not match the requested card.')
  }
  rememberCreatedAgent(agent)
}

/** Re-read only the identity derived from this account and logical import. The
 * stored origin must still match the frozen URL before it can count as success. */
export async function reconcileAgentImport(
  intent: AgentImportIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await agentImportCreationId(intent.tenantId, idempotencyKey)
  let agent: Agent
  try {
    agent = await apiGet<Agent>(paths.agent(expectedId))
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return false
    throw error
  }
  if (agent.id !== expectedId || !hasFrozenOrigin(agent, intent)) return false
  rememberCreatedAgent(agent)
  return true
}
