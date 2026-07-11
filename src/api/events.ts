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
import { invalidate, invalidatePrefix } from './cache.ts'
import { invalidateForCommonsOp } from './commonsInvalidation.ts'
import { helloRequiresReset } from './streamPolicy.ts'
import { activeAccount, onAccountSwitch } from './account.ts'

let source: EventSource | null = null
let knownEpoch: string | null = null

/** Session-scoped push fan-out for the CONTROLLER. The open thread is controller
 *  state (not a `useQuery` read), so cache invalidation alone can't heal it — a
 *  context attached on another client, or a rename, would stay invisible until
 *  the session was re-selected. Callbacks get the session id whose server-side
 *  state moved; the controller decides whether that's the open thread and how to
 *  reconcile. One narrow, event-shape-free seam, so the one-door rule holds
 *  (nothing outside src/api knows an SSE event type). */
type SessionPushListener = (sessionId: string) => void
const sessionPushListeners = new Set<SessionPushListener>()
export function onSessionPush(fn: SessionPushListener): () => void {
  sessionPushListeners.add(fn)
  return () => {
    sessionPushListeners.delete(fn)
  }
}
function notifySessionPush(sessionId: string): void {
  for (const fn of sessionPushListeners) fn(sessionId)
}

/** The single place an ambient event becomes a cache mutation. */
function route(e: ServerEvent): void {
  switch (e.type) {
    case 'hello': {
      if (helloRequiresReset(e, knownEpoch)) resetAll()
      knownEpoch = e.epoch
      break
    }
    case 'session.updated':
      invalidate(keys.sessions)
      // The full session (its thread) changed too — a persisted turn, a rename.
      // No-op unless some view has read this session (then it refetches).
      invalidate(keys.session(e.session.id))
      // The usage snapshot is session-resolved (its context capacity + model ref
      // come from the session's provider/model pick, which this event may have
      // changed — a cross-client pick, a cascade clearing it) — keep the gauge's
      // datum in sync (UI-12). No-op unless the session's composer is open.
      invalidate(keys.usage(e.session.id))
      notifySessionPush(e.session.id)
      break
    // A session's attached contexts changed (here or on another client) — re-read
    // the binding the effect-mediation path resolves against, and tell the
    // controller: the composer's chips render controller state, which must
    // reconcile or the attach never shows here.
    case 'session.contexts.changed':
      invalidate(keys.sessionContexts(e.sessionId))
      notifySessionPush(e.sessionId)
      break
    // A scheduled run fired / advanced a step / finished (run-now or the daemon) —
    // the schedules (their run lists) are now stale. This is the ambient-push that
    // makes a run appear in the rail and step forward with no user request.
    case 'run.started':
    case 'run.progress':
    case 'run.finished':
      invalidate(keys.schedules)
      break
    // A routine was created / edited / paused / removed (another client or device;
    // this one's commands invalidate locally too) — the rail's Scheduled pane and
    // the Scheduled section read the same list, so one refetch heals both.
    case 'schedule.changed':
      invalidate(keys.schedules)
      break
    // A relation edit was applied (by another client, or this one's standing
    // approval acting on a run) — re-read the graph. An Agent Commons CRUD op edits a
    // registry, not the graph, so also refresh the registry caches the Agents hub reads.
    case 'relation.applied':
      invalidate(keys.relations)
      invalidateForCommonsOp(e.op)
      // A relation op can create/share/rename what profiles + search serve (D21/D22)
      // — refresh any OPEN profile/search views (mounts revalidate on their own).
      invalidatePrefix(keys.ownerProfile())
      invalidatePrefix(keys.search())
      // …and what the D17 directories list (share-project / publish-agent): a just-
      // shared project must appear in an open Discover tab, a retracted one must leave.
      invalidatePrefix(keys.directoryProjects())
      invalidatePrefix(keys.directoryAgents())
      break
    // A connector's auth/setup state changed (the Contexts page connect/disconnect,
    // here or on another client/device), or a context was added to / removed from
    // the set-up registry — re-read the saved-contexts snapshot.
    case 'connector.status':
    case 'savedcontext.changed':
      invalidate(keys.savedContexts)
      break
    // Recents changed (attached on another device/tab) — re-read the snapshot.
    case 'recents.changed':
      invalidate(keys.recents)
      break
    // A public act fanned out to THIS tenant's inbox (D24 — the event is
    // tenant-targeted server-side) — re-read it so the bell updates live.
    case 'notification.changed':
      invalidate(keys.notifications)
      // A bell can name a project shared with this tenant AFTER its graph loaded
      // (mention fan-out needs only `project.shared`) — refetch the graph so the
      // door resolves instead of dead-clicking. Tenant-targeted and rare, so cheap.
      invalidate(keys.relations)
      break
    // A proposal's lifecycle moved (opened / commented / merged / declined — the
    // event reaches only the two parties). The review queue is prefetched as soon
    // as a published card renders, so the bell's door must refetch it or open stale.
    case 'proposal.changed':
      invalidate(keys.agentProposals(e.agentId))
      break
    // A Project's Contributor roster changed — possibly a cross-tenant arrival (P8).
    // The roster count also rides the directory card ("N contributors", D17).
    case 'commission.changed':
      invalidate(keys.commissions(e.projectId))
      invalidate(keys.commissions())
      invalidatePrefix(keys.directoryProjects())
      break
    // The native-runner registry changed — a runner connected, disconnected, or
    // re-advertised its capabilities. Re-read the registry so affordances that
    // depend on a host's capabilities reflect it.
    case 'runner.connected':
    case 'runner.disconnected':
    case 'runner.capabilities.changed':
      invalidate(keys.runners)
      // The Add-context source switcher derives its runner sources from the
      // registry, so refresh it too (a connect/disconnect adds/removes a source).
      invalidate(keys.fsSources)
      break
    // An effect was projected into a runner's record — refresh that runner's log.
    case 'runner.effect':
      invalidate(keys.runnerEffects(e.effect.runnerId))
      break
    // A Session provider's drain loop bound or went quiet — re-read the providers
    // list so its computed `online` dot flips live (the relay mirror of runner.*).
    case 'relay.connected':
    case 'relay.disconnected':
      invalidate(keys.providers)
      break
    // A resource's reservation ledger changed (acquired / committed / released /
    // capacity set) — re-read that resource's lock state, and every open project
    // Coordination panel (the surface that actually renders reservations; the
    // event doesn't carry a projectId, and the family is small).
    case 'reservation.changed':
      invalidate(keys.resourceStatus(e.resourceId))
      invalidatePrefix(keys.projectSubGoals())
      break
    // The Dispatch feed changed — a one-off run was kicked off or finished. Re-read
    // the small feed so it appears and flips running → done live.
    case 'dispatch.changed':
      invalidate(keys.dispatch)
      break
    // A cross-user effect landed in the detective audit trail (D15/OQ7) — refresh the
    // Audit surface so the watch updates live.
    case 'audit.entry':
      invalidate(keys.auditLog)
      break
    // A Project's open-work backlog changed (D19) — an item was posted or a standing
    // Contributor took one. Re-read the backlog, the agent list (the taker's D13
    // credit), and the project directory (its open-work count moved).
    case 'openwork.changed':
      invalidate(keys.openSubGoals(e.projectId))
      invalidate(keys.workerAgents)
      invalidatePrefix(keys.directoryProjects())
      // A resolve moves the taker's D13 credit on every surface built to show it:
      // the agent DIRECTORY's contribution counts and the S10 resolved-work list
      // behind them (not just the caller's own agent list above).
      invalidatePrefix(keys.directoryAgents())
      invalidatePrefix(keys.agentResolvedWork())
      // Open-work counts + activity ride profiles and search hits too (D21/D22).
      invalidatePrefix(keys.ownerProfile())
      invalidatePrefix(keys.search())
      break
    default:
      break
  }
}

/** Open the ambient stream once (idempotent). Safe to call on every mount. */
export function connectEvents(): void {
  if (source) return
  // The stream binds identity at open via the session COOKIE (P6): EventSource
  // can't set headers, but it carries cookies natively — the very reason the
  // credential is a cookie. (The server's ?user=&tenant= params are the legacy
  // dev seam; this client no longer uses them.)
  source = new EventSource(`${API_BASE}/events`)
  source.onmessage = (ev) => {
    try {
      const e = JSON.parse(ev.data) as ServerEvent
      // I5 tripwire, SSE face: the hello names the identity the server resolved
      // for this stream — a mismatch means events would invalidate the wrong
      // account's cache. Kill the stream loudly; don't route a single frame.
      if (e.type === 'hello' && e.identity) {
        const acct = activeAccount()
        if (acct && e.identity.tenantId !== acct.tenantId) {
          console.error(`[events] identity echo mismatch: acting as tenant '${acct.tenantId}' but the stream resolved '${e.identity.tenantId}' — stream closed`)
          source?.close()
          source = null
          return
        }
      }
      route(e)
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

// An account switch reopens the stream as the new identity (multi-account §6.3).
// A RECONNECT keeps the browser's Last-Event-ID (same identity, resume); a SWITCH
// must not — different identity, different visible stream — so the old source is
// torn down (discarding its Last-Event-ID) and epoch tracking resets: the next
// hello is treated as this identity's first (no false "continuity" reset, and no
// carried-over assumptions). The cache reset itself is the switcher's job
// (switchAccount → resetAll in the app layer); this module only re-binds the pipe.
onAccountSwitch(() => {
  source?.close()
  source = null
  knownEpoch = null
  connectEvents()
})

/** Mount-time hook: ensure the app is subscribed to server pushes. */
export function useServerEvents(): void {
  useEffect(() => {
    connectEvents()
  }, [])
}
