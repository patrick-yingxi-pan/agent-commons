import { Sparkles } from 'lucide-react'
import { Spinner } from './Spinner'
import { InlineOperationStatus } from './InlineOperationStatus'
import {
  enqueueSessionCompaction,
  heldSessionCompactionIntent,
  useSessionCompactionStatus,
} from '../controller/sessionCompactionMutations'

/** Inline MODEL-32 affordance shown when the open thread is long enough to compact.
 *  The server asks the selected provider for a continuation brief, then compare-commits
 *  it with a recoverable archive. Its account/session controller retains the exact
 *  request through navigation and response loss; the shell owns Retry/Dismiss while
 *  this source surface stays visibly held. Once active context shrinks, it hides. */
export function CompactionAffordance({
  sessionId,
  tenantId,
}: {
  sessionId: string
  tenantId?: string
}) {
  const mutation = useSessionCompactionStatus()
  const held = heldSessionCompactionIntent(sessionId)
  const active = held !== null && mutation.activeResourceId === sessionId
  const run = () => {
    if (!tenantId || held) return
    void enqueueSessionCompaction({ tenantId, sessionId })
  }
  if (held && (!active || mutation.busy)) {
    return (
      <InlineOperationStatus
        tone="status"
        leading={<Spinner size={13} />}
        message={active ? 'Compacting our conversation so we can keep chatting…' : 'Compaction queued…'}
      />
    )
  }
  if (held && mutation.error) {
    return (
      <InlineOperationStatus
        tone="alert"
        message={mutation.error}
      />
    )
  }
  return (
    <div className="mx-auto mb-1.5 flex w-full max-w-3xl justify-center">
      <button
        onClick={run}
        disabled={!tenantId}
        aria-label="Compact conversation to free up context"
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2/40 px-3 py-1 text-[12px] text-ink-soft transition hover:bg-panel-2 disabled:opacity-70"
      >
        <Sparkles size={13} className="text-accent" />
        Compact conversation to free up context
      </button>
    </div>
  )
}
