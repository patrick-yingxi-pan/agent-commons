import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Spinner } from './Spinner'
import { InlineOperationStatus } from './InlineOperationStatus'

/** Inline MODEL-32 affordance shown when the open thread is long enough to compact.
 *  The server asks the selected provider for a continuation brief, then compare-commits
 *  it with a recoverable archive; failure remains explicit and retryable. While it runs,
 *  the warm first-person caption from docs/context-compaction.md avoids blame or limits
 *  language. Once active context shrinks, the affordance hides itself. */
export function CompactionAffordance({
  onCompact,
  onRunningChange,
}: {
  onCompact: () => Promise<void>
  onRunningChange?: (running: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    if (busy) return
    setError(null)
    setBusy(true)
    onRunningChange?.(true)
    try {
      await onCompact()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The conversation could not be compacted. Nothing was archived.')
    } finally {
      setBusy(false)
      onRunningChange?.(false)
    }
  }
  if (busy) {
    return (
      <InlineOperationStatus
        tone="status"
        leading={<Spinner size={13} />}
        message="Compacting our conversation so we can keep chatting…"
      />
    )
  }
  if (error) {
    return (
      <InlineOperationStatus
        tone="alert"
        message={error}
        action={{ label: 'Retry compaction', icon: <Sparkles size={12} />, onClick: () => void run() }}
      />
    )
  }
  return (
    <div className="mx-auto mb-1.5 flex w-full max-w-3xl justify-center">
      <button
        onClick={run}
        disabled={busy}
        aria-label="Compact conversation to free up context"
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2/40 px-3 py-1 text-[12px] text-ink-soft transition hover:bg-panel-2 disabled:opacity-70"
      >
        <Sparkles size={13} className={`text-accent ${busy ? 'motion-safe:animate-pulse' : ''}`} />
        Compact conversation to free up context
      </button>
    </div>
  )
}
