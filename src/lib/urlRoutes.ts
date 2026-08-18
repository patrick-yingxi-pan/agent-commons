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
 *    /u/:ownerName          a namespace's public profile (D21; the display name
 *                           IS the public handle — the explicit /u/ prefix keeps
 *                           profile names from colliding with section names).
 *                           Hosted by the Commons (OWNER_SECTION), which is why
 *                           this is the profile's ONE address: the rail's "Your
 *                           profile" child is a standing DOOR to it, never a
 *                           `/commons/profile` sub-view — a page with two
 *                           addresses is the thing this module exists to prevent
 *    /u/:ownerName/:sectionId
 *                           one structural section of that composite profile
 *    /:section              a section list (Projects, Agents, …)
 *    /:section/:subview     a section focused on a rail-tree child (ADAPT-13);
 *                           subview ids win over detail ids (reserved words,
 *                           the GitHub rule)
 *    /:section/groups/:id   a structural section inside an Artifacts, Contexts,
 *                           or Models collection root
 *    /projects/:projectId   a project detail page
 *    /projects/:projectId/:sectionId
 *                           one Project section page
 *    /scheduled/:scheduleId a routine detail page
 *    /scheduled/:scheduleId/:sectionId
 *                           one routine section page
 *    /contexts/:contextId   a saved context's detail page
 *    /artifacts/:artifactId an artifact open in the gallery (UI-19 — the rail
 *                           lists artifacts, so one has to be addressable)
 *    /models/:providerId    a model provider's canonical detail page
 *    /agents/prompts/:id    one reusable system-prompt material
 *    /agents/tools/:id      one callable tool material
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
import { OWNER_SECTION } from './paneNav.ts'
import { SECTION_SUBVIEWS } from './subviews.ts'
import { isOwnerProfileSectionId, isProjectSectionId, isScheduleSectionId } from './compositeSections.ts'
import { isCollectionSectionHost } from './collectionSections.ts'

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
  if (loc.ownerName) {
    const base = `/u/${encodeURIComponent(loc.ownerName)}`
    return loc.ownerSectionId && isOwnerProfileSectionId(loc.ownerSectionId)
      ? `${base}/${encodeURIComponent(loc.ownerSectionId)}`
      : base
  }
  if (loc.promptId) return `/agents/prompts/${encodeURIComponent(loc.promptId)}`
  if (loc.toolId) return `/agents/tools/${encodeURIComponent(loc.toolId)}`
  if (loc.agentId) return `/agents/${encodeURIComponent(loc.agentId)}`
  // PaneSeed is deliberately shared, so stale persisted state can carry a
  // field its host does not understand. Do not manufacture group URLs outside
  // the collection roots that declare this grammar.
  if (loc.collectionSectionId && isCollectionSectionHost(loc.section))
    return `/${loc.section}/groups/${encodeURIComponent(loc.collectionSectionId)}`
  if (loc.projectId && loc.workItemId)
    return `/projects/${encodeURIComponent(loc.projectId)}/work/${encodeURIComponent(loc.workItemId)}`
  if (loc.projectId && loc.contributionId)
    return `/projects/${encodeURIComponent(loc.projectId)}/changes/${encodeURIComponent(loc.contributionId)}`
  if (loc.projectId && loc.projectSectionId)
    return `/projects/${encodeURIComponent(loc.projectId)}/${encodeURIComponent(loc.projectSectionId)}`
  if (loc.projectId) return `/projects/${encodeURIComponent(loc.projectId)}`
  if (loc.scheduleId && loc.scheduleSectionId)
    return `/scheduled/${encodeURIComponent(loc.scheduleId)}/${encodeURIComponent(loc.scheduleSectionId)}`
  if (loc.scheduleId) return `/scheduled/${encodeURIComponent(loc.scheduleId)}`
  if (loc.contextId) return `/contexts/${encodeURIComponent(loc.contextId)}`
  if (loc.discussionId) return `/discussions/${encodeURIComponent(loc.discussionId)}`
  if (loc.artifactId) return `/artifacts/${encodeURIComponent(loc.artifactId)}`
  if (loc.providerId) return `/models/${encodeURIComponent(loc.providerId)}`
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
      loc: { kind: 'section', section: OWNER_SECTION, projectId: null, scheduleId: null, ownerName: segs[1] },
      subview: null,
    }
  }
  if (segs[0] === 'u' && segs.length === 3 && segs[1] && isOwnerProfileSectionId(segs[2])) {
    return {
      loc: {
        kind: 'section',
        section: OWNER_SECTION,
        projectId: null,
        scheduleId: null,
        ownerSectionId: segs[2],
        ownerName: segs[1],
      },
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
    return { loc: { ...base, projectId: segs[1], projectSectionId: 'open-work', workItemId: segs[3] }, subview: null }
  }
  // Its sibling: /projects/:id/changes/:cid — a contribution's own page (the
  // PR-page analog; the address carries the stable contribution id, not the
  // landing number — an OPEN contribution has no number yet, and an address
  // must never change when the entity's display state does).
  if (section === 'projects' && segs.length === 4 && segs[2] === 'changes' && segs[3]) {
    return { loc: { ...base, projectId: segs[1], projectSectionId: 'changes', contributionId: segs[3] }, subview: null }
  }
  if (section === 'projects' && segs.length === 3 && segs[1] && isProjectSectionId(segs[2])) {
    return { loc: { ...base, projectId: segs[1], projectSectionId: segs[2] }, subview: null }
  }
  if (section === 'scheduled' && segs.length === 3 && segs[1] && isScheduleSectionId(segs[2])) {
    return { loc: { ...base, scheduleId: segs[1], scheduleSectionId: segs[2] }, subview: null }
  }
  if (section === 'agents' && segs.length === 3 && segs[1] === 'prompts' && segs[2]) {
    return { loc: { ...base, promptId: segs[2] }, subview: null }
  }
  if (section === 'agents' && segs.length === 3 && segs[1] === 'tools' && segs[2]) {
    return { loc: { ...base, toolId: segs[2] }, subview: null }
  }
  // The maintainer console's account detail (FWD-7 v1.1) — nested under a
  // static `users` segment so it can never collide with the reserved admin
  // subview ids (orgs / credentials / audit / ops).
  if (section === 'admin' && segs.length === 3 && segs[1] === 'users' && segs[2]) {
    return { loc: { ...base, adminUserId: segs[2] }, subview: null }
  }
  if (isCollectionSectionHost(section) && segs.length === 3 && segs[1] === 'groups' && segs[2]) {
    return { loc: { ...base, collectionSectionId: segs[2] }, subview: null }
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
  if (section === 'discussions') return { loc: { ...base, discussionId: second }, subview: null }
  if (section === 'artifacts') return { loc: { ...base, artifactId: second }, subview: null }
  if (section === 'models') return { loc: { ...base, providerId: second }, subview: null }
  return null
}
