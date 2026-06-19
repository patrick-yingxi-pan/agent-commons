import { PanelLeft, PanelLeftClose } from 'lucide-react'
import { ClaudeMark } from './ClaudeMark'

/** The product's own top bar — kept clean (sidebar toggle + wordmark) so the
 *  mock reads like the real app. The proposal framing lives above it, in the
 *  ProposalBar. */
export function TopBar({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen: boolean
  onToggleSidebar: () => void
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line bg-canvas/80 px-4 backdrop-blur">
      <button
        onClick={onToggleSidebar}
        title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-expanded={sidebarOpen}
        className="-ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-ink"
      >
        {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
      </button>
      <ClaudeMark />
      <span className="font-serif text-[17px] font-semibold tracking-tight text-ink">Claude</span>
    </header>
  )
}
