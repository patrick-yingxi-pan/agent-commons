/** The account-resource rail's split renderer. It uses the same SplitNode /
 * ResizeHandle grammar as the main workspace, restricted to a vertical tree.
 * Every leaf renders the complete forest; a new leaf receives a persistent
 * entry locator and begins at that row without reparenting it. */
import { useLayoutEffect, useRef, type FocusEvent, type PointerEvent, type ReactNode } from 'react'
import { clampRatio } from '../lib/splitFrame'
import type { RailPaneContent, RailSplitNode } from '../lib/railSplit'
import { ResizeHandle } from './ResizeHandle'

const RAIL_VIEW_MIN = 96

export function RailSplit({
  tree,
  focusedPane,
  onFocusPane,
  onSelectEntry,
  onRatio,
  renderPane,
}: {
  tree: RailSplitNode
  focusedPane: string
  onFocusPane: (path: string) => void
  onSelectEntry: (path: string, index: number, label: string) => void
  onRatio: (path: string, ratio: number) => void
  renderPane: (path: string) => ReactNode
}) {
  const scrollPositions = useRef(new Map<string, number>())
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto" data-rail-split>
      <RailBranch
        node={tree}
        path=""
        focusedPane={focusedPane}
        scrollPositions={scrollPositions.current}
        onFocusPane={onFocusPane}
        onSelectEntry={onSelectEntry}
        onRatio={onRatio}
        renderPane={renderPane}
      />
    </div>
  )
}

type BranchProps = {
  node: RailSplitNode
  path: string
  focusedPane: string
  scrollPositions: Map<string, number>
  onFocusPane: (path: string) => void
  onSelectEntry: (path: string, index: number, label: string) => void
  onRatio: (path: string, ratio: number) => void
  renderPane: (path: string) => ReactNode
}

function RailBranch(props: BranchProps) {
  const { node, path, onRatio } = props
  const ref = useRef<HTMLDivElement>(null)
  if (node.kind === 'pane') {
    return <RailLeaf {...props} content={node.content} />
  }

  const ratio = clampRatio(node.ratio)
  const child = (next: RailSplitNode, nextPath: string) => (
    <RailBranch {...props} node={next} path={nextPath} />
  )
  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col" data-rail-split-branch={path || 'root'}>
      <div className="flex min-h-0 min-w-0" style={{ flex: `${ratio} 1 0%`, minHeight: RAIL_VIEW_MIN }}>
        {child(node.a, `${path}a`)}
      </div>
      <div
        className="relative flex min-h-0 min-w-0 border-t border-line"
        style={{ flex: `${1 - ratio} 1 0%`, minHeight: RAIL_VIEW_MIN }}
      >
        <ResizeHandle
          side="top"
          label={`Resize sidebar views (${path || 'root'})`}
          value={Math.round((1 - ratio) * 100)}
          min={15}
          max={85}
          onMove={(clientY) => {
            const rect = ref.current?.getBoundingClientRect()
            if (!rect) return
            onRatio(path, (clientY - rect.top) / Math.max(1, rect.height))
          }}
        />
        {child(node.b, `${path}b`)}
      </div>
    </div>
  )
}

function RailLeaf({
  content,
  path,
  focusedPane,
  scrollPositions,
  onFocusPane,
  onSelectEntry,
  renderPane,
}: BranchProps & { content: RailPaneContent }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const body = scrollRef.current
    if (!body) return
    const remembered = scrollPositions.get(content.id)
    if (remembered !== undefined) {
      body.scrollTop = remembered
      return
    }
    body.scrollTop = 0
    if (content.anchorIndex === undefined) return
    const anchorIndex = content.anchorIndex
    // A split remounts local disclosure state. Prefer the selected row's label
    // (and its canonical active projection) before its former ordinal so a
    // capped or multiply-nested entry still becomes the new view's visual top.
    // Data-backed rows may arrive after this layout pass; observe until the
    // semantic row appears, then replace any provisional ordinal alignment.
    const alignAnchor = (): boolean => {
      const entries = Array.from(body.querySelectorAll<HTMLElement>('[data-rail-entry]'))
      const sameLabel = content.anchorLabel
        ? entries.filter((entry) => railEntryLabel(entry) === content.anchorLabel)
        : []
      const exact =
        sameLabel.find((entry) => entry.getAttribute('aria-current') === 'page') ?? sameLabel[0]
      const target =
        exact ??
        entries.find((entry) => entry.getAttribute('aria-current') === 'page') ??
        entries[anchorIndex]
      if (target) {
        body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top
        scrollPositions.set(content.id, body.scrollTop)
      }
      return !!exact
    }
    if (alignAnchor()) return
    const observer = new MutationObserver(() => {
      if (alignAnchor()) observer.disconnect()
    })
    observer.observe(body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [content.id, content.anchorIndex, content.anchorLabel, path, scrollPositions])

  const selectFrom = (target: EventTarget | null) => {
    const body = scrollRef.current
    const element = target instanceof Element ? target.closest<HTMLElement>('[data-rail-entry]') : null
    if (!body || !element || !body.contains(element)) {
      onFocusPane(path)
      return
    }
    const index = Array.from(body.querySelectorAll<HTMLElement>('[data-rail-entry]')).indexOf(element)
    if (index >= 0) onSelectEntry(path, index, railEntryLabel(element))
  }

  return (
    <div
      className={`relative flex min-h-0 min-w-0 flex-1 flex-col transition-colors ${
        focusedPane === path ? 'bg-canvas' : 'bg-sidebar'
      }`}
      data-rail-pane={path || 'root'}
      data-rail-view-id={content.id}
      data-focused={focusedPane === path || undefined}
      onPointerDownCapture={(event: PointerEvent<HTMLDivElement>) => selectFrom(event.target)}
      onFocusCapture={(event: FocusEvent<HTMLDivElement>) => selectFrom(event.target)}
    >
      <div
        ref={scrollRef}
        data-rail-scroll-pane={path || 'root'}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-1"
        onScroll={(event) => scrollPositions.set(content.id, event.currentTarget.scrollTop)}
      >
        {renderPane(path)}
      </div>
    </div>
  )
}

const railEntryLabel = (entry: HTMLElement): string =>
  (entry.getAttribute('aria-label') ?? entry.textContent ?? '').trim().replace(/\s+/g, ' ')
