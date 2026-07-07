/** ── Contract: watching + the notification inbox (docs/agent-commons.md, D24) ──
 *  A tenant may WATCH any Project it can see; the platform keeps a persisted,
 *  per-tenant inbox of public acts — the GitHub bell. Notifications are minted at
 *  act time and fanned out to the Project's watchers, its owner, and the item's
 *  poster, minus the actor. Every field is public-face (display names, never raw
 *  foreign tenant ids); a notification never tells you something the walls
 *  wouldn't show you if you went looking. */

export type NotificationKind =
  | 'work.posted'
  | 'work.resolved'
  | 'work.commented'
  | 'work.retracted'
  | 'agent.forked'
  // D25 — the definition-evolution loop: an opened proposal rings the owner;
  // the merge/decline rings the proposer.
  | 'proposal.opened'
  | 'proposal.merged'
  | 'proposal.declined'
  // D27 — a comment on the proposal thread rings the OTHER party.
  | 'proposal.commented'
  // D29 — a work-item comment named you with `@<display name>`. Minted only on a
  // SHARED project (naming an outsider on a private one would leak its existence);
  // points at the item, like the other `work.*` kinds.
  | 'mentioned'

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
  /** The forked definition (`agent.forked`) — the SOURCE agent's id + label. */
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
