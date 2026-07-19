/** ── The shell's navigation controller (universal split, Phase 6) ────────────
 *  What remains of the pre-split singleton session controller after the
 *  equal-panes dissolve: panes own their conversations (usePaneConversation +
 *  ConversationPane), sections own their pages (SectionPane), and the
 *  session-context mutations live in the session-parametric funnels
 *  (useSessionContextCommands, draftCore). This hook owns only what is
 *  genuinely SHELL-scoped — one per workspace, not per pane:
 *
 *    • The BOOT address (consumed once per page load, winning over the
 *      per-account persisted tree's focused content — a pasted link opens
 *      what it names) and the fresh-draft default (ADAPT-1) when neither an
 *      address nor a restored tree fills the background.
 *    • Browser Back/Forward (popstate → the focused pane, like every
 *      navigation) and the address-bar projection of the focused pane's
 *      canonical path (ADAPT-15).
 *    • The account switch: the keyed conversation store and the draft funnel
 *      are module-level (per client, not per account) and must drop the
 *      outgoing account's entries; URL writes stop so the outgoing instance
 *      can't clobber the incoming account's address. The per-account VIEW
 *      memory is the persisted split tree itself (src/lib/mainSplit.ts) —
 *      the old separate view-memory blob is retired.
 *    • The entity DOORS the shell surfaces call (notifications, search,
 *      relation deep-links): each routes its section + detail seed into the
 *      FOCUSED pane; the notification doors also set the transient
 *      `pendingFocus` the destination page consumes once to scroll +
 *      highlight (docs/notification-routing.md). Focus is not page identity:
 *      it stays out of the URL and out of the tree.
 *    • Session ROW mutations (pin / rename / archive / delete) — list-level
 *      writes with no pane of their own. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DRAFT_ID } from '../data/liveSession'
import type { PaneSeed } from '../lib/paneNav'
import type { FocusTarget } from '../lib/notificationDoor'
import { pathForView, viewForPath, type RoutedView } from '../lib/urlRoutes'
import { deleteSession as deleteSessionCmd, loadSession, patchSession, onAccountSwitch } from '../api'
import { conversations } from './conversationStore'
import { draft } from './draftController'
import type { SectionId } from '../types'

/** ── Boot address (src/lib/urlRoutes.ts) ─────────────────────────────────────
 *  The URL the page LOADED at, consumed once per page load: a pasted /
 *  bookmarked link opens exactly what it names, winning over the per-account
 *  persisted tree's focused content (GitHub's rule — the address is a
 *  promise). Later mounts of the hook (an account switch) get null and let
 *  the account's own restored tree stand. Module-level so React StrictMode
 *  double-mount and the per-account remount can't consume it twice with
 *  different answers. */
let bootViewPending = true
let bootViewCache: RoutedView | null = null
function takeBootView(): RoutedView | null {
  if (bootViewPending) {
    bootViewPending = false
    bootViewCache = typeof window === 'undefined' ? null : viewForPath(window.location.pathname)
  }
  const v = bootViewCache
  bootViewCache = null // one consumer applies it; everyone after boots normally
  return v
}
/** A session boot address VALIDATES asynchronously. Module-level so a second
 *  mount of the hook (React StrictMode's double-mount) follows the in-flight
 *  validation instead of consuming a now-null boot view and minting a draft
 *  over it mid-flight — the fresh instance just re-latches its settle gate. */
let bootValidation: Promise<void> | null = null

export function useSessionWorkspace(split?: {
  /** The FOCUSED pane's canonical path (the address bar is a projection of
   *  the focused pane) — 'keep' when a pane with no canonical location is
   *  focused (a picker, the background): the address stays as-is. */
  focusedPath?: string | 'keep'
  /** Apply a routed view to the focused pane — null routes the root (a fresh
   *  draft). The popstate planner's fallback arm and the boot route share it. */
  applyRouteToFocused?: (routed: RoutedView | null) => void
  /** Apply a popstate address PER PAGE (ADAPT-18): pop the focused pane's own
   *  back top, else refocus a pane already showing the address, else fall
   *  back to the plain focused-pane route. */
  applyPopRoute?: (routed: RoutedView | null) => void
  /** Apply the BOOT address: same routing, plus the boot dedup — a restored
   *  pane already showing the address is FOCUSED instead of routed over
   *  (the address was the focused pane's own projection; the transient focus
   *  cursor boots at the first pane, so a blind route would clobber it).
   *  Returns false when it DEDUPED (focused an existing pane) — the boot
   *  latch must release immediately then, since no focusedPath change will
   *  re-run the URL effect to release it. */
  applyBootRoute?: (routed: RoutedView | null) => boolean
  /** An entity DOOR (a notification bell, a palette hit, a relation card's
   *  "View in …") lands in the FOCUSED pane, seeded with its detail — like
   *  every navigation. `push` = the door originated inside pane content
   *  (ADAPT-18: the origin rides the target's back stack). */
  routeDoor?: (section: SectionId, seed: PaneSeed, push?: boolean) => void
  /** A SESSION door (a palette hit, a notifications row) lands in the
   *  focused pane too. */
  routeSession?: (sessionId: string) => void
  /** A bare-section door (palette "Pages", a relation card's section jump). */
  routeSection?: (section: SectionId, sub?: string | null) => void
  /** Boot fallback (ADAPT-1): when neither a boot address nor the restored
   *  per-account tree fills the background, mint the fresh draft. */
  mintIfEmpty?: () => void
}) {
  // Ref'd so the popstate listener (bound once) reads the CURRENT callbacks.
  const splitRef = useRef(split)
  splitRef.current = split

  // A transient "highlight this on arrival" target, set by a notification door
  // (docs/notification-routing.md) and consumed once by the destination page
  // (scroll + highlight the work item / proposal). Deliberately SEPARATE from
  // page identity — it lives in neither the URL nor the tree, so Back never
  // re-fires a highlight. A plain navigation clears it; a focus-carrying entry
  // point sets it.
  const [pendingFocus, setPendingFocus] = useState<FocusTarget | null>(null)
  const consumeFocus = useCallback(() => setPendingFocus(null), [])

  // Flips when this account is being LEFT (see onAccountSwitch below): the
  // outgoing instance must stop writing the address — the incoming account's
  // remount owns it from here.
  const leftAccount = useRef(false)
  // Holds URL writes until the boot address has been consumed and applied, so
  // the restored tree's focused path can't overwrite the address the user
  // arrived at before it routes.
  const restoreSettled = useRef(false)
  // The boot route is a setState — it PROJECTS on the next render, but the
  // URL-sync effect runs first in the SAME commit with the restored tree's
  // stale focusedPath and would push it OVER the boot address (a junk history
  // entry: paste /projects/p1 with a tree whose focused pane is /artifacts →
  // history [/artifacts, /projects/p1]). This latch holds pushes until the
  // focused path CATCHES UP with the boot route's canonical target.
  const bootTarget = useRef<string | null>(null)

  // ── Boot: the address wins; otherwise the restored tree stands; otherwise
  // the fresh draft (ADAPT-1). Runs once per mount — the per-account remount
  // re-runs it, but takeBootView only answers on the first page-load consume.
  useEffect(() => {
    if (restoreSettled.current) return
    // A sibling mount's session validation is in flight (StrictMode's
    // double-mount): follow its settle — consuming the (now-null) boot view
    // here would mint a draft over the validating address.
    if (bootValidation) {
      void bootValidation.finally(() => {
        restoreSettled.current = true
      })
      return
    }
    const routed = takeBootView()
    if (!routed) {
      // No address: the per-account TREE (restored by useMainSplit's mount
      // initializer) IS the view memory. Nothing restored → the fresh draft.
      splitRef.current?.mintIfEmpty?.()
      restoreSettled.current = true
      return
    }
    const applyBoot = (r: RoutedView) => {
      // Latch the canonical target FIRST — the URL effect must hold pushes
      // until the routed page projects into focusedPath.
      bootTarget.current = pathForView(r.loc, r.subview ?? null)
      const bootRoute = splitRef.current?.applyBootRoute
      if (bootRoute) {
        // DEDUPED (an existing pane already shows the address): the projection
        // matches by construction, and if that pane was already focused no
        // focusedPath change will ever re-run the URL effect — release the
        // latch now or every later push stays held (the reload-then-navigate
        // address freeze).
        if (!bootRoute(r)) bootTarget.current = null
      } else {
        splitRef.current?.applyRouteToFocused?.(r)
      }
    }
    if (routed.loc.kind === 'session' && routed.loc.sessionId !== DRAFT_ID) {
      // A session address is VALIDATED first — a dead link (deleted / foreign)
      // must not wipe the restored focused pane with an unresolvable thread.
      // Every async arm gates on leftAccount: a response landing after an
      // account switch must not route into (and persist under) the NEW
      // account's tree scope.
      const sid = routed.loc.sessionId
      bootValidation = loadSession(sid)
        .then(() => {
          if (!leftAccount.current) applyBoot(routed)
        })
        .catch(() => {
          if (leftAccount.current) return
          splitRef.current?.mintIfEmpty?.()
          // The dead address must not stand over a page that has its own
          // canonical URL (ADAPT-15: the address reflects what's shown) —
          // correct it in place (a fix, not a navigation).
          const p = splitRef.current?.focusedPath
          if (p && p !== 'keep' && window.location.pathname !== p) window.history.replaceState(null, '', p)
        })
        .finally(() => {
          restoreSettled.current = true
          bootValidation = null
        })
      return
    }
    applyBoot(routed)
    restoreSettled.current = true
  }, [])

  // ── The address bar projects the FOCUSED pane (ADAPT-15) ──────────────────
  // 'keep' = a non-page pane is focused (a picker, the background): the
  // address stays — page identity didn't change. Equality-guarded so arriving
  // VIA the address (boot, popstate) never mints a duplicate history entry.
  useEffect(() => {
    if (!restoreSettled.current || leftAccount.current) return
    const path = split?.focusedPath
    if (!path || path === 'keep') return
    if (bootTarget.current) {
      // The boot route hasn't projected yet — the focused path is still the
      // restored tree's pre-route value; pushing it would bury the boot
      // address under a junk entry. Resume once the projection catches up.
      if (path !== bootTarget.current) return
      bootTarget.current = null // caught up; the equality guard below no-pushes
    }
    if (window.location.pathname !== path) window.history.pushState(null, '', path)
  }, [split?.focusedPath])

  // ── Browser Back/Forward: re-parse the address it moved to and land it in
  // the focused pane, like every navigation. The URL-sync effect above then
  // sees pathname already equal to the routed page's path — no new entry.
  // A SESSION address is validated first, exactly like the boot address: the
  // history may hold another account's threads (a switch doesn't clear it) or
  // a since-deleted session — a dead link must stay a dead click, never a
  // blank pseudo-conversation routed into (and persisted with) the tree.
  useEffect(() => {
    // Per-page application (ADAPT-18): pop the focused pane's own back top /
    // refocus the pane already showing the address / plain-route — falling
    // back to the plain route where no planner is wired.
    const apply = (routed: RoutedView | null) =>
      (splitRef.current?.applyPopRoute ?? splitRef.current?.applyRouteToFocused)?.(routed)
    // A monotonic token sequences the async session-validation arm: rapid
    // Back/Back (or Back/Forward) across two session addresses fire independent
    // loadSession calls that can resolve OUT OF ORDER — applying the earlier
    // target last, leaving the pane disagreeing with the address bar. Only the
    // LATEST pop's resolution applies.
    let popToken = 0
    const onPop = () => {
      const token = (popToken += 1)
      const routed = viewForPath(window.location.pathname)
      if (routed?.loc.kind === 'session' && routed.loc.sessionId !== DRAFT_ID) {
        const sid = routed.loc.sessionId
        loadSession(sid)
          .then(() => {
            if (!leftAccount.current && token === popToken) apply(routed)
          })
          .catch(() => {}) // gone / foreign → stay put (the address was a dead link)
        return
      }
      apply(routed)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // ── Account switch (multi-account §6.1): the keyed conversation store and
  // the draft funnel are per CLIENT, not per account — drop the outgoing
  // account's entries (its threads are another tenant's; a stale draft
  // coalesce handle would append the next account's first send to the OLD
  // account's materialized session). The Workspace remount (keyed by account)
  // restores the incoming account's own tree; this instance only stands down.
  useEffect(
    () =>
      onAccountSwitch(() => {
        leftAccount.current = true
        conversations.clearAll()
        draft.reset()
      }),
    [],
  )

  // ── Entity doors — every shell surface (notifications, search, relation
  // deep-links, panel breadcrumbs) lands its target in the FOCUSED pane,
  // detail open. Plain doors drop any stale highlight target; the
  // notification doors (below) set one after routing.
  const openSession = useCallback((id: string) => {
    splitRef.current?.routeSession?.(id)
  }, [])
  const newSession = useCallback(() => {
    // Reset the shared draft entry FIRST (a lingering coalesce handle would
    // append the next send to the previously materialized session), then land
    // the fresh draft in the focused pane — on the background this mints the
    // first pane.
    draft.reset()
    splitRef.current?.routeSession?.(DRAFT_ID)
  }, [])
  const openSection = useCallback((s: SectionId, sub?: string | null) => {
    splitRef.current?.routeSection?.(s, sub ?? null)
    setPendingFocus(null)
  }, [])
  // The detail doors share one shape — route the section with its detail seed,
  // drop any stale highlight — so they're minted from one factory (stable:
  // splitRef and the setState are both stable, so the memo never rebuilds).
  const { openProject, openSchedule, openOwner, openAgentPage, openContextPage, openWorkItemPage, openAdminUserPage } = useMemo(() => {
    const door = (section: SectionId, seed: PaneSeed) => {
      splitRef.current?.routeDoor?.(section, seed)
      setPendingFocus(null)
    }
    return {
      openProject: (projectId: string) => door('projects', { projectId }),
      openSchedule: (scheduleId: string) => door('scheduled', { scheduleId }),
      openOwner: (name: string) => door('agents', { ownerName: name }),
      openAgentPage: (agentId: string) => door('agents', { agentId }),
      openContextPage: (contextId: string) => door('contexts', { contextId }),
      openWorkItemPage: (projectId: string, workItemId: string) => door('projects', { projectId, workItemId }),
      openAdminUserPage: (adminUserId: string) => door('admin', { adminUserId }),
    }
  }, [])

  // ── Notification doors (docs/notification-routing.md): the page opens on
  // the exact sub-entity the act touched, with the transient highlight set
  // AFTER routing (the plain doors above clear it).

  // A work.* / mentioned bell: the item's page, with the touched sub-entity
  // (the item itself, or one comment) highlighted on arrival.
  const openWorkItem = useCallback((projectId: string, workItemId: string, commentId?: string) => {
    splitRef.current?.routeDoor?.('projects', { projectId, workItemId })
    setPendingFocus({ projectId, workItemId, commentId })
  }, [])

  // A change proposal on the agent's review surface (proposal.* bells).
  // `ownerName` null ⇒ the caller OWNS the agent ⇒ their Agents hub (the
  // review queue); else the definition's own PAGE (COMMONS-26), where "Your
  // proposals" lives — with the proposal focused on arrival. `push` marks the
  // pane-originated call sites (a proposal row inside a page, ADAPT-18); the
  // notification panel's chrome door omits it.
  const openProposal = useCallback((agentId: string, proposalId: string, ownerName: string | null, push?: boolean) => {
    splitRef.current?.routeDoor?.('agents', ownerName ? { agentId } : {}, push)
    setPendingFocus({ agentId, proposalId })
  }, [])

  // The source agent (agent.forked) — the recipient is its owner, so their own
  // Agents hub, with the card highlighted. Never the fork (the leak-wall).
  const openAgent = useCallback((agentId: string) => {
    splitRef.current?.routeDoor?.('agents', {})
    setPendingFocus({ agentId })
  }, [])

  // ── Recents row-menu edits (pin / rename / archive / delete) ──────────────
  // List-level mutations; the sidebar reflects them through the live session
  // feed. Delete's pane eviction (a pane hosting the removed session) is the
  // caller's concern — the tree is the split controller's.
  const pinSession = useCallback((id: string, pinned: boolean) => {
    void patchSession(id, { pinned })
  }, [])
  const renameSession = useCallback((id: string, title: string) => {
    void patchSession(id, { title })
  }, [])
  const archiveSession = useCallback((id: string, archived: boolean) => {
    void patchSession(id, { status: archived ? 'archived' : 'active' })
  }, [])
  const deleteSession = useCallback((id: string) => {
    void deleteSessionCmd(id)
  }, [])

  return {
    pendingFocus,
    consumeFocus,
    openSession,
    newSession,
    openSection,
    openProject,
    openSchedule,
    openOwner,
    openAgentPage,
    openContextPage,
    openWorkItemPage,
    openAdminUserPage,
    openWorkItem,
    openProposal,
    openAgent,
    pinSession,
    renameSession,
    archiveSession,
    deleteSession,
  }
}
