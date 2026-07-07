import { useRef } from 'react'
import { AtSign, Award, Bell, GitMerge, GitPullRequest, Hammer, ListChecks, MessageSquare, XCircle, type LucideIcon } from 'lucide-react'
import type { AppNotification, NotificationKind } from '../../contract/index.ts'
import type { SectionId } from '../types'
import { useFocusTrap } from '../lib/useFocusTrap'
import { SCRIM_CLASS } from '../lib/scrim'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { relativeTime } from '../lib/relativeTime'
import { doorFor } from '../lib/notificationDoor'
import { useNotifications, markNotificationsRead, useAgents } from '../api'

const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  'work.posted': ListChecks,
  'work.resolved': Hammer,
  'work.commented': MessageSquare,
  'work.retracted': XCircle,
  'agent.forked': Award,
  'proposal.opened': GitPullRequest,
  'proposal.merged': GitMerge,
  'proposal.declined': XCircle,
  'proposal.commented': MessageSquare,
  mentioned: AtSign,
}

/** The row's one-line sentence — actor + verb + object (all public-face fields). */
function describe(n: AppNotification): string {
  switch (n.kind) {
    case 'work.posted':
      return `${n.actor} posted “${n.subGoal}” on ${n.projectName}`
    case 'work.resolved':
      return `${n.actor} resolved “${n.subGoal}” on ${n.projectName}`
    case 'work.commented':
      return `${n.actor} commented on “${n.subGoal}” (${n.projectName})`
    case 'work.retracted':
      return `${n.actor} retracted “${n.subGoal}” on ${n.projectName}`
    case 'agent.forked':
      return `${n.actor} forked your agent “${n.agentLabel}”`
    case 'proposal.opened':
      return `${n.actor} proposed a change to “${n.agentLabel}”`
    case 'proposal.merged':
      return `${n.actor} merged your proposal into “${n.agentLabel}”`
    case 'proposal.declined':
      return `${n.actor} declined your proposal on “${n.agentLabel}”`
    case 'proposal.commented':
      return `${n.actor} commented on a proposal on “${n.agentLabel}”`
    case 'mentioned':
      return `${n.actor} mentioned you on “${n.subGoal}” (${n.projectName})`
  }
}

/** ── The notification inbox (docs/agent-commons.md, D24) ─────────────────────
 *  The GitHub bell: what happened to what you watch, own, or posted — while you
 *  weren't looking. Every row is a DOOR that lands on the EXACT place its act
 *  happened (docs/notification-routing.md): `doorFor` maps the kind to a nav intent
 *  the controller dispatches — the work item's thread, the proposal under review,
 *  the source agent — and clicking marks it read. "Mark all read" settles the badge.
 *  Overlay chrome mirrors the search palette (one dialog family). */
export function NotificationsPanel({
  onOpenProject,
  onOpenSection,
  onOpenWorkItem,
  onOpenProposal,
  onOpenAgent,
  onOpenOwner,
  onClose,
}: {
  onOpenProject: (id: string) => void
  onOpenSection: (s: SectionId) => void
  onOpenWorkItem: (projectId: string, workItemId: string, commentId?: string) => void
  onOpenProposal: (agentId: string, proposalId: string, ownerName: string | null) => void
  onOpenAgent: (agentId: string) => void
  onOpenOwner: (name: string) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const rows = useNotifications().data ?? []
  // My own agent registry — resolves whether a proposal bell lands on MY review
  // queue (I own the agent) or the owner's public profile (I'm the proposer).
  const myAgents = useAgents().data ?? []
  const unread = rows.filter((r) => !r.read).length
  useFocusTrap(dialogRef, onClose)

  const open = (n: AppNotification) => {
    if (!n.read) void markNotificationsRead([n.id])
    const intent = doorFor(n)
    switch (intent.kind) {
      case 'workItem':
        onOpenWorkItem(intent.projectId, intent.workItemId, intent.commentId)
        break
      case 'project':
        onOpenProject(intent.projectId)
        break
      case 'proposal': {
        const iOwn = myAgents.some((a) => a.id === intent.agentId)
        onOpenProposal(intent.agentId, intent.proposalId, iOwn ? null : n.actor)
        break
      }
      case 'agent': {
        // A proposal.* bell whose id predates R2 (no proposalId) degrades to this
        // coarse 'agent' door. It still belongs to the PROPOSER when they don't own
        // the agent → the owner's profile (n.actor), where "Your proposals" lives —
        // not the caller's own hub. A fork bell always rings the owner (who owns the
        // source), so it lands on the hub.
        const iOwn = myAgents.some((a) => a.id === intent.agentId)
        if (!iOwn && n.kind.startsWith('proposal.')) onOpenOwner(n.actor)
        else onOpenAgent(intent.agentId)
        break
      }
      case 'section':
        onOpenSection(intent.section)
        break
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[12dvh] short:pt-[6dvh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
    >
      <div className={`${SCRIM_CLASS} backdrop-blur-[1px]`} />
      <div
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex max-h-[68dvh] w-[480px] max-w-full flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-line-strong short:max-h-[85dvh]"
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-3.5 py-2.5">
          <Bell size={16} className="shrink-0 text-ink-faint" />
          <span className="flex-1 text-[14px] font-semibold text-ink">Notifications</span>
          {unread > 0 && (
            <button onClick={() => void markNotificationsRead()} className={INLINE_ACTION_CLASS}>
              Mark all read
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-ink-faint">
              Nothing yet — watch a project (or share one) and its public acts land here.
            </div>
          ) : (
            rows.map((n) => {
              const Icon = KIND_ICON[n.kind]
              return (
                <button
                  key={n.id}
                  onClick={() => open(n)}
                  className="flex w-full items-start gap-3 px-3.5 py-2 text-left transition hover:bg-panel-2"
                >
                  <Icon size={15} className={`mt-0.5 shrink-0 ${n.read ? 'text-ink-faint' : 'text-accent-strong'}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] leading-snug ${n.read ? 'text-ink-soft' : 'font-medium text-ink'}`}>
                      {describe(n)}
                    </span>
                    <span className="block text-[11px] text-ink-faint">{relativeTime(n.at)}</span>
                  </span>
                  {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
