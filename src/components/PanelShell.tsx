import { type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'

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
  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 388, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      className="flex h-full shrink-0 flex-col overflow-hidden border-l border-line bg-panel"
    >
      <div className="flex w-[388px] flex-1 flex-col">
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
