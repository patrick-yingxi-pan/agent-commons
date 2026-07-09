import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEMO_STEPS } from '../data/demo'
import { DEMO_SESSION_ID, SESSIONS } from '../data/sessions'
import {
  DRAFT_ID,
  DRAFT_SESSION,
  EMPTY_LIVE,
  WS_ID,
  addContextToLive,
  focusForAdded,
  folderLabel,
  liveFromSession,
  removeAttachmentFromLive,
  removeContextsFromLive,
  removeFolderFromLive,
  repoIdForLabel,
  slug,
  withConnector,
  workspaceOf,
  workspaceNameFor,
  type Live,
} from '../data/liveSession'
import { sameFocus } from '../lib/focus'
import { firstSubview } from '../lib/subviews'
import { pushLocation, type NavLocation } from '../lib/nav'
import type { FocusTarget } from '../lib/notificationDoor'
import { rememberAttached } from '../lib/contextShortcuts'
import { getPanelPref, setPanelPref } from '../lib/panelPrefs'
import { loadModelPrefs } from '../lib/modelPrefs'
import { parseFsRecentKey } from '../../contract/index'
import { runSessionById } from '../data/scheduledRuns'
import {
  applyRelationOp,
  attachContext,
  createSession,
  deleteSession as deleteSessionCmd,
  detachContext,
  invalidate,
  keys,
  peek,
  loadSession,
  patchSession,
  persistWorkspace,
  runSessionFromCache,
  runSessionFromSchedules,
  cancelTurn,
  onAccountSwitch,
  reattachTurn,
  sendMessage,
  compactSession,
} from '../api'
import type {
  AddedContext,
  AttachContextRequest,
  EscalationProposal,
  Message,
  ModelProvider,
  PanelFocus,
  Repo,
  SectionId,
  Session,
  TourPhase,
} from '../types'

/** A held escalation proposal — the result of the model's panel-producing tool
 *  call (open_workspace / connect_repo / create_project), waiting on the inline
 *  consent prompt. Carries the message it rode in on (for scrolling/anchoring). */
interface PendingEscalation {
  messageId: string
  escalation: EscalationProposal
}

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
function bindingsFor(ctx: AddedContext): AttachContextRequest[] {
  switch (ctx.kind) {
    case 'folder': {
      // The folder key is source-qualified (`<source>::<path>`); its scope is the
      // path within the source, and `source` records which host it came from.
      const folderId = ctx.artifacts[0]?.source?.id ?? slug(ctx.label)
      const scope = parseFsRecentKey(folderId)?.entryId ?? ctx.label
      return [{ id: folderId, type: 'folder', label: ctx.label, scope, source: ctx.source }]
    }
    case 'repo':
      return [{ id: repoIdForLabel(ctx.label), type: 'repo', label: ctx.label, scope: ctx.path ?? '*' }]
    case 'connector':
      return [{ id: ctx.connector.id, type: 'connector', label: ctx.connector.label, scope: '*' }]
    case 'mcp':
      return [{ id: ctx.connector.id, type: 'mcp', label: ctx.connector.label, scope: '*' }]
    case 'files':
      return ctx.attachments.map((a): AttachContextRequest => ({
        id: a.id,
        type: 'files',
        label: a.label,
        scope: parseFsRecentKey(a.id)?.entryId ?? '*',
        source: a.source,
      }))
    case 'photos':
      return ctx.attachments.map((a): AttachContextRequest => ({
        id: a.id,
        type: 'photos',
        label: a.label,
        scope: parseFsRecentKey(a.id)?.entryId ?? '*',
        source: a.source,
      }))
    default:
      return []
  }
}

/** The strongest present context to auto-open when a session opens — a repo if
 *  there is one, else a workspace, else nothing (the panel stays closed). */
function strongestFocus(l: Live): PanelFocus | null {
  return l.repos[0]
    ? { kind: 'repo', id: l.repos[0].id }
    : l.workspaces[0]
      ? { kind: 'workspace', id: l.workspaces[0].id }
      : null
}

/** ── Controller: the active session + its live workspace ───────────────────
 *  Owns all session, live-context, panel-focus, section, and guided-tour state,
 *  plus every handler the view binds to. App.tsx is a thin view over what this
 *  returns; the domain rules it calls live in data/liveSession.ts (model). */
export function useSessionWorkspace() {
  const [activeId, setActiveId] = useState(DEMO_SESSION_ID)
  const [live, setLive] = useState<Live>(EMPTY_LIVE)
  const [typing, setTyping] = useState(false)
  // Which attached context the right-hand sidebar is showing (null = closed).
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

  // Guided-tour state (only meaningful for the demo session).
  const [phase, setPhase] = useState<TourPhase>('idle')
  const [stepIndex, setStepIndex] = useState(-1)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  // The server-owned turn currently streaming into THIS client (multi-account
  // P0/P6c) — the handle the stop button cancels with. Null between turns.
  const [liveTurn, setLiveTurn] = useState<{ sessionId: string; turnId: string } | null>(null)
  // An escalating beat holds here until the user consents: the model's tool call
  // produced an escalation proposal (streamed as `message.escalation`), and it
  // applies only on approval. Null = nothing pending.
  const [pendingEscalation, setPendingEscalation] = useState<PendingEscalation | null>(null)
  const pendingEscalationRef = useRef(pendingEscalation)
  pendingEscalationRef.current = pendingEscalation
  // Sessions materialized this client-session — a draft made real on its first
  // send (server-minted, so absent from the static seed mirror). The active-session
  // resolution and the sidebar consult this until the next reload reseeds from the API.
  const [extraSessions, setExtraSessions] = useState<Session[]>([])
  // Free-typed sends run one-at-a-time through this chain: the backend enforces one
  // live turn per session (server/turns.ts), so a rapid second send queues behind
  // the first instead of being refused with 409 conflict.
  const sendChain = useRef<Promise<void>>(Promise.resolve())

  // Timer bookkeeping so switching sessions cancels in-flight callbacks.
  const runId = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  // Mirror of `live` for reads inside event handlers (handleAddContext has empty
  // deps and must not close over a stale snapshot).
  const liveRef = useRef(live)
  liveRef.current = live
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
  // so the pick rides the materialization (`createSession(text, providerId)`).
  // Seeded from the Customize page's default (`defaultProviderId`), so "what new
  // sessions start with" covers registered models too.
  const [draftProviderId, setDraftProviderId] = useState<string | undefined>(
    () => loadModelPrefs().defaultProviderId,
  )
  const draftProviderRef = useRef(draftProviderId)
  draftProviderRef.current = draftProviderId

  const activeSession = useMemo(
    // A scheduled run opens its own synthesized session — resolve from the live
    // feed cache first (covers daemon/run-now runs), then the seed fallback. A
    // session materialized this client-session (a sent draft) resolves from
    // `extraSessions`, since it isn't in the static seed mirror.
    () =>
      SESSIONS.find((c) => c.id === activeId) ??
      extraSessions.find((s) => s.id === activeId) ??
      runSessionFromSchedules(activeId) ??
      runSessionFromCache(activeId) ??
      runSessionById(activeId) ??
      DRAFT_SESSION,
    [activeId, extraSessions],
  )
  const isDemo = !!activeSession.isDemo
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
      ? { kind: 'section', section: sectionRef.current, projectId: focusProjectRef.current, scheduleId: focusScheduleRef.current, ownerName: focusOwnerRef.current }
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

  const schedule = useCallback((fn: () => void, ms: number) => {
    const myRun = runId.current
    const t = setTimeout(() => {
      if (myRun === runId.current) fn()
    }, ms)
    timers.current.push(t)
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
  // turn persisted while we were away (reattachTurn refetches the session).
  const reattachToTurn = useCallback((sid: string, turnId: string, myRun: number) => {
    const stale = () => activeIdRef.current !== sid || runId.current !== myRun
    setTyping(true)
    setBusy(true)
    setLiveTurn({ sessionId: sid, turnId })
    void reattachTurn(sid, turnId, 0, {
      onStart: (_id, message) => {
        if (stale()) return
        setTyping(false)
        setLive((l) => (l.messages.some((m) => m.id === message.id) ? l : { ...l, messages: [...l.messages, message] }))
      },
      onDelta: (messageId, chunk) => {
        if (stale()) return
        setLive((l) => ({
          ...l,
          messages: l.messages.map((m) => (m.id === messageId ? { ...m, content: m.content + chunk } : m)),
        }))
      },
      onRelations: (messageId, relationActions) => {
        if (stale()) return
        setLive((l) => ({
          ...l,
          messages: l.messages.map((m) => (m.id === messageId ? { ...m, relationActions } : m)),
        }))
      },
      onToolActivity: (messageId, toolActivities) => {
        if (stale()) return
        setLive((l) => ({
          ...l,
          messages: l.messages.map((m) => (m.id === messageId ? { ...m, toolActivities } : m)),
        }))
      },
      onEscalation: (messageId, escalation) => {
        if (stale()) return
        setPendingEscalation({ messageId, escalation })
      },
      onEnd: (message) => {
        if (stale()) return
        setLive((l) => ({ ...l, messages: l.messages.map((m) => (m.id === message.id ? message : m)) }))
        invalidate(keys.usage(sid))
      },
    })
      .catch(() => {})
      .finally(() => {
        // However the stream ended (message.end, 404→refetch, or a drop), the
        // local streaming affordances stand down; the record is the authority.
        if (stale()) return
        setTyping(false)
        setBusy(false)
        setLiveTurn(null)
      })
  }, [])

  // The deliberate stop (design §5.2/§6.5): cancel the SERVER-owned turn — the
  // partial persists and the open stream ends with its message.end, which is
  // what clears busy/typing (the button doesn't fake the stop locally).
  const stopTurn = useCallback(() => {
    const t = liveTurn
    if (t) void cancelTurn(t.sessionId, t.turnId).catch(() => {})
  }, [liveTurn])

  // Why the last send was refused/failed, when the server said so (the pre-persist
  // gates: relay_offline / relay_busy / limit_exceeded carry user-facing copy —
  // "Your session isn't answering — start its drain loop and retry"). Shown by the
  // interrupted affordance in place of its generic line; cleared on the next send.
  const [sendFailure, setSendFailure] = useState<string | null>(null)

  // A thread whose last word is the USER'S with nothing generating — the
  // orphaned-turn state (server restarted mid-turn, or the send failed): offer
  // a retry. Deliberately a FRESH send (the record stays honest — no rewriting
  // history); scoped to real sessions (the demo/draft can't orphan a turn).
  const interrupted =
    !busy &&
    !typing &&
    activeId !== DRAFT_ID &&
    !activeSession.isDemo &&
    live.messages.length > 0 &&
    live.messages[live.messages.length - 1].role === 'user'
  const retryInterrupted = useCallback(() => {
    const last = [...liveRef.current.messages].reverse().find((m) => m.role === 'user')
    if (last?.content) handleSendRef.current?.(last.content)
  }, [])

  const selectSession = useCallback(
    (id: string) => {
      // Record the page we're leaving so back can return to it (title irrelevant
      // for the dedupe check — it's only used to skip re-selecting this session).
      record({ kind: 'session', sessionId: id, title: '' })
      clearTimers()
      const myRun = runId.current
      setTyping(false)
      setBusy(false)
      setLiveTurn(null)
      setActiveSection(null)
      setActiveId(id)
      // Switching sessions abandons any context staged on the (now-left) draft, so it
      // can't later be flushed onto a different session's first send (FWD-1 pending buffer).
      pendingDraftContexts.current = []
      const session =
        SESSIONS.find((c) => c.id === id) ??
        extraSessionsRef.current.find((s) => s.id === id) ??
        runSessionFromSchedules(id) ??
        runSessionFromCache(id) ??
        runSessionById(id) ??
        DRAFT_SESSION
      const nextLive = liveFromSession(session)
      setLive(nextLive)
      // Restore the session's remembered panel (FWD-2 / PD34): a stored focus, or null
      // (the user left it closed) — both honoured over the auto-open. With no stored
      // choice, fall back to the strongest present context (the original behaviour).
      const restoreFocus = (l: Live): PanelFocus | null => {
        const pref = id === DRAFT_ID ? undefined : getPanelPref(id)
        return pref !== undefined ? pref : strongestFocus(l)
      }
      setFocus(restoreFocus(nextLive))
      setPhase('idle')
      setPendingEscalation(null)
      if (session.isDemo) {
        setStepIndex(-1)
        setCaption('')
      }
      // Reconcile the full live session from the server (the system of record): a
      // persisted turn AND any persisted runtime attaches (workspace/repo/connector/
      // file) reappear. Skip the demo (the guided tour owns its panels, client-side)
      // and the unsaved draft. Guarded by runId so a fast re-switch can't clobber.
      if (id !== DRAFT_ID && !session.isDemo) {
        loadSession(id)
          .then((s) => {
            if (runId.current !== myRun) return
            const reconciled = liveFromSession(s)
            setLive(reconciled)
            setFocus(restoreFocus(reconciled))
            // A turn is still generating server-side (multi-account §6.5): the
            // thread would otherwise sit silently on its user message. Resume
            // rendering the stream — replayed from the top, then the live tail.
            if (s.activeTurnId) reattachToTurn(id, s.activeTurnId, myRun)
          })
          .catch(() => {})
      }
    },
    [clearTimers, record, reattachToTurn],
  )

  // An account switch changes whose world this client renders (multi-account
  // §6.1): the cache reset re-reads server state, but the OPEN THREAD is local
  // controller state and must be dropped explicitly — the old active session may
  // not even exist for the new account. Land on a fresh draft; selectSession's
  // clearTimers bumps runId, so any in-flight local stream goes stale (the turn
  // itself continues server-side — that's invariant I1's whole point).
  useEffect(() => onAccountSwitch(() => selectSession(DRAFT_ID)), [selectSession])

  // Apply an approved escalation to the live session — attach the workspace
  // (using the user-chosen root as its label) or the repo + its connector — and
  // focus the newly attached context's sidebar. The panel *content* came from the
  // backend (the tool's result), not a client fixture; this just lands it. Runs
  // only once the user approves (see approveEscalation), never automatically.
  const applyEscalation = useCallback(
    (esc: EscalationProposal, workspaceRoot?: string) => {
      setLive((l) => {
        const next: Live = { ...l }
        // Guard the id-keyed pushes so a replayed beat can't duplicate a panel.
        if (esc.kind === 'workspace' && !l.workspaces.some((w) => w.id === 'ws-demo')) {
          next.workspaces = [
            ...l.workspaces,
            {
              id: 'ws-demo',
              label: workspaceRoot ? folderLabel(workspaceRoot) : workspaceNameFor(activeSession),
              artifacts: esc.artifacts,
            },
          ]
        }
        if (esc.kind === 'repo' && !l.repos.some((r) => r.id === 'repo-demo')) {
          next.repos = [
            ...l.repos,
            {
              id: 'repo-demo',
              label: esc.remote,
              origin: 'github',
              remote: esc.remote,
              branch: esc.branch,
              files: esc.files,
              diff: esc.diff,
              terminal: esc.terminal,
            },
          ]
          next.connectors = esc.connectors.reduce(withConnector, l.connectors)
        }
        return next
      })
      if (esc.kind === 'workspace') setFocus({ kind: 'workspace', id: 'ws-demo' })
      if (esc.kind === 'repo') setFocus({ kind: 'repo', id: 'repo-demo' })
    },
    [activeSession],
  )

  // Play one beat: send its user message through the *real* path — the backend
  // calls the model with the tool interface, runs whatever tools it calls, and
  // streams the reply + proposals back. The demo session sends `ephemeral` so the
  // tour replays without persisting. Escalation beats hold here (busy stays true)
  // on the inline consent prompt until approved; relation-edit beats render their
  // confirm cards and release "Next" at message end.
  const playStep = useCallback(
    (index: number) => {
      const step = DEMO_STEPS[index]
      if (!step) return
      // A beat always plays in the session thread — so if a prior beat sent the
      // user to the project page (the create-project detour), advancing returns
      // here first, then plays.
      setActiveSection(null)
      setFocusProjectId(null)
      setStepIndex(index)
      setCaption(step.caption)
      setBusy(true)
      const myRun = runId.current
      const userMsg: Message = { id: `u-tour-${index}-${Date.now()}`, role: 'user', content: step.userText }
      setLive((l) => ({ ...l, messages: [...l.messages, userMsg] }))
      setTyping(true)
      // Stale if the user navigated to a different session, or a re-select bumped
      // runId (the project detour keeps activeId on the demo, so it stays live).
      const stale = () => activeIdRef.current !== DEMO_SESSION_ID || runId.current !== myRun
      let escalated = false
      void sendMessage(
        DEMO_SESSION_ID,
        step.userText,
        {
          onStart: (_id, message) => {
            if (stale()) return
            setTyping(false)
            setLive((l) => ({ ...l, messages: [...l.messages, message] }))
          },
          onDelta: (messageId, chunk) => {
            if (stale()) return
            setLive((l) => ({
              ...l,
              messages: l.messages.map((m) => (m.id === messageId ? { ...m, content: m.content + chunk } : m)),
            }))
          },
          onRelations: (messageId, relationActions) => {
            if (stale()) return
            setLive((l) => ({
              ...l,
              messages: l.messages.map((m) => (m.id === messageId ? { ...m, relationActions } : m)),
            }))
          },
          onToolActivity: (messageId, toolActivities) => {
            if (stale()) return
            setLive((l) => ({
              ...l,
              messages: l.messages.map((m) => (m.id === messageId ? { ...m, toolActivities } : m)),
            }))
          },
          onEscalation: (_messageId, escalation) => {
            if (stale()) return
            escalated = true
            setPendingEscalation({ messageId: _messageId, escalation })
          },
          onEnd: (message) => {
            if (stale()) return
            setLive((l) => ({ ...l, messages: l.messages.map((m) => (m.id === message.id ? { ...m, ...message } : m)) }))
            setTyping(false)
            // The turn consumed real tokens — refresh the usage gauge.
            invalidate(keys.usage(DEMO_SESSION_ID))
            // Escalation beats stay busy until the consent prompt is resolved.
            if (!escalated) setBusy(false)
          },
        },
        { ephemeral: true },
      ).catch(() => {
        if (stale()) return
        setTyping(false)
        setBusy(false)
      })
    },
    [],
  )

  // Consent resolved: apply the held escalation (with the chosen cowork root, for
  // a workspace), clear the prompt, and release "Next". Deny is handled in the
  // prompt itself (a recoverable "denied" view) and never reaches here, so the
  // tour can't advance without access.
  const approveEscalation = useCallback(
    (workspaceRoot?: string) => {
      const pending = pendingEscalationRef.current
      if (!pending) return
      const esc = pending.escalation
      if (esc.kind === 'project') {
        // A project escalation creates a real project (a server-backed relation
        // op), optionally filing this session into it, then walks the user to the
        // project's page so the change is visible. "Next" (still on the caption
        // bar) plays the next beat, which clears the section and lands back here.
        applyRelationOp({
          kind: 'create-project',
          projectId: esc.project.id,
          projectName: esc.project.name,
          projectDescription: esc.project.description,
          ...(esc.fileSession ? { sessionId: activeSession.id, sessionTitle: activeSession.title } : {}),
        })
        // Same as openProject, inlined to avoid referencing that later const —
        // recording the thread first so the project page's back returns to it.
        record({ kind: 'section', section: 'projects', projectId: esc.project.id, scheduleId: null, ownerName: null })
        setActiveSection('projects')
        setFocusProjectId(esc.project.id)
        setFocusScheduleId(null)
        setFocusOwnerName(null)
        if (esc.visitCaption) setCaption(esc.visitCaption)
      } else {
        applyEscalation(esc, workspaceRoot)
      }
      setPendingEscalation(null)
      setBusy(false)
    },
    [applyEscalation, activeSession, record],
  )

  // Resets step/caption too, so this doubles as a one-click "Replay" from the
  // finished state — not just the first run.
  const startTour = useCallback(() => {
    clearTimers()
    setLive(EMPTY_LIVE)
    setStepIndex(-1)
    setCaption('')
    setPendingEscalation(null)
    setPhase('running')
    schedule(() => playStep(0), 200)
  }, [clearTimers, playStep, schedule])

  // "Next" advances a beat; on the final beat the button reads "Finish" and
  // ends the tour rather than stepping past the last step.
  const nextStep = useCallback(() => {
    if (busy) return
    if (stepIndex + 1 >= DEMO_STEPS.length) {
      setPhase('done')
      return
    }
    playStep(stepIndex + 1)
  }, [busy, playStep, stepIndex])

  // Open the demo session and immediately play its guided tour. Owned by the
  // controller so the view doesn't have to encode the select-then-tour ordering.
  // The demo is "home" — clear any history so back doesn't escape the tour.
  const startDemoTour = useCallback(() => {
    selectSession(DEMO_SESSION_ID)
    setHistory([])
    startTour()
  }, [selectSession, startTour])

  // A turn streams from the backend (POST /sessions/:id/messages) through the real
  // Messages API tool-use loop: we append the user message, then render the
  // assistant reply token-by-token as it arrives. The model (a local mock) decides
  // which resource-manipulation tools to call; the backend executes them and
  // streams back the consent-gated proposals (relation cards / escalations), so a
  // free-typed "organize" request is as real a round-trip as the guided tour's.
  const handleSend = useCallback((text: string) => {
    const startId = activeIdRef.current
    // The draft's panel choice at dispatch (captured synchronously, before the
    // materialize await, so a mid-flight navigation can't make us read another
    // session's focus). Carried onto the real session below so an explicitly-closed
    // panel on a pre-attached draft (FWD-1) survives the draft→real transition (FWD-2).
    const draftFocus = focusRef.current
    // The draft's model pick at dispatch (same synchronous capture as the focus
    // above), sanitized against the live registry: a stale pick — e.g. a Customize
    // default whose provider was deleted — degrades to the built-in default instead
    // of failing the materialization (the server 404s an unknown providerId). The
    // same sanitize guards the post-materialize flush below, so a rejected stale id
    // can't sneak back in through the late-write path.
    const sanitizePick = (id: string | undefined): string | undefined => {
      const known = peek<ModelProvider[]>(keys.providers)
      return id && (!known || known.some((p) => p.id === id)) ? id : undefined
    }
    const draftProvider = sanitizePick(draftProviderRef.current)
    // The send generation at dispatch time. Any session switch / re-select bumps
    // runId (via clearTimers), which invalidates this stream — so a reconcile
    // triggered by re-selecting this same session mid-stream can't be clobbered by,
    // or duplicate against, the still-arriving deltas.
    const myRun = runId.current
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text }
    setLive((l) => ({ ...l, messages: [...l.messages, userMsg] }))
    setTyping(true)
    setBusy(true)
    setSendFailure(null) // a fresh send stands the previous refusal copy down
    // The turn runs async so an unsaved draft is first materialized into a real,
    // persisted session (the server mints its id + titles it from this message).
    // The reply then streams under that id and the backend persists the turn —
    // making "send" a real, durable operation rather than client-only state.
    //
    // Sends are SERIALIZED through one chain: the backend enforces one live turn
    // per session (server/turns.ts — a concurrent send is 409 conflict), so a
    // rapid second message waits for the first turn to finish instead of being
    // refused. The user message already rendered above, so nothing looks stuck.
    sendChain.current = sendChain.current.then(async () => {
      let sid = startId
      if (sid === DRAFT_ID) {
        try {
          // Coalesce a rapid second send on the same fresh draft into the first
          // materialization (the composer isn't disabled while streaming), so two
          // quick messages land in ONE session rather than creating two.
          const pending = draftMaterializing.current ?? createSession(text, draftProvider)
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
          const latePick = sanitizePick(draftProviderRef.current)
          if (latePick !== draftProvider) {
            void patchSession(sid, { providerId: latePick ?? '' })
          }
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
      // Ignore stream events that arrive after the user switched away — or
      // re-selected this same session (which bumps runId and re-reconciles).
      const stale = () => activeIdRef.current !== sid || runId.current !== myRun
      await sendMessage(sid, text, {
        onStart: (_id, message, turnId) => {
          if (stale()) return
          setTyping(false)
          if (turnId) setLiveTurn({ sessionId: sid, turnId })
          setLive((l) => ({ ...l, messages: [...l.messages, message] }))
        },
        onDelta: (messageId, chunk) => {
          if (stale()) return
          setLive((l) => ({
            ...l,
            messages: l.messages.map((m) => (m.id === messageId ? { ...m, content: m.content + chunk } : m)),
          }))
        },
        onRelations: (messageId, relationActions) => {
          if (stale()) return
          setLive((l) => ({
            ...l,
            messages: l.messages.map((m) => (m.id === messageId ? { ...m, relationActions } : m)),
          }))
        },
        // A free-typed turn can also call an attached connector/MCP tool (P6) —
        // surface the (mock) result as activity under the message; a read is not gated.
        onToolActivity: (messageId, toolActivities) => {
          if (stale()) return
          setLive((l) => ({
            ...l,
            messages: l.messages.map((m) => (m.id === messageId ? { ...m, toolActivities } : m)),
          }))
        },
        // A free-typed turn can also call a panel-producing tool (e.g. "create a
        // project") — surface the same consent prompt the tour uses; it applies
        // only on approval.
        onEscalation: (messageId, escalation) => {
          if (stale()) return
          setPendingEscalation({ messageId, escalation })
        },
        onEnd: (message) => {
          if (stale()) return
          setLive((l) => ({ ...l, messages: l.messages.map((m) => (m.id === message.id ? message : m)) }))
          setTyping(false)
          setBusy(false)
          setLiveTurn(null)
          // The turn consumed real tokens, and a persisted turn grew the thread's
          // context — refresh the usage gauge for this session.
          invalidate(keys.usage(sid))
        },
      }).catch((err: unknown) => {
        if (stale()) return
        setTyping(false)
        setBusy(false)
        setLiveTurn(null)
        // Keep the server's refusal copy (a gate's 503/429 message) for the
        // interrupted affordance — distinct, actionable copy over a generic line.
        setSendFailure(err instanceof Error && err.message ? err.message : null)
      })
      // A rejection must never escape into the chain itself: a rejected chain would
      // silently skip every subsequent send (`.then` on a rejected promise never runs).
    }).catch(() => {})
  }, [])
  handleSendRef.current = handleSend

  // Whether a session's server-owned writes (its panels AND its binding-of-record)
  // should persist: a real, listed (or just-materialized) session that isn't the
  // demo or the unsaved draft. Both write-through paths gate on this so the two
  // facets stay in step — otherwise a binding write would land for a draft/demo
  // while the panel write was skipped, orphaning a persisted binding.
  const persistableSession = useCallback((id: string): boolean => {
    if (id === DRAFT_ID) return false
    const session =
      SESSIONS.find((s) => s.id === id) ?? extraSessionsRef.current.find((s) => s.id === id)
    return !!session && !session.isDemo
  }, [])

  // Write the active session's panels through to the server (the system of record)
  // after a panel mutation, so a runtime attach survives a reload / shows on
  // another client. Skips the demo (the guided tour owns its panels, client-side)
  // and the unsaved draft / run sessions (not persisted). Fire-and-forget — the
  // optimistic `live` stays the panel's instant driver.
  const persistLive = useCallback((id: string, next: Live) => {
    if (!persistableSession(id)) return
    void persistWorkspace(id, workspaceOf(next)).catch(() => {})
  }, [persistableSession])

  // Manually attach context to the open thread — the same escalation the tour
  // performs, but user-driven. Every context type funnels through here, and the
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
    const next = addContextToLive(liveRef.current, ctx)
    setLive(next)
    persistLive(id, next)
    // Open the newly attached context's sidebar so you see what you added — and remember
    // it as this session's panel choice (FWD-2), so reopening restores it.
    const f = focusForAdded(ctx, next)
    if (f) {
      setFocus(f)
      if (persistableSession(id)) setPanelPref(id, f)
    }
  }, [persistableSession, persistLive])

  // Clicking a chip toggles its sidebar — and remembers the choice for this session
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
    setTyping(false)
    setBusy(false)
    setActiveSection(null)
    setActiveId(DRAFT_ID)
    // A fresh draft must re-materialize on its first send — don't reuse the
    // previous draft's (now resolved) session.
    draftMaterializing.current = null
    // …and starts back on the preferred default model (a registered provider when
    // Customize says so, else no pick — the built-in trio).
    setDraftProviderId(loadModelPrefs().defaultProviderId)
    if (seed) {
      rememberAttached(seed) // promote into the Add-context recents, like a manual attach
      const seeded = addContextToLive(EMPTY_LIVE, seed)
      setLive(seeded)
      setFocus(focusForAdded(seed, seeded))
      pendingDraftContexts.current = [seed]
    } else {
      setLive(EMPTY_LIVE)
      setFocus(null)
      pendingDraftContexts.current = []
    }
    setPhase('idle')
    setStepIndex(-1)
    setCaption('')
    setPendingEscalation(null)
  }, [clearTimers, record])

  // "New from repo / folder / connector…" — a per-mode entry point that starts a
  // fresh chat with that context pre-attached (FWD-1 / PD33). Multi-add aware: if
  // already on a fresh, empty draft, stack the context onto it (so several picks
  // build one new thread) instead of resetting to yet another draft.
  const newSessionWith = useCallback(
    (ctx: AddedContext) => {
      if (activeIdRef.current === DRAFT_ID && liveRef.current.messages.length === 0) {
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
    setActiveSubview(firstSubview(s)) // land on the section's first sub-view (null if none)
    setFocusProjectId(null)
    setFocusScheduleId(null)
    setFocusOwnerName(null)
    setPendingFocus(null) // a plain nav carries no focus intent — drop any stale target
  }, [record])

  // Switch the active section's sub-view (the rail drill-in menu). A LATERAL move —
  // not recorded in history — so it drops any open detail (returning to that
  // sub-view's list) but leaves the section itself put.
  const openSubview = useCallback((id: string) => {
    setActiveSubview(id)
    setFocusProjectId(null)
    setFocusScheduleId(null)
    setFocusOwnerName(null)
    setPendingFocus(null)
  }, [])

  // Open a project's detail page. Reached three ways — a session's "In ‹Project›"
  // breadcrumb, a relation deep-link, or a click in the Projects list — and all
  // route through here, so the detail target is one source of truth (focusProjectId)
  // and every entry is recorded in history for back.
  const openProject = useCallback((projectId: string) => {
    record({ kind: 'section', section: 'projects', projectId, scheduleId: null, ownerName: null })
    setActiveSection('projects')
    setActiveSubview(firstSubview('projects'))
    setFocusProjectId(projectId)
    setFocusScheduleId(null)
    setFocusOwnerName(null)
    setPendingFocus(null)
  }, [record])

  // Open a routine's detail page. Reached from a run session's breadcrumb, a
  // project's routine row, or the Scheduled list — all through here (see openProject).
  const openSchedule = useCallback((scheduleId: string) => {
    record({ kind: 'section', section: 'scheduled', projectId: null, scheduleId, ownerName: null })
    setActiveSection('scheduled')
    setActiveSubview(firstSubview('scheduled'))
    setFocusScheduleId(scheduleId)
    setFocusProjectId(null)
    setFocusOwnerName(null)
    setPendingFocus(null)
  }, [record])

  // Open a workspace's public profile (D21) — reached from any owner byline (a
  // directory card, a shared project's header, a search hit), all through here,
  // so the open profile is one source of truth and every entry lands in history.
  const openOwner = useCallback((name: string) => {
    record({ kind: 'section', section: 'agents', projectId: null, scheduleId: null, ownerName: name })
    setActiveSection('agents')
    setActiveSubview(firstSubview('agents'))
    setFocusOwnerName(name)
    setFocusProjectId(null)
    setFocusScheduleId(null)
    setPendingFocus(null)
  }, [record])

  // ── Notification doors (docs/notification-routing.md) ─────────────────────
  // A bell lands on the EXACT sub-entity its act touched: these navigate to the
  // page (recording history, like every nav) AND set the transient focus the
  // destination consumes to scroll + highlight it. `setPendingFocus` runs last so
  // it survives the plain-nav clear these reuse conceptually.
  const consumeFocus = useCallback(() => setPendingFocus(null), [])

  // A work item's thread on its project page (work.* / mentioned bells).
  const openWorkItem = useCallback((projectId: string, workItemId: string, commentId?: string) => {
    record({ kind: 'section', section: 'projects', projectId, scheduleId: null, ownerName: null })
    setActiveSection('projects')
    setActiveSubview(firstSubview('projects'))
    setFocusProjectId(projectId)
    setFocusScheduleId(null)
    setFocusOwnerName(null)
    setPendingFocus({ projectId, workItemId, commentId })
  }, [record])

  // A change proposal on the agent's review surface (proposal.* bells). `ownerName`
  // null ⇒ the caller OWNS the agent ⇒ their Agents hub (the review queue); else the
  // owner's profile (D21), where the public agent detail + "Your proposals" live.
  // (No commentId focus: the proposal's thread renders open in both surfaces — a
  // short two-party conversation — so anchoring one comment added nothing; the
  // per-comment anchor is a work-item-only affordance, where threads collapse.)
  const openProposal = useCallback(
    (agentId: string, proposalId: string, ownerName: string | null) => {
      record({ kind: 'section', section: 'agents', projectId: null, scheduleId: null, ownerName })
      setActiveSection('agents')
      setActiveSubview(firstSubview('agents'))
      setFocusOwnerName(ownerName)
      setFocusProjectId(null)
      setFocusScheduleId(null)
      setPendingFocus({ agentId, proposalId })
    },
    [record],
  )

  // The source agent (agent.forked) — the recipient is its owner, so their own
  // Agents hub, with the card highlighted. Never the fork (the leak-wall).
  const openAgent = useCallback((agentId: string) => {
    record({ kind: 'section', section: 'agents', projectId: null, scheduleId: null, ownerName: null })
    setActiveSection('agents')
    setActiveSubview(firstSubview('agents'))
    setFocusOwnerName(null)
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
      setActiveSubview(firstSubview(loc.section)) // sub-views aren't in history — land on the first
      setFocusProjectId(loc.projectId)
      setFocusScheduleId(loc.scheduleId)
      setFocusOwnerName(loc.ownerName ?? null)
    }
  }, [selectSession])

  const goBack = useCallback(() => {
    const h = historyRef.current
    if (h.length === 0) {
      // Nothing recorded — fall back to the current section's list (drop a detail).
      if (sectionRef.current && (focusProjectRef.current || focusScheduleRef.current || focusOwnerRef.current)) {
        setFocusProjectId(null)
        setFocusScheduleId(null)
        setFocusOwnerName(null)
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
    if (activeSection && (focusProjectId || focusScheduleId || focusOwnerName))
      return { kind: 'section', section: activeSection, projectId: null, scheduleId: null, ownerName: null }
    return null
  }, [history, activeSection, focusProjectId, focusScheduleId, focusOwnerName])

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
  // The composer's model pick for the ACTIVE session. A real session PATCHes its
  // server row (undefined → '' clears back to the Agent's provider — the registry's
  // empty-string-means-default convention); a draft holds the pick locally and the
  // materialization carries it (see handleSend). Next turn routes accordingly.
  const selectModelProvider = useCallback((providerId?: string) => {
    if (activeIdRef.current === DRAFT_ID) setDraftProviderId(providerId)
    else void patchSession(activeIdRef.current, { providerId: providerId ?? '' })
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
    const next = removeAttachmentFromLive(liveRef.current, attId)
    setLive(next)
    persistLive(id, next)
  }, [persistableSession, persistLive])

  // Remove a single source folder from the shared workspace: drop the artifacts
  // it contributed, and drop the workspace itself if that empties it (the
  // valid-focus effect below then closes the panel). Seeded/default artifacts
  // (no source) are never touched, so a workspace that still holds them stays.
  const removeFolder = useCallback((sourceId: string) => {
    const id = activeIdRef.current
    const next = removeFolderFromLive(liveRef.current, sourceId)
    setLive(next)
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
    const next = removeContextsFromLive(liveRef.current, focuses)
    setLive(next)
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
    setFocus(null)
    // Remember the closed state for this session (FWD-2), so it stays closed on reopen.
    if (persistableSession(activeIdRef.current)) setPanelPref(activeIdRef.current, null)
  }, [persistableSession])

  // The view-facing shape of the held consent prompt: which escalation is
  // pending plus what the prompt needs to render (a workspace beat's root
  // choices; a repo beat's service name). Null when nothing is pending.
  const pendingApproval = useMemo(() => {
    if (!pendingEscalation) return null
    const esc = pendingEscalation.escalation
    if (esc.kind === 'workspace') {
      return { kind: 'workspace', rootChoices: esc.rootChoices.length ? esc.rootChoices : ['~/'] } as const
    }
    if (esc.kind === 'project') {
      return { kind: 'project', projectName: esc.project.name } as const
    }
    return { kind: 'repo', connectorLabel: esc.connectorLabel } as const
  }, [pendingEscalation])

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
      setLive((l) => ({ ...l, messages: updated.messages ?? [] }))
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
    pendingFocus,
    live,
    typing,
    focus,
    activeSession,
    isDemo,
    isDraft,
    // guided tour
    phase,
    stepIndex,
    caption,
    busy,
    liveTurn,
    interrupted,
    sendFailure,
    totalSteps: DEMO_STEPS.length,
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
    selectModelProvider,
    draftProviderId,
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
    startTour,
    nextStep,
    startDemoTour,
    approveEscalation,
  }
}
