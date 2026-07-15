/** ── The MAIN workspace split frame (universal split Phase 2) ────────────────
 *  Tiles the main surface right of the rail into the split tree
 *  (src/lib/mainSplit.ts vocabulary): the `primary` pane renders the singleton
 *  controller's surface (injected as a closure — the pre-split JSX untouched);
 *  `msection` panes are INDEPENDENT, fully interactive section pages with
 *  pane-local navigation (SectionPane below); `mpicker` panes choose. Every
 *  pane wears a slim strip (label + split/close — the primary can't close: it
 *  is where rail navigation lands and what the URL names). Dividers are the
 *  ONE keyboard-operable ResizeHandle, named per path (UI-11). Wide tier only
 *  (the caller gates, ADAPT-11): overlay tiers render the primary surface
 *  alone and the tree persists. */
import { useRef, useState, type ReactNode } from 'react'
import { Columns2, Rows2, X } from 'lucide-react'
import { ResizeHandle } from './ResizeHandle'
import { SectionView } from './SectionView'
import { SECTION_META } from '../lib/sections'
import { clampRatio, type SplitDir } from '../lib/splitFrame'
import type { MainPaneContent, MainSplitNode } from '../lib/mainSplit'
import type { NavLocation } from '../lib/nav'
import type { SectionId } from '../types'

/** Global doors a pane hands off to the PRIMARY surface (opening a thread from
 *  a pane's session list shows it where conversations live — the primary). */
export interface MainPaneNav {
  onOpenSession: (id: string) => void
  onNewSession: () => void
  onOpenProposal: (agentId: string, proposalId: string, ownerName: string | null) => void
}

/** The gate App renders: no tree (or an overlay tier) passes the primary
 *  surface through UNTOUCHED — the pre-split app, byte-identical; a tree tiles
 *  it as the primary pane beside the independent ones. */
export function MainSplitGate({
  tree,
  children,
  primaryLabel,
  nav,
  onSplitPane,
  onFillPane,
  onClosePane,
  onRatio,
}: {
  tree: MainSplitNode | null
  children: ReactNode
  primaryLabel: string
  nav: MainPaneNav
  onSplitPane: (path: string, dir: SplitDir) => void
  onFillPane: (path: string, content: MainPaneContent) => void
  onClosePane: (path: string) => void
  onRatio: (path: string, ratio: number) => void
}) {
  if (!tree) return <>{children}</>
  return (
    <MainSplit
      tree={tree}
      primaryLabel={primaryLabel}
      renderPrimary={() => children}
      nav={nav}
      onSplitPane={onSplitPane}
      onFillPane={onFillPane}
      onClosePane={onClosePane}
      onRatio={onRatio}
    />
  )
}

export function MainSplit({
  tree,
  primaryLabel,
  renderPrimary,
  nav,
  onSplitPane,
  onFillPane,
  onClosePane,
  onRatio,
}: {
  tree: MainSplitNode
  primaryLabel: string
  renderPrimary: () => ReactNode
  nav: MainPaneNav
  onSplitPane: (path: string, dir: SplitDir) => void
  onFillPane: (path: string, content: MainPaneContent) => void
  onClosePane: (path: string) => void
  onRatio: (path: string, ratio: number) => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-main-split>
      <Branch
        node={tree}
        path=""
        primaryLabel={primaryLabel}
        renderPrimary={renderPrimary}
        nav={nav}
        onSplitPane={onSplitPane}
        onFillPane={onFillPane}
        onClosePane={onClosePane}
        onRatio={onRatio}
      />
    </div>
  )
}

interface BranchProps {
  node: MainSplitNode
  path: string
  primaryLabel: string
  renderPrimary: () => ReactNode
  nav: MainPaneNav
  onSplitPane: (path: string, dir: SplitDir) => void
  onFillPane: (path: string, content: MainPaneContent) => void
  onClosePane: (path: string) => void
  onRatio: (path: string, ratio: number) => void
}

function Branch(props: BranchProps) {
  const { node, path, primaryLabel, onSplitPane, onClosePane, onRatio } = props
  const ref = useRef<HTMLDivElement>(null)

  if (node.kind === 'pane') {
    const c = node.content
    const label = c.kind === 'primary' ? primaryLabel : c.kind === 'msection' ? SECTION_META[c.id].label : c.kind === 'msession' ? 'Conversation' : 'New pane'
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas" data-main-pane={path || 'root'}>
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line bg-surface/60 px-2.5">
          <span className="truncate text-[12px] font-medium text-ink-soft">{label}</span>
          <div className="ml-auto flex shrink-0 items-center">
            <button
              onClick={() => onSplitPane(path, 'row')}
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface hover:text-ink"
              title="Split right"
              data-main-split-btn="row"
            >
              <Columns2 size={14} />
            </button>
            <button
              onClick={() => onSplitPane(path, 'col')}
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface hover:text-ink"
              title="Split down"
              data-main-split-btn="col"
            >
              <Rows2 size={14} />
            </button>
            {c.kind !== 'primary' && (
              <button
                onClick={() => onClosePane(path)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface hover:text-ink"
                title="Close pane"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {c.kind === 'primary' ? (
            props.renderPrimary()
          ) : c.kind === 'msection' ? (
            <SectionPane section={c.id} nav={props.nav} />
          ) : (
            <MainPicker onPick={(content) => props.onFillPane(path, content)} />
          )}
        </div>
      </div>
    )
  }

  const row = node.dir === 'row'
  const ratio = clampRatio(node.ratio)
  // The same absolute floors the right-panel frame earned (rulebook finding):
  // percentage bases never shrink a pane under a usable minimum.
  const minStyle = row ? { minWidth: 320 } : { minHeight: 160 }
  const child = (n: MainSplitNode, p: string) => <Branch {...props} node={n} path={p} />
  return (
    <div ref={ref} className={`flex min-h-0 min-w-0 flex-1 ${row ? 'flex-row' : 'flex-col'}`}>
      <div className="flex min-h-0 min-w-0" style={{ flex: `${ratio} 1 0%`, ...minStyle }}>
        {child(node.a, `${path}a`)}
      </div>
      <div
        className={`relative flex min-h-0 min-w-0 ${row ? 'border-l' : 'border-t'} border-line`}
        style={{ flex: `${1 - ratio} 1 0%`, ...minStyle }}
      >
        <ResizeHandle
          side={row ? 'left' : 'top'}
          label={`Resize view panes (${path || 'root'})`}
          value={Math.round((1 - ratio) * 100)}
          min={15}
          max={85}
          onMove={(client) => {
            const rect = ref.current?.getBoundingClientRect()
            if (!rect) return
            onRatio(path, row ? (client - rect.left) / Math.max(1, rect.width) : (client - rect.top) / Math.max(1, rect.height))
          }}
        />
        {child(node.b, `${path}b`)}
      </div>
    </div>
  )
}

/** ── An independent section page, navigation scoped to its pane ──────────────
 *  Fully interactive: it reads the same live registries every section page
 *  reads (the api hooks are global), but its sub-view, open detail, and back
 *  stack are PANE-LOCAL — navigating inside one pane never moves another (and
 *  never touches the URL: the address stays the primary's, ADAPT-15).
 *  Conversation doors (open a thread, new session) hand off to the primary
 *  surface — where conversations live until Phase 3. */
interface PaneFocusState {
  projectId: string | null
  scheduleId: string | null
  ownerName: string | null
  workItemId: string | null
  agentId: string | null
  contextId: string | null
}
const NO_FOCUS: PaneFocusState = { projectId: null, scheduleId: null, ownerName: null, workItemId: null, agentId: null, contextId: null }

function SectionPane({ section, nav }: { section: SectionId; nav: MainPaneNav }) {
  const [subview, setSubview] = useState<string | null>(null)
  const [focus, setFocus] = useState<PaneFocusState>(NO_FOCUS)
  const [stack, setStack] = useState<PaneFocusState[]>([])

  const navigate = (next: Partial<PaneFocusState>) => {
    setStack((s) => [...s, focus])
    setFocus({ ...NO_FOCUS, ...next })
  }
  const onBack = () => {
    setStack((s) => {
      const prev = s.at(-1)
      setFocus(prev ?? NO_FOCUS)
      return s.slice(0, -1)
    })
  }
  const top = stack.at(-1)
  const backTo: NavLocation | null =
    stack.length > 0
      ? { kind: 'section', section, projectId: top?.projectId ?? null, scheduleId: top?.scheduleId ?? null, ownerName: top?.ownerName ?? null }
      : focus.projectId || focus.scheduleId || focus.ownerName || focus.agentId || focus.contextId
        ? { kind: 'section', section, projectId: null, scheduleId: null, ownerName: null }
        : null

  return (
    <SectionView
      section={section}
      subview={subview}
      onOpenSubview={(id) => {
        setSubview(id)
        setFocus(NO_FOCUS)
      }}
      onOpenSession={nav.onOpenSession}
      onNewSession={nav.onNewSession}
      onOpenProject={(id) => navigate({ projectId: id })}
      onOpenSchedule={(id) => navigate({ scheduleId: id })}
      onOpenProposal={nav.onOpenProposal}
      onBack={onBack}
      backTo={backTo}
      focusProjectId={focus.projectId}
      focusScheduleId={focus.scheduleId}
      focusOwnerName={focus.ownerName}
      focusWorkItemId={focus.workItemId}
      focusAgentId={focus.agentId}
      focusContextId={focus.contextId}
      onOpenAgentPage={(id) => navigate({ agentId: id })}
    />
  )
}

/** The empty pane's content picker — every section page; conversations join in
 *  Phase 3. */
function MainPicker({ onPick }: { onPick: (content: MainPaneContent) => void }) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-canvas" data-main-picker>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="px-1 pb-2 text-[12px] font-medium text-ink-faint">Choose what this pane shows</div>
        {(Object.keys(SECTION_META) as SectionId[]).map((id) => {
          const meta = SECTION_META[id]
          return (
            <button
              key={id}
              onClick={() => onPick({ kind: 'msection', id })}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink transition hover:bg-surface"
            >
              <meta.Icon size={16} className="shrink-0 text-ink-soft" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{meta.label}</span>
                <span className="block truncate text-[12px] text-ink-faint">{meta.subtitle}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
