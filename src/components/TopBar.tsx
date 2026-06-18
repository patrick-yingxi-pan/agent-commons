import { Info } from 'lucide-react'
import { ClaudeMark } from './ClaudeMark'

export function TopBar({ onAbout }: { onAbout: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-canvas/80 px-4 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <ClaudeMark />
        <span className="font-serif text-[17px] font-semibold tracking-tight text-ink">Claude</span>
        <span className="ml-1 rounded-full border border-line-strong bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-soft">
          Unified Workspace · concept
        </span>
      </div>
      <button
        onClick={onAbout}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-surface hover:text-ink"
      >
        <Info size={15} />
        About this proposal
      </button>
    </header>
  )
}
