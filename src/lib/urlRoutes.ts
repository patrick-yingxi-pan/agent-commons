/** ── URL routes: the address bar as a projection of NavLocation ──────────────
 *  Every page the app can show has ONE canonical URL — GitHub's core navigation
 *  property (a link is the coordination primitive: shareable, bookmarkable,
 *  open-in-new-tab-able), applied to this shell's own nav model. This module is
 *  the pure two-way mapping; the controller (useSessionWorkspace) owns the
 *  History API sync (pushState on navigation, popstate → apply, boot URL wins
 *  over per-account view memory — a pasted link must open what it names).
 *
 *  Grammar (segments percent-encoded):
 *    /                      the fresh draft (root carries no preference — parse
 *                           returns null so a plain boot restores view memory)
 *    /s/:sessionId          a session thread
 *    /u/:ownerName          a workspace's public profile (D21; the display name
 *                           IS the public handle — the explicit /u/ prefix keeps
 *                           profile names from colliding with section names)
 *    /:section              a section list (Projects, Agents, …)
 *    /:section/:subview     a section focused on a rail-tree child (ADAPT-13);
 *                           subview ids win over detail ids (reserved words,
 *                           the GitHub rule)
 *    /projects/:projectId   a project detail page
 *    /scheduled/:scheduleId a routine detail page
 *    /contexts/:contextId   a saved context's detail page (kind ids are reserved)
 *    /admin/users/:userId   an account's detail page in the maintainer console
 *                           (nested under `users` so the reserved admin
 *                           subview ids can never collide)
 *
 *  Deliberately pure (type-only + pure-module imports) so `tests/` can lock the
 *  mapping without a DOM. Transient focus (a highlighted work item / comment) is
 *  NOT page identity and never appears in the URL — same rule as nav history. */
import type { SectionId } from '../types.ts'
import { DRAFT_ID } from '../data/liveSession.ts'
import { SECTION_LABELS, type NavLocation } from './nav.ts'
import { SECTION_SUBVIEWS } from './subviews.ts'

/** A parsed address: the page plus the section sub-view (which nav history
 *  ignores but the address must carry — GitHub's tabs are URLs). */
export type RoutedView = { loc: NavLocation; subview: string | null }

const SECTION_IDS = Object.keys(SECTION_LABELS) as SectionId[]

function isSectionId(s: string): s is SectionId {
  return (SECTION_IDS as string[]).includes(s)
}

function isSubviewOf(section: SectionId, id: string): boolean {
  return (SECTION_SUBVIEWS[section] ?? []).some((v) => v.id === id)
}

/** The canonical path for a page. Total — every NavLocation has an address. */
export function pathForView(loc: NavLocation, subview: string | null): string {
  if (loc.kind === 'session') {
    return loc.sessionId === DRAFT_ID ? '/' : `/s/${encodeURIComponent(loc.sessionId)}`
  }
  if (loc.ownerName) return `/u/${encodeURIComponent(loc.ownerName)}`
  if (loc.agentId) return `/agents/${encodeURIComponent(loc.agentId)}`
  if (loc.projectId && loc.workItemId)
    return `/projects/${encodeURIComponent(loc.projectId)}/work/${encodeURIComponent(loc.workItemId)}`
  if (loc.projectId) return `/projects/${encodeURIComponent(loc.projectId)}`
  if (loc.scheduleId) return `/scheduled/${encodeURIComponent(loc.scheduleId)}`
  if (loc.contextId) return `/contexts/${encodeURIComponent(loc.contextId)}`
  if (loc.adminUserId) return `/admin/users/${encodeURIComponent(loc.adminUserId)}`
  return subview ? `/${loc.section}/${encodeURIComponent(subview)}` : `/${loc.section}`
}

/** Parse a pathname back to a page. Null means "no preference" — the root, or a
 *  path this app doesn't serve (the caller stays on its default rather than
 *  guessing; a stale entity id inside a VALID shape still parses — the detail
 *  pages already degrade gracefully on ids the server no longer knows). */
export function viewForPath(pathname: string): RoutedView | null {
  const segs = pathname.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  })
  if (segs.length === 0) return null

  if (segs[0] === 's' && segs.length === 2 && segs[1]) {
    return { loc: { kind: 'session', sessionId: segs[1], title: '' }, subview: null }
  }
  if (segs[0] === 'u' && segs.length === 2 && segs[1]) {
    return {
      loc: { kind: 'section', section: 'agents', projectId: null, scheduleId: null, ownerName: segs[1] },
      subview: null,
    }
  }
  if (!isSectionId(segs[0])) return null
  const section = segs[0]
  const base = { kind: 'section' as const, section, projectId: null, scheduleId: null, ownerName: null }
  if (segs.length === 1) return { loc: base, subview: null }
  // The one deeper form: /projects/:id/work/:itemId — a work item's own page
  // (the issue-page analog; nested because the item is project-scoped by nature).
  if (section === 'projects' && segs.length === 4 && segs[2] === 'work' && segs[3]) {
    return { loc: { ...base, projectId: segs[1], workItemId: segs[3] }, subview: null }
  }
  // The maintainer console's account detail (FWD-7 v1.1) — nested under a
  // static `users` segment so it can never collide with the reserved admin
  // subview ids (orgs / credentials / audit / ops).
  if (section === 'admin' && segs.length === 3 && segs[1] === 'users' && segs[2]) {
    return { loc: { ...base, adminUserId: segs[2] }, subview: null }
  }
  if (segs.length !== 2) return null
  const second = segs[1]
  // Reserved words first: a registered sub-view id names the facet/tab, never an
  // entity (so /projects/mine is the "Yours" group even if an id collided).
  if (isSubviewOf(section, second)) return { loc: base, subview: second }
  if (section === 'projects') return { loc: { ...base, projectId: second }, subview: null }
  if (section === 'scheduled') return { loc: { ...base, scheduleId: second }, subview: null }
  if (section === 'agents') return { loc: { ...base, agentId: second }, subview: null }
  if (section === 'contexts') return { loc: { ...base, contextId: second }, subview: null }
  return null
}
