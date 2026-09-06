/** ── The main workspace split's controller (universal split, Phase 6) ────────
 *  Owns the MAIN surface's split tree — EQUAL pages (conversations incl. the
 *  draft, section pages, context panels), row/col nested, `null` = the empty
 *  BACKGROUND — and the FOCUSED-pane cursor the whole interaction model turns
 *  on:
 *
 *    • The rail's two split buttons act on the FOCUSED pane, duplicating its
 *      content in place — no picker step, no per-pane chrome. The new pane
 *      takes focus, ready to be retargeted.
 *    • Every navigation (a rail door, a palette hit, popstate) lands in the
 *      focused pane (`routeToFocused` — on the background it MINTS the first
 *      pane); the address bar projects the focused pane.
 *    • Close is ONE rule for every pane: the sibling inherits the slot;
 *      closing the last pane leaves the background.
 *
 *  Focus is a transient cursor, not layout — in-memory only, reconciled to
 *  the first pane whenever its own pane vanishes. The tree is per-account
 *  persisted (src/lib/mainSplit.ts). */
import { useCallback, useEffect, useRef, useState } from 'react'
import { nodeAt, pane, panes, replacePane, setRatio, splitPane as splitLeaf, updatePaneContent, type PaneContent, type SplitDir } from '../lib/splitFrame'
import { pruneMainTree, withBackPush } from '../lib/paneHistory'
import type { PaneSeed } from '../lib/paneNav'
import {
  closeMainPane as closeMain,
  findFocusDrivenContext,
  getMainSplitPref,
  retargetDraftPanes,
  setMainSplitPref,
  setFocusDrivenContextTree,
  unpinnedContent,
  withoutFocusDrivenContext,
  type MainPaneContent,
  type MainSplitNode,
  type PaneAt,
} from '../lib/mainSplit'

const firstPanePath = (t: MainSplitNode | null): string => panes(t)[0]?.path ?? ''

export function useMainSplit(opts?: {
  /** Resolves a session's display title at back-PUSH time (the carried title
   *  of an msession back entry — nav.ts's "resolved when you leave it"). */
  sessionTitle?: (id: string) => string
  /** Capability filter applied only to RESTORED view memory. Direct routes
   *  still reach their explanatory denied page; an old persisted page cannot
   *  strand an identity whose chrome no longer offers that destination. */
  restoreKeep?: (content: MainPaneContent) => boolean
}) {
  const optsRef = useRef(opts)
  optsRef.current = opts
  // Restore per account (the Workspace remounts keyed by account, so this
  // initializer re-runs against the right blob; legacy primary leaves were
  // stripped by the migration in getMainSplitPref).
  const restoredRef = useRef<{ tree: MainSplitNode | null; normalized: boolean } | null>(null)
  const [mainTree, setMainTreeState] = useState<MainSplitNode | null>(() => {
    const stored = getMainSplitPref()
    const restored = opts?.restoreKeep ? pruneMainTree(stored, opts.restoreKeep) : stored
    restoredRef.current = { tree: restored, normalized: restored !== stored }
    return restored
  })
  const treeRef = useRef(mainTree)
  treeRef.current = mainTree

  // A removed capability is an authority change, not a temporary layout
  // clamp: retire inaccessible panes and history from storage so a later root
  // boot cannot resurrect them. The state initializer already prevents a
  // denied-frame flash; this post-mount write only normalizes the saved blob.
  useEffect(() => {
    const restored = restoredRef.current
    if (restored?.normalized) setMainSplitPref(withoutFocusDrivenContext(restored.tree))
  }, [])

  const [focusedPane, setFocusedPane] = useState<string>(() => firstPanePath(treeRef.current))
  const focusedRef = useRef(focusedPane)
  focusedRef.current = focusedPane

  /** Commit a tree edit: render + persist, and reconcile the focus cursor —
   *  a path that no longer names a pane falls back to the first pane.
   *  Persistence STRIPS the focus-driven context pane (`withoutFocusDrivenContext`)
   *  — it is a transient projection of `focus`, re-derived on boot by the sync
   *  effect, so storing it would churn on every toggle and flash a wrong-session
   *  panel on reload (never-in-storage). */
  const commit = useCallback((next: MainSplitNode | null) => {
    treeRef.current = next
    setMainTreeState(next)
    setMainSplitPref(withoutFocusDrivenContext(next))
    const focused = focusedRef.current
    if (!next || nodeAt(next, focused)?.kind !== 'pane') {
      // The focused pane was SPLIT (e.g. the context-panel projection tiling a
      // panel beside the focused conversation): its content moved to the `a`
      // child — focus follows it there rather than jumping to the first pane.
      const descended = next && nodeAt(next, focused)?.kind === 'split' ? `${focused}a` : null
      focusedRef.current =
        next && descended && nodeAt(next, descended)?.kind === 'pane' ? descended : firstPanePath(next)
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

  /** Split the FOCUSED pane (the rail's two buttons): the new sibling is a
   *  DUPLICATE of what's focused — no picker; every pane duplicates equally
   *  (a duplicated context panel drops the focusDriven marker and becomes an
   *  independent PINNED pane). A background (no tree) has nothing to split. */
  const splitFocused = useCallback(
    (dir: SplitDir) => {
      const t = treeRef.current
      if (!t) return
      const path = focusedRef.current
      const node = nodeAt(t, path)
      if (!node || node.kind !== 'pane') return
      commit(splitLeaf(t, path, dir, unpinnedContent({ ...node.content })))
      // The new pane (the split's second half) takes focus, ready to retarget.
      focusedRef.current = `${path}b`
      setFocusedPane(focusedRef.current)
    },
    [commit],
  )

  /** EVERY navigation lands in the focused pane: replace its content in
   *  place — or MINT the first pane when only the background shows. TOTAL:
   *  a stale focus path (a race with a concurrent tree edit) reconciles to
   *  the first pane and lands there — a door never silently no-ops. Returns
   *  the LANDING pane's path (the notification doors scope their transient
   *  highlight to exactly the pane they landed in). `push` marks a door that
   *  ORIGINATED inside the replaced pane's content (ADAPT-18): the outgoing
   *  page — with its whole history chain — is pushed onto the target's back
   *  stack, so the landing page carries a back affordance to its origin.
   *  Chrome doors omit it and reset the stack. */
  const routeToFocused = useCallback(
    (content: MainPaneContent, push?: boolean): string => {
      const t = treeRef.current
      if (!t) {
        commit(pane(content))
        focusedRef.current = ''
        setFocusedPane('')
        return ''
      }
      let path = focusedRef.current
      if (nodeAt(t, path)?.kind !== 'pane') {
        path = firstPanePath(t)
        focusedRef.current = path
        setFocusedPane(path)
      }
      const node = nodeAt(t, path)
      const landing =
        push && node?.kind === 'pane' && content.kind !== 'context-panel'
          ? withBackPush(node.content, content, optsRef.current?.sessionTitle)
          : content
      commit(replacePane(t, path, landing))
      return path
    },
    [commit],
  )

  /** Replace a pane's content BY PATH (a section pane retargeting its own
   *  leaf on a cross-section door). */
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

  /** Close the pane the action explicitly TARGETED — the rail's close button,
   *  ONE rule for every
   *  pane (the owner's equal-pages model): the sibling inherits the slot;
   *  closing the LAST pane leaves the background. The one special case is
   *  the `focusDriven` CONTEXT pane — a transient projection of its session's
   *  `focus`, so closing it clears the DRIVER via `onCloseActiveContext` (the
   *  caller's `closePanel`) and the sync effect removes the pane — keeping
   *  `focus` and the tree in step (detected off the pane's MARKER). */
  const closePaneFromAction = useCallback(
    (path: string, onCloseActiveContext?: (sessionId: string) => void) => {
      const t = treeRef.current
      if (!t) return
      const node = nodeAt(t, path)
      if (node?.kind !== 'pane') return
      if (node.content.kind === 'context-panel' && node.content.focusDriven) {
        onCloseActiveContext?.(node.content.sessionId)
      } else {
        commit(closeMain(t, path))
      }
    },
    [commit],
  )

  // Whether the rail's close button applies right now (derived per render —
  // focus and tree are both state, so this stays in step): any focused pane,
  // every pane equally (one close rule).
  const focusedNode = mainTree ? nodeAt(mainTree, focusedPane) : undefined
  const focusedClosable = focusedNode?.kind === 'pane'
  /** The focused pane's content (undefined = no tree / stale path) — the URL
   *  derives the address from this (Phase 6: the address bar is a projection
   *  of the FOCUSED pane, not of a designated primary). */
  const focusedContent = focusedNode?.kind === 'pane' ? focusedNode.content : undefined

  const setMainRatio = useCallback(
    (path: string, ratio: number) => {
      const t = treeRef.current
      if (t) commit(setRatio(t, path, ratio))
    },
    [commit],
  )

  /** Reconcile the active session's context pane to `panel` (null = closed) —
   *  the focus-sync effect (App) drives this from the session's `focus` on the
   *  wide tier. Idempotent: `setFocusDrivenContextTree` returns the same tree when
   *  already in the desired state, so no needless render / persist. */
  const setFocusDrivenContext = useCallback(
    (sessionId: string, panel: PaneContent | null) => {
      const t = treeRef.current
      const next = setFocusDrivenContextTree(t, sessionId, panel)
      if (next !== t) commit(next)
    },
    [commit],
  )

  /** A section pane REPORTS its live location (sub-view + open detail) — a
   *  rev-STABLE content update (the pane must not remount from describing
   *  itself), equality-guarded so redundant reports never commit/persist.
   *  The URL projects it; a reload restores the pane to the same spot. */
  const reportPaneAt = useCallback(
    (path: string, at: PaneAt, hist: PaneSeed[], rev: number) => {
      const t = treeRef.current
      if (!t) return
      const node = nodeAt(t, path)
      if (node?.kind !== 'pane' || node.content.kind !== 'msection') return
      // A report is stamped with the leaf REVISION its pane instance rendered
      // under. A stale instance's late effect (StrictMode re-runs its report
      // after a route already replaced the leaf) must not write its old
      // location onto the fresh content — the boot route would silently lose
      // to the page it was overriding (the bare-address-over-deep-at bug).
      if ((node.rev ?? 0) !== rev) return
      const prev = node.content
      if (
        prev.at &&
        JSON.stringify(prev.at) === JSON.stringify(at) &&
        JSON.stringify(prev.hist ?? []) === JSON.stringify(hist)
      )
        return
      commit(updatePaneContent(t, path, { ...node.content, at, hist }))
    },
    [commit],
  )

  /** LIVE PRUNE: drop every pane whose subject is definitively GONE (a
   *  deleted session's conversation + context panes; a detached context's
   *  pinned panel — reported by the pane once its entry is server-reconciled).
   *  One rule with close: pruning the last pane leaves the background.
   *  Same-ref no-op; `commit` reconciles a pruned-away focus cursor. */
  const pruneMainPanes = useCallback(
    (keep: (c: MainPaneContent) => boolean) => {
      const t = treeRef.current
      // Panes first, then the surviving panes' BACK stacks (ADAPT-18): a gone
      // subject must vanish from history too, or the back affordance would
      // walk into a dead thread.
      const next = pruneMainTree(t, keep)
      if (next !== t) commit(next)
    },
    [commit],
  )

  /** A pane-hosted draft materialized: retarget every draft conversation pane
   *  to the real id (content match — duplicates follow too). */
  const adoptDraftPanes = useCallback(
    (draftId: string, realId: string) => {
      const t = treeRef.current
      const next = retargetDraftPanes(t, draftId, realId)
      if (next !== t) commit(next)
    },
    [commit],
  )

  return {
    mainTree,
    focusedPane,
    focusedClosable,
    focusedContent,
    focusMainPane,
    splitFocused,
    routeToFocused,
    setFocusDrivenContext,
    adoptDraftPanes,
    reportPaneAt,
    pruneMainPanes,
    fillMainPane,
    closeMainPane,
    closePaneFromAction,
    setMainRatio,
  }
}
