/** ── An independent section page, navigation scoped to its pane ──────────────
 *  (universal split, ADAPT-17's pane-locality rule.) Fully interactive: it
 *  reads the same live registries every section page reads (the api hooks are
 *  global), but its sub-view, open detail, and back stack are PANE-LOCAL —
 *  navigating inside one pane never moves another. The pane REPORTS its live
 *  location up into the tree (`onAt`, rev-stable), so the URL projects the
 *  focused pane's deep page and a reload restores it (ADAPT-15). */
import { useCallback, useEffect, useRef, useState } from 'react'
import { SectionView } from './SectionView'
import type { MainPaneNav } from './MainSplit'
import type { MainPaneContent, PaneAt } from '../lib/mainSplit'
import type { NavLocation } from '../lib/nav'
import type { SectionId } from '../types'
import { SectionNavOverride, useRelations } from '../controller/useRelations'
import { paneNavTarget, seedOfLoc, type PaneSeed } from '../lib/paneNav'

interface PaneFocusState {
  projectId: string | null
  scheduleId: string | null
  ownerName: string | null
  workItemId: string | null
  agentId: string | null
  contextId: string | null
}
const NO_FOCUS: PaneFocusState = { projectId: null, scheduleId: null, ownerName: null, workItemId: null, agentId: null, contextId: null }

export function SectionPane({
  section,
  initialSub,
  initialFocus,
  nav,
  onRetarget,
  onAt,
}: {
  section: SectionId
  initialSub?: string | null
  /** Seeds the open DETAIL (a cross-section door retargeted this pane's leaf
   *  with the target entity — src/lib/paneNav.ts). */
  initialFocus?: PaneSeed
  nav: MainPaneNav
  /** Rewrite THIS pane's leaf (a cross-section entity door: the pane
   *  navigates to the target section with the detail open — never another). */
  onRetarget: (content: MainPaneContent) => void
  /** Report the pane's LIVE location (sub-view + open detail) up into the
   *  tree — the URL projects it, persistence restores it (Phase 6 step 4). */
  onAt?: (at: PaneAt) => void
}) {
  // Seeded from the routed content (a rail facet click carries its facet in,
  // a cross-section door carries its detail), pane-local after that (the
  // host keys this component on section+sub+seed, so a re-route resets
  // cleanly).
  const [subview, setSubview] = useState<string | null>(initialSub ?? null)
  const [focus, setFocus] = useState<PaneFocusState>({ ...NO_FOCUS, ...initialFocus })
  const [stack, setStack] = useState<PaneFocusState[]>([])

  const navigate = (next: Partial<PaneFocusState>) => {
    setStack((s) => [...s, focus])
    setFocus({ ...NO_FOCUS, ...next })
  }

  // Mirror of the open detail, so the stable pane bridge below can push the
  // back stack without a stale closure.
  const focusRef = useRef(focus)
  focusRef.current = focus

  // Report the pane's LIVE location up into the tree content (rev-stable, so
  // this can't remount the pane) — the URL projects the focused pane's deep
  // page and a reload restores it. Ref'd callback: nav identity churn must
  // not re-fire the effect.
  const onAtRef = useRef(onAt)
  onAtRef.current = onAt
  useEffect(() => {
    onAtRef.current?.({ sub: subview, ...seedOfLoc(focus) })
  }, [subview, focus])

  // The pane-local nav bridge (ADAPT-17's pane-locality rule): every entity
  // door below — owner bylines, context rows, work-item links, "View in …" —
  // resolves against THIS pane through the SectionNavOverride that
  // useRelations() composes. Same-section targets push the pane's own detail
  // focus; cross-section targets retarget the pane's leaf (seeded); a shape
  // the pane can't host (a bare section jump) falls through to the root
  // bridge. SectionPane itself sits ABOVE its own override, so this
  // useRelations() reads the ROOT navigate.
  const rootNavigate = useRelations().navigate
  const paneNavigate = useCallback(
    (target: SectionId, id?: string, subId?: string) => {
      const t = paneNavTarget(section, target, id, subId)
      if (t.kind === 'focus') {
        setStack((s) => [...s, focusRef.current])
        setFocus({ ...NO_FOCUS, ...t.focus })
      } else if (t.kind === 'retarget') {
        onRetarget({ kind: 'msection', id: t.section, seed: t.seed })
      } else {
        rootNavigate(target, id, subId)
      }
    },
    [section, onRetarget, rootNavigate],
  )
  const onBack = () => {
    setStack((s) => {
      const prev = s.at(-1)
      setFocus(prev ?? NO_FOCUS)
      return s.slice(0, -1)
    })
  }
  const top = stack.at(-1)
  const backTo: NavLocation | null =
    stack.length > 0
      ? { kind: 'section', section, projectId: top?.projectId ?? null, scheduleId: top?.scheduleId ?? null, ownerName: top?.ownerName ?? null }
      : focus.projectId || focus.scheduleId || focus.ownerName || focus.agentId || focus.contextId
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
        focusProjectId={focus.projectId}
        focusScheduleId={focus.scheduleId}
        focusOwnerName={focus.ownerName}
        focusWorkItemId={focus.workItemId}
        focusAgentId={focus.agentId}
        focusContextId={focus.contextId}
        onOpenAgentPage={(id) =>
          section === 'agents' ? navigate({ agentId: id }) : onRetarget({ kind: 'msection', id: 'agents', seed: { agentId: id } })
        }
      />
    </SectionNavOverride.Provider>
  )
}
