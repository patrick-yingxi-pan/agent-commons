/** ── The inbox's ROW form (docs/notification-routing.md) ─────────────────────
 *  The sentence, the icon and the unread mark for one notification. Lives apart
 *  from the page that lists them (`NotificationsSection`) for the ordinary
 *  reason: the page owns the doors and the layout, this owns what a bell LOOKS
 *  like, and the kind→icon / kind→sentence maps below are total over
 *  `NotificationKind` — a new kind fails the build here rather than rendering
 *  blank. */
import { AlertTriangle, AtSign, Award, Bell, GitFork, GitMerge, GitPullRequest, Hammer, ListChecks, Mail, MessageSquare, MessagesSquare, Share2, Sparkles, UserPlus, XCircle, type LucideIcon } from 'lucide-react'
import type { AppNotification, NotificationKind } from '../../contract/index.ts'
import type { SectionId } from '../types'
import { relativeTime } from '../lib/relativeTime'
import { DOOR_CLASS } from '../lib/textDoor'
import { ROW_DOOR_CLASS, cardDoorClick } from '../lib/cardDoor'


const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  'schedule.failed': AlertTriangle,
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
  // Social layer (S5).
  'social.shared': Share2,
  'social.offered': Sparkles,
  'social.landed': GitMerge,
  'social.declined': XCircle,
  'social.discussed': MessagesSquare,
  'social.forked': GitFork,
  'social.reported': Bell,
  // The person layer (S7).
  'social.followed': UserPlus,
  'social.messaged': Mail,
  // The square (S8).
  'social.mentioned': AtSign,
  'social.replied': MessageSquare,
}

/** The row's one-line sentence — actor + verb + object (all public-face fields). */
function describe(n: AppNotification): string {
  switch (n.kind) {
    case 'schedule.failed':
      return `${n.actor} couldn’t complete “${n.scheduleName ?? 'Routine'}”`
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
    // Social layer (S5) — subjectName is the public display face.
    case 'social.shared':
      return `${n.actor} shared the ${n.subjectKind} “${n.subjectName}” with you`
    case 'social.offered':
      return `${n.actor} offered an improvement to “${n.subjectName}”`
    case 'social.landed':
      return `${n.actor} landed your improvement to “${n.subjectName}”`
    case 'social.declined':
      return `${n.actor} declined your improvement to “${n.subjectName}”`
    case 'social.discussed':
      return `${n.actor} posted in the discussion on “${n.subjectName}”`
    case 'social.forked':
      return `${n.actor} continued your conversation “${n.subjectName}” from one of its turns`
    case 'social.reported':
      return `${n.actor} reported a post on “${n.subjectName}” — you hold the delete`
    // The person layer (S7). Neither row names a subject: for a follow the
    // subject is YOU, and for a message the anchored name is the reader's own —
    // echoing either back would label the bell with the recipient.
    case 'social.followed':
      return `${n.actor} followed you`
    case 'social.messaged':
      return `${n.actor} sent you a message`
    // S8 — like the two above, this names no subject: the thing mentioned is
    // the reader, and echoing their own name back would label the bell with it.
    case 'social.mentioned':
      return `${n.actor} mentioned you`
    // Also nameless, and for the same reason: a post's subject is its author,
    // so naming it would label this bell with the reader's own name.
    case 'social.replied':
      return `${n.actor} replied to your post`
  }
}

/** Every door a bell can walk through. Taken as ONE bundle, not as seven
 *  handlers: these are the PUSHING flavour of the doors the rail uses
 *  (ADAPT-18 — a bell is an interruption, so back is the way home), and a
 *  per-prop wiring is exactly where one of them would quietly get the wrong
 *  flavour. */
export interface NotificationDoors {
  openSchedule: (scheduleId: string, runId?: string) => void
  openProject: (id: string) => void
  openSection: (s: SectionId) => void
  openWorkItem: (projectId: string, workItemId: string, commentId?: string) => void
  openProposal: (agentId: string, proposalId: string, ownerName: string | null) => void
  openAgent: (agentId: string) => void
  /** The thread page a `social.discussed` bell lands on. */
  openDiscussionPage: (discussionId: string) => void
  openOwner: (name: string) => void
}

/** One row of the inbox. A card door (UI-17): the SENTENCE is the keyboard door
 *  and the accessible name, the whole row is the mouse target. It used to be a
 *  single <button> wrapping everything — legal inside an overlay list, but as a
 *  page row that hands a screen reader the entire row (sentence + timestamp +
 *  "Unread") as one name. */
export type NotificationReadPhase = 'queued' | 'pending' | 'failed'

export function NotificationRow({
  row,
  onOpen,
  readPhase,
}: {
  row: AppNotification
  onOpen: () => void
  readPhase?: NotificationReadPhase
}) {
  const Icon = KIND_ICON[row.kind]
  const readLabel = readPhase === 'queued'
    ? 'Read update queued'
    : readPhase === 'pending'
      ? 'Marking read…'
      : readPhase === 'failed'
        ? 'Waiting for Retry'
        : null
  return (
    // The hosting FoldSection owns the horizontal inset (UI-30); this row owns
    // only its vertical rhythm, like every other CardList row under a rule.
    <div
      data-notification-row=""
      data-notification-row-read={readPhase}
      onClick={cardDoorClick(onOpen)}
      className={`flex items-start gap-3 py-3 ${ROW_DOOR_CLASS}`}
    >
      <Icon size={15} className={`mt-0.5 shrink-0 ${row.read ? 'text-ink-faint' : 'text-accent-strong'}`} />
      <div className="min-w-0 flex-1">
        <button
          onClick={onOpen}
          aria-busy={readPhase === 'pending' || undefined}
          className={`block max-w-full text-left text-[13px] leading-snug ${row.read ? 'text-ink-soft' : 'font-medium text-ink'} ${DOOR_CLASS}`}
        >
          {describe(row)}
        </button>
        <span className="mt-0.5 block text-[11px] text-ink-faint">
          {relativeTime(row.at)}{readLabel ? ` · ${readLabel}` : ''}
        </span>
      </div>
      {!row.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
    </div>
  )
}
