import { useSession } from '../api/hooks'
import { DRAFT_ID } from '../data/liveSession'
import { useConversation } from './conversationStore'

/** Context authority is session ownership, never the viewer's share tier.
 * Unknown rows fail closed; drafts remain local and writable. */
export function useContextWritable(sessionId?: string): boolean {
  const draft = !sessionId || sessionId === DRAFT_ID
  const { busy } = useConversation(sessionId || DRAFT_ID)
  const session = useSession(draft ? '' : sessionId).data
  // The first send is moving this draft into a real conversation. Keep its
  // reviewed input stable until adoption; later turns can edit next-turn context.
  return draft ? !busy : (!!session && session.own !== false)
}
