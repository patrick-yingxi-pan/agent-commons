/** The account-resource rail's split renderer. It uses the same SplitNode /
 * ResizeHandle grammar as the main workspace, restricted to a vertical tree.
 * Every leaf renders the canonical resource tree; a rooted leaf projects only
 * the selected node and its descendants, without changing canonical identity. */
import { useLayoutEffect, useRef, type FocusEvent, type PointerEvent, type ReactNode } from 'react'
import { clampRatio } from '../lib/splitFrame'
import type { RailPaneContent, RailSplitNode, RailViewRoot } from '../lib/railSplit'
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
  onSelectEntry: (path: string, root: RailViewRoot) => void
  onRatio: (path: string, ratio: number) => void
  renderPane: (path: string, content: RailPaneContent) => ReactNode
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
  onSelectEntry: (path: string, root: RailViewRoot) => void
  onRatio: (path: string, ratio: number) => void
  renderPane: (path: string, content: RailPaneContent) => ReactNode
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
        className="relative flex min-h-0 min-w-0"
        style={{ flex: `${1 - ratio} 1 0%`, minHeight: RAIL_VIEW_MIN }}
      >
        <ResizeHandle
          side="top"
          ownsEdge
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
    let positioned = false
    const clearProjection = () => {
      body.removeAttribute('data-rail-rooted')
      body.removeAttribute('data-rail-root-pending')
      body.querySelectorAll<HTMLElement>('[data-rail-root-hidden]').forEach((element) => {
        element.removeAttribute('data-rail-root-hidden')
      })
      body.querySelectorAll<HTMLElement>('[data-rail-root-ancestor]').forEach((element) => {
        element.removeAttribute('data-rail-root-ancestor')
      })
      body.querySelectorAll<HTMLElement>('[data-rail-root-target]').forEach((element) => {
        element.removeAttribute('data-rail-root-target')
      })
    }
    const position = () => {
      if (positioned) return
      body.scrollTop = remembered ?? 0
      positioned = true
    }
    const root = content.root
    if (!root) {
      clearProjection()
      position()
      return
    }
    body.setAttribute('data-rail-root-pending', '')
    const applyRootProjection = (): boolean => {
      clearProjection()
      body.setAttribute('data-rail-root-pending', '')
      const forest = body.querySelector<HTMLElement>('[data-rail-forest]')
      const nodes = Array.from(body.querySelectorAll<HTMLElement>('[data-rail-node-key]'))
      const findNode = (key: string) => nodes.find((node) => node.dataset.railNodeKey === key)
      const target = findNode(root.key)
      const ancestors = root.ancestors.map(findNode)
      if (!forest || !target || ancestors.some((node) => !node)) return false
      const chain = [...(ancestors as HTMLElement[]), target]
      const hide = (element: Element) => element.setAttribute('data-rail-root-hidden', '')
      const keepOnly = (container: HTMLElement, kept: HTMLElement) => {
        Array.from(container.children).forEach((child) => {
          if (child !== kept) hide(child)
        })
      }
      keepOnly(forest, chain[0])
      for (let index = 0; index < ancestors.length; index += 1) {
        const ancestor = ancestors[index] as HTMLElement
        const row = Array.from(ancestor.children).find((child) => child.hasAttribute('data-rail-node-row'))
        const children = Array.from(ancestor.children).find((child) => child.hasAttribute('data-rail-node-children'))
        if (!(children instanceof HTMLElement)) return false
        if (row) hide(row)
        ancestor.setAttribute('data-rail-root-ancestor', '')
        keepOnly(children, chain[index + 1])
      }
      target.setAttribute('data-rail-root-target', '')
      body.removeAttribute('data-rail-root-pending')
      body.setAttribute('data-rail-rooted', '')
      position()
      return true
    }
    applyRootProjection()
    const observer = new MutationObserver(() => {
      applyRootProjection()
    })
    observer.observe(body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      clearProjection()
    }
  }, [content.id, content.root, path, scrollPositions])

  const selectFrom = (target: EventTarget | null) => {
    const body = scrollRef.current
    const element = target instanceof Element ? target.closest<HTMLElement>('[data-rail-entry]') : null
    if (!body || !element || !body.contains(element)) {
      onFocusPane(path)
      return
    }
    const node = element.closest<HTMLElement>('[data-rail-node-key]')
    if (!node || !body.contains(node) || !node.dataset.railNodeKey) {
      onFocusPane(path)
      return
    }
    const ancestors: string[] = []
    let parent = node.parentElement?.closest<HTMLElement>('[data-rail-node-key]') ?? null
    while (parent && body.contains(parent)) {
      if (parent.dataset.railNodeKey) ancestors.unshift(parent.dataset.railNodeKey)
      parent = parent.parentElement?.closest<HTMLElement>('[data-rail-node-key]') ?? null
    }
    onSelectEntry(path, {
      key: node.dataset.railNodeKey,
      label: railEntryLabel(element),
      ancestors,
    })
  }

  return (
    <div
      className={`relative flex min-h-0 min-w-0 flex-1 flex-col transition-colors ${
        focusedPane === path ? 'bg-canvas' : 'bg-sidebar'
      }`}
      data-rail-pane={path || 'root'}
      data-rail-view-id={content.id}
      data-rail-view-root={content.root?.key}
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
        {renderPane(path, content)}
      </div>
    </div>
  )
}

const railEntryLabel = (entry: HTMLElement): string =>
  (entry.getAttribute('aria-label') ?? entry.textContent ?? '').trim().replace(/\s+/g, ' ')
