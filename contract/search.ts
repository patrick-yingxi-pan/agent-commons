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

export type SearchHitType =
  | 'session'
  | 'project'
  | 'artifact'
  | 'schedule'
  | 'agent'
  | 'prompt'
  | 'model'
  | 'context'
  | 'owner'
  | 'sharedProject'
  | 'publishedAgent'
  | 'openWork'

export interface SearchHit {
  type: SearchHitType
  id: string
  title: string
  subtitle: string
  /** The door parameter when opening the hit needs more than its id:
   *  an `openWork` item's projectId (its backlog lives on the project page),
   *  a `publishedAgent`'s owner name (its public face lives on the profile). */
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
  /** Only non-empty groups, in the fixed type order. Empty query ⇒ no groups. */
  groups: SearchGroup[]
}

/** Per-group hit cap (the palette shows the head; `total` says what's beneath). */
export const SEARCH_GROUP_CAP = 5
