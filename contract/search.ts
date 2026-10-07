/** ── Contract: global search (docs/agent-commons.md, D22) ────────────────────
 *  One route (`GET /search?q=`) answering with typed, grouped hits across
 *  everything the CALLER can see — their private workspace (sessions, projects,
 *  artifacts, routines, models, agents, prompts, contexts) and the commons
 *  (shared Projects, published Agents, open work, owners). Built exclusively
 *  from the same per-tenant reads and redactions the pages themselves use, so
 *  search is a window, never a wall-breach: a row absent from every page is
 *  absent from search (the D17 invariant, generalized). Substring match, no
 *  ranking (D17's directory posture — mechanism, not curation); groups come in
 *  a fixed type order, capped per group with a true total. */

export const SEARCH_HIT_TYPES = [
  'session', 'project', 'artifact', 'schedule', 'agent', 'prompt', 'model', 'context',
  'owner', 'sharedProject', 'publishedAgent', 'openWork',
] as const

export type SearchHitType = typeof SEARCH_HIT_TYPES[number]

export interface SearchPage {
  type: SearchHitType
  offset: number
}
/** Fixed page size for category browsing; overview groups retain their smaller cap. */
export const SEARCH_PAGE_SIZE = 20

/** Parse strict URL query values. `undefined` means overview mode; `null` means invalid. */
export function parseSearchPage(type?: string, offset?: string): SearchPage | null | undefined {
  if (type === undefined && offset === undefined) return undefined
  if (type === undefined || !SEARCH_HIT_TYPES.includes(type as SearchHitType)) return null
  if (offset === undefined) return { type: type as SearchHitType, offset: 0 }
  if (!/^(0|[1-9]\d*)$/.test(offset)) return null
  const parsed = Number(offset)
  if (!Number.isSafeInteger(parsed)) return null
  return { type: type as SearchHitType, offset: parsed }
}

export interface SearchHit {
  type: SearchHitType
  id: string
  title: string
  subtitle: string
  /** An `openWork` item's projectId, required by its canonical work-item door.
   * Other types may carry descriptive context here, not navigation identity. */
  ref?: string
}

export interface SearchGroup {
  type: SearchHitType
  /** Display label for the group header (server-owned so every client agrees). */
  label: string
  /** The FULL match count — `hits` is capped, this is honest. */
  total: number
  hits: SearchHit[]
}

export interface SearchResponse {
  query: string
  /** Overview: non-empty groups in fixed type order; empty query ⇒ no groups.
   * Category page: exactly the selected group, including an empty result. */
  groups: SearchGroup[]
  /** Present only for category paging; echoes the exact normalized request. */
  page?: SearchPage
}

/** Per-group hit cap (the palette shows the head; `total` says what's beneath). */
export const SEARCH_GROUP_CAP = 5
