import type { SectionId } from '../types'
import type { PaneSeed } from './paneNav.ts'

/** A section's sub-view — one child node in the rail's inline disclosure tree. `id` is
 *  the section's own switch key (a surface id), `label` is what the rail shows. */
export type SubView = { id: string; label: string }

/** ── What a rail child is allowed to be (owner directive, 2026-07-24) ────────
 *  A rail child is a **place**: a specific entity with its own page, or one of
 *  YOUR standing collections. A partition of a section's list by a property of
 *  its items — kind, state, ownership — is a **filter**, and a filter's one
 *  home is the section row's "Filter & sort" menu (`./sectionFilter.ts`), the
 *  same primitive the Scheduled and Recents panes already use.
 *
 *  So the rail has exactly two kinds of child, and this registry holds only the
 *  first:
 *
 *  1. **Declared surfaces** — this file. A hub whose children are genuinely
 *     distinct PAGES (the Agents hub's Prompts / Commissions / Discover / Audit;
 *     the maintainer console's Organizations / Credentials / Audit / Ops), and
 *     the Commons' standing lenses, which are the viewer's own collections
 *     (what you watch / liked / posted / opened) rather than a slice of the
 *     feed's content. The section row itself is each hub's default surface, so
 *     that surface is never re-listed as a child.
 *  2. **Instances** — NOT here, because they are live data, not a registry: a
 *     content section (Projects, Artifacts, Contexts, Models, Discussions)
 *     expands to the top rows of the very list its page renders, ordered by
 *     that section's stored filter, with a tail row for the rest. The rail and
 *     the page compute that list with ONE function (`./sectionLists.ts`).
 *
 *  Scheduled is in neither: its instances already have their own rail pane
 *  (routines, with their own "Filter & sort"), and a second copy of them under
 *  the tree row would be the same list twice in one rail. Its section page
 *  reads that pane's filter, so the partition still has exactly one control.
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
    { id: 'watched', label: 'Watched' },
    { id: 'liked', label: 'Liked' },
    { id: 'posted', label: 'Posted' },
    { id: 'viewed', label: 'Recently viewed' },
  ],
  // The Agents hub's children are its NON-default *surfaces* — the section row itself
  // opens the worker-agents list (the default), so listing "Agents" again as a child
  // would duplicate it.
  agents: [
    { id: 'work', label: 'Your work' },
    { id: 'prompts', label: 'Prompts' },
    { id: 'commissions', label: 'Commissions' },
    { id: 'discover', label: 'Discover' },
    { id: 'audit', label: 'Audit' },
  ],
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
  discussions: 'discussionId',
}

/** How many instance rows the rail shows before folding the rest into one
 *  "Show all N" row (which opens the section page — the surface built to hold
 *  them all, with its own search). The rail is navigation, not an inventory. */
export const RAIL_INSTANCE_CAP = 8
