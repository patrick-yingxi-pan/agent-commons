/** ── Navigation history ───────────────────────────────────────────────────────
 *  The app has no URL router, yet a page can be reached more than one way: a
 *  project detail opens from the Projects list, from a session's "In ‹Project›"
 *  breadcrumb, or from a relation deep-link; a routine detail opens from the
 *  Scheduled list, from a run session's breadcrumb, or from a project's routine
 *  row. So "back" must follow where you actually came *from* (a dynamic history)
 *  rather than a fixed structural parent (always the section list).
 *
 *  A `NavLocation` captures one visited page. The controller keeps a stack of them
 *  and pops on back; these are the pure, unit-tested helpers it builds on. A
 *  session location carries its title (resolved when you leave it — run sessions
 *  aren't in any list to look up later); a section location carries only ids, and
 *  its label is resolved at render from the live project / schedule names. */
import type { SectionId } from '../types'

export type NavLocation =
  | { kind: 'session'; sessionId: string; title: string }
  | { kind: 'section'; section: SectionId; projectId: string | null; scheduleId: string | null }

/** The display name for each cross-cutting section (its list page). */
export const SECTION_LABELS: Record<SectionId, string> = {
  projects: 'Projects',
  artifacts: 'Artifacts',
  contexts: 'Contexts',
  scheduled: 'Scheduled',
  dispatch: 'Dispatch',
  customize: 'Customize',
}

/** Two locations are the same *page* (identity only — a session's title is display
 *  chrome, not part of where it points). */
export function sameLocation(a: NavLocation, b: NavLocation): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'session' && b.kind === 'session') return a.sessionId === b.sessionId
  if (a.kind === 'section' && b.kind === 'section')
    return a.section === b.section && a.projectId === b.projectId && a.scheduleId === b.scheduleId
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

/** The label for the back button: the destination it will return to. Section
 *  detail pages resolve their project / routine name from the live maps; a bare
 *  section falls back to its list name; a session uses its carried title. */
export function resolveBackLabel(
  to: NavLocation | null,
  names: { project?: Record<string, string>; schedule?: Record<string, string> } = {},
): string {
  if (!to) return 'Back'
  if (to.kind === 'session') return to.title || 'Back'
  if (to.projectId) return names.project?.[to.projectId] ?? SECTION_LABELS.projects
  if (to.scheduleId) return names.schedule?.[to.scheduleId] ?? SECTION_LABELS.scheduled
  return SECTION_LABELS[to.section]
}
