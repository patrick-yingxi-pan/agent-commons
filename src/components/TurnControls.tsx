/** The live-turn affordances above the composer (multi-account design §6.5):
 *
 *  • STREAMING — a turn is generating for this thread: offer the deliberate
 *    stop. The button cancels the SERVER-owned turn (`POST …/cancel`); the
 *    partial persists and the stream's own `message.end` is what stands the
 *    local streaming state down — nothing is faked client-side.
 *  • INTERRUPTED — the thread's last word is the user's with nothing
 *    generating (a turn orphaned by a server restart, or a failed send): offer
 *    a retry. Deliberately a FRESH send — the record stays honest.
 *
 *  One component for both so the two states can't drift apart visually — the
 *  same slot, the same shape, opposite verbs. */
import { CircleStop, RotateCcw } from 'lucide-react'

export function TurnControls({
  mode,
  onStop,
  onRetry,
}: {
  mode: 'streaming' | 'interrupted'
  onStop: () => void
  onRetry: () => void
}) {
  const streaming = mode === 'streaming'
  return (
    <div className="mb-2 flex items-center justify-center gap-2 text-[12px] text-ink-faint">
      <span>{streaming ? 'Claude is writing…' : 'Generation was interrupted.'}</span>
      <button
        onClick={streaming ? onStop : onRetry}
        className="flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-ink-soft transition hover:bg-panel-2 hover:text-ink"
      >
        {streaming ? <CircleStop size={12} /> : <RotateCcw size={12} />}
        {streaming ? 'Stop' : 'Retry'}
      </button>
    </div>
  )
}
