/** ── A content section's "Filter & sort" — where a facet lives now ───────────
 *  The rail tree used to BE the facet control: a section's children were its
 *  partitions (Projects → Yours / Shared, Artifacts → Documents / Images / …),
 *  and clicking one focused the page on that slice. Two rail panes right below
 *  it already did the opposite — Scheduled and Recents list the THINGS and put
 *  the partition behind a "Filter & sort" button — so the same rail carried two
 *  models, and the tree's model was the one that couldn't answer "which
 *  projects do I have?" without opening a page.
 *
 *  The rule now (owner directive, 2026-07-24; docs/ui-invariants.md UI-19):
 *
 *    A rail child is a PLACE — a specific entity with its own page, or one of
 *    your standing collections. A partition of the list by a property of its
 *    items (kind, state, ownership) is a FILTER, and a filter's one home is the
 *    section row's "Filter & sort" menu.
 *
 *  This module is that menu's vocabulary and its persistence. The facet ids are
 *  deliberately the SAME ids the rail tree used to carry, so the section bodies
 *  keep filtering on the value they always did — the control moved, the model
 *  didn't. Deliberately DOM-free and React-free (uiPrefs guards its localStorage
 *  access), so `tests/` can lock the catalog — and the stable snapshot at the
 *  foot of this file — without a browser; `./useSectionFilter.ts` is the thin
 *  React adapter over it. */
import type { SectionId } from '../types'
// Extension-qualified: this module is node-tested, and Node's native TS resolves
// runtime imports only with the explicit .ts.
import { getLayout, setLayout, subscribeLayout, uiPrefScope } from './uiPrefs.ts'

/** One option of a section's facet dimension. */
export interface SectionFacet {
  id: string
  label: string
}

/** How one section's menu is built: its single facet dimension (the partition
 *  the rail tree used to own) and its sort dimension. ONE facet per section —
 *  the rail-tree rule survives the move: a list is partitioned one way, and a
 *  second axis would be two answers to "which slice am I looking at". */
export interface SectionFilterSpec {
  /** What the facet dimension is called in the menu ("Type", "Status", …). */
  facetLabel: string
  /** The neutral "no partition" option's label — always the `all` id. */
  allLabel: string
  facets: SectionFacet[]
  sorts: SectionFacet[]
  /** The sort the section reads as neutral (its value shows muted, not accent). */
  defaultSort: string
}

/** The facet a section shows when nothing is chosen — the section row IS the
 *  all view, exactly as it was when the row meant "no child selected". */
export const ALL_FACET = 'all'

/** The ONE catalog. A section listed here has a "Filter & sort" button on its
 *  rail row and its list is driven by the stored choice; a section absent here
 *  has no partition to choose (Dispatch's flat feed, Customize's settings
 *  stack, and the hub sections whose children are genuinely distinct SURFACES
 *  rather than slices — see `./subviews.ts`). */
export const SECTION_FILTERS: Partial<Record<SectionId, SectionFilterSpec>> = {
  projects: {
    facetLabel: 'Show',
    allLabel: 'Everything',
    // Three relationships, not two: a project reached through an ORG seat is
    // neither yours nor a foreigner's share (FWD-6), and the page already bands
    // it separately — the menu now names that band instead of hiding it inside
    // the all view.
    facets: [
      { id: 'mine', label: 'Yours' },
      { id: 'org', label: 'Your organizations' },
      { id: 'shared', label: 'Shared with you' },
    ],
    sorts: [
      { id: 'recency', label: 'Last updated' },
      { id: 'alpha', label: 'Name' },
    ],
    defaultSort: 'recency',
  },
  artifacts: {
    facetLabel: 'Type',
    allLabel: 'All types',
    facets: [
      { id: 'doc', label: 'Documents' },
      { id: 'image', label: 'Images' },
      { id: 'sheet', label: 'Sheets' },
      { id: 'slide', label: 'Slides' },
      { id: 'email', label: 'Emails' },
    ],
    sorts: [
      { id: 'recency', label: 'Last edited' },
      { id: 'alpha', label: 'Name' },
    ],
    defaultSort: 'recency',
  },
  contexts: {
    facetLabel: 'Type',
    allLabel: 'All types',
    facets: [
      { id: 'connector', label: 'Connectors' },
      { id: 'mcp', label: 'MCP servers' },
      { id: 'repo', label: 'Repositories' },
    ],
    sorts: [
      { id: 'recency', label: 'Last used' },
      { id: 'alpha', label: 'Name' },
    ],
    defaultSort: 'recency',
  },
  models: {
    facetLabel: 'Kind',
    allLabel: 'All providers',
    facets: [
      { id: 'builtin', label: 'Built-in' },
      { id: 'registered', label: 'Registered' },
      { id: 'session', label: 'Sessions' },
    ],
    // A provider has no "last used" the client can read, so name order is the
    // only honest second choice — offering a recency sort we can't compute
    // would be a control that lies (UI-16's rule, applied to a menu).
    sorts: [{ id: 'alpha', label: 'Name' }],
    defaultSort: 'alpha',
  },
  // The feed has no per-row page of its own (a card's door is its SUBJECT's
  // page), so the Commons has no instance children — its rail children are the
  // viewer's standing lenses (./subviews.ts), and the item-kind partition that
  // used to be those children lives here, where a partition belongs.
  commons: {
    facetLabel: 'Kind',
    allLabel: 'Everything',
    facets: [
      // S8 — what somebody SAID, as opposed to what they shared or landed. Three
      // kinds of act, one partition; the lenses (./subviews.ts) stay the
      // viewer's own collections.
      { id: 'posts', label: 'Posts' },
      { id: 'shares', label: 'Shares' },
      { id: 'landings', label: 'Landings' },
    ],
    sorts: [
      { id: 'recency', label: 'Newest first' },
      { id: 'oldest', label: 'Oldest first' },
    ],
    defaultSort: 'recency',
  },
  discussions: {
    facetLabel: 'State',
    allLabel: 'All threads',
    facets: [
      { id: 'open', label: 'Open' },
      { id: 'resolved', label: 'Resolved' },
    ],
    sorts: [
      { id: 'recency', label: 'Recent activity' },
      { id: 'alpha', label: 'Title' },
    ],
    defaultSort: 'recency',
  },
}

export interface SectionFilterValue {
  facet: string
  sortBy: string
}

/** A section's stored choice, CLAMPED at read: an id this build no longer
 *  offers (a facet retired, a blob written by an older shape) reads as the
 *  neutral value rather than filtering every row out of a list the user can
 *  then not explain. Storage is never rewritten by the clamp — the same rule
 *  the rail's pane heights follow. */
export function clampSectionFilter(section: SectionId, value: SectionFilterValue): SectionFilterValue {
  const spec = SECTION_FILTERS[section]
  if (!spec) return { facet: ALL_FACET, sortBy: value.sortBy }
  const facet = value.facet === ALL_FACET || spec.facets.some((f) => f.id === value.facet) ? value.facet : ALL_FACET
  const sortBy = spec.sorts.some((s) => s.id === value.sortBy) ? value.sortBy : spec.defaultSort
  return { facet, sortBy }
}

/** The uiPrefs keys — per ACCOUNT, like every other rail preference (a facet is
 *  chrome, and switching back to an account must find its rail as it was left). */
const facetKey = (section: SectionId) => `sectionFacet.${section}`
const sortKey = (section: SectionId) => `sectionSort.${section}`

export function loadSectionFilter(section: SectionId): SectionFilterValue {
  const spec = SECTION_FILTERS[section]
  return clampSectionFilter(section, {
    facet: getLayout(facetKey(section), ALL_FACET),
    sortBy: getLayout(sortKey(section), spec?.defaultSort ?? 'recency'),
  })
}

export function saveSectionFilter(section: SectionId, value: SectionFilterValue): void {
  setLayout(facetKey(section), value.facet)
  setLayout(sortKey(section), value.sortBy)
}

/** ── The live value's STABLE snapshot (what `useSectionFilter` reads) ─────────
 *  `useSyncExternalStore` demands a referentially stable snapshot and
 *  `loadSectionFilter` mints a fresh object per call — returning that directly
 *  would re-render forever. So the value is memoized per section, and the memo
 *  carries BOTH things it depends on:
 *
 *  · the stored blob — dropped on every WRITE, via the subscription below.
 *    Registered at module load, so it runs BEFORE the React subscribers appended
 *    after it (the Set preserves insertion order) and they re-read a cleared memo.
 *  · the ACCOUNT that blob belongs to — part of the memo's IDENTITY, not an
 *    event. A scope switch happens inside App's render (`setUiPrefScope`), where
 *    notifying live readers is illegal, so this memo cannot be TOLD the account
 *    changed; it has to notice. Keying on the scope is what buys that switch its
 *    silence — and it's the half that keeps the fix honest, since a memo that
 *    only listened would hand the new account the old one's facets.
 *
 *  Lives here rather than in the hook so `tests/` can exercise it without React
 *  or a DOM (uiPrefs guards its localStorage access). */
let memo = new Map<SectionId, SectionFilterValue>()
let memoScope: string | null = uiPrefScope()

subscribeLayout(() => {
  memo = new Map()
})

export function sectionFilterSnapshot(section: SectionId): SectionFilterValue {
  const scope = uiPrefScope()
  if (scope !== memoScope) {
    memoScope = scope
    memo = new Map()
  }
  const held = memo.get(section)
  if (held) return held
  const value = loadSectionFilter(section)
  memo.set(section, value)
  return value
}

/** Is this choice narrowing / re-ordering anything? Drives the menu's accent
 *  tone and the rail's decision to keep the button visible on an unhovered row
 *  — a filter you can't see is a list that looks broken. */
export function isSectionFilterActive(section: SectionId, value: SectionFilterValue): boolean {
  const spec = SECTION_FILTERS[section]
  return value.facet !== ALL_FACET || (!!spec && value.sortBy !== spec.defaultSort)
}

/** The label a facet id reads as (the menu's current value). */
export function facetLabel(section: SectionId, facet: string): string {
  const spec = SECTION_FILTERS[section]
  if (!spec) return facet
  return facet === ALL_FACET ? spec.allLabel : (spec.facets.find((f) => f.id === facet)?.label ?? spec.allLabel)
}

export function sortLabel(section: SectionId, sortBy: string): string {
  const spec = SECTION_FILTERS[section]
  return spec?.sorts.find((s) => s.id === sortBy)?.label ?? sortBy
}

/** Does a row whose facet value is `value` belong in the `facet` slice? The
 *  `all` rule in ONE place, so no caller re-implements "unless it's all". */
export function facetMatches(facet: string, value: string): boolean {
  return facet === ALL_FACET || facet === value
}

/** Order rows by the chosen sort. The section supplies the two faces every
 *  sort needs — a display name and a timestamp — so this stays one comparator
 *  instead of one per entity kind. Returns a NEW array (a rail child list and
 *  a page list read the same source; neither may sort it in place). */
export function sortSectionRows<T>(
  rows: readonly T[],
  sortBy: string,
  face: { name: (row: T) => string; at: (row: T) => number },
): T[] {
  const out = [...rows]
  out.sort(
    sortBy === 'alpha'
      ? (a, b) => face.name(a).localeCompare(face.name(b))
      : sortBy === 'oldest'
        ? (a, b) => face.at(a) - face.at(b) || face.name(a).localeCompare(face.name(b))
        : (a, b) => face.at(b) - face.at(a) || face.name(a).localeCompare(face.name(b)),
  )
  return out
}
