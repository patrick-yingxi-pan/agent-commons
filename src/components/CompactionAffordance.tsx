import { useState } from 'react'
import { Sparkles } from 'lucide-react'

/** Inline affordance shown above the composer when the open thread is long enough to
 *  compact (P5 / BROKER-EXP-3). Clicking asks the backend (server-owned) to archive the
 *  older messages behind a summary marker, freeing context space — the usage gauge disc
 *  then drops back and a compaction divider appears in the thread. While it runs it shows
 *  the warm, first-person caption from docs/context-compaction.md ("no blame, no limits
 *  language"). Once compacted the thread is short again, so the affordance hides itself. */
export function CompactionAffordance({ onCompact }: { onCompact: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onCompact()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mx-auto mb-1.5 flex w-full max-w-3xl justify-center">
      <button
        onClick={run}
        disabled={busy}
        aria-label="Compact conversation to free up context"
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2/40 px-3 py-1 text-[12px] text-ink-soft transition hover:bg-panel-2 disabled:opacity-70"
      >
        <Sparkles size={13} className={`text-accent ${busy ? 'animate-pulse' : ''}`} />
        {busy ? 'Compacting our conversation so we can keep chatting…' : 'Compact conversation to free up context'}
      </button>
    </div>
  )
}
