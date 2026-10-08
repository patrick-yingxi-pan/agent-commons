/** ── The shell's route bridges (universal split, the equal-pages model) ──────
 *  The one cluster that turns an ADDRESSED navigation (a parsed RoutedView, an
 *  entity door, a session door) into a focused-pane edit — extracted from the
 *  App view so the bridging logic lives with the controllers (App stays a thin
 *  view; useSessionWorkspace consumes these as its `split` bridges).
 *
 *  Everything routes through `routeToFocused` (total — a door never no-ops):
 *  the focused pane retargets in place, or the first pane is MINTED on the
 *  background. The two special cases:
 *
 *   • `applyBootRoute` — the BOOT address applies with a DEDUP the live
 *     navigations don't have: the address the page loaded at was the FOCUSED
 *     pane's projection, but the focus cursor is transient (not persisted)
 *     and boots at the first pane — routing the address blindly would clobber
 *     pane #1 with a copy of the pane the user was actually focused on (a
 *     reload destroyed multi-pane layouts). If a restored pane already SHOWS
 *     the boot address, focus it instead; only an address nothing shows
 *     routes. Live doors deliberately keep no dedup — duplicates are legal
 *     (split IS duplicate); this only reconciles the address with the tree it
 *     was projected from.
 *   • `routeDoor` records its LANDING pane (`notifPane`) so a notification
 *     door's transient highlight — set right after the route — reaches
 *     exactly the pane it landed in, not a duplicate pane showing the same
 *     page (per-pane focus targets, docs/notification-routing.md). */
import { useCallback, useRef } from 'react'
import { DRAFT_ID } from '../data/liveSession'
import { draft } from './draftController'
import { panes } from '../lib/splitFrame'
import { paneLocationPath, type MainPaneContent, type MainSplitNode } from '../lib/mainSplit'
import { planPop } from '../lib/paneHistory'
import { seedOfLoc, type PaneSeed } from '../lib/paneNav'
import { pathForView, type RoutedView } from '../lib/urlRoutes'
import type { SectionId } from '../types'

export function useShellRoutes({
  mainTree,
  focusedPane,
  routeToFocused,
  focusMainPane,
  fillMainPane,
}: {
  mainTree: MainSplitNode | null
  /** The focused-pane cursor — the popstate planner's "whose back stack". */
  focusedPane: string
  /** The split controller's total router — returns the LANDING pane's path.
   *  `push` = the door originated inside the replaced pane (ADAPT-18). */
  routeToFocused: (content: MainPaneContent, push?: boolean) => string
  focusMainPane: (path: string) => void
  /** Replace a pane BY PATH without a history push — the popstate pop arm. */
  fillMainPane: (path: string, content: MainPaneContent) => void
}) {
  // The boot address (and the popstate planner's fallback arm) retargets the
  // FOCUSED pane, like every navigation. null routes the root — a fresh draft.
  const applyRouteToFocused = useCallback(
    (routed: RoutedView | null): void => {
      if (!routed) {
        // The root = a FRESH draft (like every other draft door): reset first,
        // or the coalesce handle would append the next send to the PREVIOUS
        // materialized session.
        draft.reset()
        routeToFocused({ kind: 'msession', id: DRAFT_ID })
        return
      }
      if (routed.loc.kind === 'session') {
        routeToFocused({ kind: 'msession', id: routed.loc.sessionId })
        return
      }
      const l = routed.loc
      routeToFocused({ kind: 'msection', id: l.section, sub: routed.subview ?? null, seed: seedOfLoc(l) })
    },
    [routeToFocused],
  )

  // An entity door (a notification bell, a palette hit, a relation card's
  // "View in …") lands in the FOCUSED pane, its detail page open (the pane
  // seed) — recording the landing pane for the notification highlight.
  // `push` marks a door that originated INSIDE pane content (a proposal row
  // on an agent page): the origin rides the target's back stack (ADAPT-18).
  const notifPaneRef = useRef<string>('')
  const routeDoor = useCallback(
    (section: SectionId, seed: PaneSeed, push?: boolean): void => {
      notifPaneRef.current = routeToFocused({ kind: 'msection', id: section, seed }, push)
    },
    [routeToFocused],
  )
  // Browser Back/Forward, PER PAGE (ADAPT-18, src/lib/paneHistory.ts): the
  // canonical address the history moved to first tries the focused pane's own
  // back top (an in-page hop — pop it, the deeper chain survives), then a
  // pane already showing the address (a focus hop's entry — refocus it, never
  // clobber the focused pane with a duplicate), then the plain focused-pane
  // route (a fresh landing, like every navigation).
  const applyPopRoute = useCallback(
    (routed: RoutedView | null): void => {
      if (!routed) {
        applyRouteToFocused(null)
        return
      }
      const target = pathForView(routed.loc, routed.subview ?? null)
      const plan = planPop(mainTree, focusedPane, target)
      if (plan.kind === 'pop') fillMainPane(plan.path, plan.content)
      else if (plan.kind === 'focus') focusMainPane(plan.path)
      else applyRouteToFocused(routed)
    },
    [mainTree, focusedPane, fillMainPane, focusMainPane, applyRouteToFocused],
  )

  // A session door (palette hit, notifications row, boot address) and a
  // bare-section door land in the focused pane the same way.
  const routeSession = useCallback(
    (id: string): void => {
      notifPaneRef.current = routeToFocused({ kind: 'msession', id })
    },
    [routeToFocused],
  )
  const routeSection = useCallback(
    (section: SectionId, sub?: string | null): void => {
      routeToFocused({ kind: 'msection', id: section, sub: sub ?? null })
    },
    [routeToFocused],
  )
  // Boot fallback (ADAPT-1): neither a boot address nor the restored
  // per-account tree filled the background — mint the fresh draft.
  const mintIfEmpty = useCallback((): void => {
    if (!mainTree) {
      draft.reset()
      routeToFocused({ kind: 'msession', id: DRAFT_ID })
    }
  }, [mainTree, routeToFocused])
  // The boot dedup (see the header) — an address a restored pane already
  // shows FOCUSES that pane instead of routing over another. Returns whether
  // it ROUTED (true) or merely focused an existing pane (false): a dedup means
  // the projection already matches the address, so the caller's boot latch has
  // nothing to hold — and, when the matched pane was already focused, no
  // focusedPath change would ever re-run the URL effect to release it (the
  // reload-then-navigate address freeze).
  const applyBootRoute = useCallback(
    (routed: RoutedView | null): boolean => {
      if (routed && mainTree) {
        const target = window.location.pathname
        const match = panes(mainTree).find((p) => paneLocationPath(p.content) === target)
        if (match) {
          focusMainPane(match.path)
          return false
        }
      }
      applyRouteToFocused(routed)
      return true
    },
    [mainTree, focusMainPane, applyRouteToFocused],
  )

  return { applyRouteToFocused, applyPopRoute, applyBootRoute, routeDoor, routeSession, routeSection, mintIfEmpty, notifPaneRef }
}
