import type { ReactNode } from 'react'
import { ChevronRight, FolderSearch } from 'lucide-react'

/** The dashed "Browse…" row that ends every recents list and opens the explorer. */
export function BrowseRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line-strong px-2 py-1.5 text-left text-ink-soft transition hover:bg-panel-2 hover:text-ink"
    >
      <FolderSearch size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 text-[13px] font-medium">{label}</span>
      <ChevronRight size={15} className="shrink-0 text-ink-faint" />
    </button>
  )
}


/** Footer for the multi-add pickers: a running "N added" count and a Done button
 *  to close (click-outside / Esc also close). Signals that adds don't close the
 *  picker, so you can keep clicking. */
export function MultiAddFooter({ count, onDone }: { count: number; onDone: () => void }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2 border-t border-line px-1 pt-2">
      <span className="min-w-0 truncate text-[11px] text-ink-faint">
        {count === 0 ? 'Add as many as you need' : `${count} added`}
      </span>
      <button
        type="button"
        onClick={onDone}
        className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-ink ring-1 ring-line-strong transition hover:bg-panel-2"
      >
        Done
      </button>
    </div>
  )
}


export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pb-1">
      <p className="px-1 pb-1.5 text-[11px] text-ink-faint">{label}</p>
      {children}
    </div>
  )
}
