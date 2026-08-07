/** ── Notification doors (docs/notification-routing.md) ───────────────────────
 *  Every inbox row is a DOOR: clicking it must land on the EXACT place its act
 *  happened — the work item's thread, the proposal under review — not a coarse
 *  section the recipient then has to search. `doorFor` maps a notification to a
 *  `NavIntent` (where to go + the sub-entity to focus on arrival); it is TOTAL over
 *  `NotificationKind` (the `never` default fails the build if a kind gains no door).
 *  The controller turns a NavIntent into navigation + a `FocusTarget`; the
 *  destination page consumes the focus (scroll · highlight · expand the thread).
 *
 *  Every id here is public-face — a work item / proposal / comment the recipient may
 *  already see — never a tenant id (the D24 leak-wall). A row that predates the R2 id
 *  fields degrades to the page (then the section), so a bell is never a dead click. */
import type { AppNotification } from '../../contract/index.ts'
import type { SectionId } from '../types'

/** The transient "highlight this on arrival" intent. Deliberately NOT part of
 *  `NavLocation` (which is page identity): keeping focus out of navigation identity
 *  means Back never re-fires a highlight, and two arrivals at one page from different
 *  bells aren't counted as different pages. The controller holds one pending target
 *  and the destination page consumes it once. */
export interface FocusTarget {
  projectId?: string
  workItemId?: string
  agentId?: string
  proposalId?: string
  /** Anchor a specific comment inside the thread (the platform's `#issuecomment-N`). */
  commentId?: string
  /** One TURN inside a conversation — what a `session-turn` anchor locus
   *  resolves to (`src/lib/anchorLocus.ts`, SOCIAL-6b). The same transient
   *  contract as the fields above: the matching `MessageRow` scrolls to itself,
   *  flashes, and consumes it. */
  messageId?: string
  /** One RUN inside a routine — what a `schedule-run` anchor locus resolves to
   *  (`src/lib/anchorLocus.ts`). Same transient contract: the matching run row
   *  scrolls to itself, flashes, and consumes it. */
  runId?: string
}

/** Where a door leads. The precise variants carry the focus; the fallbacks (a legacy
 *  row missing its id, or a kind with no sub-entity) land on the page, then section —
 *  always somewhere, never a no-op. */
export type NavIntent =
  | { kind: 'workItem'; projectId: string; workItemId: string; commentId?: string }
  | { kind: 'project'; projectId: string }
  // No commentId: a proposal's thread renders open in both review surfaces (a short
  // two-party conversation), so the per-comment anchor — a work-item affordance where
  // threads collapse — carried no value on this path.
  | { kind: 'proposal'; agentId: string; proposalId: string }
  | { kind: 'agent'; agentId: string }
  /** A discussion's own page (`social.discussed`) — the thread IS the target,
   *  so this door needs no in-page focus: the post is on the page it opens. */
  | { kind: 'discussion'; discussionId: string }
  /** A workspace's public profile (`social.followed`, S7) — a follow is an act
   *  about a PERSON, and the profile is the only page a person has. */
  | { kind: 'owner'; ownerName: string }
  | { kind: 'section'; section: SectionId }

/** The door for one notification — total over `NotificationKind`. */
export function doorFor(n: AppNotification): NavIntent {
  switch (n.kind) {
    // Work-item lifecycle + @mention → the item's thread on the project page.
    case 'work.posted':
    case 'work.resolved':
    case 'work.commented':
    case 'work.retracted':
    case 'mentioned':
      if (n.projectId && n.workItemId)
        return { kind: 'workItem', projectId: n.projectId, workItemId: n.workItemId, commentId: n.commentId }
      if (n.projectId) return { kind: 'project', projectId: n.projectId }
      return { kind: 'section', section: 'projects' }
    // Change-proposal lifecycle → the proposal on the agent's review surface.
    case 'proposal.opened':
    case 'proposal.merged':
    case 'proposal.declined':
    case 'proposal.commented':
      if (n.agentId && n.proposalId)
        return { kind: 'proposal', agentId: n.agentId, proposalId: n.proposalId }
      if (n.agentId) return { kind: 'agent', agentId: n.agentId }
      return { kind: 'section', section: 'agents' }
    // Social layer (S5): the door is the SUBJECT — a project subject lands on
    // its page (where the Sharing/Discussion/Improvements sections live); other
    // kinds land on their section (sessions, which have none, fall back to the
    // Commons — the feed carries the share). Slice-1 mapping, recorded in the
    // design ledger; per-kind deep doors arrive with their surfaces.
    // A post lands on the THREAD's own page, not its subject's — that page is
    // where the post actually is, and it carries the anchor chip back to the
    // subject (or, for a turn-anchored thread, to the exact turn). The deepest
    // door of any social kind, because discussions are the one social noun with
    // a page of their own.
    case 'social.discussed':
      if (n.discussionId) return { kind: 'discussion', discussionId: n.discussionId }
      return { kind: 'section', section: 'discussions' }
    // S7 — a DM lands on the thread, like every other discussion kind; its
    // fallback is the INBOX rather than the discussions hub, because that is
    // where the server lists it (a DM is deliberately in exactly one of the
    // two, so the door has to agree with the list).
    case 'social.messaged':
      if (n.discussionId) return { kind: 'discussion', discussionId: n.discussionId }
      return { kind: 'section', section: 'messages' }
    // A new follower → their profile, the only page the act is ABOUT. (`actor`
    // is the public display name, which is exactly the profile handle.)
    case 'social.followed':
      return { kind: 'owner', ownerName: n.actor }
    // A fork lands on YOUR conversation, never on their copy — the D24 leak-wall
    // (their fork is a private session of theirs, exactly as `agent.forked` sends
    // the owner to the source and never to the fork).
    case 'social.forked':
    case 'social.shared':
    case 'social.offered':
    case 'social.landed':
    case 'social.declined':
    case 'social.reported': {
      if (n.subjectKind === 'project' && n.subjectId) return { kind: 'project', projectId: n.subjectId }
      const section: SectionId =
        n.subjectKind === 'schedule' ? 'scheduled'
        : n.subjectKind === 'context' ? 'contexts'
        : n.subjectKind === 'discussion' ? 'discussions'
        : 'commons'
      return { kind: 'section', section }
    }
    // A fork → the SOURCE agent the recipient owns (never the fork: a private agent
    // of the forker the source owner may not see — the leak-wall).
    case 'agent.forked':
      if (n.agentId) return { kind: 'agent', agentId: n.agentId }
      return { kind: 'section', section: 'agents' }
    default:
      return assertNever(n.kind)
  }
}

/** Compile-time exhaustiveness: a new `NotificationKind` with no `case` above leaves
 *  `n.kind` wider than `never` here and fails the build. At runtime (a persisted row
 *  of some unknown future kind) it degrades to a section rather than throwing. */
function assertNever(kind: never): NavIntent {
  void kind
  return { kind: 'section', section: 'agents' }
}
