/** ── One ordered list per content section, read by BOTH its projections ──────
 *  A section now shows up twice at once: as the rail tree's instance children
 *  (the top rows, under the section's row) and as the section page's list. They
 *  are the same list — so they are computed by the same function, here, rather
 *  than by two filters that agree until someone edits one. Each takes the raw
 *  registry read plus the section's stored `SectionFilterValue` and returns the
 *  rows in display order; the rail then slices the head of it.
 *
 *  Each function is small on purpose: the SHARED parts (the all-facet rule, the
 *  comparator) live in `./sectionFilter.ts`, and what stays here is the one
 *  thing only this kind knows — which property its facet is measured on. That
 *  classification cannot move to the catalog without dragging every entity type
 *  into it; keeping it beside the type is what lets the catalog stay pure
 *  metadata.
 *
 *  Pure (type-only entity imports), so `tests/section-lists.test.ts` can lock
 *  the orderings without a DOM. */
import type { ArtifactItem, Discussion, ModelProvider, Project, SavedContext } from '../types'
import { discussionTitle } from '../../contract/social.ts'
import { facetMatches, sortSectionRows, type SectionFilterValue } from './sectionFilter.ts'

/** Which relationship band a project falls in — the three the Projects page has
 *  always drawn (yours · an org seat · shared with you), now nameable in the
 *  filter menu. `myOrgIds` comes from the caller's identity, so this stays a
 *  pure function of its inputs. */
export function projectFacet(p: Project, myOrgIds: ReadonlySet<string>): 'mine' | 'org' | 'shared' {
  if (p.tenantId && myOrgIds.has(p.tenantId)) return 'org'
  return p.own === false ? 'shared' : 'mine'
}

/** The band order the Projects page draws in — yours, then your orgs, then the
 *  commons. The LIST carries it too, so the rail's flat head is the page's first
 *  rows and not a different set: sorted purely by recency, two of your own
 *  projects sank below ten shared ones in the rail while the page still showed
 *  them first (found live, 2026-07-24). */
const PROJECT_BAND_ORDER = { mine: 0, org: 1, shared: 2 } as const

export function listProjects(
  rows: readonly Project[],
  filter: SectionFilterValue,
  myOrgIds: ReadonlySet<string>,
): Project[] {
  const kept = rows.filter((p) => facetMatches(filter.facet, projectFacet(p, myOrgIds)))
  const ordered = sortSectionRows(kept, filter.sortBy, { name: (p) => p.name, at: (p) => p.updatedAt })
  // Stable sort, so the chosen order survives inside each band; a single-facet
  // view is one band, where this is a no-op.
  return ordered.sort((a, b) => PROJECT_BAND_ORDER[projectFacet(a, myOrgIds)] - PROJECT_BAND_ORDER[projectFacet(b, myOrgIds)])
}

export function listArtifacts(rows: readonly ArtifactItem[], filter: SectionFilterValue): ArtifactItem[] {
  const kept = rows.filter((a) => facetMatches(filter.facet, a.kind))
  return sortSectionRows(kept, filter.sortBy, { name: (a) => a.name, at: (a) => a.editedAt })
}

export function listContexts(rows: readonly SavedContext[], filter: SectionFilterValue): SavedContext[] {
  const kept = rows.filter((c) => facetMatches(filter.facet, c.kind))
  // A never-attached context has no `lastUsedAt` (null) — it sorts to the end of
  // the recency order rather than to the top, which a `?? 0` would also do but
  // by accident. Named, so the intent survives an edit.
  return sortSectionRows(kept, filter.sortBy, { name: (c) => c.label, at: (c) => c.lastUsedAt ?? 0 })
}

/** A provider's facet: the shared built-ins (no tenant), the endpoints this
 *  tenant registered, and delegated Session providers — the same three the rail
 *  tree used to list. */
export function providerFacet(p: ModelProvider): 'builtin' | 'registered' | 'session' {
  if (p.kind === 'session') return 'session'
  return p.tenantId ? 'registered' : 'builtin'
}

export function listProviders(rows: readonly ModelProvider[], filter: SectionFilterValue): ModelProvider[] {
  const kept = rows.filter((p) => facetMatches(filter.facet, providerFacet(p)))
  // Providers carry no timestamp the client can read, so their catalog offers
  // name order only — `at` is never consulted for them.
  return sortSectionRows(kept, filter.sortBy, { name: (p) => p.label, at: () => 0 })
}

/** A thread's last activity — the stamp its recency order means (a thread with
 *  one post is as recent as that post, not as its opening). */
export function discussionActivityAt(d: Discussion): number {
  return d.posts[d.posts.length - 1]?.at ?? d.openedAt
}

export function listDiscussions(rows: readonly Discussion[], filter: SectionFilterValue): Discussion[] {
  const kept = rows.filter((d) => facetMatches(filter.facet, d.state))
  const ordered = sortSectionRows(kept, filter.sortBy, {
    name: (d) => discussionTitle(d.posts[0]?.body),
    at: discussionActivityAt,
  })
  // Open threads lead in the ALL view whatever the sort — the hub's standing
  // read is "what still needs me", and the server's own list does the same.
  // Inside a single-state facet the band is a no-op, so the sort is untouched.
  return filter.facet === 'all'
    ? [...ordered].sort((a, b) => (a.state === b.state ? 0 : a.state === 'open' ? -1 : 1))
    : ordered
}
