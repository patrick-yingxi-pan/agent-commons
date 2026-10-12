import { motion } from 'framer-motion'
import { lazy, Suspense, useRef } from 'react'
import { ArrowRight, Check, Radio } from 'lucide-react'
import type { EscalationProposal, Message as MessageT } from '../types'
import { renderRich } from '../lib/rich'
import { driverByline } from '../lib/driverByline'
import { FOCUS_FLASH_CLASS, useFocusFlash, usePendingFocus } from '../lib/focusContext'
import { useAgents, useProviders } from '../api'
import { useRelations } from '../controller/useRelations'
import { ClaudeMark } from './ClaudeMark'
import { DeferredRelationActionCard as RelationActionCard } from './DeferredRelationActionCard'
import { DeferredToolActivityCard } from './DeferredToolActivityCard'
import { LocusGutter } from './LocusGutter'
import { DRAFT_ID } from '../data/liveSession'

const ConversationSummary = lazy(() => import('./ConversationSummary'))
const SessionForkAction = lazy(() =>
  import('./SessionForkAction.tsx').then((module) => ({ default: module.SessionForkAction })),
)

/** Whether this turn's cognition came over a Session provider — the
 *  delegated-cognition relay. Those words came from the user's OWN session's model,
 *  not an endpoint we dialed, and the reply is marked as such (external/untrusted
 *  provenance, docs/delegated-cognition-provider.md §5). Reads the per-turn
 *  provider stamp (`message.providerId` — how the turn actually routed, session
 *  pick included); legacy messages without one fall back to the driving Agent's
 *  provider. */
function useIsRelayed(message: MessageT): boolean {
  const agents = useAgents().data ?? []
  const providers = useProviders().data ?? []
  const providerId =
    message.providerId ??
    (message.agentId ? agents.find((a) => a.id === message.agentId)?.providerId : undefined)
  return !!providerId && providers.find((p) => p.id === providerId)?.kind === 'session'
}

/** The applied face of a persisted escalation proposal (today: `create_project`)
 *  — a confirmed line with a JUMP LINK, derived from the record (the project
 *  exists in the graph), so it survives reloads exactly like the pending card
 *  (C28) does. Approval deliberately does NOT navigate: being yanked to the
 *  project page mid-conversation broke the flow, so the link waits here to be
 *  followed at will (the same "View in …" shape the relation card uses — form
 *  follows function). Renders nothing while the proposal is pending (the inline
 *  consent prompt owns that state) or for panel escalations, whose approval is
 *  already visible in place (the panel opens). */
function EscalationOutcome({ escalation }: { escalation: EscalationProposal }) {
  const { isCreatedProject, navigate } = useRelations()
  if (escalation.kind !== 'project' || !isCreatedProject(escalation.project.id)) return null
  return (
    <div className="mt-2 flex items-center gap-2 text-[12px]">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ok-tint text-ok-strong">
        <Check size={12} />
      </span>
      <span className="font-medium text-ink">Created the {escalation.project.name} project</span>
      <button
        onClick={() => navigate('projects', escalation.project.id)}
        className="inline-flex items-center gap-1 font-medium text-accent-strong transition hover:gap-1.5"
      >
        Open project
        <ArrowRight size={13} />
      </button>
    </div>
  )
}

function TurnMessageRow({
  message,
  sessionId,
  tenantId,
  onOpenSession,
}: {
  message: MessageT
  sessionId: string
  tenantId?: string
  onOpenSession?: (id: string) => void
}) {
  const relayed = useIsRelayed(message)
  // A turn is an ADDRESSABLE position (SOCIAL-6b): a discussion can anchor to
  // it, and the chip on that thread doors back here. Reading `pending` at
  // render is deliberate — `useFocusFlash` consumes it in the same effect that
  // lights the flash, so a later read would already be null.
  const { pending } = usePendingFocus()
  const rowRef = useRef<HTMLDivElement>(null)
  const flash = useFocusFlash(pending?.messageId === message.id, rowRef)
  // S5 — the byline is the Agent that DROVE this turn (per-turn provenance), so a D16
  // hand-off is visible; the default agent / a user turn / a legacy message read 'Claude'.
  const byline = driverByline(message.agentId, useAgents().data ?? [])
  const isUser = message.role === 'user'
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      ref={rowRef}
      // A turn is an addressable position, so the row is addressable in the DOM
      // too — the anchor an E2E uses to assert a locus door LANDED here (the
      // `data-session-title-bar` idiom).
      data-turn={message.id}
      // The flash rides the FULL-WIDTH row, outside `max-w-3xl`, so lighting a
      // turn can't shift the thread's measure by a pixel — message text stays
      // aligned with the composer below it.
      className={`group px-4 py-3 transition ${flash ? FOCUS_FLASH_CLASS : ''}`}
    >
      <div className="mx-auto flex w-full max-w-3xl gap-3">
        <div className="mt-0.5 shrink-0">
          {isUser ? (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-userbubble text-[12px] font-semibold text-ink-soft">
              P
            </div>
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-tint">
              <ClaudeMark size={16} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-ink-soft">
            {isUser ? 'You' : byline}
            {!isUser && relayed && (
              <span
                title="This reply was generated by your own delegated session (a Session provider), not an endpoint we dialed."
                className="inline-flex items-center gap-1 rounded bg-panel-2 px-1.5 py-px text-[10px] font-medium text-ink-faint"
              >
                <Radio size={10} />
                via your delegated session
              </span>
            )}
          </div>
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
            {renderRich(message.content)}
          </div>
          {message.toolActivities && message.toolActivities.length > 0 && (
            <DeferredToolActivityCard activities={message.toolActivities} sessionId={sessionId} />
          )}
          {message.escalation && <EscalationOutcome escalation={message.escalation} />}
          {message.relationActions && message.relationActions.length > 0 && (
            <RelationActionCard
              ops={message.relationActions}
              sessionId={sessionId}
              messageId={message.id}
              resolved={message.relationsResolved}
            />
          )}
          {/* A turn is an addressable POSITION: the gutter mints a
              `session-turn` locus here. An unsent draft has no server-side
              session to anchor to, so it gets none. */}
          <LocusGutter
            subject={{ kind: 'session', id: sessionId }}
            locus={{ kind: 'session-turn', messageId: message.id }}
            noun="turn"
            action={(
              <Suspense fallback={null}>
                <SessionForkAction
                  sessionId={sessionId}
                  messageId={message.id}
                  tenantId={tenantId}
                  onOpenSession={onOpenSession}
                />
              </Suspense>
            )}
            enabled={sessionId !== DRAFT_ID}
          />
        </div>
      </div>
    </motion.div>
  )
}

export function MessageRow(props: {
  message: MessageT
  sessionId: string
  tenantId?: string
  onOpenSession?: (id: string) => void
}) {
  return props.message.compactedFrom ? (
    <Suspense fallback={<div role="status" className="px-4 py-3 text-center text-[12px] text-ink-faint">Loading conversation summary…</div>}>
      <ConversationSummary message={props.message} sessionId={props.sessionId} />
    </Suspense>
  ) : <TurnMessageRow {...props} />
}

/** The in-flight indicator. `waitingOn` swaps the token-streaming shimmer for an
 *  honest caption — a Session provider's reply arrives whole when the far session
 *  answers (no token streaming in v1 is structural, design §7.8), so the UI says
 *  who it's waiting on instead of pretending to stream. */
export function TypingRow({ waitingOn }: { waitingOn?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="px-4 py-3"
    >
      <div className="mx-auto flex w-full max-w-3xl gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint">
          <ClaudeMark size={16} />
        </div>
        <div className="flex items-center gap-1.5 pt-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="thinking-dot h-1.5 w-1.5 rounded-full bg-ink-faint"
              style={{ animationDelay: `${i * 0.16}s` }}
            />
          ))}
          {waitingOn && <span className="pl-1 text-[12px] text-ink-faint">{waitingOn}</span>}
        </div>
      </div>
    </motion.div>
  )
}
