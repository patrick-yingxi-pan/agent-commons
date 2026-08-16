/** Focus + edits for the rail's vertical-only split tree. The interaction
 * mirrors useMainSplit: one focused leaf, split that leaf, close that leaf,
 * persist the tree. Selection is transient and names the entry that a newly
 * split view should place at its visual top. */
import { useCallback, useRef, useState } from 'react'
import { nodeAt, panes, setRatio } from '../lib/splitFrame'
import {
  closeRailView,
  getRailSplitPref,
  setRailSplitPref,
  splitRailView,
  type RailSplitNode,
} from '../lib/railSplit'

const firstPanePath = (tree: RailSplitNode): string => panes(tree)[0]?.path ?? ''
let railViewSequence = 0
const nextRailViewId = (): string => `rail-view-${Date.now().toString(36)}-${++railViewSequence}`

export function useRailSplit() {
  const [railTree, setRailTreeState] = useState<RailSplitNode>(() => getRailSplitPref())
  const treeRef = useRef(railTree)
  treeRef.current = railTree

  const [focusedRailPane, setFocusedRailPane] = useState(() => firstPanePath(treeRef.current))
  const focusedRef = useRef(focusedRailPane)
  focusedRef.current = focusedRailPane

  const [selectedEntry, setSelectedEntry] = useState<{
    path: string
    index: number
    label: string
  } | null>(null)
  const selectedRef = useRef(selectedEntry)
  selectedRef.current = selectedEntry

  const commit = useCallback((next: RailSplitNode) => {
    treeRef.current = next
    setRailTreeState(next)
    setRailSplitPref(next)
    const focused = focusedRef.current
    if (nodeAt(next, focused)?.kind !== 'pane') {
      const descended = nodeAt(next, focused)?.kind === 'split' ? `${focused}a` : null
      focusedRef.current = descended && nodeAt(next, descended)?.kind === 'pane' ? descended : firstPanePath(next)
      setFocusedRailPane(focusedRef.current)
    }
  }, [])

  const focusRailPane = useCallback((path: string) => {
    if (nodeAt(treeRef.current, path)?.kind !== 'pane') return
    if (focusedRef.current !== path) {
      focusedRef.current = path
      setFocusedRailPane(path)
    }
    selectedRef.current = null
    setSelectedEntry(null)
  }, [])

  const selectRailEntry = useCallback((path: string, index: number, label: string) => {
    if (nodeAt(treeRef.current, path)?.kind !== 'pane') return
    focusedRef.current = path
    setFocusedRailPane(path)
    const selection = { path, index, label }
    selectedRef.current = selection
    setSelectedEntry(selection)
  }, [])

  const splitFocusedRail = useCallback(() => {
    const selection = selectedRef.current
    const tree = treeRef.current
    const path = focusedRef.current
    if (!selection || selection.path !== path || nodeAt(tree, path)?.kind !== 'pane') return
    commit(splitRailView(tree, path, selection.index, selection.label, nextRailViewId()))
    focusedRef.current = `${path}b`
    setFocusedRailPane(focusedRef.current)
    selectedRef.current = { path: focusedRef.current, index: selection.index, label: selection.label }
    setSelectedEntry(selectedRef.current)
  }, [commit])

  const closeFocusedRail = useCallback(() => {
    const tree = treeRef.current
    if (panes(tree).length <= 1) return
    commit(closeRailView(tree, focusedRef.current))
    selectedRef.current = null
    setSelectedEntry(null)
  }, [commit])

  const setRailRatio = useCallback(
    (path: string, ratio: number) => commit(setRatio(treeRef.current, path, ratio)),
    [commit],
  )

  return {
    railTree,
    focusedRailPane,
    railCanSplit: selectedEntry?.path === focusedRailPane,
    railCanClose: panes(railTree).length > 1,
    focusRailPane,
    selectRailEntry,
    splitFocusedRail,
    closeFocusedRail,
    setRailRatio,
  }
}
