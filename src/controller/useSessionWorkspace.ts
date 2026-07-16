import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SESSIONS } from '../data/sessions'
import {
  DRAFT_ID,
  DRAFT_SESSION,
  EMPTY_LIVE,
  addContextToLive,
  bindingsFor,
  applyEscalationToLive,
  approvalView,
  escalationBinding,
  focusForAdded,
  folderLabel,
  liveFromSession,
  removeAttachmentFromLive,
  removeContextsFromLive,
  removeFolderFromLive,
  repoIdForLabel,
  slug,
  unresolvedEscalation,
  workspaceOf,
  workspaceNameFor,
  type Live,
} from '../data/liveSession'
import { sameFocus } from '../lib/focus'
import { pushLocation, type NavLocation } from '../lib/nav'
import type { FocusTarget } from '../lib/notificationDoor'
import { rememberAttached } from '../lib/contextShortcuts'
import { getPanelPref, setPanelPref } from '../lib/panelPrefs'
import { loadViewLocation, saveViewLocation, type ViewLocation } from '../lib/viewMemory'
import { pathForView, viewForPath, type RoutedView } from '../lib/urlRoutes'
import { loadModelPrefs } from '../lib/modelPrefs'
import type { ModelPick } from '../lib/models'
import { parseFsRecentKey, DEFAULT_PROVIDER_ID } from '../../contract/index'
import {
  applyRelationOp,
  attachContext,
  createSession,
  deleteSession as deleteSessionCmd,
  detachContext,
  keys,
  peek,
  loadSession,
  patchSession,
  persistWorkspace,
  onAccountSwitch,
  useMe,
  onSessionPush,
  compactSession,
} from '../api'
import { conversations, useConversation } from './conversationStore'
import type {
  AddedContext,
  AttachContextRequest,
  EscalationProposal,
  Message,
  ModelProvider,
  PanelFocus,
  RelationGraph,
  SectionId,
  Session,
} from '../types'

/** Map an attached `AddedContext` to the persistent binding(s) it should create —
 *  the *attachment of record* the effect-mediation path resolves against
 *  (Primitive 1 of docs/shared-resource-coordination.md). Ids match the live
 *  model's so attach and the chip-remove focus pair up: a repo by `repoIdForLabel`,
 *  connectors / attachments by their own id. A folder keys on its OWN source id
 *  (the id its artifacts carry, which `removeFolder` detaches by) — NOT the shared
 *  workspace panel id — so attaching a second folder doesn't overwrite the first
 *  folder's binding-of-record (and its scope). `scope` is the resource boundary
 *  (a path for folder / repo, `'*'` otherwise); files / photos expand to one
 *  binding per attachment. */
// bindingsFor moved to data/liveSession.ts (the model layer) so the split
// panes' attach path shares the exact mapping — imported above.


/** The strongest present context to auto-open when a session opens — a repo if
 *  there is one, else a workspace, else nothing (the panel stays closed). */
function strongestFocus(l: Live): PanelFocus | null {
  return l.repos[0]
    ? { kind: 'repo', id: l.repos[0].id }
    : l.workspaces[0]
      ? { kind: 'workspace', id: l.workspaces[0].id }
      : null
}

/** ── Boot address (src/lib/urlRoutes.ts) ─────────────────────────────────────
 *  The URL the page LOADED at, consumed once per page load: a pasted /
 *  bookmarked link opens exactly what it names, winning over the per-account
 *  view memory (GitHub's rule — the address is a promise). Later mounts of the
 *  hook (an account switch) get null and restore memory instead, then rewrite
 *  the address to match. Module-level so React StrictMode double-mount and the
 *  per-account remount can't consume it twice with different answers. */
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

/** ── Controller: the active session + its live workspace ───────────────────
 *  Owns all session, live-context, panel-focus, and section state, plus every
 *  handler the view binds to. App.tsx is a thin view over what this returns;
 *  the domain rules it calls live in data/liveSession.ts (model). */
export function useSessionWorkspace() {
  // The app opens on a fresh draft — a single empty thread + composer (ADAPT-1).
  const [activeId, setActiveId] = useState(DRAFT_ID)
  // The ACTIVE session's conversation state — read from the keyed per-session
  // store (universal split Phase 1: the session half lives in
  // conversationStore.ts so any pane can host a conversation; this singleton
  // hook now subscribes to just its active one).
  const { live, typing, busy, liveTurn, sendFailure, pendingEscalation } = useConversation(activeId)
  // Which attached context the right-hand sidebar is showing (null = closed).
  // On the WIDE tier this `focus` drives the active session's context PANE in the
  // universal main tree (App projects it via setFocusDrivenContext); on the overlay
  // tiers it drives the docked / takeover panel. One per-session source of truth,
  // remembered by panelPrefs (FWD-2). The legacy right-frame split tree (ADAPT-16)
  // is retired — several context panes now tile through the universal split.
  const [focus, setFocus] = useState<PanelFocus | null>(null)
  // Which cross-cutting tool is open in the main area (null = the session).
  const [activeSection, setActiveSection] = useState<SectionId | null>(null)
  // Which sub-view of the active section is selected — the rail's drill-in menu and
  // the section body both read this (lib/subviews). A lateral tab switch, deliberately
  // NOT in navigation history: Back doesn't undo a sub-view switch (the push model).
  // null = the section has no sub-views (or none open).
  const [activeSubview, setActiveSubview] = useState<string | null>(null)
  // When a session deep-links into its project, which project the Projects
  // section should open in detail (null = show the project list). This is the
  // single source of truth for "which project detail is open" — a list-card click
  // routes through openProject too, so every way in is recorded in history.
  const [focusProjectId, setFocusProjectId] = useState<string | null>(null)
  // Likewise for a scheduled run session deep-linking back to its routine.
  const [focusScheduleId, setFocusScheduleId] = useState<string | null>(null)
  // And for a workspace profile (D21) open under the Agents section — the display
  // name, which IS the public handle (an owner byline anywhere is a door here).
  const [focusOwnerName, setFocusOwnerName] = useState<string | null>(null)
  // And for a work item's own page under its project (the issue-page analog) —
  // meaningful only alongside focusProjectId; null = the project page itself.
  const [focusWorkItemId, setFocusWorkItemId] = useState<string | null>(null)
  // And for a published definition's own page under the Agents section (the
  // repo-page analog, COMMONS-26); null = the hub / profile as the others say.
  const [focusAgentId, setFocusAgentId] = useState<string | null>(null)
  // And for a saved context's detail page under the Contexts section (ADAPT-15:
  // the detail was once component state with no address); null = the list.
  const [focusContextId, setFocusContextId] = useState<string | null>(null)
  // A transient "highlight this on arrival" target, set by a notification door
  // (docs/notification-routing.md) and consumed once by the destination page (scroll
  // + highlight the work item / proposal). Deliberately SEPARATE from the nav state
  // above and from history — focus is not page identity, so Back never re-fires a
  // highlight. A plain navigation clears it; a focus-carrying entry point sets it.
  const [pendingFocus, setPendingFocus] = useState<FocusTarget | null>(null)
  // The navigation history stack — the pages visited, so "back" returns to where
  // you actually came *from* (dynamic) instead of a fixed structural parent. Each
  // nav action pushes the page it leaves; goBack pops. (See lib/nav.ts.)
  const [history, setHistory] = useState<NavLocation[]>([])

  // Server sessions this client resolved that aren't in the static seed mirror —
  // a draft made real on its first send, or any session opened by id (a run
  // session from the Scheduled rail, a thread from another device): the reconcile
  // read upserts here, so ALL sessions resolve through one chain (seed mirror →
  // this) with no per-kind synthesis. Consulted until the next reload reseeds.
  const [extraSessions, setExtraSessions] = useState<Session[]>([])

  // Timer bookkeeping so switching sessions cancels in-flight callbacks.
  const runId = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  // handleSend, reachable from callbacks defined before it (retryInterrupted).
  const handleSendRef = useRef<((text: string) => void) | null>(null)
  // Mirror of the open panel, so the toggle (focusContext) can compute the next panel
  // without a stale closure and persist the per-session choice (FWD-2).
  const focusRef = useRef(focus)
  focusRef.current = focus
  // Mirror of the open session id, so a streaming reply that arrives after the
  // user switched sessions is ignored rather than landing in the wrong thread.
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  // Mirror of materialized sessions for reads inside event handlers (selectSession
  // has stable deps and must not close over a stale snapshot).
  const extraSessionsRef = useRef(extraSessions)
  extraSessionsRef.current = extraSessions
  // Mirrors of the current navigation location + the history stack, so the nav
  // actions (stable callbacks) can read where they're leaving without stale
  // closures. activeSessionRef is set after activeSession is computed, below.
  const sectionRef = useRef(activeSection)
  sectionRef.current = activeSection
  const focusProjectRef = useRef(focusProjectId)
  focusProjectRef.current = focusProjectId
  const focusScheduleRef = useRef(focusScheduleId)
  focusScheduleRef.current = focusScheduleId
  const focusOwnerRef = useRef(focusOwnerName)
  focusOwnerRef.current = focusOwnerName
  const focusWorkItemRef = useRef(focusWorkItemId)
  focusWorkItemRef.current = focusWorkItemId
  const focusAgentRef = useRef(focusAgentId)
  focusAgentRef.current = focusAgentId
  const focusContextRef = useRef(focusContextId)
  focusContextRef.current = focusContextId

  // ── Per-account view memory (src/lib/viewMemory.ts) ─────────────────────────
  // The scope freezes at first resolution: the Workspace is KEYED per account
  // (App.tsx), so one instance of this hook serves exactly one account — the
  // freeze keeps the mid-switch cache flicker (useMe briefly undefined, then
  // the NEXT account's answer reaching a not-yet-remounted instance) from ever
  // crediting this account's saves to another. `leftAccount` flips on
  // switch-away so the land-on-draft reset below can't overwrite the place the
  // account was actually left at; `restoreSettled` holds saves off until the
  // mount-time restore has landed (or concluded there is nothing to restore).
  const me = useMe().data
  const viewScope = useRef<string | null>(null)
  if (viewScope.current === null && me) viewScope.current = me.user.id
  const restoreSettled = useRef(false)
  const leftAccount = useRef(false)
  const historyRef = useRef(history)
  historyRef.current = history
  // The in-flight draft → real materialization, so two quick sends on a fresh draft
  // coalesce into ONE session instead of racing to create two. Reset when a new
  // draft begins (newSession) or the materialization fails.
  const draftMaterializing = useRef<Promise<Session> | null>(null)
  // Contexts attached while on the (not-yet-real) draft — a pre-attached entry
  // shortcut (FWD-1) or a manual attach before the first send. The draft can't
  // persist a binding (it has no server id yet), so these are held and flushed onto
  // the real session the moment the draft materializes, so they survive a reload.
  const pendingDraftContexts = useRef<AddedContext[]>([])
  // The draft's model pick (the composer's selector on a not-yet-real session) —
  // same holding pattern as the contexts above: the draft can't PATCH a server row,
  // so the pick rides the materialization (`createSession(text, providerId,
  // modelId)`). Two levels (provider + catalog model), seeded from the Customize
  // page's default prefs, so "what new sessions start with" covers registered
  // providers and concrete models alike.
  const [draftPick, setDraftPick] = useState<ModelPick>(() => {
    const prefs = loadModelPrefs()
    return { providerId: prefs.providerId, modelId: prefs.modelId }
  })
  const draftPickRef = useRef(draftPick)
  draftPickRef.current = draftPick

  const activeSession = useMemo(
    // One resolution chain for every session kind: the static seed mirror, then
    // the sessions this client resolved from the server (`extraSessions` — sent
    // drafts AND any session opened by id, run sessions included; the reconcile
    // read upserts them). An id not yet resolved renders as the draft shell until
    // that read lands — the same brief state any cross-device open has.
    () =>
      SESSIONS.find((c) => c.id === activeId) ??
      extraSessions.find((s) => s.id === activeId) ??
      DRAFT_SESSION,
    [activeId, extraSessions],
  )
  // The transient "New session" draft (not a saved session). Drives the empty
  // greeting + title-bar suppression off the actual id, so a future *empty* real
  // session falls back to neutral copy with its title still shown.
  const isDraft = activeId === DRAFT_ID

  // Mirror of the resolved active session, so `here()` can carry its title into a
  // history entry (run sessions aren't in any list to look up by id later).
  const activeSessionRef = useRef(activeSession)
  activeSessionRef.current = activeSession

  // The page currently shown — a section (with any open detail) or the session
  // thread. Read from refs so the nav actions can capture it as the page they
  // leave, without depending on (and rebuilding from) changing state.
  const here = useCallback((): NavLocation => {
    return sectionRef.current
      ? { kind: 'section', section: sectionRef.current, projectId: focusProjectRef.current, scheduleId: focusScheduleRef.current, ownerName: focusOwnerRef.current, workItemId: focusWorkItemRef.current, agentId: focusAgentRef.current, contextId: focusContextRef.current }
      : { kind: 'session', sessionId: activeIdRef.current, title: activeSessionRef.current.title }
  }, [])

  // Set while goBack is restoring a page, so the restore itself isn't recorded as
  // a new forward step (otherwise back→back would ping-pong instead of unwinding).
  const restoring = useRef(false)

  // Record the page we're leaving as we navigate to `to` (deduped — see lib/nav).
  const record = useCallback((to: NavLocation) => {
    if (restoring.current) return
    setHistory((h) => pushLocation(h, here(), to))
  }, [here])

  const clearTimers = useCallback(() => {
    runId.current += 1
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  // Auto-scroll the thread as messages/typing change — and when a consent prompt
  // appears, so it isn't left below the fold.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [live.messages, typing, pendingEscalation])

  // Resume rendering a turn that's still generating server-side (multi-account
  // §6.5, invariant I1's UI face): a client arriving mid-generation — reopened
  // session, page reload, account switch-back — sees `Session.activeTurnId` on
  // the reconciled read and REATTACHES instead of finding a silently stuck
  // thread. Replays from seq 0: the reconciled live holds only persisted
  // messages, so the assistant shell isn't present yet (the id-guard on
  // message.start keeps a replayed shell from ever duplicating). Ends with the
  // same authoritative message.end the original stream carries; a 404 means the
  // turn persisted while we were away (the store's reattach refetches the session).
  // The streaming turn pipeline (send / reattach / stop) lives in the keyed
  // conversation store now — the hook only routes the active session at it.

  // The deliberate stop (design §5.2/§6.5): cancel the SERVER-owned turn — the
  // partial persists and the open stream ends with its message.end, which is
  // what clears busy/typing (the button doesn't fake the stop locally).
  const stopTurn = useCallback(() => {
    conversations.stop(activeIdRef.current)
  }, [])

  // A thread whose last word is the USER'S with nothing generating — the
  // orphaned-turn state (server restarted mid-turn, or the send failed): offer
  // a retry. Deliberately a FRESH send (the record stays honest — no rewriting
  // history); scoped to real sessions (a draft can't orphan a turn).
  const interrupted =
    !busy &&
    !typing &&
    activeId !== DRAFT_ID &&
    live.messages.length > 0 &&
    live.messages[live.messages.length - 1].role === 'user'
  const retryInterrupted = useCallback(() => {
    const last = [...conversations.get(activeIdRef.current).live.messages].reverse().find((m) => m.role === 'user')
    if (last?.content) handleSendRef.current?.(last.content)
  }, [])

  // Land a server-read session in the client's resolvable set (rows the static
  // seed mirror already covers are skipped) — how a run session opened from the
  // Scheduled rail, or a thread from another device, becomes locally resolvable
  // (title bar, initiator stamp, model pick) after its reconcile read.
  const upsertExtraSession = useCallback((s: Session) => {
    if (SESSIONS.some((c) => c.id === s.id)) return
    setExtraSessions((prev) => {
      const i = prev.findIndex((x) => x.id === s.id)
      if (i === -1) return [s, ...prev]
      const next = [...prev]
      next[i] = s
      return next
    })
  }, [])

  const selectSession = useCallback(
    (id: string) => {
      // Record the page we're leaving so back can return to it (title irrelevant
      // for the dedupe check — it's only used to skip re-selecting this session).
      record({ kind: 'session', sessionId: id, title: '' })
      clearTimers()
      const myRun = runId.current
      setActiveSection(null)
      setActiveId(id)
      // Switching sessions abandons any context staged on the (now-left) draft, so it
      // can't later be flushed onto a different session's first send (FWD-1 pending buffer).
      pendingDraftContexts.current = []
      const session =
        SESSIONS.find((c) => c.id === id) ??
        extraSessionsRef.current.find((s) => s.id === id) ??
        DRAFT_SESSION
      const nextLive = liveFromSession(session)
      // Reset THIS session's conversation entry (fresh flags, no held escalation)
      // and stale any of its older streams; other sessions' streams keep landing
      // in their own entries (the store's epoch model).
      conversations.reset(id, nextLive)
      const since = conversations.epoch(id)
      // Restore the session's remembered panel (FWD-2 / PD34): a stored focus, or null
      // (the user left it closed) — both honoured over the auto-open. With no stored
      // choice, fall back to the strongest present context (the original behaviour).
      const restoreFocus = (l: Live): PanelFocus | null => {
        const pref = id === DRAFT_ID ? undefined : getPanelPref(id)
        return pref !== undefined ? pref : strongestFocus(l)
      }
      setFocus(restoreFocus(nextLive))
      // The active session's context panel rides its `focus` (restored above);
      // the wide tier projects it into the universal tree (App's setFocusDrivenContext
      // effect), the overlay tiers render it docked. No separate frame to restore.
      // Reconcile the full live session from the server (the system of record): a
      // persisted turn AND any persisted runtime attaches (workspace/repo/connector/
      // file) reappear. Skip the unsaved draft (it has no server row yet). Guarded
      // by runId (this client hasn't navigated) AND the entry's epoch (the store's
      // reconcile refuses to clobber a newer reset of the same session).
      if (id !== DRAFT_ID) {
        loadSession(id)
          .then((s) => {
            upsertExtraSession(s)
            if (runId.current !== myRun) return
            const reconciled = liveFromSession(s)
            if (!conversations.reconcile(id, since, reconciled)) return
            setFocus(restoreFocus(reconciled))
            // A persisted-but-unresolved escalation proposal resurfaces as the
            // pending consent card (C28) — the record is the authority; without
            // this, any reopen/reload dropped the card and the proposal could
            // never be approved (the relay transport's long turns hit this).
            const held = unresolvedEscalation(s, reconciled, peek<RelationGraph>(keys.relations))
            if (held) conversations.holdEscalation(id, held)
            // A turn is still generating server-side (multi-account §6.5): the
            // thread would otherwise sit silently on its user message. Resume
            // rendering the stream — replayed from the top, then the live tail.
            if (s.activeTurnId) conversations.reattach(id, s.activeTurnId)
          })
          .catch(() => {})
      }
    },
    [clearTimers, record, upsertExtraSession],
  )

  // An account switch changes whose world this client renders (multi-account
  // §6.1): the cache reset re-reads server state, but the OPEN THREAD is local
  // controller state and must be dropped explicitly — the old active session may
  // not even exist for the new account. Land on a fresh draft; selectSession's
  // clearTimers bumps runId, so any in-flight local stream goes stale (the turn
  // itself continues server-side — that's invariant I1's whole point).
  useEffect(
    () =>
      onAccountSwitch(() => {
        // This instance's account is being LEFT: its last real location is
        // already saved — stop saving so the draft reset below (and any
        // renders while the keyed remount lands) can't overwrite it.
        leftAccount.current = true
        // Drop the sessions resolved for the OLD account — they're another
        // tenant's threads (run sessions included), and keeping them would let a
        // history-back render foreign content the server would now 404 — and
        // every conversation entry with them (the keyed store is per client,
        // not per account).
        setExtraSessions([])
        conversations.clearAll()
        selectSession(DRAFT_ID)
      }),
    [selectSession],
  )

  // A server push named the OPEN thread (a context attached on another client, a
  // rename, a persisted turn): reconcile the controller's live copy from the
  // system of record — the same read selectSession does — so the composer chips
  // and panels track the server instead of freezing at selection time. Skipped
  // while a local stream is mid-flight (the live tail is already authoritative;
  // a reconcile would stomp the render) and for the draft (client-owned).
  useEffect(
    () =>
      onSessionPush((sessionId) => {
        if (sessionId !== activeIdRef.current || sessionId === DRAFT_ID) return
        const entry = conversations.get(sessionId)
        if (entry.busy || entry.typing) return
        const myRun = runId.current
        const since = conversations.epoch(sessionId)
        loadSession(sessionId)
          .then((s) => {
            upsertExtraSession(s)
            if (runId.current !== myRun || activeIdRef.current !== sessionId) return
            const now = conversations.get(sessionId)
            if (now.busy || now.typing) return
            const pushed = liveFromSession(s)
            if (!conversations.reconcile(sessionId, since, pushed)) return
            // Same C28 resurfacing as the select-time reconcile: a turn that
            // finished while this client wasn't streaming it (another device,
            // a detached view) may carry an unresolved escalation proposal.
            const held = unresolvedEscalation(s, pushed, peek<RelationGraph>(keys.relations))
            if (held) conversations.holdEscalation(sessionId, held)
          })
          .catch(() => {})
      }),
    [],
  )

  // Apply an approved escalation to the live session — attach the workspace
  // (using the user-chosen root as its label) or the repo + its connector — and
  // focus the newly attached context's sidebar. The panel *content* came from the
  // backend (the tool's result), not a client fixture; this just lands it. Runs
  // only once the user approves (see approveEscalation), never automatically.
  const applyEscalation = useCallback(
    (esc: EscalationProposal, workspaceRoot?: string) => {
      // The one shared apply funnel (data/liveSession — split panes approve
      // through the same rules; id-guarded, so a replayed beat can't duplicate).
      const label = workspaceRoot ? folderLabel(workspaceRoot) : workspaceNameFor(activeSession)
      const next = applyEscalationToLive(conversations.get(activeIdRef.current).live, esc, label)
      conversations.setLive(activeIdRef.current, next)
      // The grown context's panel opens by setting `focus` — the wide tier's
      // setFocusDrivenContext effect then tiles it as a context pane, the overlay
      // tiers dock it. (One source of truth; no inline tree edit.)
      const grown: PanelFocus | null =
        esc.kind === 'workspace'
          ? { kind: 'workspace', id: 'ws-demo' }
          : esc.kind === 'repo'
            ? { kind: 'repo', id: 'repo-demo' }
            : null
      if (grown) setFocus(grown)
      // An approved escalation on a REAL session persists through the same two
      // facets as a manual attach (handleAddContext): the binding-of-record the
      // effect-mediation path resolves against, and the panel write-through — or
      // a reload would silently drop what the user just consented to grow. A
      // draft has no server row yet.
      const id = activeIdRef.current
      const session = SESSIONS.find((s) => s.id === id) ?? extraSessionsRef.current.find((s) => s.id === id)
      if (id !== DRAFT_ID && session && esc.kind !== 'project') {
        const binding = escalationBinding(esc, label, workspaceRoot)
        if (binding) void attachContext(id, binding).catch(() => {})
        void persistWorkspace(id, workspaceOf(next)).catch(() => {})
      }
    },
    [activeSession],
  )

  // Consent resolved: apply the held escalation (with the chosen cowork root, for
  // a workspace) and clear the prompt. Deny is handled in the prompt itself (a
  // recoverable "denied" view) and never reaches here.
  const approveEscalation = useCallback(
    (workspaceRoot?: string) => {
      const pending = conversations.get(activeIdRef.current).pendingEscalation
      if (!pending) return
      const esc = pending.escalation
      if (esc.kind === 'project') {
        // A project escalation creates a real project (a server-backed relation
        // op), optionally filing this session into it. The user STAYS in the
        // thread — being yanked to the project page mid-conversation broke the
        // flow they were in; the message's confirmed card (EscalationOutcome)
        // carries an "Open project" link to follow at will.
        applyRelationOp({
          kind: 'create-project',
          projectId: esc.project.id,
          projectName: esc.project.name,
          projectDescription: esc.project.description,
          ...(esc.fileSession ? { sessionId: activeSession.id, sessionTitle: activeSession.title } : {}),
        })
      } else {
        applyEscalation(esc, workspaceRoot)
      }
      conversations.patch(activeIdRef.current, { pendingEscalation: null })
    },
    [applyEscalation, activeSession],
  )

  // A turn streams from the backend (POST /sessions/:id/messages) through the real
  // Messages API tool-use loop: we append the user message, then render the
  // assistant reply token-by-token as it arrives. The model (a local mock) decides
  // which resource-manipulation tools to call; the backend executes them and
  // streams back the consent-gated proposals (relation cards / escalations) — a
  // free-typed "organize" request is a real round-trip.
  const handleSend = useCallback((text: string) => {
    const startId = activeIdRef.current
    // The draft's panel choice at dispatch (captured synchronously, before the
    // materialize await, so a mid-flight navigation can't make us read another
    // session's focus). Carried onto the real session below so an explicitly-closed
    // panel on a pre-attached draft (FWD-1) survives the draft→real transition (FWD-2).
    const draftFocus = focusRef.current
    // The draft's model pick at dispatch (same synchronous capture as the focus
    // above), sanitized against the live registry: a stale pick — e.g. a Customize
    // default whose provider was deleted, or a model its catalog dropped —
    // degrades to the inherit default instead of failing the materialization (the
    // server 404s an unknown providerId and 400s an off-catalog modelId). The
    // same sanitize guards the post-materialize flush below, so a rejected stale
    // pick can't sneak back in through the late-write path.
    const sanitizePick = (pick: ModelPick): ModelPick => {
      const known = peek<ModelProvider[]>(keys.providers)
      if (!known) return pick // registry not loaded — let the server arbitrate
      const provider = known.find((p) => p.id === (pick.providerId ?? DEFAULT_PROVIDER_ID))
      if (pick.providerId && !provider) return {}
      const modelId = pick.modelId && provider?.models?.some((m) => m.id === pick.modelId) ? pick.modelId : undefined
      return { providerId: pick.providerId, modelId }
    }
    const draftModel = sanitizePick(draftPickRef.current)
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text }
    // The optimistic user turn + the generation flags land on the DISPATCH-TIME
    // entry (the draft's, before materialization — `adopt` moves them under the
    // real id below). A fresh send stands the previous refusal copy down.
    conversations.update(startId, (s) => ({
      ...s,
      typing: true,
      busy: true,
      sendFailure: null,
      live: { ...s.live, messages: [...s.live.messages, userMsg] },
    }))
    // The turn runs async so an unsaved draft is first materialized into a real,
    // persisted session (the server mints its id + titles it from this message).
    // The reply then streams under that id and the backend persists the turn —
    // making "send" a real, durable operation rather than client-only state.
    //
    // Sends SERIALIZE PER SESSION (the store's chain): the backend enforces one
    // live turn per session (server/turns.ts — a concurrent send is 409
    // conflict), so a rapid second message waits for the first turn to finish
    // instead of being refused. The user message already rendered above, so
    // nothing looks stuck. Different sessions run concurrently — the store's
    // epoch model keeps each stream landing in its own entry.
    void (async () => {
      let sid = startId
      if (sid === DRAFT_ID) {
        try {
          // Coalesce a rapid second send on the same fresh draft into the first
          // materialization (the composer isn't disabled while streaming), so two
          // quick messages land in ONE session rather than creating two.
          const pending = draftMaterializing.current ?? createSession(text, draftModel.providerId, draftModel.modelId)
          draftMaterializing.current = pending
          const created = await pending
          sid = created.id
          setExtraSessions((prev) => (prev.some((s) => s.id === created.id) ? prev : [created, ...prev]))
          // Flush any contexts pre-attached to the draft (a FWD-1 entry shortcut or a
          // manual attach before first send) onto the now-real session: persist each
          // binding-of-record and the assembled panels, so they survive a reload —
          // the binding writes the draft deliberately skipped (persistableSession=false).
          const seeded = pendingDraftContexts.current
          if (seeded.length) {
            // Await the binding writes BEFORE the turn streams: generation derives an
            // attached connector/MCP's tools from the session's server-side contexts
            // (P6), so a pre-attached draft must have its bindings landed before the
            // first send — otherwise the message races ahead and the tools aren't
            // declared for that turn.
            await Promise.all(seeded.flatMap((ctx) => bindingsFor(ctx).map((b) => attachContext(sid, b).catch(() => {}))))
            // Build the panels from the SAME seeded contexts, not `liveRef.current` — a
            // navigation while createSession was in flight would have replaced the live
            // state, so reading the ref here could persist another session's panels onto
            // `sid` (and desync them from the bindings written above). Deriving both faces
            // from `seeded` keeps the persisted binding-of-record and panels in lock-step.
            const seededLive = seeded.reduce((l, ctx) => addContextToLive(l, ctx), EMPTY_LIVE)
            void persistWorkspace(sid, workspaceOf(seededLive)).catch(() => {})
            pendingDraftContexts.current = []
          }
          // Carry the draft's panel choice onto the now-real session (FWD-2): the draft
          // couldn't persist a pref (no server id), so an explicitly-closed panel on a
          // pre-attached draft would otherwise be re-opened by strongestFocus on reopen.
          setPanelPref(sid, draftFocus)
          // A model pick changed WHILE materializing (the composer stayed live) went to
          // the draft slot after the capture above — flush it onto the real session,
          // the same late-write treatment the pre-attached contexts get. Sanitized
          // like the capture, so a stale pref the dispatch just dropped isn't
          // re-PATCHed here (it would 404 on every fresh-draft send).
          const latePick = sanitizePick(draftPickRef.current)
          if (latePick.providerId !== draftModel.providerId || latePick.modelId !== draftModel.modelId) {
            void patchSession(sid, { providerId: latePick.providerId ?? '', modelId: latePick.modelId ?? '' })
          }
          // The draft entry's optimistic state (its user turn(s), its flags)
          // moves under the real id — once; a coalesced second send finds the
          // draft slot already blank and adopt() skips it.
          conversations.adopt(DRAFT_ID, sid)
          // Adopt the new id only if the user is still on the draft — don't yank
          // them back if they navigated away while it was materializing.
          if (activeIdRef.current === DRAFT_ID) {
            setActiveId(sid)
            activeIdRef.current = sid
          }
        } catch {
          // Couldn't materialize (server unreachable) — stream against the draft id;
          // the reply still renders, it just isn't persisted (graceful degradation).
          draftMaterializing.current = null // let a retry re-materialize
          sid = startId
        }
      }
      // The turn streams through the store's shared pipeline: relation cards,
      // escalation prompts, connector tool activity, the settle flags, and the
      // usage-gauge refresh all land in the SESSION'S OWN entry — however the
      // user navigates meanwhile (the epoch model; a reset of this session is
      // the only thing that stales the stream). Server refusal copy (a gate's
      // 503/429) lands as the entry's sendFailure for the retry affordance.
      void conversations.sendTurn(sid, text)
    })()
  }, [])
  handleSendRef.current = handleSend

  // Whether a session's server-owned writes (its panels AND its binding-of-record)
  // should persist: a real, listed (or just-materialized) session — not the
  // unsaved draft. Both write-through paths gate on this so the two facets stay
  // in step — otherwise a binding write would land for a draft while the panel
  // write was skipped, orphaning a persisted binding.
  const persistableSession = useCallback((id: string): boolean => {
    if (id === DRAFT_ID) return false
    const session =
      SESSIONS.find((s) => s.id === id) ?? extraSessionsRef.current.find((s) => s.id === id)
    return !!session
  }, [])

  // Write the active session's panels through to the server (the system of record)
  // after a panel mutation, so a runtime attach survives a reload / shows on
  // another client. Skips the unsaved draft (no server row yet). Fire-and-forget —
  // the optimistic `live` stays the panel's instant driver.
  const persistLive = useCallback((id: string, next: Live) => {
    if (!persistableSession(id)) return
    void persistWorkspace(id, workspaceOf(next)).catch(() => {})
  }, [persistableSession])

  // Manually attach context to the open thread — the same escalation Claude can
  // propose, but user-driven. Every context type funnels through here, and the
  // newly attached context's sidebar opens so you see what you added.
  const handleAddContext = useCallback((ctx: AddedContext) => {
    // The single attach funnel — every context type, from every surface (this
    // picker, Browse, an AI proposal, a repo's side-effect connector), lands
    // here. Promote into the Add-context shortcut list from this one place so
    // the "Recent"/"Connected" quick lists always reflect what was just added
    // (the invariant lives in lib/contextShortcuts.ts).
    rememberAttached(ctx)
    const id = activeIdRef.current
    // Two server-owned facets, both written through (the optimistic `live` is the
    // panel's instant driver): the persistent *binding* the effect-mediation path
    // resolves against (Primitive 1), and the panel *content* the binding produces.
    // Both gate on persistableSession so a draft/demo doesn't persist an orphan
    // binding the panel write (persistLive) deliberately skips.
    if (persistableSession(id)) for (const b of bindingsFor(ctx)) void attachContext(id, b).catch(() => {})
    // A draft can't persist its binding yet (no server id) — hold it so it's flushed
    // onto the real session when the draft materializes on first send (see handleSend).
    else if (id === DRAFT_ID) pendingDraftContexts.current.push(ctx)
    const next = addContextToLive(conversations.get(id).live, ctx)
    conversations.setLive(id, next)
    persistLive(id, next)
    // Open the newly attached context's panel so you see what you added — and
    // remember it (FWD-2). On the wide tier the setFocusDrivenContext effect (App)
    // tiles it as a context pane; the overlay tiers dock it.
    const f = focusForAdded(ctx, next)
    if (f) {
      setFocus(f)
      if (persistableSession(id)) setPanelPref(id, f)
    }
  }, [persistableSession, persistLive])

  // Clicking a chip toggles its panel — and remembers the choice for this session
  // (FWD-2), so reopening the thread restores it. Persist only on this explicit toggle
  // (and closePanel / attach), never via a generic focus watcher — a transient auto-close
  // of a not-yet-loaded panel during a session load must not overwrite the stored choice.
  const focusContext = useCallback(
    (f: PanelFocus) => {
      const next = sameFocus(focusRef.current, f) ? null : f
      setFocus(next)
      if (persistableSession(activeIdRef.current)) setPanelPref(activeIdRef.current, next)
    },
    [persistableSession],
  )

  // "New session" opens a blank thread with the composer ready, like the desktop
  // app's "New chat" (not a jump to an existing session). With an optional context
  // `seed`, the thread lands already-escalated with that context pre-attached and its
  // panel open — the old per-mode entry points ("New from repo / folder") survive as
  // shortcuts, not tabs (FWD-1 / PD33). One code path, several launchers; the seed runs
  // the same attach funnel (held in pendingDraftContexts, persisted on first send).
  const newSession = useCallback((seed?: AddedContext) => {
    record({ kind: 'session', sessionId: DRAFT_ID, title: '' })
    clearTimers()
    setActiveSection(null)
    setActiveId(DRAFT_ID)
    // A fresh draft must re-materialize on its first send — don't reuse the
    // previous draft's (now resolved) session.
    draftMaterializing.current = null
    // …and starts back on the preferred default model (the Customize pick —
    // provider and/or concrete catalog model; no pick = the inherit default).
    const prefs = loadModelPrefs()
    setDraftPick({ providerId: prefs.providerId, modelId: prefs.modelId })
    if (seed) {
      rememberAttached(seed) // promote into the Add-context recents, like a manual attach
      const seeded = addContextToLive(EMPTY_LIVE, seed)
      conversations.reset(DRAFT_ID, seeded) // fresh flags, no held escalation
      setFocus(focusForAdded(seed, seeded))
      pendingDraftContexts.current = [seed]
    } else {
      conversations.reset(DRAFT_ID, EMPTY_LIVE)
      setFocus(null)
      pendingDraftContexts.current = []
    }
  }, [clearTimers, record])

  // "New from repo / folder / connector…" — a per-mode entry point that starts a
  // fresh chat with that context pre-attached (FWD-1 / PD33). Multi-add aware: if
  // already on a fresh, empty draft, stack the context onto it (so several picks
  // build one new thread) instead of resetting to yet another draft.
  const newSessionWith = useCallback(
    (ctx: AddedContext) => {
      if (activeIdRef.current === DRAFT_ID && conversations.get(DRAFT_ID).live.messages.length === 0) {
        handleAddContext(ctx)
      } else {
        newSession(ctx)
      }
    },
    [handleAddContext, newSession],
  )

  // Opening a section from the rail always lands on its top level, so clear any
  // project a previous deep-link had focused.
  const openSection = useCallback((s: SectionId) => {
    record({ kind: 'section', section: s, projectId: null, scheduleId: null, ownerName: null })
    setActiveSection(s)
    setActiveSubview(null) // each section body maps null to its own default (all / worker list)
    setFocusProjectId(null)
    setFocusScheduleId(null)
    setFocusOwnerName(null)
    setFocusWorkItemId(null)
    setFocusAgentId(null)
    setFocusContextId(null)
    setPendingFocus(null) // a plain nav carries no focus intent — drop any stale target
  }, [record])

  // Switch the active section's sub-view (the rail drill-in menu). A LATERAL move —
  // not recorded in history — so it drops any open detail (returning to that
  // sub-view's list) but leaves the section itself put.
  const openSubview = useCallback((id: string | null) => {
    setActiveSubview(id)
    setFocusProjectId(null)
    setFocusScheduleId(null)
    setFocusOwnerName(null)
    setFocusWorkItemId(null)
    setFocusAgentId(null)
    setFocusContextId(null)
    setPendingFocus(null)
  }, [])

  // Open a project's detail page. Reached three ways — a session's "In ‹Project›"
  // breadcrumb, a relation deep-link, or a click in the Projects list — and all
  // route through here, so the detail target is one source of truth (focusProjectId)
  // and every entry is recorded in history for back.
  const openProject = useCallback((projectId: string) => {
    record({ kind: 'section', section: 'projects', projectId, scheduleId: null, ownerName: null })
    setActiveSection('projects')
    setActiveSubview(null)
    setFocusProjectId(projectId)
    setFocusScheduleId(null)
    setFocusOwnerName(null)
    setFocusWorkItemId(null)
    setFocusAgentId(null)
    setFocusContextId(null)
    setPendingFocus(null)
  }, [record])

  // Open a routine's detail page. Reached from a run session's breadcrumb, a
  // project's routine row, or the Scheduled list — all through here (see openProject).
  const openSchedule = useCallback((scheduleId: string) => {
    record({ kind: 'section', section: 'scheduled', projectId: null, scheduleId, ownerName: null })
    setActiveSection('scheduled')
    setActiveSubview(null)
    setFocusScheduleId(scheduleId)
    setFocusProjectId(null)
    setFocusOwnerName(null)
    setFocusWorkItemId(null)
    setFocusAgentId(null)
    setFocusContextId(null)
    setPendingFocus(null)
  }, [record])

  // Open a workspace's public profile (D21) — reached from any owner byline (a
  // directory card, a shared project's header, a search hit), all through here,
  // so the open profile is one source of truth and every entry lands in history.
  const openOwner = useCallback((name: string) => {
    record({ kind: 'section', section: 'agents', projectId: null, scheduleId: null, ownerName: name })
    setActiveSection('agents')
    setActiveSubview(null)
    setFocusOwnerName(name)
    setFocusWorkItemId(null)
    setFocusAgentId(null)
    setFocusContextId(null)
    setFocusProjectId(null)
    setFocusScheduleId(null)
    setPendingFocus(null)
  }, [record])

  // A published definition's OWN page under the Agents section (the repo-page
  // analog, COMMONS-26) — every door to a public definition lands here: the
  // directory card's title / "View definition", a profile's agent card, the
  // proposer-side proposal bell, a pasted /agents/:id address.
  const openAgentPage = useCallback((agentId: string) => {
    record({ kind: 'section', section: 'agents', projectId: null, scheduleId: null, ownerName: null, agentId })
    setActiveSection('agents')
    setActiveSubview(null)
    setFocusAgentId(agentId)
    setFocusOwnerName(null)
    setFocusProjectId(null)
    setFocusScheduleId(null)
    setFocusWorkItemId(null)
    setFocusContextId(null)
    setPendingFocus(null)
  }, [record])

  // A saved context's OWN page under the Contexts section (ADAPT-15) — every door
  // to a set-up context lands here: the Contexts list row, a project's context
  // chip, a contributor row's reach label, a pasted /contexts/:id address.
  const openContextPage = useCallback((contextId: string) => {
    record({ kind: 'section', section: 'contexts', projectId: null, scheduleId: null, ownerName: null, contextId })
    setActiveSection('contexts')
    setActiveSubview(null)
    setFocusContextId(contextId)
    setFocusAgentId(null)
    setFocusOwnerName(null)
    setFocusProjectId(null)
    setFocusScheduleId(null)
    setFocusWorkItemId(null)
    setPendingFocus(null)
  }, [record])

  // A work item's OWN page under its project (the issue-page analog, D19/D23) —
  // every door to an item lands here: its title on the project backlog, a work.* /
  // mentioned bell (which then anchors the comment it names via the pending focus,
  // GitHub's `#issuecomment`), a pasted /projects/:id/work/:item address.
  const openWorkItemPage = useCallback((projectId: string, workItemId: string) => {
    record({ kind: 'section', section: 'projects', projectId, scheduleId: null, ownerName: null, workItemId })
    setActiveSection('projects')
    setActiveSubview(null)
    setFocusProjectId(projectId)
    setFocusScheduleId(null)
    setFocusOwnerName(null)
    setFocusWorkItemId(workItemId)
    setFocusAgentId(null)
    setFocusContextId(null)
    setPendingFocus(null)
  }, [record])

  // ── Per-account view restore + save (multi-account: switch-back finds the
  // account exactly where it was left; a reload restores the same way) ────────
  // Restore ONCE per mount, as soon as the scope resolves. A remembered thread
  // is validated against the server first (deleted / foreign → stay on the
  // fresh draft); a remembered section page restores optimistically — those
  // pages read live data and degrade gracefully. Declared BEFORE the save
  // effect so a restore always settles ahead of the first save.
  useEffect(() => {
    if (!viewScope.current || restoreSettled.current) return
    // The boot address wins over memory (a pasted link opens what it names);
    // it maps onto the same ViewLocation shape so ONE apply path serves both.
    const routed = takeBootView()
    const loc: ViewLocation | undefined = routed
      ? routed.loc.kind === 'session'
        ? { kind: 'session', sessionId: routed.loc.sessionId }
        : {
            kind: 'section',
            section: routed.loc.section,
            subview: routed.subview,
            projectId: routed.loc.projectId,
            scheduleId: routed.loc.scheduleId,
            ownerName: routed.loc.ownerName ?? null,
            workItemId: routed.loc.workItemId ?? null,
            agentId: routed.loc.agentId ?? null,
            contextId: routed.loc.contextId ?? null,
          }
      : loadViewLocation(viewScope.current)
    if (!loc) {
      restoreSettled.current = true
      return
    }
    if (loc.kind === 'session') {
      loadSession(loc.sessionId)
        .then(() => selectSession(loc.sessionId))
        .catch(() => {}) // gone (or the draft placeholder) → the fresh draft stands
        .finally(() => {
          restoreSettled.current = true
        })
      return
    }
    if (loc.ownerName) openOwner(loc.ownerName)
    else if (loc.agentId) openAgentPage(loc.agentId)
    else if (loc.contextId) openContextPage(loc.contextId)
    else if (loc.projectId && loc.workItemId) openWorkItemPage(loc.projectId, loc.workItemId)
    else if (loc.projectId) openProject(loc.projectId)
    else if (loc.scheduleId) openSchedule(loc.scheduleId)
    else {
      openSection(loc.section)
      if (loc.subview) openSubview(loc.subview)
    }
    restoreSettled.current = true
  }, [me, selectSession, openOwner, openAgentPage, openContextPage, openWorkItemPage, openProject, openSchedule, openSection, openSubview])

  // Save the location on every navigation — the thread, or the section page
  // with its sub-view / detail focus. Gated until the restore settles (the
  // mount-time draft must not clobber the remembered place) and stopped once
  // the account is left (see onAccountSwitch above).
  useEffect(() => {
    if (!viewScope.current || !restoreSettled.current || leftAccount.current) return
    saveViewLocation(
      viewScope.current,
      activeSection
        ? {
            kind: 'section',
            section: activeSection,
            subview: activeSubview,
            projectId: focusProjectId,
            scheduleId: focusScheduleId,
            ownerName: focusOwnerName,
            workItemId: focusWorkItemId,
            agentId: focusAgentId,
            contextId: focusContextId,
          }
        : { kind: 'session', sessionId: activeId },
    )
    // …and mirror the location into the address bar (src/lib/urlRoutes.ts): every
    // page has ONE canonical URL, so it's shareable / bookmarkable and the browser's
    // own Back/Forward work. Arriving VIA the address (boot deep link, popstate)
    // lands with the path already current, so the equality guard keeps those from
    // minting a duplicate history entry.
    const path = pathForView(
      activeSection
        ? { kind: 'section', section: activeSection, projectId: focusProjectId, scheduleId: focusScheduleId, ownerName: focusOwnerName, workItemId: focusWorkItemId, agentId: focusAgentId, contextId: focusContextId }
        : { kind: 'session', sessionId: activeId, title: '' },
      activeSubview,
    )
    if (window.location.pathname !== path) window.history.pushState(null, '', path)
  }, [activeId, activeSection, activeSubview, focusProjectId, focusScheduleId, focusOwnerName, focusWorkItemId, focusAgentId, focusContextId])

  // Browser Back/Forward: re-parse the address it moved to and show that page.
  // Not recorded in the in-app back stack while applying (`restoring`) — the two
  // histories stay parallel, and the URL-sync effect above sees pathname already
  // equal to the restored page's path, so no new entry is pushed.
  useEffect(() => {
    const onPop = () => {
      const routed = viewForPath(window.location.pathname)
      restoring.current = true
      if (!routed) {
        newSession() // the root — the fresh draft
      } else if (routed.loc.kind === 'session') {
        const sid = routed.loc.sessionId
        void loadSession(sid)
          .then(() => selectSession(sid))
          .catch(() => {}) // gone / foreign → stay put (the address was a dead link)
      } else {
        const l = routed.loc
        if (l.ownerName) openOwner(l.ownerName)
        else if (l.agentId) openAgentPage(l.agentId)
        else if (l.contextId) openContextPage(l.contextId)
        else if (l.projectId && l.workItemId) openWorkItemPage(l.projectId, l.workItemId)
        else if (l.projectId) openProject(l.projectId)
        else if (l.scheduleId) openSchedule(l.scheduleId)
        else {
          openSection(l.section)
          if (routed.subview) openSubview(routed.subview)
        }
      }
      restoring.current = false
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [newSession, selectSession, openOwner, openAgentPage, openContextPage, openWorkItemPage, openProject, openSchedule, openSection, openSubview])

  // ── Notification doors (docs/notification-routing.md) ─────────────────────
  // A bell lands on the EXACT sub-entity its act touched: these navigate to the
  // page (recording history, like every nav) AND set the transient focus the
  // destination consumes to scroll + highlight it. `setPendingFocus` runs last so
  // it survives the plain-nav clear these reuse conceptually.
  const consumeFocus = useCallback(() => setPendingFocus(null), [])

  // A work.* / mentioned bell: the item's page, with the touched sub-entity
  // (the item itself, or one comment) highlighted on arrival.
  const openWorkItem = useCallback((projectId: string, workItemId: string, commentId?: string) => {
    openWorkItemPage(projectId, workItemId)
    setPendingFocus({ projectId, workItemId, commentId })
  }, [openWorkItemPage])

  // A change proposal on the agent's review surface (proposal.* bells). `ownerName`
  // null ⇒ the caller OWNS the agent ⇒ their Agents hub (the review queue); else the
  // definition's own PAGE (COMMONS-26), where "Your proposals" lives — with the
  // proposal focused on arrival. (No commentId focus: the proposal's thread renders
  // open in both surfaces — a short two-party conversation — so anchoring one
  // comment added nothing; the per-comment anchor is a work-item-only affordance.)
  const openProposal = useCallback(
    (agentId: string, proposalId: string, ownerName: string | null) => {
      if (ownerName) {
        openAgentPage(agentId)
      } else {
        record({ kind: 'section', section: 'agents', projectId: null, scheduleId: null, ownerName: null })
        setActiveSection('agents')
        setActiveSubview(null)
        setFocusOwnerName(null)
        setFocusAgentId(null)
        setFocusContextId(null)
        setFocusProjectId(null)
        setFocusScheduleId(null)
        setFocusWorkItemId(null)
      }
      setPendingFocus({ agentId, proposalId })
    },
    [record, openAgentPage],
  )

  // The source agent (agent.forked) — the recipient is its owner, so their own
  // Agents hub, with the card highlighted. Never the fork (the leak-wall).
  const openAgent = useCallback((agentId: string) => {
    record({ kind: 'section', section: 'agents', projectId: null, scheduleId: null, ownerName: null })
    setActiveSection('agents')
    setActiveSubview(null)
    setFocusOwnerName(null)
    setFocusWorkItemId(null)
    setFocusAgentId(null)
    setFocusContextId(null)
    setFocusProjectId(null)
    setFocusScheduleId(null)
    setPendingFocus({ agentId })
  }, [record])

  // ── Back: pop the history stack and restore that page ─────────────────────
  // Dynamic, not structural — returns to wherever you came *from*. The fallback
  // (empty stack on a detail page) is the section's own list, so back is never a
  // dead end. `backTo` is the destination, surfaced so the button can name it.
  const applyLocation = useCallback((loc: NavLocation) => {
    if (loc.kind === 'session') {
      selectSession(loc.sessionId)
    } else {
      setActiveSection(loc.section)
      setActiveSubview(null) // sub-views aren't in history — land on the section default
      setFocusProjectId(loc.projectId)
      setFocusScheduleId(loc.scheduleId)
      setFocusOwnerName(loc.ownerName ?? null)
      setFocusWorkItemId(loc.workItemId ?? null)
      setFocusAgentId(loc.agentId ?? null)
      setFocusContextId(loc.contextId ?? null)
    }
  }, [selectSession])

  const goBack = useCallback(() => {
    const h = historyRef.current
    if (h.length === 0) {
      // Nothing recorded — fall back one STRUCTURAL level: a work-item page drops
      // to its project page (GitHub: issue → repo), any other detail to the list.
      if (sectionRef.current && focusWorkItemRef.current) {
        setFocusWorkItemId(null)
        setFocusAgentId(null)
        return
      }
      if (sectionRef.current && (focusProjectRef.current || focusScheduleRef.current || focusOwnerRef.current || focusAgentRef.current || focusContextRef.current)) {
        setFocusProjectId(null)
        setFocusScheduleId(null)
        setFocusOwnerName(null)
        setFocusWorkItemId(null)
        setFocusAgentId(null)
        setFocusContextId(null)
      }
      return
    }
    const prev = h[h.length - 1]
    setHistory(h.slice(0, -1))
    // Restore without recording — applyLocation may route through selectSession,
    // which would otherwise push the page we're leaving back onto the stack.
    restoring.current = true
    applyLocation(prev)
    restoring.current = false
  }, [applyLocation])

  // The destination back will return to — the stack's top, or (empty stack on a
  // detail page) that section's list. Null when there's nowhere to go back to.
  const backTo = useMemo<NavLocation | null>(() => {
    if (history.length > 0) return history[history.length - 1]
    // Structural fallbacks mirror goBack: item page → its project page → the list.
    if (activeSection && focusWorkItemId && focusProjectId)
      return { kind: 'section', section: activeSection, projectId: focusProjectId, scheduleId: null, ownerName: null }
    if (activeSection && (focusProjectId || focusScheduleId || focusOwnerName || focusAgentId || focusContextId))
      return { kind: 'section', section: activeSection, projectId: null, scheduleId: null, ownerName: null }
    return null
  }, [history, activeSection, focusProjectId, focusScheduleId, focusOwnerName, focusWorkItemId, focusAgentId, focusContextId])

  // ── Recents row-menu edits (pin / rename / archive / delete) ──────────────
  // List-level mutations; the sidebar reflects them through the live session
  // feed. Delete also steps the open thread away if it was the one removed (the
  // controller resolves the full session from a static mirror, so a dangling id
  // would otherwise linger).
  const pinSession = useCallback((id: string, pinned: boolean) => {
    void patchSession(id, { pinned })
  }, [])
  const renameSession = useCallback((id: string, title: string) => {
    void patchSession(id, { title })
  }, [])
  const archiveSession = useCallback((id: string, archived: boolean) => {
    void patchSession(id, { status: archived ? 'archived' : 'active' })
  }, [])
  // The composer's model pick for the ACTIVE session — two levels (provider +
  // catalog model). A real session PATCHes its server row (undefined → '' clears
  // each back to inherit — the registry's empty-string-means-default convention;
  // the server clears the model pick on any provider change, its namespace moved);
  // a draft holds the pick locally and the materialization carries it (see
  // handleSend). Next turn routes accordingly.
  const selectModel = useCallback((pick: ModelPick) => {
    if (activeIdRef.current === DRAFT_ID) setDraftPick(pick)
    else void patchSession(activeIdRef.current, { providerId: pick.providerId ?? '', modelId: pick.modelId ?? '' })
  }, [])
  const deleteSession = useCallback(
    (id: string) => {
      void deleteSessionCmd(id)
      if (id === activeIdRef.current) newSession()
    },
    [newSession],
  )

  const removeAttachment = useCallback((attId: string) => {
    const id = activeIdRef.current
    if (persistableSession(id)) void detachContext(id, attId).catch(() => {})
    const next = removeAttachmentFromLive(conversations.get(id).live, attId)
    conversations.setLive(id, next)
    persistLive(id, next)
  }, [persistableSession, persistLive])

  // Remove a single source folder from the shared workspace: drop the artifacts
  // it contributed, and drop the workspace itself if that empties it (the
  // valid-focus effect below then closes the panel). Seeded/default artifacts
  // (no source) are never touched, so a workspace that still holds them stays.
  const removeFolder = useCallback((sourceId: string) => {
    const id = activeIdRef.current
    const next = removeFolderFromLive(conversations.get(id).live, sourceId)
    conversations.setLive(id, next)
    // Detach this folder's own binding-of-record — keyed by its source id, the same
    // id attach used (Primitive 1) — so it goes away even when other folders remain
    // in the shared workspace (each folder is its own attachment now, not a shared
    // WS_ID one that only detaches when the whole workspace empties).
    if (persistableSession(id)) void detachContext(id, sourceId).catch(() => {})
    persistLive(id, next)
  }, [persistableSession, persistLive])

  // Remove one or more attached contexts in a single update. The chip remove
  // flow passes several at once when a removal cascades (a repo + its orphaned
  // GitHub connector, or the connector + the repos that depend on it); the
  // connector panel's Disconnect passes just the connector.
  const removeContexts = useCallback((focuses: PanelFocus[]) => {
    const id = activeIdRef.current
    // Mirror the removal to the persistent binding (Primitive 1): detach each focus
    // by id (the binding id pairs with the chip's focus id). Fire-and-forget, and
    // gated on persistableSession so it stays in step with the binding write.
    if (persistableSession(id)) for (const f of focuses) void detachContext(id, f.id).catch(() => {})
    const next = removeContextsFromLive(conversations.get(id).live, focuses)
    conversations.setLive(id, next)
    persistLive(id, next)
  }, [persistableSession, persistLive])

  // Close the sidebar if its context no longer exists (removed / switched away).
  useEffect(() => {
    if (!focus) return
    const valid =
      focus.kind === 'workspace'
        ? live.workspaces.some((w) => w.id === focus.id)
        : focus.kind === 'repo'
          ? live.repos.some((r) => r.id === focus.id)
          : focus.kind === 'connector'
            ? live.connectors.some((c) => c.id === focus.id)
            : live.attachments.some((a) => a.id === focus.id)
    if (!valid) setFocus(null)
  }, [focus, live])

  const focusedWorkspace =
    focus?.kind === 'workspace' ? live.workspaces.find((w) => w.id === focus.id) : undefined
  const focusedRepo = focus?.kind === 'repo' ? live.repos.find((r) => r.id === focus.id) : undefined
  const focusedConnector =
    focus?.kind === 'connector' ? live.connectors.find((c) => c.id === focus.id) : undefined

  const closePanel = useCallback(() => {
    // Clears the active session's panel — on the wide tier the setFocusDrivenContext
    // effect (App) then removes its context pane; the overlay tiers hide the
    // docked panel. Remember the closed state (FWD-2) so it stays closed on reopen.
    setFocus(null)
    if (persistableSession(activeIdRef.current)) setPanelPref(activeIdRef.current, null)
  }, [persistableSession])

  // The view-facing shape of the held consent prompt: which escalation is
  // pending plus what the prompt needs to render (a workspace beat's root
  // choices; a repo beat's service name). Null when nothing is pending.
  const pendingApproval = useMemo(
    () => (pendingEscalation ? approvalView(pendingEscalation.escalation) : null),
    [pendingEscalation],
  )

  // Context compaction (P5 / BROKER-EXP-3): ask the backend (server-owned) to archive the
  // older messages behind a summary marker, then swap our live messages to the returned
  // (compacted) set so the open thread + the composer's live token overlay — and thus the
  // usage gauge disc — drop back. Only a persisted, real session compacts (a draft/demo
  // has nothing durable to archive).
  const compact = useCallback(async () => {
    const sid = activeIdRef.current
    if (!persistableSession(sid)) return
    try {
      const updated = await compactSession(sid)
      if (activeIdRef.current !== sid) return // navigated away mid-request
      conversations.setLive(sid, (l) => ({ ...l, messages: updated.messages ?? [] }))
    } catch {
      /* leave the thread as-is; the user can retry */
    }
  }, [persistableSession])

  return {
    // state
    activeId,
    activeSection,
    activeSubview,
    focusProjectId,
    focusScheduleId,
    focusOwnerName,
    focusWorkItemId,
    focusAgentId,
    focusContextId,
    pendingFocus,
    live,
    typing,
    focus,
    activeSession,
    isDraft,
    busy,
    liveTurn,
    interrupted,
    sendFailure,
    pendingApproval,
    bottomRef,
    // derived focus
    focusedWorkspace,
    focusedRepo,
    focusedConnector,
    // actions
    selectSession,
    newSession,
    newSessionWith,
    openSection,
    openSubview,
    openProject,
    openSchedule,
    openOwner,
    openAgentPage,
    openContextPage,
    openWorkItemPage,
    openWorkItem,
    openProposal,
    openAgent,
    consumeFocus,
    goBack,
    backTo,
    pinSession,
    renameSession,
    archiveSession,
    deleteSession,
    // the composer's model pick (draft-held until materialization)
    selectModel,
    draftPick,
    handleSend,
    stopTurn,
    retryInterrupted,
    compact,
    handleAddContext,
    focusContext,
    removeContexts,
    removeAttachment,
    removeFolder,
    closePanel,
    approveEscalation,
  }
}
