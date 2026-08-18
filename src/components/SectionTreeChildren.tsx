/** ── The rail tree's kinds of child ─────────────────────────────────────────
 *  A rail child is a PLACE (src/lib/subviews.ts): a declared surface, one
 *  INSTANCE of the section's list, or a STANDING DOOR to a place whose
 *  canonical address is its own (`OwnerProfileChild`, below — the only one).
 *  This module renders the latter two. The instance kind is the
 *  top rows of the very list the section page shows, in the same order, sliced
 *  by `RAIL_INSTANCE_CAP` with a tail row that UNFOLDS the rest in place. The
 *  section row mirrors the page's Filter & sort control over the same state.
 *
 *  The rail and the page compute the list with ONE function per section
 *  (`src/lib/sectionLists.ts`) over ONE stored choice (`useSectionFilter`), so
 *  the eight names in the rail are always the first eight names on the page.
 *  That is the whole point of the arrangement — a rail that lists a *different*
 *  eight would be worse than one that lists none.
 *
 *  Each section's children mount only while its row is EXPANDED, so a rail
 *  that never opens Models never fetches providers. */
import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  useAgents,
  useAgentToolCatalog,
  useAttention,
  useCommissions,
  useContributions,
  useDiscussions,
  useMe,
  useMyDiscussions,
  useMyOrgs,
  useOpenSubGoals,
  useProviders,
  useSavedContexts,
  useSystemPrompts,
} from '../api'
import { useRelations } from '../controller/useRelations'
import { discussionTitle } from '../../contract/social.ts'
import type { Project, SectionId } from '../types'
import type { PaneSeed } from '../lib/paneNav'
import {
  SIDEBAR_BRANCH,
  SIDEBAR_ENTRY_LEAD,
  SIDEBAR_NESTED_ENTRY_LAYOUT,
  SIDEBAR_HOVER,
  sidebarEntryClass,
  type SidebarEntryKind,
} from '../lib/sidebar'
import { RAIL_INSTANCE_CAP, SECTION_INSTANCE_KEY } from '../lib/subviews'
import { useSectionFilter } from '../lib/useSectionFilter'
import { listArtifacts, listContexts, listDiscussions, listProjects, listProviders } from '../lib/sectionLists'
import {
  PROJECT_SECTIONS,
  visibleCompositeSections,
  type ProjectSectionId,
} from '../lib/compositeSections'
import { AGENT_SECTIONS, agentSectionForSubview, agentToolLabel } from '../lib/agentStructure'
import {
  ACCOUNT_MCP_SECTION,
  artifactCollectionSections,
  contextCollectionSections,
  modelCollectionSections,
  type CollectionSection,
} from '../lib/collectionSections'
import { railFoldAffects, type RailFoldSignal } from '../lib/railSplit'

/** Stable, path-shaped identity for one canonical rail node. A split stores
 * this key rather than a row ordinal, so filtering, capping, and async arrival
 * cannot silently retarget a rooted view. */
export const railNodeKey = (...parts: string[]): string =>
  parts.map((part) => encodeURIComponent(part)).join('/')

type RailRootPath = {
  ancestors: ReadonlySet<string>
  all: ReadonlySet<string>
}
const EMPTY_RAIL_ROOT_PATH: RailRootPath = { ancestors: new Set(), all: new Set() }
const RailRootPathContext = createContext<RailRootPath>(EMPTY_RAIL_ROOT_PATH)

/** A rooted rail view still renders the canonical tree, but hidden ancestors
 * must stay disclosed long enough for their selected descendant to exist. */
export function RailRootScope({
  ancestorKeys,
  rootKey,
  children,
}: {
  ancestorKeys: string[]
  rootKey?: string
  children: ReactNode
}) {
  const ancestors = new Set(ancestorKeys)
  const all = new Set(rootKey ? [...ancestorKeys, rootKey] : ancestorKeys)
  return (
    <RailRootPathContext.Provider value={{ ancestors, all }}>
      {children}
    </RailRootPathContext.Provider>
  )
}

export function useRailRootAncestorKeys(): ReadonlySet<string> {
  return useContext(RailRootPathContext).ancestors
}

export function useRailRootPathKeys(): ReadonlySet<string> {
  return useContext(RailRootPathContext).all
}

function useForcedRailAncestor(key: string): boolean {
  return useRailRootAncestorKeys().has(key)
}

function RailTreeNode({ nodeKey, children }: { nodeKey: string; children: ReactNode }) {
  return <div data-rail-node-key={nodeKey}>{children}</div>
}

/** One structural guide. Nest it once per disclosed level; every row can then
 *  use the same local inset instead of calculating an absolute depth. */
export function RailTreeBranch({ className = '', ...props }: ComponentProps<'div'>) {
  return <div {...props} data-rail-node-children className={`${SIDEBAR_BRANCH} ${className}`} />
}

/** The first column of every non-root rail row. Branches and foldable list
 * headings put their caret in this seat; leaves deliberately preserve the empty
 * seat so their label cannot drift left of the structural row that contains them. */
export function RailEntryLead({
  label,
  expanded,
  onToggle,
  disclosureExpanded,
}: ({
  label: string
  expanded: boolean
  onToggle: () => void
  disclosureExpanded?: undefined
} | {
  label?: undefined
  expanded?: undefined
  onToggle?: undefined
  /** A parent button owns the disclosure action; this seat renders only its
   *  visual state so the row stays one tab stop. */
  disclosureExpanded: boolean
} | {
  label?: undefined
  expanded?: undefined
  onToggle?: undefined
  disclosureExpanded?: undefined
})) {
  if (disclosureExpanded !== undefined) {
    return (
      <span data-rail-entry-lead className={SIDEBAR_ENTRY_LEAD} aria-hidden>
        {disclosureExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </span>
    )
  }
  if (!onToggle) return <span data-rail-entry-lead className={SIDEBAR_ENTRY_LEAD} aria-hidden />
  return (
    <button
      type="button"
      data-rail-entry-lead
      onClick={onToggle}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
      aria-expanded={expanded}
      className={`rounded text-ink-faint transition ${SIDEBAR_ENTRY_LEAD} ${SIDEBAR_HOVER} hover:text-ink`}
    >
      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
    </button>
  )
}

/** One leaf under an expanded branch. `kind` preserves semantic identity for
 * the tree and tests; it does not change the row's visual anatomy. Depth alone
 * sets the inset, so unrelated entries on the same level remain harmonious. */
export function SubNavRow({
  nodeKey,
  label,
  title,
  kind = 'item',
  active,
  onClick,
}: {
  nodeKey: string
  label: string
  /** The row's full text when the label truncates (an artifact name, a thread's
   *  opening post) — the rail is narrow and these are real entity names. */
  title?: string
  /** Semantic role only; every non-root role wears the same row anatomy. */
  kind?: Extract<SidebarEntryKind, 'item' | 'view'>
  active: boolean
  onClick: () => void
}) {
  return (
    <RailTreeNode nodeKey={nodeKey}>
      <button
        data-rail-node-row
        data-rail-entry
        data-rail-entry-kind={kind}
        onClick={onClick}
        title={title}
        aria-current={active ? 'page' : undefined}
        className={sidebarEntryClass(kind, active)}
      >
        <RailEntryLead />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      </button>
    </RailTreeNode>
  )
}

/** ── The third kind of rail child: a STANDING DOOR (owner directive, 2026-08-09) ──
 *  "Your profile" under the Commons — your own public face, `/u/:name`.
 *
 *  Why it belongs to the Commons and not to the account chip: a profile is a
 *  SOCIAL page, not an account setting. The chip's menu switches who you are;
 *  this row goes to what you look like to everyone else. The Commons row reads
 *  "what your world shares" and the profile's own tagline reads "everything
 *  ‹name› shares" — the same sentence, narrowed to you, which is exactly the
 *  relationship the four lenses beside it already have with the feed.
 *
 *  Why it is a door and not a sub-view: the page already has a canonical
 *  address, and `/commons/profile` would be a second one (`lib/subviews.ts`).
 *  So it routes through `openOwner` — the same funnel every byline, follower row
 *  and @-mention uses — and lands on the address anyone else would reach.
 *
 *  The name it opens is the **namespace's**, not the user's: a profile is a
 *  namespace's face (the server's own rule is `tenantName(tenantId) === name`),
 *  and the account chip's Organizations rows already door by `tenant.name`. On
 *  the seeded accounts the two names are equal — that is what `lib/accountFace`
 *  is about — but they are not the same fact, and only one of them has a page. */
export function OwnerProfileChild({
  activeOwner,
  onOpenOwner,
}: {
  /** The owner profile the focused pane is showing (null = none) — this row is
   *  lit only when that profile is YOURS. */
  activeOwner: string | null
  onOpenOwner: (name: string) => void
}) {
  const tenantName = useMe().data?.tenant.name
  // No identity yet (the boot read is in flight): render nothing rather than a
  // row that would door to an empty name.
  if (!tenantName) return null
  return (
    <SubNavRow
      nodeKey={railNodeKey('section', 'commons', 'owner', tenantName)}
      label="Your profile"
      title={`Your public profile — everything ${tenantName} shares`}
      kind="view"
      active={activeOwner === tenantName}
      onClick={() => onOpenOwner(tenantName)}
    />
  )
}

/** The tail row: what the cap left out, unfolded IN PLACE (owner directive,
 *  2026-07-31: "Show all" must reveal the remaining rows under the section, not
 *  jump to another page — the rail is a disclosure tree, and this is one more
 *  disclosure). Not a `SubNavRow` — it names a QUANTITY, not a place, so it
 *  deliberately doesn't impersonate a destination. While unfolded it reads
 *  "Show fewer", so the fold back out is the same control. */
export function ShowAllRow({ hidden, open, onToggle }: { hidden: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className={`${SIDEBAR_NESTED_ENTRY_LAYOUT} text-left text-ink-faint transition ${SIDEBAR_HOVER} hover:text-ink-soft`}
    >
      <RailEntryLead />
      <span>{open ? 'Show fewer' : `Show all — ${hidden} more`}</span>
    </button>
  )
}

/** Keep the canonical head compact without making the currently addressed
 * resource disappear. This matters when a new split remounts a branch whose
 * source view had temporarily unfolded its tail. */
function cappedWithActive<T>(
  rows: T[],
  showAll: boolean,
  active: (row: T) => boolean,
): T[] {
  if (showAll || rows.length <= RAIL_INSTANCE_CAP) return rows
  const visible = rows.slice(0, RAIL_INSTANCE_CAP)
  const current = rows.find(active)
  return current && !visible.includes(current) ? [...visible, current] : visible
}

/** Agents is a composite rather than a flat surface switcher. The same
 * `AGENT_SECTIONS` map drives its root page; this projection adds the runtime
 * resource leaves below Ready agents, Prompts, and Tools. */
export function AgentTreeChildren({
  activeSubview,
  activeSeed,
  onOpenSubview,
  onOpenDetail,
  foldSignal,
}: {
  activeSubview: string | null
  activeSeed?: PaneSeed | null
  onOpenSubview: (id: string) => void
  onOpenDetail: InstanceChildProps['onOpenDetail']
  foldSignal?: RailFoldSignal | null
}) {
  const agents = useAgents().data ?? []
  const prompts = useSystemPrompts().data ?? []
  const tools = useAgentToolCatalog().data?.entries ?? []
  const ownsOpenAgent = !!activeSeed?.agentId && agents.some((agent) => agent.id === activeSeed.agentId)
  const activeTop = activeSeed?.agentId
    ? (ownsOpenAgent ? 'ready-agents' : 'discover')
    : activeSeed?.promptId || activeSeed?.toolId
      ? 'building-blocks'
      : agentSectionForSubview(activeSubview)?.id ?? null
  const initiallyOpen: string[] = AGENT_SECTIONS.flatMap((section) => {
    const open: string[] = section.id === activeTop ? [section.id] : []
    if (section.children.some((child) => child.id === activeSubview)) open.push(section.id)
    if (activeSeed?.promptId) open.push('prompts')
    if (activeSeed?.toolId) open.push('tools')
    return open
  })
  const [open, setOpen] = useState<Set<string>>(() => new Set(initiallyOpen))
  const forcedAncestors = useRailRootAncestorKeys()
  useEffect(() => {
    setOpen((current) => {
      const next = new Set(current)
      let changed = false
      for (const id of initiallyOpen) {
        if (!next.has(id)) {
          next.add(id)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [activeTop, activeSubview, activeSeed?.promptId, activeSeed?.toolId])
  useEffect(() => {
    if (!foldSignal) return
    const nodes = [
      ...AGENT_SECTIONS.map((section) => ({
        id: section.id,
        key: railNodeKey('section', 'agents', 'section', section.id),
      })),
      {
        id: 'prompts',
        key: railNodeKey('section', 'agents', 'section', 'building-blocks', 'material', 'prompts'),
      },
      {
        id: 'tools',
        key: railNodeKey('section', 'agents', 'section', 'building-blocks', 'material', 'tools'),
      },
    ]
    setOpen((current) => {
      const next = new Set(current)
      for (const node of nodes) {
        if (!railFoldAffects(foldSignal, node.key)) continue
        foldSignal.expanded ? next.add(node.id) : next.delete(node.id)
      }
      return next
    })
  }, [foldSignal])
  const toggle = (id: string) => setOpen((current) => {
    const next = new Set(current)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <>
      {AGENT_SECTIONS.map((section) => {
        const hasChildren = section.id === 'ready-agents' || section.children.length > 0
        const count = section.id === 'ready-agents'
          ? agents.length
          : section.id === 'building-blocks'
            ? prompts.length + tools.length
            : undefined
        const pageActive =
          (activeSubview === section.id && !activeSeed?.agentId && !activeSeed?.promptId && !activeSeed?.toolId) ||
          (section.id === 'discover' && !!activeSeed?.agentId && !ownsOpenAgent)
        const sectionKey = railNodeKey('section', 'agents', 'section', section.id)
        const expanded = open.has(section.id) || forcedAncestors.has(sectionKey)
        return (
          <RailTreeNode key={section.id} nodeKey={sectionKey}>
            <AgentStructureRow
              label={section.label}
              count={count}
              active={pageActive}
              expanded={expanded}
              hasChildren={hasChildren}
              onToggle={() => toggle(section.id)}
              onOpen={() => onOpenSubview(section.id)}
            />
            {hasChildren && expanded && (
              <RailTreeBranch data-agent-section={section.id}>
                {section.id === 'ready-agents' ? (
                  <AgentLeafList
                    nodeKeyFor={(id) => railNodeKey('section', 'agents', 'section', section.id, 'item', id)}
                    rows={agents.map((agent) => ({ id: agent.id, label: agent.label }))}
                    empty="No ready agents yet."
                    activeId={activeSeed?.agentId ?? null}
                    onOpen={(id) => onOpenDetail('agents', { agentId: id })}
                  />
                ) : section.id === 'building-blocks' ? (
                  <>
                    <AgentMaterialBranch
                      nodeKey={railNodeKey('section', 'agents', 'section', section.id, 'material', 'prompts')}
                      id="prompts"
                      label="Prompts"
                      count={prompts.length}
                      active={activeSubview === 'prompts' && !activeSeed?.promptId}
                      expanded={
                        open.has('prompts') ||
                        forcedAncestors.has(railNodeKey('section', 'agents', 'section', section.id, 'material', 'prompts'))
                      }
                      onToggle={() => toggle('prompts')}
                      onOpen={() => onOpenSubview('prompts')}
                    >
                      <AgentLeafList
                        nodeKeyFor={(id) => railNodeKey('section', 'agents', 'section', section.id, 'material', 'prompts', 'item', id)}
                        rows={prompts.map((prompt) => ({ id: prompt.id, label: prompt.label }))}
                        empty="No prompts yet."
                        activeId={activeSeed?.promptId ?? null}
                        onOpen={(id) => onOpenDetail('agents', { promptId: id })}
                      />
                    </AgentMaterialBranch>
                    <AgentMaterialBranch
                      nodeKey={railNodeKey('section', 'agents', 'section', section.id, 'material', 'tools')}
                      id="tools"
                      label="Tools"
                      count={tools.length}
                      active={activeSubview === 'tools' && !activeSeed?.toolId}
                      expanded={
                        open.has('tools') ||
                        forcedAncestors.has(railNodeKey('section', 'agents', 'section', section.id, 'material', 'tools'))
                      }
                      onToggle={() => toggle('tools')}
                      onOpen={() => onOpenSubview('tools')}
                    >
                      <AgentLeafList
                        nodeKeyFor={(id) => railNodeKey('section', 'agents', 'section', section.id, 'material', 'tools', 'item', id)}
                        rows={tools.map((tool) => ({ id: tool.name, label: agentToolLabel(tool.name) }))}
                        empty="No tools available."
                        activeId={activeSeed?.toolId ?? null}
                        onOpen={(id) => onOpenDetail('agents', { toolId: id })}
                      />
                    </AgentMaterialBranch>
                  </>
                ) : section.id === 'coordination' ? (
                  section.children.map((child) => (
                    <SubNavRow
                      key={child.id}
                      nodeKey={railNodeKey('section', 'agents', 'section', section.id, 'subview', child.id)}
                      label={child.label}
                      kind="view"
                      active={activeSubview === child.id}
                      onClick={() => onOpenSubview(child.id)}
                    />
                  ))
                ) : null}
              </RailTreeBranch>
            )}
          </RailTreeNode>
        )
      })}
    </>
  )
}

function AgentStructureRow({
  label,
  count,
  active,
  expanded,
  hasChildren,
  onToggle,
  onOpen,
}: {
  label: string
  count?: number
  active: boolean
  expanded: boolean
  hasChildren: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  return (
    <div data-rail-node-row data-rail-entry-kind="group" className={sidebarEntryClass('group', active)}>
      {hasChildren
        ? <RailEntryLead label={label} expanded={expanded} onToggle={onToggle} />
        : <RailEntryLead />}
      <button data-rail-entry onClick={onOpen} aria-current={active ? 'page' : undefined} className="min-w-0 flex-1 truncate text-left">{label}</button>
      {count !== undefined && <span className="shrink-0 text-[10px] font-normal text-ink-faint">{count}</span>}
    </div>
  )
}

function AgentMaterialBranch({ nodeKey, id, label, count, active, expanded, onToggle, onOpen, children }: {
  nodeKey: string
  id: string
  label: string
  count: number
  active: boolean
  expanded: boolean
  onToggle: () => void
  onOpen: () => void
  children: ReactNode
}) {
  return (
    <RailTreeNode nodeKey={nodeKey}>
      <AgentStructureRow label={label} count={count} active={active} expanded={expanded} hasChildren={count > 0} onToggle={onToggle} onOpen={onOpen} />
      {count > 0 && expanded && <RailTreeBranch data-agent-material={id}>{children}</RailTreeBranch>}
    </RailTreeNode>
  )
}

function AgentLeafList({ rows, empty, activeId, onOpen, nodeKeyFor }: {
  rows: { id: string; label: string }[]
  empty: string
  activeId: string | null
  onOpen: (id: string) => void
  nodeKeyFor: (id: string) => string
}) {
  const [showAll, setShowAll] = useState(false)
  const rootPath = useRailRootPathKeys()
  if (rows.length === 0) return <NoRowsRow>{empty}</NoRowsRow>
  const visible = cappedWithActive(
    rows,
    showAll,
    (row) => row.id === activeId || rootPath.has(nodeKeyFor(row.id)),
  )
  const hidden = rows.length - visible.length
  return (
    <>
      {visible.map((row) => (
        <SubNavRow nodeKey={nodeKeyFor(row.id)} key={row.id} label={row.label} title={row.label} active={activeId === row.id} onClick={() => onOpen(row.id)} />
      ))}
      {(showAll || hidden > 0) && <ShowAllRow hidden={hidden} open={showAll} onToggle={() => setShowAll((value) => !value)} />}
    </>
  )
}

/** The empty state of an expanded section: the tree said "there are children
 *  here" and there are none, which is worth a word rather than a blank gap. */
export function NoRowsRow({ children }: { children: ReactNode }) {
  return (
    <p className={`${SIDEBAR_NESTED_ENTRY_LAYOUT} text-ink-faint`}>
      <RailEntryLead />
      <span>{children}</span>
    </p>
  )
}

export interface InstanceChildProps {
  /** The detail id the focused pane is currently showing in this section (null
   *  = its list) — which child wears the highlight. */
  activeId: string | null
  /** The full focused detail lets a composite child (work / change) carry the
   *  highlight, not just its parent id. */
  activeSeed?: PaneSeed | null
  /** Sessions live outside section grammar, but are still resource leaves. */
  activeSessionId?: string | null
  /** Open one row: the section, seeded with its detail id. */
  onOpenDetail: (section: SectionId, seed: PaneSeed) => void
  onOpenSession?: (sessionId: string) => void
}

/** The instance projection of a content section. Collection roots may preserve
 * an intermediate structural section before these canonical rows. */
export function SectionInstanceChildren({
  section,
  foldSignal,
  ...props
}: { section: SectionId; foldSignal?: RailFoldSignal | null } & InstanceChildProps) {
  if (!SECTION_INSTANCE_KEY[section]) return null
  switch (section) {
    case 'projects':
      return <ProjectChildren foldSignal={foldSignal} {...props} />
    case 'artifacts':
      return <ArtifactChildren foldSignal={foldSignal} {...props} />
    case 'contexts':
      return <ContextChildren foldSignal={foldSignal} {...props} />
    case 'models':
      return <ProviderChildren foldSignal={foldSignal} {...props} />
    case 'discussions':
      return <DiscussionChildren {...props} />
    default:
      return null
  }
}

/** The shared shape of every instance list: order by the section's filter, show
 *  the head, fold the tail into one row. Callers hand it rows already reduced
 *  to (id, label) so this stays free of every entity type. */
function InstanceRows({
  section,
  rows,
  empty,
  activeId,
  onOpenDetail,
}: {
  section: SectionId
  rows: { id: string; label: string }[]
  empty: string
} & InstanceChildProps) {
  const key = SECTION_INSTANCE_KEY[section]
  // Unfolded-ness is VIEW state, not a preference: it resets when the section
  // row folds (these children unmount while collapsed), the tree's own idiom.
  const [showAll, setShowAll] = useState(false)
  const rootPath = useRailRootPathKeys()
  if (rows.length === 0) return <NoRowsRow>{empty}</NoRowsRow>
  const head = cappedWithActive(
    rows,
    showAll,
    (row) => row.id === activeId || rootPath.has(railNodeKey('section', section, 'item', row.id)),
  )
  const hidden = rows.length - head.length
  return (
    <>
      {head.map((r) => (
        <SubNavRow
          key={r.id}
          nodeKey={railNodeKey('section', section, 'item', r.id)}
          label={r.label}
          title={r.label}
          active={activeId === r.id}
          onClick={() => onOpenDetail(section, key ? { [key]: r.id } : {})}
        />
      ))}
      {(showAll || hidden > 0) && (
        <ShowAllRow
          hidden={hidden}
          open={showAll}
          onToggle={() => setShowAll((v) => !v)}
        />
      )}
    </>
  )
}

function ProjectChildren({ foldSignal, ...props }: InstanceChildProps & { foldSignal?: RailFoldSignal | null }) {
  const [filter] = useSectionFilter('projects')
  const rel = useRelations()
  const myOrgIds = new Set((useMyOrgs().data ?? []).map((o) => o.tenant.id))
  const rows = listProjects(rel.allProjects(), filter, myOrgIds)
  const [showAll, setShowAll] = useState(false)
  const rootPath = useRailRootPathKeys()
  if (rows.length === 0) return <NoRowsRow>No projects here yet.</NoRowsRow>
  const head = cappedWithActive(
    rows,
    showAll,
    (project) =>
      project.id === props.activeSeed?.projectId ||
      rootPath.has(railNodeKey('section', 'projects', 'item', project.id)),
  )
  const hidden = rows.length - head.length
  return (
    <>
      {head.map((project) => <ProjectBranch key={project.id} project={project} foldSignal={foldSignal} {...props} />)}
      {(showAll || hidden > 0) && (
        <ShowAllRow
          hidden={hidden}
          open={showAll}
          onToggle={() => setShowAll((v) => !v)}
        />
      )}
    </>
  )
}

/** One composite project in the resource forest. The parent discloses its
 * addressable SECTIONS; each section then discloses the canonical resources it
 * contains. No descendant is flattened directly under the Project. */
function ProjectBranch({
  project,
  activeSeed,
  activeSessionId,
  onOpenDetail,
  onOpenSession,
  foldSignal,
}: { project: Project; foldSignal?: RailFoldSignal | null } & InstanceChildProps) {
  const branchActive = activeSeed?.projectId === project.id
  const nodeKey = railNodeKey('section', 'projects', 'item', project.id)
  const forcedOpen = useForcedRailAncestor(nodeKey)
  const rootActive =
    branchActive && !activeSeed?.projectSectionId && !activeSeed?.workItemId && !activeSeed?.contributionId
  const [expanded, setExpanded] = useState(branchActive)
  useEffect(() => {
    if (branchActive) setExpanded(true)
  }, [branchActive])
  useEffect(() => {
    if (foldSignal && railFoldAffects(foldSignal, nodeKey)) setExpanded(foldSignal.expanded)
  }, [foldSignal])
  const disclosed = expanded || forcedOpen
  return (
    <RailTreeNode nodeKey={nodeKey}>
      <div
        data-rail-node-row
        data-rail-entry-kind="item"
        className={sidebarEntryClass('item', rootActive)}
      >
        <RailEntryLead
          label={project.name}
          expanded={disclosed}
          onToggle={() => setExpanded((value) => !value)}
        />
        <button
          data-rail-entry
          onClick={() => onOpenDetail('projects', { projectId: project.id })}
          title={project.name}
          aria-current={rootActive ? 'page' : undefined}
          className="min-w-0 flex-1 truncate text-left"
        >
          {project.name}
        </button>
      </div>
      {disclosed && (
        <RailTreeBranch data-project-tree={project.id}>
          <ProjectResourceChildren
            project={project}
            activeSeed={activeSeed}
            activeSessionId={activeSessionId}
            onOpenDetail={onOpenDetail}
            onOpenSession={onOpenSession}
            foldSignal={foldSignal}
          />
        </RailTreeBranch>
      )}
    </RailTreeNode>
  )
}

type ProjectResourceRow = {
  key: string
  label: string
  kind: string
  active: boolean
  open: () => void
}

function ProjectResourceChildren({
  project,
  activeSeed,
  activeSessionId,
  onOpenDetail,
  onOpenSession,
  foldSignal,
}: {
  project: Project
  activeSeed?: PaneSeed | null
  activeSessionId?: string | null
  onOpenDetail: InstanceChildProps['onOpenDetail']
  onOpenSession?: InstanceChildProps['onOpenSession']
  foldSignal?: RailFoldSignal | null
}) {
  const rel = useRelations()
  const saved = useSavedContexts().data?.contexts ?? []
  const work = useOpenSubGoals(project.id).data ?? []
  const changes = useContributions(project.id).data ?? []
  const attention = useAttention(project.id).data
  const commissions = useCommissions(project.id).data ?? []
  const agents = useAgents().data ?? []
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const discussions = useDiscussions('project', project.id).data ?? []
  const artifacts = rel.artifactsForProject(project.id)
  const contexts = rel.contextsForProject(project.id)
    .map((ctx) => saved.find((item) => item.id === ctx.label || item.label === ctx.label))
    .filter((ctx): ctx is NonNullable<typeof ctx> => ctx !== undefined)
  const schedules = rel.schedulesForProject(project.id)
  const sessions = rel.sessionsForProject(project.id)
  const resources: Partial<Record<ProjectSectionId, ProjectResourceRow[]>> = {
    attention: (attention?.asks ?? []).map((ask) => ({
      key: `attention:${ask.contributionId}`,
      label: ask.title,
      kind: 'change',
      active: activeSeed?.projectId === project.id && activeSeed.contributionId === ask.contributionId,
      open: () => onOpenDetail('projects', {
        projectId: project.id,
        projectSectionId: 'attention',
        contributionId: ask.contributionId,
      }),
    })),
    contributors: commissions.flatMap((commission) => {
      const agent = agentsById.get(commission.agentId)
      return agent ? [{
        key: `agent:${agent.id}`,
        label: agent.label,
        kind: 'agent',
        active: activeSeed?.agentId === agent.id,
        open: () => onOpenDetail('agents', { agentId: agent.id }),
      }] : []
    }),
    'open-work': work.map((item) => ({
      key: `work:${item.id}`,
      label: item.subGoal,
      kind: 'work',
      active: activeSeed?.projectId === project.id && activeSeed.workItemId === item.id,
      open: () => onOpenDetail('projects', {
        projectId: project.id,
        projectSectionId: 'open-work',
        workItemId: item.id,
      }),
    })),
    artifacts: artifacts.map((artifact) => ({
      key: `artifact:${artifact.id}`,
      label: artifact.name,
      kind: 'artifact',
      active: activeSeed?.artifactId === artifact.id,
      open: () => onOpenDetail('artifacts', { artifactId: artifact.id }),
    })),
    context: contexts.map((ctx) => ({
      key: `context:${ctx.id}`,
      label: ctx.label,
      kind: 'context',
      active: activeSeed?.contextId === ctx.id,
      open: () => onOpenDetail('contexts', { contextId: ctx.id }),
    })),
    scheduled: schedules.map((schedule) => ({
      key: `schedule:${schedule.id}`,
      label: schedule.name,
      kind: 'schedule',
      active: activeSeed?.scheduleId === schedule.id,
      open: () => onOpenDetail('scheduled', { scheduleId: schedule.id }),
    })),
    changes: changes.map((change) => ({
      key: `change:${change.id}`,
      label: change.title,
      kind: 'change',
      active: activeSeed?.projectId === project.id && activeSeed.contributionId === change.id,
      open: () => onOpenDetail('projects', {
        projectId: project.id,
        projectSectionId: 'changes',
        contributionId: change.id,
      }),
    })),
    'recent-sessions': sessions.map((session) => ({
      key: `session:${session.id}`,
      label: session.title,
      kind: 'session',
      active: activeSessionId === session.id,
      open: () => onOpenSession?.(session.id),
    })),
    discussion: discussions.filter((discussion) => discussion.anchor.locus === undefined).map((discussion) => ({
      key: `discussion:${discussion.id}`,
      label: discussionTitle(discussion.posts[0]?.body, 60),
      kind: 'discussion',
      active: activeSeed?.discussionId === discussion.id,
      open: () => onOpenDetail('discussions', { discussionId: discussion.id }),
    })),
  }
  const sections = visibleCompositeSections(PROJECT_SECTIONS, project.own !== false)
  return (
    <>
      {sections.map((section) => (
        <ProjectSectionBranch
          key={section.id}
          projectId={project.id}
          section={section}
          rows={resources[section.id] ?? []}
          activeSeed={activeSeed}
          onOpenDetail={onOpenDetail}
          foldSignal={foldSignal}
        />
      ))}
    </>
  )
}

function ProjectSectionBranch({
  projectId,
  section,
  rows,
  activeSeed,
  onOpenDetail,
  foldSignal,
}: {
  projectId: string
  section: (typeof PROJECT_SECTIONS)[number]
  rows: ProjectResourceRow[]
  activeSeed?: PaneSeed | null
  onOpenDetail: InstanceChildProps['onOpenDetail']
  foldSignal?: RailFoldSignal | null
}) {
  const sectionActive =
    activeSeed?.projectId === projectId && activeSeed.projectSectionId === section.id
  const nodeKey = railNodeKey('section', 'projects', 'item', projectId, 'section', section.id)
  const forcedOpen = useForcedRailAncestor(nodeKey)
  const pageActive = sectionActive && !activeSeed?.workItemId && !activeSeed?.contributionId
  const [expanded, setExpanded] = useState(sectionActive)
  const [showAll, setShowAll] = useState(false)
  const rootPath = useRailRootPathKeys()
  useEffect(() => {
    if (sectionActive) setExpanded(true)
  }, [sectionActive])
  useEffect(() => {
    if (foldSignal && railFoldAffects(foldSignal, nodeKey)) setExpanded(foldSignal.expanded)
  }, [foldSignal])
  const hasResources = rows.length > 0
  const visible = cappedWithActive(
    rows,
    showAll,
    (row) =>
      row.active ||
      rootPath.has(railNodeKey('section', 'projects', 'item', projectId, 'section', section.id, 'item', row.key)),
  )
  const hidden = rows.length - visible.length
  const disclosed = expanded || forcedOpen
  return (
    <RailTreeNode nodeKey={nodeKey}>
      <div
        data-rail-node-row
        data-rail-entry-kind="group"
        className={sidebarEntryClass('group', pageActive)}
      >
        {hasResources
          ? <RailEntryLead
              label={section.label}
              expanded={disclosed}
              onToggle={() => setExpanded((value) => !value)}
            />
          : <RailEntryLead />}
        <button
          data-rail-entry
          onClick={() => onOpenDetail('projects', { projectId, projectSectionId: section.id })}
          aria-current={pageActive ? 'page' : undefined}
          className="min-w-0 flex-1 truncate text-left"
        >
          {section.label}
        </button>
        {hasResources && <span className="shrink-0 text-[10px] font-normal text-ink-faint">{rows.length}</span>}
      </div>
      {hasResources && disclosed && (
        <RailTreeBranch data-project-section-resources={section.id}>
          {visible.map((row) => (
            <SubNavRow
              key={row.key}
              nodeKey={railNodeKey('section', 'projects', 'item', projectId, 'section', section.id, 'item', row.key)}
              label={row.label}
              title={`${row.label} · ${row.kind}`}
              active={row.active}
              onClick={row.open}
            />
          ))}
          {(showAll || hidden > 0) && (
            <ShowAllRow
              hidden={hidden}
              open={showAll}
              onToggle={() => setShowAll((value) => !value)}
            />
          )}
        </RailTreeBranch>
      )}
    </RailTreeNode>
  )
}

type CollectionRailItem = { id: string; label: string; seed: PaneSeed }

/** Collection roots preserve the same intermediate section level their main
 * pages draw. The section row is itself a canonical page; its resources sit
 * one guide deeper and keep their existing canonical leaf pages. */
function CollectionSectionRows({
  section,
  groups,
  empty,
  activeId,
  activeSeed,
  onOpenDetail,
  foldSignal,
}: {
  section: SectionId
  groups: CollectionSection<CollectionRailItem>[]
  empty: string
  foldSignal?: RailFoldSignal | null
} & InstanceChildProps) {
  if (groups.length === 0) return <NoRowsRow>{empty}</NoRowsRow>
  return (
    <>
      {groups.map((group) => (
        <CollectionSectionBranch
          key={group.id}
          section={section}
          group={group}
          activeId={activeId}
          activeSeed={activeSeed}
          onOpenDetail={onOpenDetail}
          foldSignal={foldSignal}
        />
      ))}
    </>
  )
}

function CollectionSectionBranch({
  section,
  group,
  activeId,
  activeSeed,
  onOpenDetail,
  foldSignal,
}: {
  section: SectionId
  group: CollectionSection<CollectionRailItem>
  foldSignal?: RailFoldSignal | null
} & Pick<InstanceChildProps, 'activeId' | 'activeSeed' | 'onOpenDetail'>) {
  const sectionActive = activeSeed?.collectionSectionId === group.id
  const nodeKey = railNodeKey('section', section, 'collection', group.id)
  const forcedOpen = useForcedRailAncestor(nodeKey)
  const containsActiveLeaf = group.items.some((item) => item.id === activeId)
  const [expanded, setExpanded] = useState(sectionActive || containsActiveLeaf)
  const [showAll, setShowAll] = useState(false)
  const rootPath = useRailRootPathKeys()
  useEffect(() => {
    if (sectionActive || containsActiveLeaf) setExpanded(true)
  }, [sectionActive, containsActiveLeaf])
  useEffect(() => {
    if (foldSignal && railFoldAffects(foldSignal, nodeKey)) setExpanded(foldSignal.expanded)
  }, [foldSignal])
  const hasResources = group.items.length > 0
  const visible = cappedWithActive(
    group.items,
    showAll,
    (item) =>
      item.id === activeId ||
      rootPath.has(railNodeKey('section', section, 'collection', group.id, 'item', item.id)),
  )
  const hidden = group.items.length - visible.length
  const disclosed = expanded || forcedOpen
  return (
    <RailTreeNode nodeKey={nodeKey}>
      <div
        data-rail-node-row
        data-collection-section={group.id}
        data-rail-entry-kind="group"
        className={sidebarEntryClass('group', sectionActive)}
      >
        {hasResources
          ? <RailEntryLead
              label={group.label}
              expanded={disclosed}
              onToggle={() => setExpanded((value) => !value)}
            />
          : <RailEntryLead />}
        <button
          data-rail-entry
          onClick={() => onOpenDetail(section, { collectionSectionId: group.id })}
          aria-current={sectionActive ? 'page' : undefined}
          className="min-w-0 flex-1 truncate text-left"
        >
          {group.label}
        </button>
        {hasResources && <span className="shrink-0 text-[10px] font-normal text-ink-faint">{group.items.length}</span>}
      </div>
      {hasResources && disclosed && (
        <RailTreeBranch data-collection-section-resources={group.id}>
          {visible.map((item) => (
            <SubNavRow
              key={item.id}
              nodeKey={railNodeKey('section', section, 'collection', group.id, 'item', item.id)}
              label={item.label}
              title={item.label}
              active={activeId === item.id}
              onClick={() => onOpenDetail(section, item.seed)}
            />
          ))}
          {(showAll || hidden > 0) && (
            <ShowAllRow
              hidden={hidden}
              open={showAll}
              onToggle={() => setShowAll((value) => !value)}
            />
          )}
        </RailTreeBranch>
      )}
    </RailTreeNode>
  )
}

function ArtifactChildren({ foldSignal, ...props }: InstanceChildProps & { foldSignal?: RailFoldSignal | null }) {
  const [filter] = useSectionFilter('artifacts')
  const rel = useRelations()
  const rows = listArtifacts(rel.allArtifacts(), filter)
  const allGroups = artifactCollectionSections(rel.allArtifacts(), rel.allProjects(), rel.artifactProjectId)
  const groups = artifactCollectionSections(rows, rel.allProjects(), rel.artifactProjectId)
  const activeGroup = props.activeSeed?.collectionSectionId
    ? allGroups.find((group) => group.id === props.activeSeed?.collectionSectionId)
    : undefined
  // A standing facet may hide every leaf in the selected structural section.
  // Keep its section row mounted anyway: the main page preserves the same
  // empty selected section, and navigation structure must not disappear merely
  // because a filter currently leaves it with zero visible resources.
  const visibleGroups = activeGroup && !groups.some((group) => group.id === activeGroup.id)
    ? [...groups, { ...activeGroup, items: [] }]
    : groups
  return (
    <CollectionSectionRows
      section="artifacts"
      groups={visibleGroups.map((group) => ({
        ...group,
        items: group.items.map((artifact) => ({ id: artifact.id, label: artifact.name, seed: { artifactId: artifact.id } })),
      }))}
      empty="No artifacts here yet."
      foldSignal={foldSignal}
      {...props}
    />
  )
}

function ContextChildren({ foldSignal, ...props }: InstanceChildProps & { foldSignal?: RailFoldSignal | null }) {
  const [filter] = useSectionFilter('contexts')
  const rows = listContexts(useSavedContexts().data?.contexts ?? [], filter)
  const activeGroupId = props.activeSeed?.collectionSectionId
  const groups = [
    ...contextCollectionSections(rows).filter((group) => group.items.length > 0 || group.id === activeGroupId).map((group) => ({
      ...group,
      items: group.items.map((context) => ({ id: context.id, label: context.label, seed: { contextId: context.id } })),
    })),
    { ...ACCOUNT_MCP_SECTION, items: [] },
  ]
  return (
    <CollectionSectionRows
      section="contexts"
      groups={groups}
      empty="No contexts here yet."
      foldSignal={foldSignal}
      {...props}
    />
  )
}

function ProviderChildren({ foldSignal, ...props }: InstanceChildProps & { foldSignal?: RailFoldSignal | null }) {
  const [filter] = useSectionFilter('models')
  const rows = listProviders(useProviders().data ?? [], filter)
  const groups = modelCollectionSections(rows).map((group) => ({
    ...group,
    items: group.items.map((provider) => ({ id: provider.id, label: provider.label, seed: { providerId: provider.id } })),
  }))
  return (
    <CollectionSectionRows
      section="models"
      groups={groups}
      empty="No providers here yet."
      foldSignal={foldSignal}
      {...props}
    />
  )
}

function DiscussionChildren(props: InstanceChildProps) {
  const [filter] = useSectionFilter('discussions')
  const rows = listDiscussions(useMyDiscussions().data ?? [], filter)
  return (
    <InstanceRows
      section="discussions"
      // The thread's opening post IS its title — through the shared trimmer, so
      // the rail can't cut mid-word where the page doesn't (contract/social.ts).
      rows={rows.map((d) => ({ id: d.id, label: discussionTitle(d.posts[0]?.body, 60) }))}
      empty="No threads here yet."
      {...props}
    />
  )
}
