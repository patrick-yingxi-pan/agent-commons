/** The empty pane's content picker — legacy: pre-duplicate-split blobs may
 *  still hold empty picker panes; the UI renders them but nothing mints them
 *  anymore (a split DUPLICATES the focused pane — no picker step). */
import { MessageSquare } from 'lucide-react'
import { useSessions } from '../api'
import { SECTION_META } from '../lib/sections'
import type { MainPaneContent } from '../lib/mainSplit'
import type { SectionId } from '../types'

export function MainPicker({ onPick }: { onPick: (content: MainPaneContent) => void }) {
  const sessions = useSessions().data ?? []
  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-canvas" data-main-picker>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="px-1 pb-2 text-[12px] font-medium text-ink-faint">Choose what this pane shows</div>
        {(Object.keys(SECTION_META) as SectionId[]).map((id) => {
          const meta = SECTION_META[id]
          return (
            <button
              key={id}
              onClick={() => onPick({ kind: 'msection', id })}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink transition hover:bg-surface"
            >
              <meta.Icon size={16} className="shrink-0 text-ink-soft" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{meta.label}</span>
                <span className="block truncate text-[12px] text-ink-faint">{meta.subtitle}</span>
              </span>
            </button>
          )
        })}
        {sessions.length > 0 && (
          <>
            <div className="px-1 pb-2 pt-3 text-[12px] font-medium text-ink-faint">Conversations</div>
            {sessions.slice(0, 12).map((s) => (
              <button
                key={s.id}
                onClick={() => onPick({ kind: 'msession', id: s.id })}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink transition hover:bg-surface"
                data-pick-session={s.id}
              >
                <MessageSquare size={16} className="shrink-0 text-ink-soft" />
                <span className="truncate font-medium">{s.title}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
