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
