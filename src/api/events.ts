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
      invalidate(keys.sessions)
      break
    // A scheduled run fired / finished (run-now or the daemon) — the recent-runs
    // feed and the schedules (their run lists) are now stale. This is the
    // ambient-push that makes a run appear in the rail with no user request.
    case 'run.started':
    case 'run.progress':
    case 'run.finished':
      invalidate(keys.recentRuns)
      invalidate(keys.schedules)
      break
    // A relation edit was applied (by another client, or this one's standing
    // approval acting on a run) — re-read the graph.
    case 'relation.applied':
      invalidate(keys.relations)
      break
    // A connector's auth/setup state changed asynchronously.
    case 'connector.status':
      invalidate(keys.savedContexts)
      break
    // Recents changed (attached on another device/tab) — re-read the snapshot.
    case 'recents.changed':
      invalidate(keys.recents)
      break
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
  // EventSource retries transient errors itself. If it gives up entirely (the
  // server was down at load, or a long outage), it lands in CLOSED — reset and
  // reconnect with a small backoff so the UI recovers without a reload.
  source.onerror = () => {
    if (source && source.readyState === EventSource.CLOSED) {
      source = null
      setTimeout(connectEvents, 2000)
    }
  }
}

/** Mount-time hook: ensure the app is subscribed to server pushes. */
export function useServerEvents(): void {
  useEffect(() => {
    connectEvents()
  }, [])
}
