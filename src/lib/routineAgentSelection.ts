import type { Agent } from '../../contract/index.ts'

/** Legacy absence inherits the fixed default Agent. Explicit identities remain
 * unavailable when missing, including while a mounted editor's registry moves. */
export function routineAgentSelection(agents: readonly Pick<Agent, 'id' | 'label'>[], agentId?: string) {
  const id = agentId ?? 'agent-default'
  return { agentId: id, agent: agents.find(candidate => candidate.id === id) }
}
