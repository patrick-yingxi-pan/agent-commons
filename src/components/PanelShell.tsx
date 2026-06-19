import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { ResizeHandle } from './ResizeHandle'
import { clamp, getLayout, setLayout } from '../lib/uiPrefs'

const MIN = 300
const MAX = 640

/** Default before the user has dragged: a fluid ~34vw, clamped. */
function defaultWidth() {
  if (typeof window === 'undefined') return 388
  return clamp(Math.round(window.innerWidth * 0.34), MIN, MAX)
}

/** The largest the panel may grow without crushing the conversation column. */
function ceilingFor(vw: number) {
  return Math.min(MAX, Math.max(MIN, vw - 360))
}

/** The sliding right-hand sidebar chrome shared by every context panel
 *  (workspace, repo, connector, file, photo): same animation, close button, and
 *  a drag handle on its left edge to resize. Width persists across panels and
 *  reloads. The body is supplied per context. */
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
  const [width, setWidth] = useState(() => clamp(getLayout('rightW', defaultWidth()), MIN, MAX))
  const [dragging, setDragging] = useState(false)
  const widthRef = useRef(width)
  widthRef.current = width

  // Keep the panel within the viewport if the window shrinks under it.
  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w, MIN, ceilingFor(window.innerWidth)))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // The handle sits on the panel's left edge; the panel is flush-right, so the
  // width is the distance from the pointer to the right of the viewport.
  const resize = (clientX: number) =>
    setWidth(clamp(window.innerWidth - clientX, MIN, ceilingFor(window.innerWidth)))

  return (
    <motion.div
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
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-ink"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </motion.div>
  )
}
