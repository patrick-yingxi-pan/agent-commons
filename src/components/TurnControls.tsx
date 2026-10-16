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
import { InlineOperationStatus } from './InlineOperationStatus'
import type { StopRequestState } from '../controller/conversationCore'

export function TurnControls({
  mode,
  reason,
  stopRequest,
  canStop = false,
  onStop,
  onRetry,
}: {
  mode: 'streaming' | 'interrupted'
  /** The server's own refusal copy when a send was refused at a pre-persist gate
   *  (e.g. a Session provider's "Your session isn't answering — start its drain
   *  loop and retry") — actionable copy over the generic line. */
  reason?: string | null
  stopRequest?: StopRequestState | null
  canStop?: boolean
  onStop: () => void
  onRetry: () => void
}) {
  const streaming = mode === 'streaming'
  const stopping = streaming ? stopRequest?.phase : undefined
  const message = stopping === 'pending' ? 'Stopping…'
    : stopping === 'requested' ? 'Stop requested. Waiting for the reply to finish…'
      : stopping === 'failed' ? 'Couldn’t confirm Stop. The reply may still be running.'
        : streaming ? 'Generating a reply…' : (reason ?? 'Generation was interrupted.')
  return (
    <InlineOperationStatus
      tone={streaming && stopping !== 'failed' ? 'status' : 'alert'}
      message={message}
      action={(!canStop && streaming) || stopping === 'pending' || stopping === 'requested' ? undefined : {
        label: streaming ? (stopping === 'failed' ? 'Retry stop' : 'Stop') : 'Retry',
        icon: streaming ? <CircleStop size={12} /> : <RotateCcw size={12} />,
        onClick: streaming ? onStop : onRetry,
      }}
    />
  )
}
