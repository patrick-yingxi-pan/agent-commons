/** ── The public-face byline (shared-surface UI model) ────────────────────────
 *  One source for the owner label every cross-tenant surface shows — "by Ada Lab
 *  (you)" — so the directory cards, the project page, and the agent detail can't
 *  drift apart (form follows function; locked by tests/public-face.test.ts, which
 *  fails if a component hand-rolls the label). The model this cue serves: **the
 *  entity page is the shared surface — capability shapes affordances, not
 *  location** (AGENTS.md design decisions). */

/** The public owner label. `own` marks the viewer's own row ("(you)"), mirroring
 *  the D17 directory entries' `own` flag and the projection's `Project.own`. */
export function bylineLabel(ownerName: string | undefined, own: boolean | undefined): string {
  return `by ${ownerName ?? 'this workspace'}${own ? ' (you)' : ''}`
}

/** The shared-entity marker text — pairs with the Globe cue in the Byline
 *  component. Exported so the lock test can assert no component re-hardcodes it. */
export const SHARED_MARKER = 'Shared · '

/** The workspace-profile page title (D21) — the display name, with the same
 *  "(you)" cue the byline uses when the viewer IS this workspace. Minted here so
 *  the page can't drift from the byline's own-marker (the lock greps for a
 *  hand-rolled "(you)" in components). */
export function profileTitle(name: string, own: boolean | undefined): string {
  return own ? `${name} (you)` : name
}

/** The profile page's one-line subtitle — what the page IS: the aggregation of a
 *  workspace's already-public rows, identical for every viewer (D21). */
export const PROFILE_TAGLINE = 'Public workspace profile — everything this workspace shares.'

/** ── The agent-actor cue (FWD-5 Phase 3 — agents as principals) ──────────────
 *  Wherever an act's WHO is a worker AGENT (a resolution's credit line, a
 *  comment whose `authorKind` is 'agent'), the byline wears the Bot badge and
 *  this tooltip — one funnel (<AgentActor> / <ActorByline>), so a human actor
 *  (an owner DOOR) and a machine actor (a badge, no profile page of its own —
 *  its OWNER has the page) can never be confused or hand-rolled apart. */
export const AGENT_ACTOR_TITLE = 'A worker Agent performed this act — its owner’s namespace holds the public record'

/** The agent-actor label. Absent = an unattributed legacy row. */
export function agentActorLabel(label: string | undefined): string {
  return label ?? 'a contributor'
}
