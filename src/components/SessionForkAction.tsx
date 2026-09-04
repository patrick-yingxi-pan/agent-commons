import { GitFork } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSession, useSocialCapability } from '../api'
import { accountGeneration } from '../api/account.ts'
import { DRAFT_ID } from '../data/liveSession'
import { HOVER_REVEAL } from '../lib/hoverReveal'

/** Deferred turn-level branch control. Conversation reading stays in the initial
 * bundle; the uncommon write/recovery workflow loads only when its source row
 * renders, and its controller stays lazy until activation. */
export function SessionForkAction({
  sessionId,
  messageId,
  tenantId,
  onOpenSession,
}: {
  sessionId: string
  messageId: string
  tenantId?: string
  onOpenSession?: (id: string) => void
}) {
  const canPropose = useSocialCapability('session', sessionId, sessionId !== DRAFT_ID).data?.canPropose === true
  const own = useSession(sessionId === DRAFT_ID ? '' : sessionId).data?.own
  const [error, setError] = useState<string | null>(null)
  const [held, setHeld] = useState(false)
  const activation = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  if (!canPropose || own === true || !tenantId || !onOpenSession) return null

  const run = async (): Promise<void> => {
    if (held || activation.current) return
    activation.current = true
    const issuedGeneration = accountGeneration()
    setHeld(true)
    setError(null)
    try {
      const { enqueueSessionFork } = await import('../controller/sessionForkMutations.ts')
      if (issuedGeneration !== accountGeneration()) return
      const result = await enqueueSessionFork({
        tenantId,
        sourceSessionId: sessionId,
        atMessageId: messageId,
      })
      if (result.outcome === 'applied' && mounted.current) onOpenSession(result.sessionId)
      else if (result.outcome === 'discarded' && mounted.current) {
        setError('The conversation wasn’t continued. Review this turn and try again.')
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not continue from this turn.')
    } finally {
      activation.current = false
      if (mounted.current) setHeld(false)
    }
  }

  return (
    <span className="flex flex-col items-start">
      <button
        onClick={() => void run()}
        disabled={held}
        aria-busy={held || undefined}
        title={held ? 'Waiting for this conversation branch to be confirmed' : 'Continue from here'}
        className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-panel-2 hover:text-ink focus-visible:opacity-100 disabled:cursor-wait disabled:opacity-60 ${HOVER_REVEAL}`}
      >
        <GitFork size={12} />
        {held ? 'Continuing…' : 'Continue from here'}
      </button>
      {error && <span role="alert" className="mt-1 text-[11px] text-danger">{error}</span>}
    </span>
  )
}
