import { useId, useRef, type ReactNode } from 'react'
import type { WorkbookSheet } from '../../contract/index.ts'

/** Reading and editing share one keyboard tab strip. Tab identity is local to
 * the body; only the enclosing artifact controls authority and saving. */
export function WorkbookTabs({ sheets, activeId, onSelect, children }: {
  sheets: WorkbookSheet[]
  activeId: string
  onSelect: (id: string) => void
  children: ReactNode
}) {
  const prefix = useId()
  const list = useRef<HTMLDivElement>(null)
  const activeIndex = Math.max(0, sheets.findIndex(sheet => sheet.id === activeId))
  return <div className="min-w-0 space-y-2" data-workbook-tabs>
    <div ref={list} role="tablist" aria-label="Worksheets" className="flex min-w-0 flex-wrap gap-1 border-b border-line pb-2">
      {sheets.map((sheet, index) => <button key={sheet.id} type="button" role="tab"
        id={`${prefix}-tab-${index}`} aria-controls={`${prefix}-panel`} aria-selected={index === activeIndex}
        tabIndex={index === activeIndex ? 0 : -1} title={sheet.name}
        className={`min-h-8 max-w-full rounded-md px-2.5 py-1 text-[12px] break-words [overflow-wrap:anywhere] outline-none focus-visible:ring-2 focus-visible:ring-accent ${index === activeIndex ? 'bg-panel-2 font-semibold text-ink' : 'text-ink-soft hover:bg-panel-2/60'}`}
        onClick={() => onSelect(sheet.id)}
        onKeyDown={event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? sheets.length - 1
            : event.key === 'ArrowRight' ? (index + 1) % sheets.length
              : event.key === 'ArrowLeft' ? (index + sheets.length - 1) % sheets.length : null
          if (next === null) return
          event.preventDefault()
          onSelect(sheets[next]!.id)
          list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
        }}>
        {sheet.name || `Unnamed sheet ${index + 1}`}
      </button>)}
    </div>
    <div role="tabpanel" id={`${prefix}-panel`} aria-labelledby={`${prefix}-tab-${activeIndex}`} tabIndex={0} className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-accent">
      {children}
    </div>
  </div>
}
