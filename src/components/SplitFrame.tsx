/** ── The split frame (spec ADAPT-16) ─────────────────────────────────────────
 *  A general tiling surface for the right panel area on the WIDE tier: renders
 *  the session's split tree (src/lib/splitFrame.ts — the pure math), each leaf
 *  hosting one of the EXISTING panels (workspace/repo, connector, attachments,
 *  runs) re-dressed through PaneChromeContext — PanelShell drops its own
 *  width/motion inside a pane, its X closes the pane, and its header gains the
 *  split buttons. Dividers are the ONE ResizeHandle primitive (keyboard-operable,
 *  UI-11), each with a distinct accessible name; ratios clamp in the math module.
 *  The frame as a whole is resizable on its left edge like the docked panel, with
 *  its own persisted width (wider default — it holds several panes). The overlay
 *  tiers never render the frame (ADAPT-11): the tree persists and the focused
 *  single panel shows instead. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { ResizeHandle } from './ResizeHandle'
import { PaneChromeContext } from './paneChrome'
import { clamp, getLayout, setLayout } from '../lib/uiPrefs'
import { clampRatio, type PaneContent, type SplitDir, type SplitNode } from '../lib/splitFrame'

/** A pane option the picker offers (derived by the caller from the live session). */
export interface PaneOption {
  content: PaneContent
  label: string
  icon?: ReactNode
}

/** The frame needs room for at least two usable panes; its max leaves the thread
 *  its reserved column (mirroring PANEL_GUTTER, a little wider for the rail). */
const FRAME_MIN = 480
const FRAME_GUTTER = 420

const frameWidthFor = (viewport: number, w: number): number =>
  clamp(w, FRAME_MIN, Math.max(FRAME_MIN, viewport - FRAME_GUTTER))

function defaultFrameWidth(): number {
  if (typeof window === 'undefined') return 720
  return frameWidthFor(window.innerWidth, Math.round(window.innerWidth * 0.55))
}

export function SplitFrame({
  tree,
  options,
  renderPane,
  onSplitPane,
  onFillPane,
  onClosePane,
  onRatio,
}: {
  tree: SplitNode
  options: PaneOption[]
  renderPane: (content: PaneContent) => ReactNode
  onSplitPane: (path: string, dir: SplitDir) => void
  onFillPane: (path: string, content: PaneContent) => void
  onClosePane: (path: string) => void
  onRatio: (path: string, ratio: number) => void
}) {
  const [width, setWidth] = useState(() => frameWidthFor(window.innerWidth, getLayout('splitW', defaultFrameWidth())))
  const widthRef = useRef(width)
  widthRef.current = width

  // Keep the frame within the viewport if the window shrinks under it (the
  // PanelShell rule: clamp at render, storage untouched).
  useEffect(() => {
    const onResize = () => setWidth((w) => frameWidthFor(window.innerWidth, w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-line bg-panel"
      style={{ width }}
      data-split-frame
    >
      <ResizeHandle
        side="left"
        label="Resize split frame"
        value={width}
        min={FRAME_MIN}
        max={Math.max(FRAME_MIN, (typeof window === 'undefined' ? 1280 : window.innerWidth) - FRAME_GUTTER)}
        onMove={(clientX) => {
          const w = frameWidthFor(window.innerWidth, window.innerWidth - clientX)
          widthRef.current = w
          setWidth(w)
        }}
        onEnd={() => setLayout('splitW', widthRef.current)}
      />
      <Branch
        node={tree}
        path=""
        options={options}
        renderPane={renderPane}
        onSplitPane={onSplitPane}
        onFillPane={onFillPane}
        onClosePane={onClosePane}
        onRatio={onRatio}
      />
    </div>
  )
}

function Branch({
  node,
  path,
  options,
  renderPane,
  onSplitPane,
  onFillPane,
  onClosePane,
  onRatio,
}: {
  node: SplitNode
  path: string
  options: PaneOption[]
  renderPane: (content: PaneContent) => ReactNode
  onSplitPane: (path: string, dir: SplitDir) => void
  onFillPane: (path: string, content: PaneContent) => void
  onClosePane: (path: string) => void
  onRatio: (path: string, ratio: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The provider value changes only with the pane's path — memo keeps embedded
  // panels from re-rendering on unrelated tree edits.
  const chrome = useMemo(
    () => ({ embedded: true, onSplit: (dir: SplitDir) => onSplitPane(path, dir), onClosePane: () => onClosePane(path) }),
    [path, onSplitPane, onClosePane],
  )

  if (node.kind === 'pane') {
    return (
      <PaneChromeContext.Provider value={chrome}>
        <div className="relative flex min-h-0 min-w-0 flex-1" data-split-pane={path || 'root'}>
          {node.content.kind === 'picker' ? (
            <PickerPane options={options} onPick={(c) => onFillPane(path, c)} onClose={() => onClosePane(path)} />
          ) : (
            renderPane(node.content)
          )}
        </div>
      </PaneChromeContext.Provider>
    )
  }

  const row = node.dir === 'row'
  const ratio = clampRatio(node.ratio)
  const child = (n: SplitNode, p: string) => (
    <Branch
      node={n}
      path={p}
      options={options}
      renderPane={renderPane}
      onSplitPane={onSplitPane}
      onFillPane={onFillPane}
      onClosePane={onClosePane}
      onRatio={onRatio}
    />
  )
  return (
    <div ref={ref} className={`flex min-h-0 min-w-0 flex-1 ${row ? 'flex-row' : 'flex-col'}`}>
      <div className="flex min-h-0 min-w-0" style={{ flex: `${ratio} 1 0%` }}>
        {child(node.a, `${path}a`)}
      </div>
      <div
        className={`relative flex min-h-0 min-w-0 ${row ? 'border-l' : 'border-t'} border-line`}
        style={{ flex: `${1 - ratio} 1 0%` }}
      >
        {/* The divider rides the SECOND child's leading edge, so its value grows
            as the client coordinate shrinks — matching the left/top slope the
            keyboard path expects. It announces the trailing pane's share (%). */}
        <ResizeHandle
          side={row ? 'left' : 'top'}
          label={`Resize split panes (${path || 'root'})`}
          value={Math.round((1 - ratio) * 100)}
          min={15}
          max={85}
          onMove={(client) => {
            const rect = ref.current?.getBoundingClientRect()
            if (!rect) return
            onRatio(path, row ? (client - rect.left) / Math.max(1, rect.width) : (client - rect.top) / Math.max(1, rect.height))
          }}
        />
        {child(node.b, `${path}b`)}
      </div>
    </div>
  )
}

/** An empty pane awaiting content — the split's second half until the user picks
 *  what to show. Duplicates are allowed on purpose (two views of the same repo —
 *  files beside diff — is the point of splitting). */
function PickerPane({
  options,
  onPick,
  onClose,
}: {
  options: PaneOption[]
  onPick: (content: PaneContent) => void
  onClose: () => void
}) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-panel" data-split-picker>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="text-sm font-semibold text-ink">Choose a panel</span>
        <button
          onClick={onClose}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-ink"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {options.length === 0 ? (
          <div className="p-3 text-sm text-ink-faint">Nothing to show here yet — attach a context first.</div>
        ) : (
          options.map((o, i) => (
            <button
              key={`${o.content.kind}:${o.content.id}:${i}`}
              onClick={() => onPick(o.content)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink transition hover:bg-surface"
            >
              {o.icon}
              <span className="truncate">{o.label}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
