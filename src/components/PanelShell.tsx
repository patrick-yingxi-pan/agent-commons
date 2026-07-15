import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Columns2, Rows2, X } from 'lucide-react'
import { ResizeHandle } from './ResizeHandle'
import { PaneChromeContext } from './paneChrome'
import { clamp, getLayout, setLayout } from '../lib/uiPrefs'
import { PANEL_MIN, PANEL_MAX, panelWidthFor, useViewport } from '../lib/viewport'

/** Default before the user has dragged: a fluid ~34vw, clamped. */
function defaultWidth() {
  if (typeof window === 'undefined') return 388
  return clamp(Math.round(window.innerWidth * 0.34), PANEL_MIN, PANEL_MAX)
}

/** The sliding right-hand sidebar chrome shared by every context panel
 *  (workspace, repo, connector, file, photo): same animation, close button, and
 *  a drag handle on its left edge to resize. Width persists across panels and
 *  reloads. The body is supplied per context.
 *
 *  On the narrow tier (FWD-3) the panel takes over the whole viewport instead:
 *  full width, slid in as a transform (animating `width` on a full-viewport
 *  surface re-layouts every frame on mobile), no resize handle. The two modes
 *  render under different keys so framer never tweens px↔% when the tier flips
 *  mid-open. */
export function PanelShell({
  icon,
  title,
  count,
  headerRight,
  onClose,
  children,
}: {
  icon: ReactNode
  title: ReactNode
  count?: number
  headerRight?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const { tier } = useViewport()
  const takeover = tier === 'narrow'
  // The split frame's chrome adaptation (ADAPT-16, src/components/paneChrome.ts):
  // embedded panes fill their split node instead of owning width/motion, the X
  // retargets at the pane, and split buttons appear when a handler is provided.
  const chrome = useContext(PaneChromeContext)
  const [width, setWidth] = useState(() =>
    clamp(getLayout('rightW', defaultWidth()), PANEL_MIN, PANEL_MAX),
  )
  const [dragging, setDragging] = useState(false)
  const widthRef = useRef(width)
  widthRef.current = width
  // A keyboard step runs start → move → end in ONE tick; committing dragging=false
  // in that same batch would spring-animate the step (and the handle's rect — a
  // child of the animated motion.div — would lag the committed width, making the
  // next press re-snap to a stale position and swallow motion under key repeat).
  // Dropping the flag a frame later keeps the keyboard gesture on the pointer
  // path's duration:0, with no pending width change left to animate.
  const dropDragRaf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(dropDragRaf.current), [])

  // Keep the panel within the viewport if the window shrinks under it.
  useEffect(() => {
    const onResize = () => setWidth((w) => panelWidthFor('wide', window.innerWidth, w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // The handle sits on the panel's left edge; the panel is flush-right, so the
  // width is the distance from the pointer to the right of the viewport. It
  // refreshes the persist ref itself (not just at render): a keyboard step runs
  // resize → the persisting onEnd in one tick, before React re-renders.
  const resize = (clientX: number) => {
    const w = panelWidthFor(tier, window.innerWidth, window.innerWidth - clientX)
    widthRef.current = w
    setWidth(w)
  }

  const header = (
    <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{title}</span>
      </span>
      {count != null && <span className="shrink-0 text-[11px] text-ink-faint">{count}</span>}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {headerRight}
        {chrome.onSplit && (
          <>
            <button
              onClick={() => chrome.onSplit!('row')}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-ink"
              title="Split right"
              data-split="row"
            >
              <Columns2 size={15} />
            </button>
            <button
              onClick={() => chrome.onSplit!('col')}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-ink"
              title="Split down"
              data-split="col"
            >
              <Rows2 size={15} />
            </button>
          </>
        )}
        <button
          onClick={chrome.onClosePane ?? onClose}
          className={`flex items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-ink ${
            takeover ? 'h-9 w-9' : 'h-7 w-7'
          }`}
          title="Close"
        >
          <X size={takeover ? 18 : 16} />
        </button>
      </div>
    </div>
  )

  // Inside a split-frame pane: the pane's node owns geometry — plain fill, no
  // width state, no slide animation (the frame mounts/unmounts panes in place).
  if (chrome.embedded) {
    return (
      <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-panel">
        {header}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    )
  }

  if (takeover) {
    return (
      <motion.div
        key="takeover"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        className="relative flex h-full w-full flex-col overflow-hidden border-l border-line bg-panel"
      >
        {header}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </motion.div>
    )
  }

  return (
    <motion.div
      key="docked"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={dragging ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 30 }}
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-line bg-panel"
    >
      <ResizeHandle
        side="left"
        label="Resize panel"
        value={width}
        min={PANEL_MIN}
        max={PANEL_MAX}
        onStart={() => setDragging(true)}
        onMove={resize}
        onEnd={() => {
          dropDragRaf.current = requestAnimationFrame(() => setDragging(false))
          setLayout('rightW', widthRef.current)
        }}
      />
      <div className="flex flex-1 flex-col" style={{ width }}>
        {header}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </motion.div>
  )
}
