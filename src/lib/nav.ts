/** ── Navigation history ───────────────────────────────────────────────────────
 *  The app has no URL router, yet a page can be reached more than one way: a
 *  project detail opens from the Projects list, from a session's "In ‹Project›"
 *  breadcrumb, or from a relation deep-link; a routine detail opens from the
 *  Routines list, from a run session's breadcrumb, or from a project's routine
 *  row. So "back" must follow where you actually came *from* (a dynamic history)
 *  rather than a fixed structural parent (always the section list).
 *
 *  A `NavLocation` captures one visited page. The controller keeps a stack of them
 *  and pops on back; these are the pure, unit-tested helpers it builds on. A
 *  session location carries its title (resolved when you leave it — run sessions
 *  aren't in any list to look up later); a section location carries only ids, and
 *  its label is resolved at render from the live project / schedule names. */
import type { SectionId } from '../types'
import { PANE_SEED_KEYS, type PaneSeed } from './paneNav.ts'
import { ownerProfileSection, projectSection, scheduleSection } from './compositeSections.ts'
import { collectionSectionLabel } from './collectionSections.ts'

export type NavLocation =
  | { kind: 'session'; sessionId: string; title: string }
  | {
      kind: 'section'
      section: SectionId
      projectId: string | null
      scheduleId: string | null
      /** A structural section inside a collection root (`/:section/groups/:id`). */
      collectionSectionId?: string | null
      /** A section page inside a composite Project (`/projects/:id/:section`). */
      projectSectionId?: string | null
      /** A section page inside a composite routine (`/scheduled/:id/:section`). */
      scheduleSectionId?: string | null
      /** A section page inside a composite namespace profile
       * (`/u/:name/:section`). */
      ownerSectionId?: string | null
      /** A workspace profile open under Commons (D21) — the display name,
       *  which IS the public handle. Optional so older call sites / history entries
       *  stay valid; absent ≡ null. */
      ownerName?: string | null
      /** A work item's own page under its project (the issue-page analog) — requires
       *  `projectId`. Optional for the same back-compat reason; absent ≡ null. */
      workItemId?: string | null
      /** A contribution's own page under its project (the PR-page analog — the
       *  agent-contribution workflow's Contribution surface, Phase A) — requires
       *  `projectId`. Optional for the same back-compat reason; absent ≡ null. */
      contributionId?: string | null
      /** A published definition's own page under the agents section (the repo-page
       *  analog, COMMONS-26). Optional for the same back-compat reason; absent ≡ null. */
      agentId?: string | null
      /** A reusable prompt material (`/agents/prompts/:id`). */
      promptId?: string | null
      /** A built-in tool material (`/agents/tools/:id`). */
      toolId?: string | null
      /** A saved context's detail page under the contexts section (ADAPT-15 — the
       *  detail was once component state with no address). Absent ≡ null. */
      contextId?: string | null
      /** An account's detail page under the maintainer console (FWD-7 v1.1 —
       *  `/admin/users/:id`, maintainers only). Absent ≡ null. */
      adminUserId?: string | null
      /** A discussion's own page under the discussions section (social S2 —
       *  `/discussions/:did`; the timeline form). Absent ≡ null. */
      discussionId?: string | null
      /** An artifact open in the gallery (`/artifacts/:id`, UI-19). Absent ≡ null. */
      artifactId?: string | null
      artifactRevision?: string | null
      /** A model provider focused in the list (`/models/:id`, UI-19). Absent ≡ null. */
      providerId?: string | null
    }

/** The display name for each cross-cutting section (its list page). */
export const SECTION_LABELS: Record<SectionId, string> = {
  commons: 'Commons',
  projects: 'Projects',
  artifacts: 'Artifacts',
  contexts: 'Contexts',
  models: 'Models',
  agents: 'Agents',
  scheduled: 'Routines',
  discussions: 'Discussions',
  messages: 'Messages',
  notifications: 'Notifications',
  sessions: 'Sessions',
  dispatch: 'Dispatch',
  customize: 'Customize',
  admin: 'Maintain',
}

/** Two locations are the same *page* (identity only — a session's title is display
 *  chrome, not part of where it points). */
export function sameLocation(a: NavLocation, b: NavLocation): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'session' && b.kind === 'session') return a.sessionId === b.sessionId
  if (a.kind === 'section' && b.kind === 'section')
    return (
      a.section === b.section &&
      (a.collectionSectionId ?? null) === (b.collectionSectionId ?? null) &&
      (a.projectSectionId ?? null) === (b.projectSectionId ?? null) &&
      a.projectId === b.projectId &&
      (a.scheduleSectionId ?? null) === (b.scheduleSectionId ?? null) &&
      a.scheduleId === b.scheduleId &&
      (a.ownerSectionId ?? null) === (b.ownerSectionId ?? null) &&
      (a.ownerName ?? null) === (b.ownerName ?? null) &&
      (a.workItemId ?? null) === (b.workItemId ?? null) &&
      (a.contributionId ?? null) === (b.contributionId ?? null) &&
      (a.agentId ?? null) === (b.agentId ?? null) &&
      (a.promptId ?? null) === (b.promptId ?? null) &&
      (a.toolId ?? null) === (b.toolId ?? null) &&
      (a.contextId ?? null) === (b.contextId ?? null) &&
      (a.adminUserId ?? null) === (b.adminUserId ?? null) &&
      (a.discussionId ?? null) === (b.discussionId ?? null) &&
      (a.artifactId ?? null) === (b.artifactId ?? null) &&
      (a.artifactRevision ?? null) === (b.artifactRevision ?? null) &&
      (a.providerId ?? null) === (b.providerId ?? null)
    )
  return false
}

/** Push the location being left onto the stack as we navigate to `to`. Skips a
 *  no-op hop (leaving === arriving, e.g. re-clicking the section you're on) and a
 *  consecutive duplicate of the current top, so back never steps through a page
 *  that looks identical to the one you're already on. */
export function pushLocation(stack: NavLocation[], leaving: NavLocation, to: NavLocation): NavLocation[] {
  if (sameLocation(leaving, to)) return stack
  const top = stack[stack.length - 1]
  if (top && sameLocation(top, leaving)) return stack
  return [...stack, leaving]
}

/** The registries the back label can name a page from — a RUNTIME list, so the
 *  lock can enumerate them and check the one supplier feeds every one. A total
 *  `resolveBackLabel` handed a half-filled map degrades exactly like the bug it
 *  replaced, silently, so "is it total?" and "is it fed?" are two questions and
 *  both are asked (`src/lib/nav.test.ts`). */
export const BACK_LABEL_SOURCES = ['project', 'schedule', 'discussion', 'artifact', 'context', 'provider', 'agent', 'prompt', 'tool'] as const

/** Live display names for the back label, one map per registry, keyed by id.
 *  Supplied by `BackButton` from the same api hooks the pages themselves read
 *  (UI-12: every displayed datum reads a LIVE source) — a name absent from a
 *  map degrades to the section label rather than showing an id. */
export type BackLabelNames = Partial<Record<(typeof BACK_LABEL_SOURCES)[number], Record<string, string>>>

/** How each DETAIL kind names itself. Typed as a mapped type over `PaneSeed`,
 *  so the compiler — not a reviewer — forces a decision here the moment a new
 *  detail kind is added: an unlabeled one used to fall silently through to its
 *  SECTION name, which is how "Back to Discussions" came to point at one
 *  specific thread. Returning `undefined` is the honest "no name to give",
 *  and the caller degrades to the section label. */
const DETAIL_LABEL: {
  [K in keyof Required<PaneSeed>]: (id: string, names: BackLabelNames, section: SectionId) => string | undefined
} = {
  collectionSectionId: (id, names, section) => collectionSectionLabel(section, id, names.project),
  projectSectionId: (id) => projectSection(id)?.label,
  projectId: (id, n) => n.project?.[id],
  scheduleSectionId: (id) => scheduleSection(id)?.label,
  scheduleId: (id, n) => n.schedule?.[id],
  ownerSectionId: (id) => ownerProfileSection(id)?.label,
  // A namespace profile is its own label — the display name IS the page (D21).
  ownerName: (id) => id,
  // Both are pages nested below a Project section. The section id precedes
  // them in PANE_SEED_KEYS, so a work/change destination reads “Open work” or
  // “Changes”; these cases remain total even though the leaf ids have no
  // standalone name registry.
  workItemId: () => undefined,
  contributionId: () => undefined,
  agentId: (id, n) => n.agent?.[id],
  promptId: (id, n) => n.prompt?.[id],
  toolId: (id, n) => n.tool?.[id],
  contextId: (id, n) => n.context?.[id],
  // The maintainer console's account detail: its roster is grant-walled and
  // fetched only by the console itself, so a back label would mean a
  // cross-tenant read from every page in the app. "Maintain" it is.
  adminUserId: () => undefined,
  discussionId: (id, n) => n.discussion?.[id],
  artifactId: (id, n) => n.artifact?.[id],
  artifactRevision: (id) => `Version ${id}`,
  providerId: (id, n) => n.provider?.[id],
}

/** The label for the back button: the destination it will return to, NAMED.
 *  A session uses its carried title (resolved when you leave it — run sessions
 *  are in no list to look up later); a section DETAIL page resolves its own
 *  name through `DETAIL_LABEL`; a bare section is its list name.
 *
 *  The detail walk follows `PANE_SEED_KEYS` — the one ordered key list every
 *  other seed mapping walks — so precedence is a property of that list rather
 *  than of the order somebody happened to write the branches in. */
export function resolveBackLabel(to: NavLocation | null, names: BackLabelNames = {}): string {
  if (!to) return 'Back'
  if (to.kind === 'session') return to.title || 'Back'
  if (to.artifactId && to.artifactRevision !== undefined && to.artifactRevision !== null)
    return `${names.artifact?.[to.artifactId] ?? 'Artifact'} · Version ${to.artifactRevision}`
  for (const key of PANE_SEED_KEYS) {
    const id = to[key]
    if (!id) continue
    return DETAIL_LABEL[key](id, names, to.section) ?? SECTION_LABELS[to.section]
  }
  return SECTION_LABELS[to.section]
}
