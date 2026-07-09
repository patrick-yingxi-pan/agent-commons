import type { SectionId } from '../types'

/** A section's sub-view — one entry in its rail drill-in menu. `id` is the section's
 *  own switch key (a hub-tab id), `label` is what the rail shows. */
export type SubView = { id: string; label: string }

/** The ONE source of truth for section sub-**navigation** (the rail's drill-in menu).
 *  Both the left rail (Sidebar) and the section body (SectionView) read this, so the nav
 *  and the content can never disagree ("registries have one home + live points-of-use").
 *  A section absent here has no rail sub-nav: its row opens the page directly.
 *
 *  Deliberately reserved for TRUE sub-navigation — genuinely distinct surfaces, each with
 *  its own entities and actions. Today that's exactly the **Agents hub** (Agents / Prompts /
 *  Commissions / Discover / Audit). *Filtering* — one list narrowed by a facet (kind /
 *  type / status / ownership: Contexts, Artifacts, Scheduled, Models, Projects) — is NOT
 *  navigation and deliberately does NOT live here: it's an in-page control (the shared
 *  `SectionFilter`), so a filter never masquerades as a nav destination, and opening a
 *  section never reshuffles the rail below it. See spec ADAPT-13.
 *
 *  This module is deliberately pure (only a type-only import), so `tests/` can import the
 *  registry without pulling the UI's icon deps. */
export const SECTION_SUBVIEWS: Partial<Record<SectionId, SubView[]>> = {
  // The Agents hub's children are its NON-default surfaces — the section row itself opens
  // the worker-agents list (the default), so listing "Agents" again as a child would
  // duplicate it. Each child is a genuinely distinct surface.
  agents: [
    { id: 'prompts', label: 'Prompts' },
    { id: 'commissions', label: 'Commissions' },
    { id: 'discover', label: 'Discover' },
    { id: 'audit', label: 'Audit' },
  ],
}
