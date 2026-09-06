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
import { keys } from './keys.ts'
import { invalidate, invalidatePrefix, resetAll, revalidateAll } from './cache.ts'
import { invalidateForCommonsOp } from './commonsInvalidation.ts'
import { helloRequiresReset } from './streamPolicy.ts'
import { activeAccount, onAccountSwitch } from './account.ts'
import { ambientSyncHealth } from './syncHealth.ts'

let source: EventSource | null = null
let knownEpoch: string | null = null

/** A narrow, event-shape-free listener seam (subscribe + notify) — the one
 *  shape every controller-facing fan-out below uses, so the one-door rule
 *  holds (nothing outside src/api knows an SSE event type). */
function makeSeam<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>()
  return {
    on(fn: (...args: Args) => void): () => void {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    notify(...args: Args): void {
      for (const fn of listeners) fn(...args)
    },
  }
}

/** Session-scoped push fan-out for the pane controllers. An open thread is
 *  controller state (not a `useQuery` read), so cache invalidation alone can't
 *  heal it — a context attached on another client, or a rename, would stay
 *  invisible until the session was reopened. Callbacks get the session id
 *  whose server-side state moved; each pane decides whether that's its
 *  session and how to reconcile. */
const sessionPush = makeSeam<[sessionId: string]>()
export const onSessionPush = sessionPush.on
const notifySessionPush = sessionPush.notify

/** The definitive GONE-signal fan-out (`session.removed`) — the live-prune
 *  seam: the split controller drops every pane hosting the removed session
 *  (a `session.updated` push can only say "refetch", never "deleted"). */
const sessionRemoved = makeSeam<[sessionId: string]>()
export const onSessionRemoved = sessionRemoved.on
const notifySessionRemoved = sessionRemoved.notify

/** The single place an ambient event becomes a cache mutation. */
function route(e: ServerEvent): void {
  switch (e.type) {
    case 'hello': {
      if (helloRequiresReset(e, knownEpoch)) resetAll()
      knownEpoch = e.epoch
      // `hello` is the health proof: by this point the identity echo has been
      // accepted, and its resumption bit has either preserved continuity or
      // triggered a complete cache reset. A socket open alone proves neither.
      ambientSyncHealth.signal('hello')
      break
    }
    case 'session.updated':
      invalidate(keys.sessions)
      // The full session (its thread) changed too — a persisted turn, a rename.
      // No-op unless some view has read this session (then it refetches).
      invalidate(keys.session(e.session.id))
      invalidatePrefix(keys.sessionCompactedMessages(e.session.id))
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
    // A session was DELETED (this client's own action echoes too — the prune
    // is idempotent): refresh the lists, drop the by-id caches, and tell the
    // split controller so every pane hosting it collapses (live prune).
    case 'session.removed':
      invalidate(keys.sessions)
      invalidate(keys.session(e.session.id))
      // Deletion also removes the canonical session→Project join. Re-read the
      // graph so open Project membership and rail grouping cannot retain a
      // dangling conversation after the definitive gone-signal.
      invalidate(keys.relations)
      notifySessionRemoved(e.session.id)
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
    // this one's commands invalidate locally too) — the rail's Scheduled tree
    // branch and its main page read the same list, so one refetch heals both.
    case 'schedule.changed':
      invalidate(keys.schedules)
      // Routine deletion also removes its Project edge. The event is shared
      // with definition edits, so this modest extra read keeps other clients'
      // graph projections truthful without inventing a second deletion event.
      invalidate(keys.relations)
      // Applying proposals freeze the routine definition revision at offer
      // time; refresh their derived `stale` flag when that target moves.
      invalidatePrefix(keys.socialProposals())
      break
    // An artifact's BODY changed — its owner edited a block, or an
    // `artifact-patch` proposal landed (social S3). Every rich body projection
    // reads the one name-keyed library, so a single refetch heals the canonical
    // page, workspace panel, attachment preview and explicit thumbnails at once
    // (UI-12). The Artifacts index is deliberately a stored synopsis (UI-31),
    // not a second rendering of the mutable body.
    case 'artifact.changed':
      invalidate(keys.artifactContent)
      invalidatePrefix(keys.socialProposals())
      break
    // Agent configuration, publication, or monotonic activity changed. Owner-
    // scoped events stay private at the server gate; directory-scoped events
    // are public invalidations and may also belong to this viewer, so refresh
    // both projections rather than shipping a raw owner id to the browser.
    case 'agent.changed':
      invalidate(keys.workerAgents)
      if (e.scope === 'directory') {
        invalidatePrefix(keys.directoryAgents())
        invalidatePrefix(keys.agentForks())
        invalidatePrefix(keys.ownerProfile())
        invalidatePrefix(keys.search())
      }
      break
    case 'provider.changed':
      invalidate(keys.providers)
      break
    case 'systemprompt.changed':
      invalidate(keys.systemPrompts)
      break
    // A relation edit was applied (by another client, or this one's standing
    // approval acting on a run) — re-read the graph. An Agent Commons CRUD op edits a
    // registry, not the graph, so also refresh the registry caches the Agents hub reads.
    case 'relation.applied':
      invalidate(keys.relations)
      invalidatePrefix(keys.socialProposals())
      invalidateForCommonsOp(e.op)
      // A relation op can create/share/rename what profiles + search serve (D21/D22)
      // — refresh any OPEN profile/search views (mounts revalidate on their own).
      invalidatePrefix(keys.ownerProfile())
      invalidatePrefix(keys.search())
      // …and what the D17 directories list (share-project / publish-agent): a just-
      // shared project must appear in an open Discover tab, a retracted one must leave.
      invalidatePrefix(keys.directoryProjects())
      invalidatePrefix(keys.directoryAgents())
      // A publish/unpublish also moves every source's PUBLIC-forks list (D18).
      invalidatePrefix(keys.agentForks())
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
    case 'org.invitation.changed':
      // Issuance/verdict/revocation reaches only the owner and addressed account.
      // Accept widens the invitee's readable world; the same rare full refresh on
      // the owner is harmless and avoids putting a private actor id in the event.
      if (e.change === 'accepted') revalidateAll()
      else {
        invalidate(keys.meInvites)
        invalidate(keys.orgInvites(e.orgId))
      }
      break
    // A proposal's lifecycle moved (opened / commented / merged / declined — the
    // event reaches only the two parties). The review queue is prefetched as soon
    // as a published card renders, so the bell's door must refetch it or open stale.
    case 'proposal.changed':
      invalidate(keys.agentProposals(e.agentId))
      invalidate(keys.myWork) // an authored proposal's verdict rides the Your-work dashboard
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
    // `relay.activity` (v5): an entry was delivered or settled — same re-read, so
    // the card's serving picture (`activeConversations` / `conversationWindow`)
    // tracks the far session's observed behavior.
    case 'relay.connected':
    case 'relay.disconnected':
    case 'relay.activity':
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
    // A Project's contribution ledger changed (workflow Phase A) — one was opened,
    // noted, or landed. The ledger is the only reader keyed on it.
    case 'contribution.changed':
      invalidate(keys.contributions(e.projectId))
      // The attention ledger is derived from the timelines — same signal.
      invalidate(keys.attention(e.projectId))
      break
    // A Project's delegation roster changed (CW8) — re-read it, and the
    // ledger's self-proposed optimization depends on the roster too.
    case 'delegation.changed':
      invalidate(keys.delegations(e.projectId))
      invalidate(keys.attention(e.projectId))
      break
    // A grant changed (social S1) — the subject's roster is stale, and so is
    // the audience's world projection: a granted project must appear in their
    // Projects list (the shared-with-me band) live, a revoked one must leave.
    case 'grant.changed':
      invalidatePrefix(keys.grants())
      invalidate(keys.projects) // seed rows enter/leave the shared-with-me band
      invalidate(keys.relations) // created rows ride the graph's extraProjects
      invalidate(keys.commons) // a published share is a feed item (S4)
      break
    // A discussion changed (social S2) — the anchored list and the open thread
    // are stale; the family prefixes catch both projections.
    case 'discussion.changed':
      invalidatePrefix(keys.discussions())
      invalidate(keys.discussion(e.discussionId))
      invalidate(keys.commons) // the card's comment count rides the feed (S4)
      invalidate(keys.myDiscussions) // the hub list (a new thread joins it)
      // A principal anchor is a DM (S7) — the inbox is its own projection, so
      // the family prefix above does not reach it. Without this a message
      // arrives silently and the unread dot never lights.
      if (e.anchor.ref.kind === 'principal') invalidate(keys.directMessages)
      break
    // A follow changed (S7) — delivered to the two parties only. The follower's
    // list and the FEED are both stale (`followed` is stamped per item, so the
    // Following lens would keep showing the old set); the followee's profile
    // carries the counts.
    case 'follow.changed':
      invalidate(keys.follows)
      invalidate(keys.commons)
      invalidatePrefix(keys.ownerProfile())
      break
    // Watch is viewer-private desired state. Every Commons card/lens may carry
    // the subject-relative stamp; Project pages also own one direct query.
    case 'watch.changed':
      invalidate(keys.commons)
      if (e.subject.kind === 'project') invalidate(keys.projectWatch(e.subject.id))
      break
    // A Like has one public aggregate and private viewer membership. The event
    // contains neither; every permitted client re-derives both from its feed.
    case 'commons-like.changed':
      invalidate(keys.commons)
      break
    // A social proposal changed (S3) — its subject's ledger, the row itself,
    // and (a landed relation-op delta) the graph projections are stale.
    case 'social-proposal.changed':
      invalidatePrefix(keys.socialProposals())
      invalidate(keys.socialProposal(e.proposalId))
      invalidate(keys.relations)
      invalidate(keys.projects)
      invalidate(keys.commons) // a landing is a feed item (S4)
      break
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
      invalidate(keys.myWork) // a posted item's lifecycle rides the Your-work dashboard
      break
    default:
      break
  }
}

/** Open the ambient stream once (idempotent). Safe to call on every mount. */
export function connectEvents(): void {
  if (source) return
  ambientSyncHealth.signal('connect')
  // The stream binds identity at open via the session COOKIE (P6): EventSource
  // can't set headers, but it carries cookies natively — the very reason the
  // credential is a cookie. (The server's ?user=&tenant= params are the legacy
  // dev seam; this client no longer uses them.)
  const opened = new EventSource(`${API_BASE}/events`)
  source = opened
  opened.onmessage = (ev) => {
    // An account switch retires the old source before opening the new one, but
    // an already-queued callback may still run. Never let a retired account's
    // frame invalidate the current account's cache or change its health.
    if (source !== opened) return
    try {
      const e = JSON.parse(ev.data) as ServerEvent
      // I5 tripwire, SSE face: the hello names the identity the server resolved
      // for this stream — a mismatch means events would invalidate the wrong
      // account's cache. Kill the stream loudly; don't route a single frame.
      if (e.type === 'hello' && e.identity) {
        const acct = activeAccount()
        if (acct && e.identity.tenantId !== acct.tenantId) {
          console.error(`[events] identity echo mismatch: acting as tenant '${acct.tenantId}' but the stream resolved '${e.identity.tenantId}' — stream closed`)
          ambientSyncHealth.signal('error')
          opened.close()
          source = null
          // Don't route the wrong account's frames — but don't go permanently
          // deaf either: a TRANSIENT mismatch (a cookie momentarily stale) must
          // recover. Reconnect on a backoff; the next hello re-asserts identity
          // and either aligns or closes again (throttled, never a hot loop).
          setTimeout(connectEvents, 3000)
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
  opened.onerror = () => {
    // `EventSource.close()` normally emits no error, but the instance fence is
    // what makes that timing irrelevant: a retired source cannot warn or reset
    // the source that replaced it.
    if (source !== opened) return
    ambientSyncHealth.signal('error')
    if (opened.readyState === EventSource.CLOSED) {
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
  ambientSyncHealth.signal('account-switch')
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
