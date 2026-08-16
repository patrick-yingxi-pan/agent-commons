/** ── An independent section page, navigation scoped to its pane ──────────────
 *  (universal split, ADAPT-17's pane-locality rule.) Fully interactive: it
 *  reads the same live registries every section page reads (the api hooks are
 *  global), but its sub-view, open detail, and back stack are PANE-LOCAL —
 *  navigating inside one pane never moves another. The pane REPORTS its live
 *  location (`onAt`, rev-stable) AND its in-section back stack (`hist`) up
 *  into the tree, so the URL projects the focused pane's deep page, a reload
 *  restores it (ADAPT-15), and a door LEAVING the pane can fold the whole
 *  in-section history into the target's carried back stack (ADAPT-18).
 *
 *  The back affordance walks two stacks as one chain: the local stack first
 *  (in-section detail hops), then the CARRIED stack (`backOut`, the pages
 *  before this pane's current section — a cross-section door, a conversation
 *  this page was opened from), then the structural fallback (the section
 *  root). */
import { useCallback, useEffect, useRef, useState } from 'react'
import { SectionView } from './SectionView'
import type { MainPaneNav, PaneBackOut } from './MainSplit'
import type { MainPaneContent, PaneAt } from '../lib/mainSplit'
import type { NavLocation } from '../lib/nav'
import type { SectionId } from '../types'
import { navLocationOfLoc } from '../lib/paneHistory'
import { SectionNavOverride } from '../controller/useRelations'
import { PANE_SEED_KEYS, locOfSeed, paneNavTarget, seedOfLoc, type PaneSeed } from '../lib/paneNav'

/** The pane's open detail, as the explicit null-carrying form of a `PaneSeed`.
 *  DERIVED from `PANE_SEED_KEYS` rather than hand-listed: this was the third
 *  copy of that field list, and a hand-copied list is how a new detail kind
 *  silently stops being remembered by a pane (UI-1's lesson about enumerations
 *  a human maintains). */
type PaneFocusState = Record<(typeof PANE_SEED_KEYS)[number], string | null>
const NO_FOCUS: PaneFocusState = Object.fromEntries(PANE_SEED_KEYS.map((k) => [k, null])) as PaneFocusState

export function SectionPane({
  section,
  initialSub,
  initialFocus,
  initialStack,
  nav,
  onRetarget,
  onAt,
  backOut,
}: {
  section: SectionId
  initialSub?: string | null
  /** Seeds the open DETAIL (a cross-section door retargeted this pane's leaf
   *  with the target entity — src/lib/paneNav.ts). */
  initialFocus?: PaneSeed
  /** Rehydrates the in-section back stack on a RESTORE mount (the persisted
   *  `hist` — without it a reload silently shortened the back walk). */
  initialStack?: PaneSeed[]
  nav: MainPaneNav
  /** Rewrite THIS pane's leaf (a cross-section entity door: the pane
   *  navigates to the target section with the detail open — never another).
   *  The host (PaneBody) pushes the outgoing page onto the target's back
   *  stack (ADAPT-18). */
  onRetarget: (content: MainPaneContent) => void
  /** Report the pane's LIVE location (sub-view + open detail) and its
   *  in-section back stack up into the tree — the URL projects the location,
   *  persistence restores both, and a door leaving the pane folds the stack
   *  into the carried history (Phase 6 step 4 + ADAPT-18). */
  onAt?: (at: PaneAt, hist: PaneSeed[]) => void
  /** The CARRIED back stack's top (the page before this section) — the back
   *  affordance continues into it once the local stack is spent. */
  backOut?: PaneBackOut
}) {
  // Seeded from the routed content (a rail facet click carries its facet in,
  // a cross-section door carries its detail), pane-local after that (the
  // host keys this component on section+sub+seed, so a re-route resets
  // cleanly).
  const [subview, setSubview] = useState<string | null>(initialSub ?? null)
  const [focus, setFocus] = useState<PaneFocusState>({ ...NO_FOCUS, ...initialFocus })
  const [stack, setStack] = useState<PaneFocusState[]>(() =>
    (initialStack ?? []).map((s) => ({ ...NO_FOCUS, ...s })),
  )

  const navigate = (next: Partial<PaneFocusState>) => {
    setStack((s) => [...s, focus])
    setFocus({ ...NO_FOCUS, ...next })
  }

  // Mirror of the open detail, so the stable pane bridge below can push the
  // back stack without a stale closure.
  const focusRef = useRef(focus)
  focusRef.current = focus

  // Report the pane's LIVE location + in-section stack up into the tree
  // content (rev-stable, so this can't remount the pane) — the URL projects
  // the focused pane's deep page and a reload restores it; a door leaving the
  // pane folds the stack into its push (ADAPT-18). Ref'd callback: nav
  // identity churn must not re-fire the effect.
  const onAtRef = useRef(onAt)
  onAtRef.current = onAt
  useEffect(() => {
    onAtRef.current?.({ sub: subview, ...seedOfLoc(focus) }, stack.map(seedOfLoc))
  }, [subview, focus, stack])

  // The pane-local nav bridge (ADAPT-17's pane-locality rule): every entity
  // door below — owner bylines, context rows, work-item links, "View in …" —
  // resolves against THIS pane through the SectionNavOverride that
  // useRelations() composes. Same-section targets push the pane's own detail
  // focus (a bare same-section jump returns to the root); cross-section
  // targets retarget the pane's leaf, seeded — the host pushes the outgoing
  // page onto the carried stack. Total: no door leaves the pane (the
  // equal-pages model has no primary to fall through to).
  const paneNavigate = useCallback(
    (target: SectionId, id?: string, subId?: string) => {
      const t = paneNavTarget(section, target, id, subId)
      if (t.kind === 'focus') {
        setStack((s) => [...s, focusRef.current])
        setFocus({ ...NO_FOCUS, ...t.focus })
      } else {
        onRetarget({ kind: 'msection', id: t.section, seed: t.seed })
      }
    },
    [section, onRetarget],
  )
  // Back walks the chain: the local stack, then the carried stack (backOut —
  // popped by the host WITHOUT a push), then the structural section root.
  const onBack = () => {
    if (stack.length === 0) {
      if (backOut) backOut.go()
      return
    }
    // Pure state updates as SIBLINGS — never a setState inside another's updater
    // (React StrictMode double-invokes updaters; a nested set is a hazard). `stack`
    // is the current render's value, correct for this single synchronous handler.
    setFocus(stack[stack.length - 1] ?? NO_FOCUS)
    setStack((s) => s.slice(0, -1))
  }
  const top = stack.at(-1)
  const backTo: NavLocation | null =
    stack.length > 0
      ? // The whole seed, not three of its keys: back from one artifact to the
        // one you opened it from must name THAT artifact, and the hand-picked
        // trio silently resolved every other detail kind to the section root.
        { kind: 'section', section, ...locOfSeed(top ?? {}) }
      : backOut
        ? navLocationOfLoc(backOut.loc)
        : // Any detail open ⇒ back means "this section's list". Derived from the
          // one key list, so a new detail kind gets the back affordance for free.
          PANE_SEED_KEYS.some((k) => focus[k])
          ? { kind: 'section', section, projectId: null, scheduleId: null, ownerName: null }
          : null

  return (
    <SectionNavOverride.Provider value={paneNavigate}>
      <SectionView
        section={section}
        subview={subview}
        onOpenSubview={(id) => {
          setSubview(id)
          setFocus(NO_FOCUS)
        }}
        onOpenSession={nav.onOpenSession}
        onFocusHere={nav.onFocusHere}
        onNewSession={nav.onNewSession}
        // Same-section doors push the pane's own detail focus; CROSS-section
        // doors (a profile page's project card, a project's routine row)
        // retarget the pane's leaf to the target section WITH the detail open
        // (the pane-locality rule — never a hub-root bounce).
        onOpenProject={(id) =>
          section === 'projects' ? navigate({ projectId: id }) : onRetarget({ kind: 'msection', id: 'projects', seed: { projectId: id } })
        }
        onOpenSchedule={(id) =>
          section === 'scheduled' ? navigate({ scheduleId: id }) : onRetarget({ kind: 'msection', id: 'scheduled', seed: { scheduleId: id } })
        }
        onOpenProposal={nav.onOpenProposal}
        onBack={onBack}
        backTo={backTo}
        focusCollectionSectionId={focus.collectionSectionId}
        focusProjectId={focus.projectId}
        focusProjectSectionId={focus.projectSectionId}
        focusScheduleId={focus.scheduleId}
        focusScheduleSectionId={focus.scheduleSectionId}
        focusOwnerName={focus.ownerName}
        focusWorkItemId={focus.workItemId}
        focusContributionId={focus.contributionId}
        focusAgentId={focus.agentId}
        focusPromptId={focus.promptId}
        focusToolId={focus.toolId}
        focusContextId={focus.contextId}
        focusAdminUserId={focus.adminUserId}
        focusDiscussionId={focus.discussionId}
        focusArtifactId={focus.artifactId}
        focusProviderId={focus.providerId}
        onOpenAgentPage={(id) =>
          section === 'agents' ? navigate({ agentId: id }) : onRetarget({ kind: 'msection', id: 'agents', seed: { agentId: id } })
        }
      />
    </SectionNavOverride.Provider>
  )
}
