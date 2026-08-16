import type { SectionId } from '../types'
import type { PaneSeed } from './paneNav.ts'
import { AGENT_SUBVIEWS } from './agentStructure.ts'

/** A section's sub-view — one child node in the rail's inline disclosure tree. `id` is
 *  the section's own switch key (a surface id), `label` is what the rail shows. */
export type SubView = { id: string; label: string }

/** ── What a rail child is allowed to be (owner directive, 2026-07-24) ────────
 *  A rail child is a **place**: a specific entity with its own page, or one of
 *  YOUR standing collections. A partition of a section's list by a property of
 *  its items — kind, state, ownership — is a **filter**, and a filter's one
 *  home is the section row's "Filter & sort" menu (`./sectionFilter.ts`), the
 *  same primitive the Scheduled tree row and Recents pane use.
 *
 *  So the rail has exactly two kinds of child, and this registry holds only the
 *  first:
 *
 *  1. **Declared surfaces** — this file. A hub whose children are genuinely
 *     distinct PAGES (the Agents composite's structural sections and resources;
 *     the maintainer console's Organizations / Credentials / Audit / Ops), and
 *     the Commons' standing lenses, which are the viewer's own collections
 *     (what you watch / liked / posted / opened) rather than a slice of the
 *     feed's content. The section row itself is each hub's default surface, so
 *     that surface is never re-listed as a child.
 *  2. **Instances** — NOT here, because they are live data, not a registry: a
 *     content section expands to the rows of the very list its page renders,
 *     ordered by that section's stored filter, with a tail row for the rest.
 *     A collection whose main page gives those rows structural headings keeps
 *     that intermediate level through `./collectionSections.ts`; this registry
 *     still names the canonical leaf key. The rail and page compute both the
 *     list and any grouping through ONE function each.
 *  3. **Standing doors** — also not here, and there is exactly one:
 *     the Commons' **Your profile** (`OwnerProfileChild`, 2026-08-09). Both
 *     kinds above address a place INSIDE the section's URL grammar
 *     (`/:section/:subview`, `/:section/:id`). A standing door is a fixed child
 *     whose place already has its own canonical address — here `/u/:name`, the
 *     namespace profile every byline in the app opens. Registering it as a
 *     sub-view would mint `/commons/profile` as a SECOND address for a page
 *     that has one, and one page ⇒ one URL is the rule this rail's navigation
 *     is built on. So the row renders beside the lenses and routes through the
 *     one owner door (`useRelations().openOwner`) like every other name in the
 *     product. It is still a PLACE, so the directive above is satisfied — what
 *     differs is only whose grammar its address belongs to.
 *
 *  Deliberately pure (only a type-only import), so `tests/` can import the
 *  registry without pulling the UI's icon deps. */
export const SECTION_SUBVIEWS: Partial<Record<SectionId, SubView[]>> = {
  // The Commons' standing LENSES (owner request, 2026-07-24: "add sub-entries
  // that filter contents … this helps the user find things"). They are children
  // rather than filter-menu options because they are not a partition of the
  // feed's content — they are the VIEWER's own collections, each a place you go
  // back to (GitHub's Watching / Stars / Yours, YouTube's Subscriptions /
  // Liked / History). The feed's own partition — shares vs landings — is a
  // property of the items, so it lives in the filter menu like every other.
  // Every one is backed by a server-stamped, viewer-relative field on
  // `CommonsItem`; nothing here is derived client-side.
  commons: [
    // S7 — the fifth lens, and the only one keyed on WHO ACTED rather than on
    // the subject. Following someone has to deliver something or it is a dead
    // affordance; this is what it delivers (and deliberately all it delivers —
    // a followee's publishes reach this lens, never a bell).
    { id: 'following', label: 'Following' },
    { id: 'watched', label: 'Watched' },
    { id: 'liked', label: 'Liked' },
    { id: 'posted', label: 'Posted' },
    { id: 'viewed', label: 'Recently viewed' },
  ],
  // Agents is a real composite: the root is its overview, and this flattened
  // address registry is derived from the nested hierarchy the rail renders.
  // Runtime agent / prompt / tool leaves live below these declared pages.
  agents: AGENT_SUBVIEWS,
  // The maintainer console's children are its SURFACES (like the Agents hub) —
  // the section row itself opens Accounts (the default), so it isn't re-listed.
  admin: [
    { id: 'orgs', label: 'Organizations' },
    { id: 'credentials', label: 'Credentials' },
    { id: 'audit', label: 'Audit' },
    { id: 'ops', label: 'Ops' },
  ],
}

/** The second kind of child: which detail id a content section's INSTANCE rows
 *  address. One entry per section whose rail children are its own rows — and
 *  the entry is exactly the `PaneSeed` key that opens one, so "the rail can
 *  list it" and "a row of it is addressable" are the same fact rather than two
 *  lists that can disagree. A section here must NOT also appear in
 *  `SECTION_SUBVIEWS`: a tree row has one kind of child, not two. */
export const SECTION_INSTANCE_KEY: Partial<Record<SectionId, keyof PaneSeed>> = {
  projects: 'projectId',
  artifacts: 'artifactId',
  contexts: 'contextId',
  models: 'providerId',
  scheduled: 'scheduleId',
  discussions: 'discussionId',
}

/** How many instance rows the rail shows before folding the rest behind one
 *  "Show all — N more" row, which UNFOLDS them in place (owner directive,
 *  2026-07-31 — the rail is a disclosure tree, so the tail is one more
 *  disclosure, never a jump to another page; "Show fewer" folds it back). */
export const RAIL_INSTANCE_CAP = 8
