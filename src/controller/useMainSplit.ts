/** ── The main workspace split's controller (universal split Phase 2) ─────────
 *  Owns the MAIN surface's split tree: the `primary` pane (the singleton
 *  controller's surface — thread or section page) plus any number of
 *  independent panes (section pages now; conversations in Phase 3), row/col
 *  nested. Per-account persisted (src/lib/mainSplit.ts); `null` = no split —
 *  the app renders exactly as before, so every pre-split path is untouched.
 *
 *  Invariant: every tree holds EXACTLY ONE `primary` pane. Splitting mints
 *  pickers; closing the primary's sibling(s) down to one pane dissolves the
 *  tree; closing the primary itself is refused by the UI (its pane has no X —
 *  the primary is where rail navigation lands and what the URL names). */
import { useCallback, useState } from 'react'
import { panes, prunePanes, replacePane, setRatio, splitPane as splitLeaf, type SplitDir } from '../lib/splitFrame'
import {
  PRIMARY,
  closeMainPane as closeMain,
  getMainSplitPref,
  newMainPicker,
  setMainSplitPref,
  type MainPaneContent,
  type MainSplitNode,
} from '../lib/mainSplit'

export function useMainSplit() {
  // Restore per account (the Workspace remounts keyed by account, so this
  // initializer re-runs against the right blob). Prune at render, storage
  // untouched: a tree without its primary (a corrupt blob) is dropped.
  const [mainTree, setMainTreeState] = useState<MainSplitNode | null>(() => {
    const stored = prunePanes(getMainSplitPref(), (c) => c.kind !== 'msession') // msession panes land in Phase 3
    return stored && panes(stored).some((p) => p.content.kind === 'primary') ? stored : null
  })

  const setMainTree = useCallback((t: MainSplitNode | null) => {
    setMainTreeState(t)
    setMainSplitPref(t)
  }, [])

  /** Split a pane (the primary included) — the new sibling opens as a picker. */
  const splitMainPane = useCallback(
    (path: string, dir: SplitDir) => {
      setMainTreeState((t) => {
        const next = t
          ? splitLeaf(t, path, dir, newMainPicker())
          : // No tree yet: the first split wraps the primary surface.
            splitLeaf({ kind: 'pane', content: PRIMARY }, '', dir, newMainPicker())
        setMainSplitPref(next)
        return next
      })
    },
    [],
  )

  const fillMainPane = useCallback(
    (path: string, content: MainPaneContent) => {
      setMainTreeState((t) => {
        if (!t) return t
        const next = replacePane(t, path, content)
        setMainSplitPref(next)
        return next
      })
    },
    [],
  )

  const closeMainPane = useCallback((path: string) => {
    setMainTreeState((t) => {
      if (!t) return t
      const next = closeMain(t, path)
      setMainSplitPref(next)
      return next
    })
  }, [])

  const setMainRatio = useCallback((path: string, ratio: number) => {
    setMainTreeState((t) => {
      if (!t) return t
      const next = setRatio(t, path, ratio)
      setMainSplitPref(next)
      return next
    })
  }, [])

  return { mainTree, setMainTree, splitMainPane, fillMainPane, closeMainPane, setMainRatio }
}
