import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEMO_STEPS, type DemoStep } from '../data/demo'
import { DEMO_SESSION_ID, SESSIONS } from '../data/sessions'
import {
  DRAFT_ID,
  DRAFT_SESSION,
  EMPTY_LIVE,
  WS_ID,
  branchFor,
  folderLabel,
  liveFromSession,
  remoteFor,
  repoIdForLabel,
  slug,
  withConnector,
  workspaceNameFor,
  type Live,
} from '../data/liveSession'
import { sameFocus } from '../lib/focus'
import { rememberAttached } from '../lib/contextShortcuts'
import { runSessionById } from '../data/scheduledRuns'
import { runSessionFromCache, sendMessage } from '../api'
import type { AddedContext, Message, PanelFocus, Repo, SectionId, TourPhase } from '../types'

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

  const activeSession = useMemo(
    // A scheduled run opens its own synthesized session — resolve from the live
    // feed cache first (covers daemon/run-now runs), then the seed fallback.
    () =>
      SESSIONS.find((c) => c.id === activeId) ??
      runSessionFromCache(activeId) ??
      runSessionById(activeId) ??
      DRAFT_SESSION,
    [activeId],
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
      setTyping(false)
      setBusy(false)
      setActiveSection(null)
      setActiveId(id)
      const session =
        SESSIONS.find((c) => c.id === id) ??
        runSessionFromCache(id) ??
        runSessionById(id) ??
        DRAFT_SESSION
      const nextLive = liveFromSession(session)
      setLive(nextLive)
      // Auto-focus the session's strongest present context so its sidebar opens —
      // a repo if there is one, else a workspace, else nothing.
      setFocus(
        nextLive.repos[0]
          ? { kind: 'repo', id: nextLive.repos[0].id }
          : nextLive.workspaces[0]
            ? { kind: 'workspace', id: nextLive.workspaces[0].id }
            : null,
      )
      setPhase('idle')
      setPendingStep(null)
      if (session.isDemo) {
        setStepIndex(-1)
        setCaption('')
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
      applyEscalation(pendingStep, workspaceRoot)
      setPendingStep(null)
      setBusy(false)
    },
    [pendingStep, applyEscalation],
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
    const sid = activeIdRef.current
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text }
    setLive((l) => ({ ...l, messages: [...l.messages, userMsg] }))
    setTyping(true)
    setBusy(true)
    // Ignore stream events that arrive after the user switched away.
    const stale = () => activeIdRef.current !== sid
    sendMessage(sid, text, {
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
    setLive((l) => {
      switch (ctx.kind) {
        case 'folder': {
          // One shared Cowork workspace per session. Attaching a folder adds its
          // (source-tagged) artifacts into that single workspace, creating it if
          // there isn't one. Dedup by artifact id so re-attaching is a no-op.
          const existing = l.workspaces[0]
          if (!existing) {
            return { ...l, workspaces: [{ id: WS_ID, label: 'Workspace', artifacts: ctx.artifacts }] }
          }
          const seen = new Set(existing.artifacts.map((a) => a.id))
          const added = ctx.artifacts.filter((a) => !seen.has(a.id))
          if (added.length === 0) return l
          return {
            ...l,
            workspaces: [{ ...existing, artifacts: [...existing.artifacts, ...added] }],
          }
        }
        case 'repo': {
          const id = repoIdForLabel(ctx.label)
          if (l.repos.some((r) => r.id === id)) return l
          // The GitHub connector, if wanted, arrives as its own separate attach
          // (see the repo picker's link prompt) — a repo no longer owns one.
          const repo: Repo = {
            id,
            label: ctx.label,
            origin: ctx.origin,
            path: ctx.path,
            remote: ctx.remote,
            branch: ctx.branch,
            files: ctx.files,
            diff: ctx.diff,
            terminal: ctx.terminal,
          }
          return { ...l, repos: [...l.repos, repo] }
        }
        case 'connector':
        case 'mcp':
          return { ...l, connectors: withConnector(l.connectors, ctx.connector) }
        case 'files':
        case 'photos': {
          // Dedup by id so re-attaching the same file/photo is a no-op (mirrors
          // the connector/repo guards) — otherwise a duplicate chip shares a
          // React key and a single remove would drop both copies.
          const seen = new Set(l.attachments.map((a) => a.id))
          const added = ctx.attachments.filter((a) => !seen.has(a.id))
          if (added.length === 0) return l
          return { ...l, attachments: [...l.attachments, ...added] }
        }
        default:
          return l
      }
    })
    switch (ctx.kind) {
      case 'folder':
        // Focus the (possibly pre-existing) shared workspace it merged into.
        setFocus({ kind: 'workspace', id: liveRef.current.workspaces[0]?.id ?? WS_ID })
        break
      case 'repo':
        setFocus({ kind: 'repo', id: `repo-${slug(ctx.label)}` })
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
  }, [])

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

  const removeAttachment = useCallback((id: string) => {
    setLive((l) => ({ ...l, attachments: l.attachments.filter((a) => a.id !== id) }))
  }, [])

  // Remove a single source folder from the shared workspace: drop the artifacts
  // it contributed, and drop the workspace itself if that empties it (the
  // valid-focus effect below then closes the panel). Seeded/default artifacts
  // (no source) are never touched, so a workspace that still holds them stays.
  const removeFolder = useCallback((sourceId: string) => {
    setLive((l) => ({
      ...l,
      workspaces: l.workspaces
        .map((w) => ({ ...w, artifacts: w.artifacts.filter((a) => a.source?.id !== sourceId) }))
        .filter((w) => w.artifacts.length > 0),
    }))
  }, [])

  // Remove one or more attached contexts in a single update. The chip remove
  // flow passes several at once when a removal cascades (a repo + its orphaned
  // GitHub connector, or the connector + the repos that depend on it); the
  // connector panel's Disconnect passes just the connector.
  const removeContexts = useCallback((focuses: PanelFocus[]) => {
    setLive((l) => {
      const ids = (kind: PanelFocus['kind']) =>
        new Set(focuses.filter((f) => f.kind === kind).map((f) => f.id))
      const wsIds = ids('workspace')
      const repoIds = ids('repo')
      const connIds = ids('connector')
      const attIds = new Set([...ids('file'), ...ids('photo')])
      return {
        ...l,
        workspaces: l.workspaces.filter((w) => !wsIds.has(w.id)),
        repos: l.repos.filter((r) => !repoIds.has(r.id)),
        connectors: l.connectors.filter((c) => !connIds.has(c.id)),
        attachments: l.attachments.filter((a) => !attIds.has(a.id)),
      }
    })
  }, [])

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
