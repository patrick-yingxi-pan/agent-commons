import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { Composer } from './components/Composer'
import { MessageRow, TypingRow } from './components/Message'
import { CaptionBar, type TourPhase } from './components/CaptionBar'
import { WorkspacePanel } from './components/WorkspacePanel'
import { SectionView } from './components/SectionView'
import { AttachmentPanel } from './components/AttachmentPanel'
import { ConnectorPanel } from './components/ConnectorPanel'
import { IntroOverlay } from './components/IntroOverlay'
import { CapBadges } from './components/CapBadges'
import { CONVERSATIONS, DEMO_CONVERSATION_ID } from './data/conversations'
import { DEMO_STEPS } from './data/demo'
import { sameFocus } from './lib/focus'
import { clamp, getLayout, setLayout } from './lib/uiPrefs'
import type {
  AddedContext,
  Attachment,
  Connector,
  Conversation,
  Message,
  PanelFocus,
  Repo,
  SectionId,
  Workspace,
} from './types'

/** Everything that makes up the live view of the open conversation. Workspaces
 *  and repos are arrays because a conversation can hold more than one of each —
 *  the same as connectors and attachments. */
interface Live {
  messages: Message[]
  workspaces: Workspace[]
  repos: Repo[]
  connectors: Connector[]
  attachments: Attachment[]
}

const EMPTY_DEMO: Live = {
  messages: [],
  workspaces: [],
  repos: [],
  connectors: [],
  attachments: [],
}

// The id of the single shared workspace created when folders are attached to a
// conversation that doesn't already have one (seeded/demo convs bring their own).
const WS_ID = 'ws-active'

// Left-rail resize bounds.
const LEFT_MIN = 208
const LEFT_MAX = 420

function withConnector(list: Connector[], c: Connector): Connector[] {
  return list.some((x) => x.id === c.id) ? list : [...list, c]
}

/** A stable, dedup-friendly id derived from a label. */
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// Branch names for the two scripted seed conversations that carry a repo. This
// is demo seed data, not a general registry — context attached at runtime brings
// its own branch (see handleAddContext), so anything not seeded here is 'main'.
const SEED_BRANCHES: Record<string, string> = {
  'insights-launch': 'feat/insights-dashboard',
  'auth-refactor': 'refactor/auth-middleware',
}

function branchFor(id: string) {
  return SEED_BRANCHES[id] ?? 'main'
}

// The repo's remote (owner/name) shown on the chip for the scripted seed
// conversations — distinct from the branch, which shows in the repo panel.
// Runtime-attached repos carry their own remote (see handleAddContext).
const SEED_REMOTES: Record<string, string> = {
  'insights-launch': 'patrick-yingxi-pan/web-app',
  'auth-refactor': 'patrick-yingxi-pan/server',
}

function remoteFor(id: string) {
  return SEED_REMOTES[id] ?? 'origin'
}

function workspaceNameFor(conv: Conversation) {
  return (
    conv.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') + '/'
  )
}

function liveFromConversation(conv: Conversation): Live {
  if (conv.isDemo) return EMPTY_DEMO
  const workspaces: Workspace[] = conv.artifacts?.length
    ? [{ id: `ws-${conv.id}`, label: workspaceNameFor(conv), artifacts: conv.artifacts }]
    : []
  const hasRepo = !!(conv.files?.length || conv.diff?.length || conv.terminal?.length)
  const repos: Repo[] = hasRepo
    ? [
        {
          id: `repo-${conv.id}`,
          label: remoteFor(conv.id),
          origin: 'github',
          remote: remoteFor(conv.id),
          branch: branchFor(conv.id),
          files: conv.files ?? [],
          diff: conv.diff ?? [],
          terminal: conv.terminal ?? [],
        },
      ]
    : []
  return {
    messages: conv.messages ?? [],
    workspaces,
    repos,
    connectors: conv.connectors ?? [],
    attachments: [],
  }
}

export default function App() {
  const [activeId, setActiveId] = useState(DEMO_CONVERSATION_ID)
  const [query, setQuery] = useState('')
  const [showIntro, setShowIntro] = useState(true)
  const [live, setLive] = useState<Live>(EMPTY_DEMO)
  const [typing, setTyping] = useState(false)
  // Which attached context the right-hand sidebar is showing (null = closed).
  const [focus, setFocus] = useState<PanelFocus | null>(null)
  // Which cross-cutting tool is open in the main area (null = the conversation).
  const [activeSection, setActiveSection] = useState<SectionId | null>(null)

  // Left-rail layout: collapsed state + drag-resizable width, both persisted.
  const [leftOpen, setLeftOpen] = useState<boolean>(() => getLayout('leftOpen', true))
  const [leftW, setLeftW] = useState(() => clamp(getLayout('leftW', 272), LEFT_MIN, LEFT_MAX))
  const [leftDragging, setLeftDragging] = useState(false)
  const leftWRef = useRef(leftW)
  leftWRef.current = leftW
  useEffect(() => setLayout('leftOpen', leftOpen), [leftOpen])

  // Guided-tour state (only meaningful for the demo conversation).
  const [phase, setPhase] = useState<TourPhase>('idle')
  const [stepIndex, setStepIndex] = useState(-1)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)

  // Timer bookkeeping so switching conversations cancels in-flight callbacks.
  const runId = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  // Mirror of `live` for reads inside event handlers (handleAddContext has empty
  // deps and must not close over a stale snapshot).
  const liveRef = useRef(live)
  liveRef.current = live

  const activeConv = useMemo(
    () => CONVERSATIONS.find((c) => c.id === activeId)!,
    [activeId],
  )
  const isDemo = !!activeConv.isDemo

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

  // Auto-scroll the thread as messages/typing change.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [live.messages, typing])

  const selectConversation = useCallback(
    (id: string) => {
      clearTimers()
      setTyping(false)
      setBusy(false)
      setActiveSection(null)
      setActiveId(id)
      const conv = CONVERSATIONS.find((c) => c.id === id)!
      const nextLive = liveFromConversation(conv)
      setLive(nextLive)
      // Auto-focus the conversation's strongest present context so its sidebar
      // opens — a repo if there is one, else a workspace, else nothing.
      setFocus(
        nextLive.repos[0]
          ? { kind: 'repo', id: nextLive.repos[0].id }
          : nextLive.workspaces[0]
            ? { kind: 'workspace', id: nextLive.workspaces[0].id }
            : null,
      )
      if (conv.isDemo) {
        setPhase('idle')
        setStepIndex(-1)
        setCaption('')
      } else {
        setPhase('idle')
      }
    },
    [clearTimers],
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
        setLive((l) => {
          const next: Live = { ...l, messages: [...l.messages, step.assistant] }
          // Guard the id-keyed pushes so a replayed step can't duplicate a panel.
          if (step.assistant.escalate === 'workspace' && !l.workspaces.some((w) => w.id === 'ws-demo')) {
            next.workspaces = [
              ...l.workspaces,
              { id: 'ws-demo', label: workspaceNameFor(activeConv), artifacts: step.artifacts ?? [] },
            ]
          }
          if (step.assistant.escalate === 'repo' && !l.repos.some((r) => r.id === 'repo-demo')) {
            next.repos = [
              ...l.repos,
              {
                id: 'repo-demo',
                label: remoteFor(activeConv.id),
                origin: 'github',
                remote: remoteFor(activeConv.id),
                branch: branchFor(activeConv.id),
                files: step.files ?? [],
                diff: step.diff ?? [],
                terminal: step.terminal ?? [],
              },
            ]
          }
          if (step.connectors) next.connectors = step.connectors.reduce(withConnector, l.connectors)
          return next
        })
        // Auto-disclose the newly attached context's sidebar (drives the tour).
        if (step.assistant.escalate === 'workspace') setFocus({ kind: 'workspace', id: 'ws-demo' })
        if (step.assistant.escalate === 'repo') setFocus({ kind: 'repo', id: 'repo-demo' })
        setBusy(false)
      }, 950)
    },
    [schedule, activeConv],
  )

  // Resets step/caption too, so this doubles as a one-click "Replay" from the
  // finished state — not just the first run.
  const startTour = useCallback(() => {
    clearTimers()
    setLive(EMPTY_DEMO)
    setStepIndex(-1)
    setCaption('')
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

  // Free-typed replies get an honest canned answer (no fake intelligence).
  const handleSend = useCallback(
    (text: string) => {
      const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text }
      setLive((l) => ({ ...l, messages: [...l.messages, userMsg] }))
      setTyping(true)
      setBusy(true)
      schedule(() => {
        setTyping(false)
        const reply: Message = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: isDemo
            ? 'This is a static prototype, so I won’t actually answer here. Use **Play the tour** above to watch one conversation flow from chat → workspace → code without switching tabs.'
            : 'This is a static prototype — open the **Insights dashboard launch** conversation and play the guided tour to see the unified flow.',
        }
        setLive((l) => ({ ...l, messages: [...l.messages, reply] }))
        setBusy(false)
      }, 800)
    },
    [isDemo, schedule],
  )

  // Manually attach context to the open thread — the same escalation the tour
  // performs, but user-driven. Every context type funnels through here, and the
  // newly attached context's sidebar opens so you see what you added.
  const handleAddContext = useCallback((ctx: AddedContext) => {
    setLive((l) => {
      switch (ctx.kind) {
        case 'folder': {
          // One shared Cowork workspace per conversation. Attaching a folder adds
          // its (source-tagged) artifacts into that single workspace, creating it
          // if there isn't one. Dedup by artifact id so re-attaching is a no-op.
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
          const id = `repo-${slug(ctx.label)}`
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
        case 'photos':
          return { ...l, attachments: [...l.attachments, ...ctx.attachments] }
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

  // "New task" reopens a fresh conversation; a nav tool takes over the main area.
  const newTask = useCallback(
    () => selectConversation(DEMO_CONVERSATION_ID),
    [selectConversation],
  )
  const openSection = useCallback((s: SectionId) => setActiveSection(s), [])

  const removeAttachment = useCallback((id: string) => {
    setLive((l) => ({ ...l, attachments: l.attachments.filter((a) => a.id !== id) }))
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
  const focusedRepo =
    focus?.kind === 'repo' ? live.repos.find((r) => r.id === focus.id) : undefined
  const focusedConnector =
    focus?.kind === 'connector' ? live.connectors.find((c) => c.id === focus.id) : undefined

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink">
      <TopBar
        onAbout={() => setShowIntro(true)}
        sidebarOpen={leftOpen}
        onToggleSidebar={() => setLeftOpen((o) => !o)}
      />

      <div className="flex min-h-0 flex-1">
        {/* Left rail: collapsible (width → 0) and drag-resizable. The inner div
            holds a fixed width so the content doesn't reflow while collapsing. */}
        <div
          className={`relative h-full shrink-0 overflow-hidden ${
            leftDragging ? '' : 'transition-[width] duration-200 ease-out'
          } ${leftOpen ? '' : 'pointer-events-none'}`}
          style={{ width: leftOpen ? leftW : 0 }}
        >
          <div style={{ width: leftW }} className="h-full">
            <Sidebar
              conversations={CONVERSATIONS}
              activeId={activeId}
              activeSection={activeSection}
              query={query}
              onQuery={setQuery}
              onSelect={selectConversation}
              onNewTask={newTask}
              onOpenSection={openSection}
              onResizeStart={() => setLeftDragging(true)}
              onResize={(clientX) => setLeftW(clamp(clientX, LEFT_MIN, LEFT_MAX))}
              onResizeEnd={() => {
                setLeftDragging(false)
                setLayout('leftW', leftWRef.current)
              }}
            />
          </div>
        </div>

        <main className="flex min-w-0 flex-1 flex-col">
          {activeSection ? (
            <SectionView section={activeSection} />
          ) : (
            <>
          {isDemo ? (
            <CaptionBar
              phase={phase}
              stepIndex={stepIndex}
              totalSteps={DEMO_STEPS.length}
              caption={caption}
              busy={busy}
              onStart={startTour}
              onNext={nextStep}
              onRestart={startTour}
            />
          ) : (
            <div className="flex items-center gap-3 border-b border-line bg-canvas/80 px-4 py-2">
              <span className="font-serif text-[15px] font-semibold text-ink">
                {activeConv.title}
              </span>
              <CapBadges caps={activeConv.caps} size="md" />
            </div>
          )}

          <div className="flex min-h-0 flex-1">
            <section className="flex min-w-0 flex-1 flex-col">
              <div className="flex-1 overflow-y-auto">
                {live.messages.length === 0 && !typing ? (
                  <EmptyState />
                ) : (
                  <div className="py-4">
                    {live.messages.map((m) => (
                      <MessageRow key={m.id} message={m} />
                    ))}
                    <AnimatePresence>{typing && <TypingRow />}</AnimatePresence>
                    <div ref={bottomRef} />
                  </div>
                )}
              </div>

              <Composer
                workspaces={live.workspaces}
                repos={live.repos}
                connectors={live.connectors}
                attachments={live.attachments}
                focus={focus}
                disabled={isDemo && phase === 'running'}
                onSend={handleSend}
                onAddContext={handleAddContext}
                onOpenContext={focusContext}
                onRemoveContexts={removeContexts}
              />
            </section>

            {/* One focused-context sidebar at a time, chosen by the active chip.
                One keyed WorkspacePanel serves both workspace and repo so the
                body morphs when you switch between the two. */}
            <AnimatePresence>
              {(focusedWorkspace || focusedRepo) && (
                <WorkspacePanel
                  key="ws"
                  mode={focusedRepo ? 'repo' : 'workspace'}
                  workspace={focusedWorkspace}
                  repo={focusedRepo}
                  onClose={() => setFocus(null)}
                />
              )}
            </AnimatePresence>

            <AnimatePresence>
              {focusedConnector && (
                <ConnectorPanel
                  key="conn"
                  connector={focusedConnector}
                  onClose={() => setFocus(null)}
                  onDisconnect={() => removeContexts([{ kind: 'connector', id: focusedConnector.id }])}
                />
              )}
            </AnimatePresence>

            <AnimatePresence>
              {(focus?.kind === 'file' || focus?.kind === 'photo') && (
                <AttachmentPanel
                  key="att"
                  kind={focus.kind}
                  items={live.attachments.filter((a) => a.kind === focus.kind)}
                  initialId={focus.id}
                  onClose={() => setFocus(null)}
                  onRemove={removeAttachment}
                />
              )}
            </AnimatePresence>
          </div>
            </>
          )}
        </main>
      </div>

      {/* Rendered without AnimatePresence: framer-motion 11 + React 19 can leave
          an exited overlay in the DOM (an invisible, click-blocking backdrop).
          A plain conditional unmounts instantly; the entrance still animates. */}
      {showIntro && (
        <IntroOverlay
          onClose={() => setShowIntro(false)}
          onStartTour={() => {
            setShowIntro(false)
            selectConversation(DEMO_CONVERSATION_ID)
            startTour()
          }}
        />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <div className="font-serif text-lg font-semibold text-ink">One place for everything</div>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Start typing, or press <span className="font-semibold text-accent-strong">Play the tour</span>{' '}
          to watch a single conversation grow a workspace and a repo — no tabs, no lost context.
        </p>
      </div>
    </div>
  )
}
