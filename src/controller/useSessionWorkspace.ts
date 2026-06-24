import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEMO_STEPS, type DemoStep } from '../data/demo'
import { DEMO_SESSION_ID, SESSIONS } from '../data/sessions'
import {
  DRAFT_ID,
  DRAFT_SESSION,
  EMPTY_LIVE,
  WS_ID,
  addContextToLive,
  branchFor,
  folderLabel,
  liveFromSession,
  remoteFor,
  removeAttachmentFromLive,
  removeContextsFromLive,
  removeFolderFromLive,
  repoIdForLabel,
  withConnector,
  workspaceOf,
  workspaceNameFor,
  type Live,
} from '../data/liveSession'
import { sameFocus } from '../lib/focus'
import { rememberAttached } from '../lib/contextShortcuts'
import { runSessionById } from '../data/scheduledRuns'
import {
  applyRelationOp,
  attachContext,
  createSession,
  deleteSession as deleteSessionCmd,
  detachContext,
  loadSession,
  patchSession,
  persistWorkspace,
  runSessionFromCache,
  runSessionFromSchedules,
  sendMessage,
} from '../api'
import type {
  AddedContext,
  AttachContextRequest,
  Message,
  PanelFocus,
  Repo,
  SectionId,
  Session,
  TourPhase,
} from '../types'

/** Map an attached `AddedContext` to the persistent binding(s) it should create —
 *  the *attachment of record* the effect-mediation path resolves against
 *  (Primitive 1 of docs/shared-resource-coordination.md). Ids match the live
 *  model's so attach and the chip-remove focus pair up: a repo by `repoIdForLabel`,
 *  the shared workspace by `WS_ID`, connectors / attachments by their own id.
 *  `scope` is the resource boundary (a path for folder / repo, `'*'` otherwise);
 *  files / photos expand to one binding per attachment. */
function bindingsFor(ctx: AddedContext): AttachContextRequest[] {
  switch (ctx.kind) {
    case 'folder':
      return [{ id: WS_ID, type: 'folder', label: ctx.label, scope: ctx.label }]
    case 'repo':
      return [{ id: repoIdForLabel(ctx.label), type: 'repo', label: ctx.label, scope: ctx.path ?? '*' }]
    case 'connector':
      return [{ id: ctx.connector.id, type: 'connector', label: ctx.connector.label, scope: '*' }]
    case 'mcp':
      return [{ id: ctx.connector.id, type: 'mcp', label: ctx.connector.label, scope: '*' }]
    case 'files':
      return ctx.attachments.map((a): AttachContextRequest => ({ id: a.id, type: 'files', label: a.label, scope: '*' }))
    case 'photos':
      return ctx.attachments.map((a): AttachContextRequest => ({ id: a.id, type: 'photos', label: a.label, scope: '*' }))
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
  // When a session deep-links into its project, which project the Projects
  // section should open in detail (null = show the project list).
  const [focusProjectId, setFocusProjectId] = useState<string | null>(null)
  // Likewise for a scheduled run session deep-linking back to its routine.
  const [focusScheduleId, setFocusScheduleId] = useState<string | null>(null)

  // Guided-tour state (only meaningful for the demo session).
  const [phase, setPhase] = useState<TourPhase>('idle')
  const [stepIndex, setStepIndex] = useState(-1)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  // An escalating beat (workspace / repo) holds here until the user consents:
  // the beat's step waits in `pendingStep` while the inline consent prompt is
  // shown, and the escalation applies only on approval. Null = nothing pending.
  const [pendingStep, setPendingStep] = useState<DemoStep | null>(null)
  // Sessions materialized this client-session — a draft made real on its first
  // send (server-minted, so absent from the static seed mirror). The active-session
  // resolution and the sidebar consult this until the next reload reseeds from the API.
  const [extraSessions, setExtraSessions] = useState<Session[]>([])

  // Timer bookkeeping so switching sessions cancels in-flight callbacks.
  const runId = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  // Mirror of `live` for reads inside event handlers (handleAddContext has empty
  // deps and must not close over a stale snapshot).
  const liveRef = useRef(live)
  liveRef.current = live
  // Mirror of the open session id, so a streaming reply that arrives after the
  // user switched sessions is ignored rather than landing in the wrong thread.
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  // Mirror of materialized sessions for reads inside event handlers (selectSession
  // has stable deps and must not close over a stale snapshot).
  const extraSessionsRef = useRef(extraSessions)
  extraSessionsRef.current = extraSessions

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
  }, [live.messages, typing, pendingStep])

  const selectSession = useCallback(
    (id: string) => {
      clearTimers()
      const myRun = runId.current
      setTyping(false)
      setBusy(false)
      setActiveSection(null)
      setActiveId(id)
      const session =
        SESSIONS.find((c) => c.id === id) ??
        extraSessionsRef.current.find((s) => s.id === id) ??
        runSessionFromSchedules(id) ??
        runSessionFromCache(id) ??
        runSessionById(id) ??
        DRAFT_SESSION
      const nextLive = liveFromSession(session)
      setLive(nextLive)
      // Auto-focus the session's strongest present context so its sidebar opens.
      setFocus(strongestFocus(nextLive))
      setPhase('idle')
      setPendingStep(null)
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
            setFocus(strongestFocus(reconciled))
          })
          .catch(() => {})
      }
    },
    [clearTimers],
  )

  // Apply a beat's escalation to the live session — attach the workspace (using
  // the user-chosen root as its label) or the repo + its connector — and focus
  // the newly attached context's sidebar. Split out of playStep so the guided
  // tour can gate it behind the inline consent prompt: it runs only once the
  // user approves (see approveEscalation), never automatically.
  const applyEscalation = useCallback(
    (step: DemoStep, workspaceRoot?: string) => {
      setLive((l) => {
        const next: Live = { ...l }
        // Guard the id-keyed pushes so a replayed step can't duplicate a panel.
        if (step.assistant.escalate === 'workspace' && !l.workspaces.some((w) => w.id === 'ws-demo')) {
          next.workspaces = [
            ...l.workspaces,
            {
              id: 'ws-demo',
              label: workspaceRoot ? folderLabel(workspaceRoot) : workspaceNameFor(activeSession),
              artifacts: step.artifacts ?? [],
            },
          ]
        }
        if (step.assistant.escalate === 'repo' && !l.repos.some((r) => r.id === 'repo-demo')) {
          next.repos = [
            ...l.repos,
            {
              id: 'repo-demo',
              label: remoteFor(activeSession.id),
              origin: 'github',
              remote: remoteFor(activeSession.id),
              branch: branchFor(activeSession.id),
              files: step.files ?? [],
              diff: step.diff ?? [],
              terminal: step.terminal ?? [],
            },
          ]
        }
        if (step.connectors) next.connectors = step.connectors.reduce(withConnector, l.connectors)
        return next
      })
      if (step.assistant.escalate === 'workspace') setFocus({ kind: 'workspace', id: 'ws-demo' })
      if (step.assistant.escalate === 'repo') setFocus({ kind: 'repo', id: 'repo-demo' })
    },
    [activeSession],
  )

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
      setLive((l) => ({ ...l, messages: [...l.messages, step.user] }))
      setTyping(true)
      schedule(() => {
        setTyping(false)
        setLive((l) => ({ ...l, messages: [...l.messages, step.assistant] }))
        // An escalating beat now asks first: append Claude's reply, then hold
        // here on the inline consent prompt (busy stays true, so "Next" stays
        // disabled) until the user approves. Non-escalating beats finish now.
        if (step.assistant.escalate) {
          setPendingStep(step)
        } else {
          setBusy(false)
        }
      }, 950)
    },
    [schedule],
  )

  // Consent resolved: apply the held beat's escalation (with the chosen cowork
  // root, for a workspace), clear the prompt, and release "Next". Deny is handled
  // in the prompt itself (a recoverable "denied" view) and never reaches here, so
  // the tour can't advance without access.
  const approveEscalation = useCallback(
    (workspaceRoot?: string) => {
      if (!pendingStep) return
      if (pendingStep.assistant.escalate === 'project') {
        // A project beat doesn't touch the live session — it creates a real
        // project (a server-backed relation op) and files this session into it,
        // then walks the user to the project's page so the change is visible.
        // "Next" (still on the caption bar) plays the next beat, which clears the
        // section and lands back in the thread.
        const proj = pendingStep.approval?.project
        if (proj) {
          applyRelationOp({
            kind: 'create-project',
            projectId: proj.id,
            projectName: proj.name,
            projectDescription: proj.description,
            sessionId: activeSession.id,
            sessionTitle: activeSession.title,
          })
          // Same as openProject, inlined to avoid referencing that later const.
          setActiveSection('projects')
          setFocusProjectId(proj.id)
          setFocusScheduleId(null)
          if (pendingStep.approval?.visitCaption) setCaption(pendingStep.approval.visitCaption)
        }
      } else {
        applyEscalation(pendingStep, workspaceRoot)
      }
      setPendingStep(null)
      setBusy(false)
    },
    [pendingStep, applyEscalation, activeSession],
  )

  // Resets step/caption too, so this doubles as a one-click "Replay" from the
  // finished state — not just the first run.
  const startTour = useCallback(() => {
    clearTimers()
    setLive(EMPTY_LIVE)
    setStepIndex(-1)
    setCaption('')
    setPendingStep(null)
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
  const startDemoTour = useCallback(() => {
    selectSession(DEMO_SESSION_ID)
    startTour()
  }, [selectSession, startTour])

  // A turn now streams from the backend (POST /sessions/:id/messages), mirroring
  // the real Messages API: we append the user message, then render the assistant
  // reply token-by-token as it arrives. The honest behavior is unchanged but now
  // lives server-side — an "organize" request streams back the matching
  // relation-edit proposals; anything else gets a canned answer.
  const handleSend = useCallback((text: string) => {
    const startId = activeIdRef.current
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text }
    setLive((l) => ({ ...l, messages: [...l.messages, userMsg] }))
    setTyping(true)
    setBusy(true)
    // The turn runs async so an unsaved draft is first materialized into a real,
    // persisted session (the server mints its id + titles it from this message).
    // The reply then streams under that id and the backend persists the turn —
    // making "send" a real, durable operation rather than client-only state.
    void (async () => {
      let sid = startId
      if (sid === DRAFT_ID) {
        try {
          const created = await createSession(text)
          sid = created.id
          setExtraSessions((prev) => [created, ...prev])
          // Adopt the new id only if the user is still on the draft — don't yank
          // them back if they navigated away while it was materializing.
          if (activeIdRef.current === DRAFT_ID) {
            setActiveId(sid)
            activeIdRef.current = sid
          }
        } catch {
          // Couldn't materialize (server unreachable) — stream against the draft id;
          // the reply still renders, it just isn't persisted (graceful degradation).
          sid = startId
        }
      }
      // Ignore stream events that arrive after the user switched away.
      const stale = () => activeIdRef.current !== sid
      await sendMessage(sid, text, {
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
        onEnd: (message) => {
          if (stale()) return
          setLive((l) => ({ ...l, messages: l.messages.map((m) => (m.id === message.id ? message : m)) }))
          setTyping(false)
          setBusy(false)
        },
      }).catch(() => {
        if (stale()) return
        setTyping(false)
        setBusy(false)
      })
    })()
  }, [])

  // Write the active session's panels through to the server (the system of record)
  // after a panel mutation, so a runtime attach survives a reload / shows on
  // another client. Skips the demo (the guided tour owns its panels, client-side)
  // and the unsaved draft / run sessions (not persisted). Fire-and-forget — the
  // optimistic `live` stays the panel's instant driver.
  const persistLive = useCallback((id: string, next: Live) => {
    if (id === DRAFT_ID) return
    const session =
      SESSIONS.find((s) => s.id === id) ?? extraSessionsRef.current.find((s) => s.id === id)
    if (!session || session.isDemo) return
    void persistWorkspace(id, workspaceOf(next)).catch(() => {})
  }, [])

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
    for (const b of bindingsFor(ctx)) void attachContext(id, b).catch(() => {})
    const next = addContextToLive(liveRef.current, ctx)
    setLive(next)
    persistLive(id, next)
    // Open the newly attached context's sidebar so you see what you added.
    switch (ctx.kind) {
      case 'folder':
        // Focus the (possibly pre-existing) shared workspace it merged into.
        setFocus({ kind: 'workspace', id: next.workspaces[0]?.id ?? WS_ID })
        break
      case 'repo':
        setFocus({ kind: 'repo', id: repoIdForLabel(ctx.label) })
        break
      case 'connector':
      case 'mcp':
        setFocus({ kind: 'connector', id: ctx.connector.id })
        break
      case 'files':
      case 'photos': {
        const first = ctx.attachments[0]
        if (first) setFocus({ kind: first.kind, id: first.id })
        break
      }
    }
  }, [persistLive])

  // Clicking a chip toggles its sidebar.
  const focusContext = useCallback((f: PanelFocus) => {
    setFocus((cur) => (sameFocus(cur, f) ? null : f))
  }, [])

  // "New session" opens a blank thread with the composer ready, like the desktop
  // app's "New chat" (not a jump to an existing session).
  const newSession = useCallback(() => {
    clearTimers()
    setTyping(false)
    setBusy(false)
    setActiveSection(null)
    setActiveId(DRAFT_ID)
    setLive(EMPTY_LIVE)
    setFocus(null)
    setPhase('idle')
    setStepIndex(-1)
    setCaption('')
    setPendingStep(null)
  }, [clearTimers])

  // Opening a section from the rail always lands on its top level, so clear any
  // project a previous deep-link had focused.
  const openSection = useCallback((s: SectionId) => {
    setActiveSection(s)
    setFocusProjectId(null)
    setFocusScheduleId(null)
  }, [])

  // Deep-link from a session into its home project: open the Projects section
  // with that project already expanded to its detail page.
  const openProject = useCallback((projectId: string) => {
    setActiveSection('projects')
    setFocusProjectId(projectId)
    setFocusScheduleId(null)
  }, [])

  // Deep-link from a scheduled run session back to its routine: open the
  // Scheduled section with that routine already expanded to its detail.
  const openSchedule = useCallback((scheduleId: string) => {
    setActiveSection('scheduled')
    setFocusScheduleId(scheduleId)
    setFocusProjectId(null)
  }, [])

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
  const deleteSession = useCallback(
    (id: string) => {
      void deleteSessionCmd(id)
      if (id === activeIdRef.current) newSession()
    },
    [newSession],
  )

  const removeAttachment = useCallback((attId: string) => {
    const id = activeIdRef.current
    void detachContext(id, attId).catch(() => {})
    const next = removeAttachmentFromLive(liveRef.current, attId)
    setLive(next)
    persistLive(id, next)
  }, [persistLive])

  // Remove a single source folder from the shared workspace: drop the artifacts
  // it contributed, and drop the workspace itself if that empties it (the
  // valid-focus effect below then closes the panel). Seeded/default artifacts
  // (no source) are never touched, so a workspace that still holds them stays.
  const removeFolder = useCallback((sourceId: string) => {
    const id = activeIdRef.current
    const next = removeFolderFromLive(liveRef.current, sourceId)
    setLive(next)
    persistLive(id, next)
  }, [persistLive])

  // Remove one or more attached contexts in a single update. The chip remove
  // flow passes several at once when a removal cascades (a repo + its orphaned
  // GitHub connector, or the connector + the repos that depend on it); the
  // connector panel's Disconnect passes just the connector.
  const removeContexts = useCallback((focuses: PanelFocus[]) => {
    const id = activeIdRef.current
    // Mirror the removal to the persistent binding (Primitive 1): detach each focus
    // by id (the binding id pairs with the chip's focus id). Fire-and-forget.
    for (const f of focuses) void detachContext(id, f.id).catch(() => {})
    const next = removeContextsFromLive(liveRef.current, focuses)
    setLive(next)
    persistLive(id, next)
  }, [persistLive])

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

  const closePanel = useCallback(() => setFocus(null), [])

  // The view-facing shape of the held consent prompt: which escalation is
  // pending plus what the prompt needs to render (a workspace beat's root
  // choices; a repo beat's service name). Null when nothing is pending.
  const pendingApproval = useMemo(() => {
    if (!pendingStep) return null
    const kind = pendingStep.assistant.escalate
    if (kind === 'workspace') {
      return { kind, rootChoices: pendingStep.approval?.rootChoices ?? ['~/'] } as const
    }
    if (kind === 'project') {
      return { kind, projectName: pendingStep.approval?.project?.name ?? 'New project' } as const
    }
    return { kind: 'repo', connectorLabel: pendingStep.connectors?.[0]?.label ?? 'GitHub' } as const
  }, [pendingStep])

  return {
    // state
    activeId,
    activeSection,
    focusProjectId,
    focusScheduleId,
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
    openSection,
    openProject,
    openSchedule,
    pinSession,
    renameSession,
    archiveSession,
    deleteSession,
    handleSend,
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
