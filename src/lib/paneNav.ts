/** ── Pane-local resolution of the section nav bridge ─────────────────────────
 *  (universal split — the pane-locality rule, ADAPT-17.) Section pages navigate
 *  entity doors through ONE bridge — `useRelations().navigate(section, id,
 *  subId)` (owner bylines, context rows, work-item links, "View in …") — whose
 *  root implementation drives the PRIMARY controller. Hosted in a split pane,
 *  those doors must stay IN THE PANE instead: this pure mapper decides what a
 *  pane does with a bridge call, and `SectionPane` provides it as the nav
 *  override every `useRelations()` consumer below it composes in.
 *
 *  Two outcomes (total — every door stays in the pane; the equal-pages model
 *  has no primary to fall through to, and an in-pane door must carry the
 *  pane's back history, ADAPT-18):
 *  - `focus`    — the target renders inside the pane's CURRENT section: push it
 *                 onto the pane's own detail focus (back stack works). A bare
 *                 same-section jump is the empty focus — back to the root.
 *  - `retarget` — a cross-section door: rewrite the pane's leaf to the target
 *                 section, seeding the detail (`msection.seed`; a bare section
 *                 jump seeds nothing — the section root) — the pane navigates,
 *                 never another.
 *
 *  The id→detail mapping MIRRORS the root bridge (`App.navigateToSection`):
 *  projects+subId → a work item; projects → a project; scheduled → a routine;
 *  contexts → a saved context's page; agents → an OWNER profile (an agent
 *  PAGE routes through the `onOpenAgentPage` prop, never this bridge);
 *  admin → an account's detail page in the maintainer console (FWD-7 v1.1).
 *  Dependency-free and node-tested (tests/pane-nav.test.ts) so the mapping
 *  can't silently diverge from the root's. */
import type { SectionId } from '../types'

/** The pane's detail-focus shape (MainSplit's PaneFocusState, structurally). */
export interface PaneSeed {
  projectId?: string
  scheduleId?: string
  ownerName?: string
  workItemId?: string
  agentId?: string
  contextId?: string
  adminUserId?: string
}

/** The ONE list of detail-id keys a pane location carries — every mapping that
 *  copies these fields (a routed URL → a pane seed, a pane's live location →
 *  its canonical NavLocation, a page's focus state → its reported seed) walks
 *  THIS list, so adding a detail kind is a one-line change here instead of a
 *  hunt across three hand-copied field lists. */
export const PANE_SEED_KEYS = ['projectId', 'scheduleId', 'ownerName', 'workItemId', 'agentId', 'contextId', 'adminUserId'] as const
type SeedKey = (typeof PANE_SEED_KEYS)[number]
// Compile-time lock: the key list and PaneSeed stay in lock-step — adding a
// detail id to one without the other fails typecheck here.
const _seedKeysCoverPaneSeed: keyof PaneSeed extends SeedKey ? (SeedKey extends keyof PaneSeed ? true : never) : never = true
void _seedKeysCoverPaneSeed

/** A location-ish object (a parsed RoutedView loc, a page's focus state — any
 *  shape carrying the detail keys as string | null | undefined) → the compact
 *  PaneSeed (only present, non-empty ids ride). */
export function seedOfLoc(loc: Partial<Record<SeedKey, string | null | undefined>>): PaneSeed {
  const seed: PaneSeed = {}
  for (const k of PANE_SEED_KEYS) {
    const v = loc[k]
    if (v) seed[k] = v
  }
  return seed
}

/** The inverse projection: a PaneSeed-ish location → the explicit
 *  null-carrying detail fields a section NavLocation requires. */
export function locOfSeed(seed: Partial<Record<SeedKey, string | null | undefined>>): Record<SeedKey, string | null> {
  return Object.fromEntries(PANE_SEED_KEYS.map((k) => [k, seed[k] ?? null])) as Record<SeedKey, string | null>
}

export type PaneNavTarget =
  | { kind: 'focus'; focus: PaneSeed }
  | { kind: 'retarget'; section: SectionId; seed: PaneSeed }

/** The root bridge's id→detail mapping, shared by both outcomes. Null = the
 *  call names no entity detail (a bare section jump). */
export function seedFor(section: SectionId, id?: string, subId?: string): PaneSeed | null {
  if (!id) return null
  if (section === 'projects') return subId ? { projectId: id, workItemId: subId } : { projectId: id }
  if (section === 'scheduled') return { scheduleId: id }
  if (section === 'contexts') return { contextId: id }
  if (section === 'agents') return { ownerName: id }
  if (section === 'admin') return { adminUserId: id }
  return null
}

/** What a pane hosting `current` does with a bridge call to (section, id, subId). */
export function paneNavTarget(
  current: SectionId,
  section: SectionId,
  id?: string,
  subId?: string,
): PaneNavTarget {
  const seed = seedFor(section, id, subId) ?? {}
  return section === current ? { kind: 'focus', focus: seed } : { kind: 'retarget', section, seed }
}
