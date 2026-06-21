/** ── The event stream router ────────────────────────────────────────────────
 *  One long-lived SSE connection to `GET /v1/events`, via the browser's native
 *  `EventSource` (auto-reconnecting). Every ambient `ServerEvent` lands here and
 *  is turned into a cache patch — the single place server pushes become UI
 *  updates. Reply-stream events (a turn's token deltas) are handled separately by
 *  the send command; this stream is for changes nobody requested: a scheduled run
 *  firing, a standing approval acting, a connector's auth expiring.
 *
 *  The router grows one `case` per phase; Phase 1 wires liveness + epoch reset. */
import { useEffect } from 'react'
import type { ServerEvent } from '../../contract/index.ts'
import { API_BASE } from './client.ts'
import { resetAll } from './cache.ts'
import { keys } from './keys.ts'
import { invalidate } from './cache.ts'

let source: EventSource | null = null
let knownEpoch: string | null = null

/** The single place an ambient event becomes a cache mutation. */
function route(e: ServerEvent): void {
  switch (e.type) {
    case 'hello': {
      // A changed epoch means the server restarted and reseeded — drop the cache
      // and refetch, rather than trusting now-stale data.
      if (knownEpoch && knownEpoch !== e.epoch) resetAll()
      knownEpoch = e.epoch
      break
    }
    case 'session.updated':
      // Phase 1 keeps the session list fresh; richer events arrive in later phases.
      invalidate(keys.sessions)
      break
    // run.*, relation.applied, recents.changed, connector.status — wired in
    // Phases 3–4 as those resources move server-side.
    default:
      break
  }
}

/** Open the ambient stream once (idempotent). Safe to call on every mount. */
export function connectEvents(): void {
  if (source) return
  source = new EventSource(`${API_BASE}/events`)
  source.onmessage = (ev) => {
    try {
      route(JSON.parse(ev.data) as ServerEvent)
    } catch {
      /* ignore a malformed frame */
    }
  }
  // EventSource reconnects on its own; nothing to do on error but let it retry.
}

/** Mount-time hook: ensure the app is subscribed to server pushes. */
export function useServerEvents(): void {
  useEffect(() => {
    connectEvents()
  }, [])
}
