/** ── Pane-local resolution of the section nav bridge ─────────────────────────
 *  (universal split — the pane-locality rule, ADAPT-17.) Section pages navigate
 *  entity doors through ONE bridge — `useRelations().navigate(section, id,
 *  subId)` (owner bylines, context rows, work-item links, "View in …") — whose
 *  root implementation drives the PRIMARY controller. Hosted in a split pane,
 *  those doors must stay IN THE PANE instead: this pure mapper decides what a
 *  pane does with a bridge call, and `SectionPane` provides it as the nav
 *  override every `useRelations()` consumer below it composes in.
 *
 *  Three outcomes:
 *  - `focus`    — the target renders inside the pane's CURRENT section: push it
 *                 onto the pane's own detail focus (back stack works).
 *  - `retarget` — a cross-section door: rewrite the pane's leaf to the target
 *                 section, seeding the detail (`msection.seed`) — the pane
 *                 navigates, not the primary.
 *  - `global`   — a shape the pane can't host (a bare section jump with no
 *                 entity): fall through to the root bridge (the primary).
 *
 *  The id→detail mapping MIRRORS the root bridge (`App.navigateToSection`):
 *  projects+subId → a work item; projects → a project; scheduled → a routine;
 *  contexts → a saved context's page; agents → an OWNER profile (an agent
 *  PAGE routes through the `onOpenAgentPage` prop, never this bridge).
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
}

export type PaneNavTarget =
  | { kind: 'focus'; focus: PaneSeed }
  | { kind: 'retarget'; section: SectionId; seed: PaneSeed }
  | { kind: 'global' }

/** The root bridge's id→detail mapping, shared by both outcomes. Null = the
 *  call names no entity detail (a bare section jump). */
export function seedFor(section: SectionId, id?: string, subId?: string): PaneSeed | null {
  if (!id) return null
  if (section === 'projects') return subId ? { projectId: id, workItemId: subId } : { projectId: id }
  if (section === 'scheduled') return { scheduleId: id }
  if (section === 'contexts') return { contextId: id }
  if (section === 'agents') return { ownerName: id }
  return null
}

/** What a pane hosting `current` does with a bridge call to (section, id, subId). */
export function paneNavTarget(
  current: SectionId,
  section: SectionId,
  id?: string,
  subId?: string,
): PaneNavTarget {
  const seed = seedFor(section, id, subId)
  if (!seed) return { kind: 'global' }
  return section === current ? { kind: 'focus', focus: seed } : { kind: 'retarget', section, seed }
}
