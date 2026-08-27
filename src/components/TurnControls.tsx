/** The live-turn affordances above the composer (multi-account design §6.5):
 *
 *  • STREAMING — a turn is generating for this thread: offer the deliberate
 *    stop. The button cancels the SERVER-owned turn (`POST …/cancel`); the
 *    partial persists and the stream's own `message.end` is what stands the
 *    local streaming state down — nothing is faked client-side.
 *  • INTERRUPTED — the thread's last word is the user's with nothing
 *    generating (a turn orphaned by a server restart, or a failed send): offer
 *    an in-place retry of that one logical turn. A retained transport key
 *    attaches/replays; a reload reuses the server-owned final user row.
 *
 *  One component for both so the two states can't drift apart visually — the
 *  same slot, the same shape, opposite verbs. */
import { CircleStop, RotateCcw } from 'lucide-react'

export function TurnControls({
  mode,
  reason,
  onStop,
  onRetry,
}: {
  mode: 'streaming' | 'interrupted'
  /** The server's own refusal copy when a send was refused at a pre-persist gate
   *  (e.g. a Session provider's "Your session isn't answering — start its drain
   *  loop and retry") — actionable copy over the generic line. */
  reason?: string | null
  onStop: () => void
  onRetry: () => void
}) {
  const streaming = mode === 'streaming'
  return (
    <div
      role={streaming ? 'status' : 'alert'}
      aria-live={streaming ? 'polite' : 'assertive'}
      className="mb-2 flex items-center justify-center gap-2 text-[12px] text-ink-faint"
    >
      <span>{streaming ? 'Claude is writing…' : (reason ?? 'Generation was interrupted.')}</span>
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
