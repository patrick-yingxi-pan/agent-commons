/** One global, non-blocking disclosure for degraded ambient synchronization.
 * Cached pages and ordinary requests remain usable; this says only the precise
 * thing the client knows: unrequested live updates are recovering. */
import { RefreshCw } from 'lucide-react'
import { useAmbientSyncHealth } from '../api'

export function SyncHealthNotice() {
  const health = useAmbientSyncHealth()
  if (health !== 'recovering') return null
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-sync-health="recovering"
      className="flex min-h-8 shrink-0 items-center justify-center gap-2 border-b border-warn/30 bg-warn-tint px-3 py-1 text-center text-[12px] font-medium text-warn-text"
    >
      <RefreshCw size={13} aria-hidden className="shrink-0 motion-safe:animate-spin" />
      <span>Live updates paused. Reconnecting…</span>
    </div>
  )
}
