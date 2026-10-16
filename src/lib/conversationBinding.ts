import type { Session, Agent, SessionMetadataPatch } from '../../contract/index.ts'
import { DEFAULT_PROVIDER_ID } from '../../contract/index.ts'
import type { ModelPick } from './models.ts'

/** Draft and saved conversations use the same wire fields. An absent provider
 * inherits the selected Agent; choosing a model never changes the Agent. */
export type ConversationBinding = Pick<Session, 'agentId' | 'providerId' | 'modelId'>

/** Only execution-binding changes hold Send/Retry; title and rail edits do not. */
export function isConversationBindingPatch(patch: Readonly<SessionMetadataPatch>): boolean {
  return patch.agentId !== undefined || patch.providerId !== undefined || patch.modelId !== undefined
}

export function conversationModelPick(binding: ConversationBinding, agents: Pick<Agent, 'id' | 'providerId'>[]): ModelPick {
  const agent = agents.find((candidate) => candidate.id === (binding.agentId ?? 'agent-default'))
  return { providerId: binding.providerId ?? agent?.providerId ?? DEFAULT_PROVIDER_ID, modelId: binding.modelId }
}
