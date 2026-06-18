import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { Composer } from './components/Composer'
import { MessageRow, TypingRow } from './components/Message'
import { CaptionBar, type TourPhase } from './components/CaptionBar'
import { WorkspacePanel } from './components/WorkspacePanel'
import { AttachmentPanel } from './components/AttachmentPanel'
import { ConnectorPanel } from './components/ConnectorPanel'
import { IntroOverlay } from './components/IntroOverlay'
import { CapBadges } from './components/CapBadges'
import { CONVERSATIONS, DEMO_CONVERSATION_ID } from './data/conversations'
import { DEMO_STEPS } from './data/demo'
import { sameFocus } from './lib/focus'
import type {
  AddedContext,
  Attachment,
  Connector,
  Conversation,
  Message,
  PanelFocus,
  Repo,
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

function withConnector(list: Connector[], c: Connector): Connector[] {
  return list.some((x) => x.id === c.id) ? list : [...list, c]
}

/** A stable, dedup-friendly id derived from a label. */
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

const BRANCH: Record<string, string> = {
  'insights-launch': 'feat/insights-dashboard',
  'auth-refactor': 'refactor/auth-middleware',
}

function branchFor(id: string) {
  return BRANCH[id] ?? 'main'
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
          label: branchFor(conv.id),
          branch: branchFor(conv.id),
          files: conv.files ?? [],
          diff: conv.diff ?? [],
          terminal: conv.terminal ?? [],
          connector: conv.connectors?.[0],
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

  // Guided-tour state (only meaningful for the demo conversation).
  const [phase, setPhase] = useState<TourPhase>('idle')
  const [stepIndex, setStepIndex] = useState(-1)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)

  // Timer bookkeeping so switching conversations cancels in-flight callbacks.
  const runId = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

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
          if (step.assistant.escalate === 'workspace') {
            next.workspaces = [
              ...l.workspaces,
              { id: 'ws-demo', label: workspaceNameFor(activeConv), artifacts: step.artifacts ?? [] },
            ]
          }
          if (step.assistant.escalate === 'repo') {
            next.repos = [
              ...l.repos,
              {
                id: 'repo-demo',
                label: branchFor(activeConv.id),
                branch: branchFor(activeConv.id),
                files: step.files ?? [],
                diff: step.diff ?? [],
                terminal: step.terminal ?? [],
                connector: step.connectors?.[0],
              },
            ]
          }
          if (step.connectors) next.connectors = [...l.connectors, ...step.connectors]
          return next
        })
        // Auto-disclose the newly attached context's sidebar (drives the tour).
        if (step.assistant.escalate === 'workspace') setFocus({ kind: 'workspace', id: 'ws-demo' })
        if (step.assistant.escalate === 'repo') setFocus({ kind: 'repo', id: 'repo-demo' })
        setBusy(false)
        if (index >= DEMO_STEPS.length - 1) setPhase('done')
      }, 950)
    },
    [schedule, activeConv],
  )

  const startTour = useCallback(() => {
    clearTimers()
    setLive(EMPTY_DEMO)
    setPhase('running')
    schedule(() => playStep(0), 200)
  }, [clearTimers, playStep, schedule])

  const nextStep = useCallback(() => {
    if (busy) return
    playStep(stepIndex + 1)
  }, [busy, playStep, stepIndex])

  const restartTour = useCallback(() => {
    clearTimers()
    setLive(EMPTY_DEMO)
    setStepIndex(-1)
    setCaption('')
    setPhase('idle')
  }, [clearTimers])

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
          const id = `ws-${slug(ctx.label)}`
          if (l.workspaces.some((w) => w.id === id)) return l
          return {
            ...l,
            workspaces: [...l.workspaces, { id, label: ctx.label, artifacts: ctx.artifacts }],
          }
        }
        case 'repo': {
          const id = `repo-${slug(ctx.label)}`
          const connectors = withConnector(l.connectors, ctx.connector)
          if (l.repos.some((r) => r.id === id)) return { ...l, connectors }
          const repo: Repo = {
            id,
            label: ctx.branch,
            branch: ctx.branch,
            files: ctx.files,
            diff: ctx.diff,
            terminal: ctx.terminal,
            connector: ctx.connector,
          }
          return { ...l, repos: [...l.repos, repo], connectors }
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
        setFocus({ kind: 'workspace', id: `ws-${slug(ctx.label)}` })
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

  const removeAttachment = useCallback((id: string) => {
    setLive((l) => ({ ...l, attachments: l.attachments.filter((a) => a.id !== id) }))
  }, [])

  const removeConnector = useCallback((id: string) => {
    setLive((l) => ({ ...l, connectors: l.connectors.filter((c) => c.id !== id) }))
  }, [])

  // Remove any attached context by its focus (used by the chip-popup trash button).
  const removeContext = useCallback((f: PanelFocus) => {
    setLive((l) => {
      switch (f.kind) {
        case 'workspace':
          return { ...l, workspaces: l.workspaces.filter((w) => w.id !== f.id) }
        case 'repo':
          return { ...l, repos: l.repos.filter((r) => r.id !== f.id) }
        case 'connector':
          return { ...l, connectors: l.connectors.filter((c) => c.id !== f.id) }
        case 'file':
        case 'photo':
          return { ...l, attachments: l.attachments.filter((a) => a.id !== f.id) }
        default:
          return l
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
      <TopBar onAbout={() => setShowIntro(true)} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          conversations={CONVERSATIONS}
          activeId={activeId}
          query={query}
          onQuery={setQuery}
          onSelect={selectConversation}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          {isDemo ? (
            <CaptionBar
              phase={phase}
              stepIndex={stepIndex}
              totalSteps={DEMO_STEPS.length}
              caption={caption}
              busy={busy}
              onStart={startTour}
              onNext={nextStep}
              onRestart={restartTour}
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
                onSend={handleSend}
                onAddContext={handleAddContext}
                onOpenContext={focusContext}
                onRemoveContext={removeContext}
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
                  onDisconnect={() => removeConnector(focusedConnector.id)}
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
        </main>
      </div>

      <AnimatePresence>
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
      </AnimatePresence>
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
