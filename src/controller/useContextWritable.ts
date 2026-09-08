import { useSession } from '../api/hooks'
import { DRAFT_ID } from '../data/liveSession'

/** Context authority is session ownership, never the viewer's share tier.
 * Unknown rows fail closed; drafts remain local and writable. */
export function useContextWritable(sessionId?: string): boolean {
  const draft = !sessionId || sessionId === DRAFT_ID
  const session = useSession(draft ? '' : sessionId).data
  return draft || (!!session && session.own !== false)
}
