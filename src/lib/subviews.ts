import type { SectionId } from '../types'

/** A section's sub-view — one child node in the rail's inline disclosure tree. `id` is
 *  the section's own switch key (a hub-tab id or a facet-group id), `label` is what the
 *  rail shows. */
export type SubView = { id: string; label: string }

/** The ONE source of truth for the rail tree's child nodes (spec ADAPT-13). Both the
 *  left rail (Sidebar's `SectionTreeRow`) and the section body (SectionView) read this,
 *  so the nav and the content can never disagree ("registries have one home + live
 *  points-of-use"). A section absent here has no children: its row opens the page
 *  directly.
 *
 *  Two node kinds, by nature: **content sections** (Contexts / Artifacts / Scheduled /
 *  Models / Projects) expand to their **facet groups** — clicking a group focuses the
 *  page on that partition, and because the tree IS the facet control, no page may add
 *  an in-page filter bar re-selecting the same facet (a facet has ONE control; locked
 *  by tests/section-subviews.test.ts). The **Agents hub** expands to its non-default
 *  surfaces (Prompts / Commissions / Discover / Audit) — genuinely distinct pages; the
 *  section row itself is the worker-agents surface, so it isn't re-listed as a child.
 *
 *  This module is deliberately pure (only a type-only import), so `tests/` can import the
 *  registry without pulling the UI's icon deps. */
export const SECTION_SUBVIEWS: Partial<Record<SectionId, SubView[]>> = {
  // Content sections expand to their group nodes (a facet partition); clicking one focuses
  // the page on that group, the section row itself shows all groups (rail sub-view null).
  // The ids ARE each section's own switch keys, so the body filters on `subview` directly.
  projects: [
    { id: 'mine', label: 'Yours' },
    { id: 'shared', label: 'Shared with you' },
  ],
  artifacts: [
    { id: 'doc', label: 'Documents' },
    { id: 'image', label: 'Images' },
    { id: 'sheet', label: 'Sheets' },
    { id: 'slide', label: 'Slides' },
    { id: 'email', label: 'Emails' },
  ],
  contexts: [
    { id: 'connector', label: 'Connectors' },
    { id: 'mcp', label: 'MCP servers' },
    { id: 'repo', label: 'Repositories' },
  ],
  models: [
    { id: 'builtin', label: 'Built-in' },
    { id: 'registered', label: 'Registered' },
    { id: 'session', label: 'Sessions' },
  ],
  // The Agents hub's children are its NON-default *surfaces* (not a facet of one list) —
  // the section row itself opens the worker-agents list (the default), so listing "Agents"
  // again as a child would duplicate it.
  agents: [
    { id: 'work', label: 'Your work' },
    { id: 'prompts', label: 'Prompts' },
    { id: 'commissions', label: 'Commissions' },
    { id: 'discover', label: 'Discover' },
    { id: 'audit', label: 'Audit' },
  ],
  scheduled: [
    { id: 'active', label: 'Active' },
    { id: 'paused', label: 'Paused' },
  ],
}
