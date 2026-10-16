import type { Agent } from '../../contract/index.ts'
import type { ConversationState } from './conversationCore.ts'

/** A local launch is not a server create or model call. Its review pins the
 * shared draft that would be replaced, the account, and the selected Agent. */
export interface AgentConversationLaunchSnapshot {
  agent: Pick<Agent, 'id' | 'label' | 'revision'> | undefined
  registryReady: boolean
  mutationHeld: boolean
  accountGeneration: number
  draftEpoch: number
  draft: Pick<ConversationState, 'live' | 'composerText' | 'draftBinding' | 'busy' | 'typing'>
}

export function agentConversationLaunchBlocked(snapshot: AgentConversationLaunchSnapshot): string | null {
  if (!snapshot.registryReady) return 'Wait for the Agent list to load successfully.'
  if (!snapshot.agent) return 'This Agent is not available in your account. Fork a public Agent before using it.'
  if (snapshot.mutationHeld) return 'Finish or dismiss the pending Agent change first.'
  if (snapshot.draft.busy || snapshot.draft.typing) return 'Wait for the current draft to finish before starting another conversation.'
  return null
}

export function hasAgentConversationDraft(snapshot: AgentConversationLaunchSnapshot): boolean {
  const { draft } = snapshot
  return !!(draft.composerText.length || draft.draftBinding || draft.live.messages.length ||
    draft.live.attachments.length || draft.live.connectors.length || draft.live.repos.length || draft.live.workspaces.length)
}

/** Recheck synchronously at confirmation: another pane may have changed the
 * shared draft while the dialog was open. Never erase work outside the review. */
export function launchAgentConversation(
  reviewed: AgentConversationLaunchSnapshot,
  current: AgentConversationLaunchSnapshot,
  actions: { resetDraft: () => void; selectAgent: (agentId: string) => void; openDraft: () => void },
): string | null {
  const blocked = agentConversationLaunchBlocked(current)
  if (blocked) return blocked
  if (reviewed.accountGeneration !== current.accountGeneration ||
    reviewed.agent?.id !== current.agent!.id || reviewed.agent?.revision !== current.agent!.revision) {
    return 'The account or Agent changed. Review the latest Agent before starting a conversation.'
  }
  if (reviewed.draftEpoch !== current.draftEpoch || reviewed.draft !== current.draft) {
    return 'Your draft changed while this was open. Review it before replacing it.'
  }
  actions.resetDraft()
  actions.selectAgent(current.agent!.id)
  actions.openDraft()
  return null
}
