import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { Composer } from './components/Composer'
import { MessageRow, TypingRow } from './components/Message'
import { CaptionBar, type TourPhase } from './components/CaptionBar'
import { WorkspacePanel, type PanelState } from './components/WorkspacePanel'
import { AttachmentPanel } from './components/AttachmentPanel'
import { IntroOverlay } from './components/IntroOverlay'
import { CapBadges } from './components/CapBadges'
import { CONVERSATIONS, DEMO_CONVERSATION_ID } from './data/conversations'
import { DEMO_STEPS } from './data/demo'
import type {
  AddedContext,
  Artifact,
  Attachment,
  Capability,
  Connector,
  Conversation,
  DiffLine,
  FileNode,
  Message,
} from './types'

/** Everything that makes up the live view of the open conversation. */
interface Live {
  messages: Message[]
  caps: Capability[]
  artifacts: Artifact[]
  files: FileNode[]
  diff: DiffLine[]
  terminal: string[]
  connectors: Connector[]
  attachments: Attachment[]
  /** Set when context is attached manually, overriding the conversation's
   *  derived workspace name / branch. */
  workspaceLabel?: string
  branchLabel?: string
}

const EMPTY_DEMO: Live = {
  messages: [],
  caps: ['chat'],
  artifacts: [],
  files: [],
  diff: [],
  terminal: [],
  connectors: [],
  attachments: [],
}

function withCap(caps: Capability[], cap: Capability): Capability[] {
  return caps.includes(cap) ? caps : [...caps, cap]
}

function withConnector(list: Connector[], c: Connector): Connector[] {
  return list.some((x) => x.id === c.id) ? list : [...list, c]
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
  return {
    messages: conv.messages ?? [],
    caps: conv.caps,
    artifacts: conv.artifacts ?? [],
    files: conv.files ?? [],
    diff: conv.diff ?? [],
    terminal: conv.terminal ?? [],
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
  const [collapsed, setCollapsed] = useState(false)
  // Which attachment group's preview/edit panel is open (null = none).
  const [openGroup, setOpenGroup] = useState<'file' | 'photo' | null>(null)

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
      setCollapsed(false)
      setOpenGroup(null)
      const conv = CONVERSATIONS.find((c) => c.id === id)!
      setLive(liveFromConversation(conv))
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
        setLive((l) => ({
          ...l,
          messages: [...l.messages, step.assistant],
          caps: step.assistant.escalate
            ? Array.from(new Set([...l.caps, step.assistant.escalate]))
            : l.caps,
          artifacts: step.artifacts ?? l.artifacts,
          files: step.files ?? l.files,
          diff: step.diff ?? l.diff,
          terminal: step.terminal ?? l.terminal,
          connectors: step.connectors
            ? [...l.connectors, ...step.connectors]
            : l.connectors,
        }))
        setBusy(false)
        if (index >= DEMO_STEPS.length - 1) setPhase('done')
      }, 950)
    },
    [schedule],
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
  // performs, but user-driven. Every context type funnels through here.
  const handleAddContext = useCallback((ctx: AddedContext) => {
    setCollapsed(false)
    setLive((l) => {
      switch (ctx.kind) {
        case 'folder':
          return {
            ...l,
            caps: withCap(l.caps, 'workspace'),
            artifacts: ctx.artifacts,
            workspaceLabel: ctx.label,
          }
        case 'repo':
          return {
            ...l,
            caps: withCap(l.caps, 'repo'),
            files: ctx.files,
            diff: ctx.diff,
            terminal: ctx.terminal,
            branchLabel: ctx.branch,
            connectors: withConnector(l.connectors, ctx.connector),
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
  }, [])

  const openAttachments = useCallback((kind: 'file' | 'photo') => {
    setOpenGroup((g) => (g === kind ? null : kind))
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setLive((l) => ({ ...l, attachments: l.attachments.filter((a) => a.id !== id) }))
  }, [])

  // Close the preview panel once its group has no items left.
  useEffect(() => {
    if (openGroup && !live.attachments.some((a) => a.kind === openGroup)) setOpenGroup(null)
  }, [openGroup, live.attachments])

  const workspaceName = live.workspaceLabel ?? workspaceNameFor(activeConv)
  const branch = live.branchLabel ?? branchFor(activeId)

  const panelVisible = live.caps.includes('workspace') || live.caps.includes('repo')
  const panelState: PanelState = {
    caps: live.caps,
    artifacts: live.artifacts,
    files: live.files,
    diff: live.diff,
    terminal: live.terminal,
    connectors: live.connectors,
    branch,
    workspaceName,
  }

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
                caps={live.caps}
                connectors={live.connectors}
                attachments={live.attachments}
                repoBranch={branch}
                workspaceName={workspaceName}
                openAttachmentKind={openGroup}
                onSend={handleSend}
                onAddContext={handleAddContext}
                onOpenAttachments={openAttachments}
              />
            </section>

            <AnimatePresence>
              {panelVisible && !openGroup && (
                <WorkspacePanel
                  state={panelState}
                  collapsed={collapsed}
                  onToggle={() => setCollapsed((c) => !c)}
                />
              )}
            </AnimatePresence>

            <AnimatePresence>
              {openGroup && (
                <AttachmentPanel
                  kind={openGroup}
                  items={live.attachments.filter((a) => a.kind === openGroup)}
                  onClose={() => setOpenGroup(null)}
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
