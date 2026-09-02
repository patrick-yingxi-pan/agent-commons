import type { CreateAgentRequest } from '../../contract/index.ts'

/** One submitted New-Agent form owns one immutable request and retry identity. */
export interface AgentCreationIntent {
  readonly tenantId: string
  readonly intentId: string
  readonly request: CreateAgentRequest
}

export const agentCreationResourceId = (intent: AgentCreationIntent): string =>
  `agent-create:${intent.intentId}`
