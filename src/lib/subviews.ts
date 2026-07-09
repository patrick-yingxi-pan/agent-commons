import type { SectionId } from '../types'

/** A section's sub-view — one entry in its rail drill-in menu. `id` is the section's
 *  own switch key (a content kind / status / hub tab), `label` is what the rail shows. */
export type SubView = { id: string; label: string }

/** The ONE source of truth for section sub-navigation. Both the left rail (the
 *  drill-in secondary menu — Sidebar) and the section body (SectionView) read this,
 *  so the nav and the content can never disagree ("registries have one home + live
 *  points-of-use"). A section absent here has no sub-views: its rail row opens the
 *  page directly, with no drill-in.
 *
 *  The classification each section already carried in-page (the Agents hub's tabs,
 *  the Contexts/Artifacts/Scheduled filter dropdowns, the Projects yours/shared
 *  bands) moves here. The filter-style sections keep an **'all'** sub-view first —
 *  their full grouped body, so nothing is hidden by default; the rest are pre-applied
 *  filters. The ids are each section's own switch keys: content kinds
 *  (`SavedContextKind`, `ArtifactKind`), a provider class, an enabled state, or a
 *  hub tab — so a section can switch on `subview` directly.
 *
 *  This module is deliberately pure (only a type-only import), so `tests/` can import
 *  the registry without pulling the UI's icon deps. */
export const SECTION_SUBVIEWS: Partial<Record<SectionId, SubView[]>> = {
  projects: [
    { id: 'all', label: 'All' },
    { id: 'shared', label: 'Shared with you' },
  ],
  artifacts: [
    { id: 'all', label: 'All' },
    { id: 'doc', label: 'Documents' },
    { id: 'image', label: 'Images' },
    { id: 'sheet', label: 'Sheets' },
    { id: 'slide', label: 'Slides' },
    { id: 'email', label: 'Emails' },
  ],
  contexts: [
    { id: 'all', label: 'All' },
    { id: 'connector', label: 'Connectors' },
    { id: 'mcp', label: 'MCP servers' },
    { id: 'repo', label: 'Repositories' },
  ],
  models: [
    { id: 'all', label: 'All' },
    { id: 'builtin', label: 'Built-in' },
    { id: 'registered', label: 'Registered' },
    { id: 'session', label: 'Sessions' },
  ],
  agents: [
    { id: 'agents', label: 'Agents' },
    { id: 'prompts', label: 'Prompts' },
    { id: 'commissions', label: 'Commissions' },
    { id: 'discover', label: 'Discover' },
    { id: 'audit', label: 'Audit' },
  ],
  scheduled: [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'paused', label: 'Paused' },
  ],
}

/** The sub-view a section lands on when opened (its first), or null if it has none. */
export function firstSubview(section: SectionId): string | null {
  return SECTION_SUBVIEWS[section]?.[0]?.id ?? null
}
