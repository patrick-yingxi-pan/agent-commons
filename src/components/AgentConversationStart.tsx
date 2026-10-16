import { useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { keys, peek, useAgents } from '../api'
import type { Agent } from '../../contract/index.ts'
import { accountGeneration } from '../api/account'
import { DRAFT_ID } from '../data/liveSession'
import { conversations, useConversation } from '../controller/conversationStore'
import { draft } from '../controller/draftController'
import { isAgentMutationHeld, useAgentMutationStatus } from '../controller/agentMutations'
import { isAgentDeletionHeld, useAgentDeletionStatus } from '../controller/agentDeletionMutations'
import {
  agentConversationLaunchBlocked, hasAgentConversationDraft, launchAgentConversation,
  type AgentConversationLaunchSnapshot,
} from '../controller/agentConversationLaunchCore'
import { PageActionButton } from './PageActionButton'
import { ConfirmDialog } from './ConfirmDialog'

/** A page-local door into the ordinary first-send funnel, not a second create
 * path. Public directory definitions must first be forked into this account. */
export function AgentConversationStart({ agentId, onOpenSession }: {
  agentId: string
  onOpenSession: (sessionId: string) => void
}) {
  const agents = useAgents()
  useConversation(DRAFT_ID)
  useAgentMutationStatus()
  useAgentDeletionStatus()
  const [review, setReview] = useState<AgentConversationLaunchSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const snapshot = (): AgentConversationLaunchSnapshot => ({
    agent: peek<Agent[]>(keys.workerAgents)?.find((agent) => agent.id === agentId),
    registryReady: agents.status === 'success',
    mutationHeld: isAgentMutationHeld(agentId) || isAgentDeletionHeld(agentId),
    accountGeneration: accountGeneration(),
    draftEpoch: conversations.epoch(DRAFT_ID),
    draft: conversations.get(DRAFT_ID),
  })
  const blocked = agentConversationLaunchBlocked(snapshot())
  const launch = (selected: AgentConversationLaunchSnapshot) => {
    const failure = launchAgentConversation(selected, snapshot(), {
      resetDraft: () => draft.reset(),
      selectAgent: (id) => conversations.patch(DRAFT_ID, { draftBinding: { agentId: id } }),
      openDraft: () => onOpenSession(DRAFT_ID),
    })
    setReview(null)
    setError(failure)
  }
  const start = () => {
    const selected = snapshot()
    const failure = agentConversationLaunchBlocked(selected)
    setError(failure)
    if (failure) return
    if (hasAgentConversationDraft(selected)) setReview(selected)
    else launch(selected)
  }
  return <>
    <PageActionButton icon={<MessageSquarePlus size={14} />} onClick={start}
      disabled={!!blocked} title={blocked ?? 'Open a blank draft using this Agent. Nothing is sent until you send a message.'}>
      New conversation
    </PageActionButton>
    {error && <p role="alert" className="w-full text-[12px] text-danger-text">{error}</p>}
    {review && <ConfirmDialog title="Replace current draft?"
      body={`This replaces the shared unsent draft, including its message and attached context, with a blank conversation using “${review.agent!.label}”. Saved conversations are unchanged. Nothing is sent until you send a message.`}
      confirmLabel="Replace draft" onConfirm={() => launch(review)} onCancel={() => setReview(null)} />}
  </>
}
