import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'

/** Panel width: a fluid ~34vw, clamped so it never gets cramped or so wide it
 *  crushes the conversation on a narrowed (non-maximized) window. */
function panelWidth() {
  if (typeof window === 'undefined') return 388
  return Math.round(Math.max(300, Math.min(388, window.innerWidth * 0.34)))
}

function usePanelWidth() {
  const [w, setW] = useState(panelWidth)
  useEffect(() => {
    const onResize = () => setW(panelWidth())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return w
}

/** The sliding right-hand sidebar chrome shared by every context panel
 *  (workspace, repo, connector, file, photo): same width, animation, and a
 *  close button. The body is supplied per context. */
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
  const width = usePanelWidth()
  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      className="flex h-full shrink-0 flex-col overflow-hidden border-l border-line bg-panel"
    >
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
