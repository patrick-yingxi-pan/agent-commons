import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { ResizeHandle } from './ResizeHandle'
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
  const [width, setWidth] = useState(() =>
    clamp(getLayout('rightW', defaultWidth()), PANEL_MIN, PANEL_MAX),
  )
  const [dragging, setDragging] = useState(false)
  const widthRef = useRef(width)
  widthRef.current = width

  // Keep the panel within the viewport if the window shrinks under it.
  useEffect(() => {
    const onResize = () => setWidth((w) => panelWidthFor('wide', window.innerWidth, w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // The handle sits on the panel's left edge; the panel is flush-right, so the
  // width is the distance from the pointer to the right of the viewport.
  const resize = (clientX: number) =>
    setWidth(panelWidthFor(tier, window.innerWidth, window.innerWidth - clientX))

  const header = (
    <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{title}</span>
      </span>
      {count != null && <span className="shrink-0 text-[11px] text-ink-faint">{count}</span>}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {headerRight}
        <button
          onClick={onClose}
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
        onStart={() => setDragging(true)}
        onMove={resize}
        onEnd={() => {
          setDragging(false)
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
