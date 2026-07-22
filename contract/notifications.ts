/** ── Contract: watching + the notification inbox (docs/agent-commons.md, D24) ──
 *  A tenant may WATCH any Project it can see; the platform keeps a persisted,
 *  per-tenant inbox of public acts — the GitHub bell. Notifications are minted at
 *  act time and fanned out to the Project's watchers, its owner, and the item's
 *  poster, minus the actor. Every field is public-face (display names, never raw
 *  foreign tenant ids); a notification never tells you something the walls
 *  wouldn't show you if you went looking. */

/** Every kind of inbox row, as a RUNTIME array — the source of truth the door
 *  switch (`src/lib/notificationDoor.ts`) and its exhaustiveness test enumerate, so
 *  adding a kind here forces a door for it (the switch's `never` default fails the
 *  build otherwise) and the test covers it. The type is derived from the array. */
export const NOTIFICATION_KINDS = [
  'work.posted',
  'work.resolved',
  'work.commented',
  'work.retracted',
  'agent.forked',
  // D25 — the definition-evolution loop: an opened proposal rings the owner;
  // the merge/decline rings the proposer.
  'proposal.opened',
  'proposal.merged',
  'proposal.declined',
  // D27 — a comment on the proposal thread rings the OTHER party.
  'proposal.commented',
  // D29 — a work-item comment named you with `@<display name>`. Minted only on a
  // SHARED project (naming an outsider on a private one would leak its existence);
  // points at the item, like the other `work.*` kinds.
  'mentioned',
  // Social layer (S5): a grant addressed you (the share ringing its audience);
  // an offered improvement rings the subject's owner; the land/decline verdict
  // rings the offerer — the D25 two-party loop generalized to the social nouns.
  'social.shared',
  'social.offered',
  'social.landed',
  'social.declined',
  // A post on a thread — rings the ANCHOR OWNER (someone is talking about your
  // thing) and every OTHER participant already in the thread (someone replied to
  // a conversation you're in), never the author. The `work.commented` /
  // `proposal.commented` shape generalized to the social nouns: without it the
  // share → discuss loop is one-way, since a comment is the one social act whose
  // subject nobody is otherwise told about.
  'social.discussed',
  // Someone CONTINUED your conversation from one of its turns into their own
  // namespace (S3). Public credit, exactly like `agent.forked` — the fork
  // changed nothing of yours, so this is news, not a decision.
  'social.forked',
  // S5 guardrails: a reader reported a post — rings the ANCHOR OWNER, who
  // holds the moderation delete (owner moderation; instance-level reports are
  // the S6 escalation).
  'social.reported',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** One inbox row ("App" prefix: the DOM has a `Notification`). */
export interface AppNotification {
  id: string
  kind: NotificationKind
  at: number
  read: boolean
  /** The acting workspace's display name (public identity). */
  actor: string
  /** The Project door (`work.*` kinds) — id + display name. */
  projectId?: string
  projectName?: string
  /** The work item's sub-goal (`work.*` kinds). */
  subGoal?: string
  /** The work item's id (`work.*` / `mentioned`) — the focus target the door lands
   *  ON inside the project page (scroll + highlight the row, expand its thread). A
   *  public id of a backlog the recipient may already see; never a tenant id. */
  workItemId?: string
  /** The change proposal's id (`proposal.*`) — the focus target inside the agent's
   *  review surface. A party-visible id, never a tenant id. */
  proposalId?: string
  /** A specific comment to anchor within a thread (`work.commented`, `mentioned`,
   *  `proposal.commented`) — the platform's `#issuecomment-N`. */
  commentId?: string
  /** The social subject (`social.*` kinds) — kind + public id + display face.
   *  The door lands on the subject's page (project subjects) or its section. */
  subjectKind?: string
  subjectId?: string
  subjectName?: string
  /** The thread a post landed in (`social.discussed`) — the door lands on the
   *  discussion's own page rather than its subject's, because that page is where
   *  the post actually is (and it carries the anchor chip back to the subject,
   *  or to the exact turn when the thread hangs on one). A party-visible id: the
   *  recipient can read the thread by construction — they own its anchor or are
   *  already in it. */
  discussionId?: string
  /** The forked definition (`agent.forked`) — the SOURCE agent's id + label. (The
   *  door lands on the source the recipient OWNS, never the fork — a private agent of
   *  the forker the source owner may not see: the D24 leak-wall.) */
  agentId?: string
  agentLabel?: string
}

/** Body of `POST /projects/:id/watch`. */
export interface SetWatchRequest {
  watching: boolean
}

/** `GET /projects/:id/watch` — the caller's watch state for one Project. */
export interface WatchState {
  watching: boolean
}

/** Body of `POST /notifications/read` — ids to mark read; omitted = all. */
export interface MarkNotificationsReadRequest {
  ids?: string[]
}

/** Per-tenant inbox cap — oldest evicted (the inbox is a pointer cache over acts
 *  that remain readable on their backlogs/profiles, not a second history). */
export const NOTIFICATION_CAP = 200
