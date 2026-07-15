/** ── The main workspace split's controller (universal split Phases 2–4) ──────
 *  Owns the MAIN surface's split tree — the `primary` pane (the singleton
 *  controller's surface) plus any number of independent panes (section pages,
 *  conversations), row/col nested — AND the FOCUSED-pane cursor the whole
 *  interaction model turns on (the 2026-07-15 redesign):
 *
 *    • The rail's two split buttons act on the FOCUSED pane, duplicating its
 *      content in place — no picker step, no per-pane chrome. The new pane
 *      takes focus, ready to be retargeted.
 *    • Rail navigation (a section, a facet, a recent conversation) lands in
 *      the focused pane: the primary navigates the singleton controller as
 *      always; a secondary pane is REPLACED in place (`routeToFocused`).
 *
 *  Focus is a transient cursor, not layout — in-memory only, reconciled to the
 *  primary whenever its pane vanishes. The tree is per-account persisted
 *  (src/lib/mainSplit.ts); `null` = no split — the app renders exactly as
 *  before, so every pre-split path is untouched.
 *
 *  Invariant: every tree holds EXACTLY ONE `primary` pane. Closing down to one
 *  pane dissolves the tree; closing the primary itself is refused by the UI
 *  (its pane has no X — the primary is where the URL lives, ADAPT-15). */
import { useCallback, useRef, useState } from 'react'
import { nodeAt, pane, panes, replacePane, setRatio, splitPane as splitLeaf, type SplitDir } from '../lib/splitFrame'
import {
  PRIMARY,
  closeMainPane as closeMain,
  closePrimaryPane,
  getMainSplitPref,
  setMainSplitPref,
  type MainPaneContent,
  type MainSplitNode,
} from '../lib/mainSplit'

const primaryPath = (t: MainSplitNode | null): string =>
  panes(t).find((p) => p.content.kind === 'primary')?.path ?? ''

export function useMainSplit() {
  // Restore per account (the Workspace remounts keyed by account, so this
  // initializer re-runs against the right blob). A tree without its primary
  // (a corrupt blob) is dropped.
  const [mainTree, setMainTreeState] = useState<MainSplitNode | null>(() => {
    const stored = getMainSplitPref()
    return stored && panes(stored).some((p) => p.content.kind === 'primary') ? stored : null
  })
  const treeRef = useRef(mainTree)
  treeRef.current = mainTree

  const [focusedPane, setFocusedPane] = useState<string>(() => primaryPath(treeRef.current))
  const focusedRef = useRef(focusedPane)
  focusedRef.current = focusedPane

  /** Commit a tree edit: render + persist, and reconcile the focus cursor —
   *  a path that no longer names a pane falls back to the primary. */
  const commit = useCallback((next: MainSplitNode | null) => {
    treeRef.current = next
    setMainTreeState(next)
    setMainSplitPref(next)
    const focused = focusedRef.current
    if (!next || nodeAt(next, focused)?.kind !== 'pane') {
      focusedRef.current = primaryPath(next)
      setFocusedPane(focusedRef.current)
    }
  }, [])

  /** Focus a pane (pointer-down anywhere in it). Stale paths are ignored. */
  const focusMainPane = useCallback((path: string) => {
    const t = treeRef.current
    if (t && nodeAt(t, path)?.kind === 'pane' && focusedRef.current !== path) {
      focusedRef.current = path
      setFocusedPane(path)
    }
  }, [])

  /** Pull focus back to the primary pane (a rail action that must land on the
   *  singleton surface — e.g. "New session"). */
  const focusPrimary = useCallback(() => {
    focusedRef.current = primaryPath(treeRef.current)
    setFocusedPane(focusedRef.current)
  }, [])

  /** Split the FOCUSED pane (the rail's two buttons): the new sibling is a
   *  DUPLICATE of what's focused — no picker. Duplicating the primary needs
   *  the caller to say what it currently shows (`primaryDuplicate`: the active
   *  section or conversation as an independent pane); null means the primary
   *  has no duplicable identity yet (a fresh draft) and the split is a no-op. */
  const splitFocused = useCallback(
    (dir: SplitDir, primaryDuplicate: MainPaneContent | null) => {
      const t = treeRef.current
      const path = t ? focusedRef.current : ''
      const node = t ? nodeAt(t, path) : pane(PRIMARY)
      if (!node || node.kind !== 'pane') return
      const dup: MainPaneContent | null =
        node.content.kind === 'primary' ? primaryDuplicate : { ...node.content }
      if (!dup) return
      commit(splitLeaf(t ?? pane(PRIMARY), path, dir, dup))
      // The new pane (the split's second half) takes focus, ready to retarget.
      focusedRef.current = `${path}b`
      setFocusedPane(focusedRef.current)
    },
    [commit],
  )

  /** Rail navigation while a SECONDARY pane is focused: replace its content in
   *  place. Returns false when the primary is focused (or no tree exists) —
   *  the caller then runs the normal singleton navigation. */
  const routeToFocused = useCallback(
    (content: MainPaneContent): boolean => {
      const t = treeRef.current
      if (!t) return false
      const path = focusedRef.current
      const node = nodeAt(t, path)
      if (!node || node.kind !== 'pane' || node.content.kind === 'primary') return false
      commit(replacePane(t, path, content))
      return true
    },
    [commit],
  )

  /** Fill a legacy picker pane (pre-duplicate blobs may still hold one). */
  const fillMainPane = useCallback(
    (path: string, content: MainPaneContent) => {
      const t = treeRef.current
      if (t) commit(replacePane(t, path, content))
    },
    [commit],
  )

  const closeMainPane = useCallback(
    (path: string) => {
      const t = treeRef.current
      if (t) commit(closeMain(t, path))
    },
    [commit],
  )

  /** Close the FOCUSED pane — the rail's close button, beside the split pair.
   *  Homogeneous across panes: a secondary pane simply collapses; closing the
   *  PRIMARY tile relocates the primary role into the pane inheriting its
   *  space — that pane's content is handed to `onPromote` (the caller
   *  navigates the singleton controller onto it, so the URL honestly names
   *  what survives) and its leaf is re-stamped primary. */
  const closeFocused = useCallback(
    (onPromote?: (content: MainPaneContent) => void) => {
      const t = treeRef.current
      if (!t) return
      const path = focusedRef.current
      const node = nodeAt(t, path)
      if (node?.kind !== 'pane') return
      if (node.content.kind === 'primary') {
        const res = closePrimaryPane(t, path)
        if (!res) return
        onPromote?.(res.promoted)
        commit(res.tree)
        // Focus follows the relocated primary (the surviving tile).
        focusedRef.current = primaryPath(treeRef.current)
        setFocusedPane(focusedRef.current)
      } else {
        commit(closeMain(t, path))
      }
    },
    [commit],
  )

  // Whether the rail's close button applies right now (derived per render —
  // focus and tree are both state, so this stays in step): any focused pane,
  // primary included (homogeneity — the role relocates, the tile closes).
  const focusedNode = mainTree ? nodeAt(mainTree, focusedPane) : undefined
  const focusedClosable = focusedNode?.kind === 'pane'

  const setMainRatio = useCallback(
    (path: string, ratio: number) => {
      const t = treeRef.current
      if (t) commit(setRatio(t, path, ratio))
    },
    [commit],
  )

  return {
    mainTree,
    focusedPane,
    focusedClosable,
    focusMainPane,
    focusPrimary,
    splitFocused,
    routeToFocused,
    fillMainPane,
    closeMainPane,
    closeFocused,
    setMainRatio,
  }
}
