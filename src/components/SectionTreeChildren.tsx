/** ── The rail tree's kinds of child ─────────────────────────────────────────
 *  A rail child is a PLACE (src/lib/subviews.ts): a declared surface, one
 *  INSTANCE of the section's list, or a STANDING DOOR to a place whose
 *  canonical address is its own (`OwnerProfileChild`, below — the only one).
 *  This module renders the latter two. The instance kind is the
 *  top rows of the very list the section page shows, in the same order, sliced
 *  by `RAIL_INSTANCE_CAP` with a tail row that UNFOLDS the rest in place — plus
 *  the control that chooses that order: the section row's "Filter & sort" menu.
 *
 *  The rail and the page compute the list with ONE function per section
 *  (`src/lib/sectionLists.ts`) over ONE stored choice (`useSectionFilter`), so
 *  the eight names in the rail are always the first eight names on the page.
 *  That is the whole point of the arrangement — a rail that lists a *different*
 *  eight would be worse than one that lists none.
 *
 *  Each section's children mount only while its row is EXPANDED, so a rail
 *  that never opens Models never fetches providers. */
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  useAgents,
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
} from '../api'
import { useRelations } from '../controller/useRelations'
import { discussionTitle } from '../../contract/social.ts'
import type { Project, SectionId } from '../types'
import type { PaneSeed } from '../lib/paneNav'
import { SIDEBAR_HOVER } from '../lib/sidebar'
import { HOVER_REVEAL } from '../lib/hoverReveal'
import { RAIL_INSTANCE_CAP, SECTION_INSTANCE_KEY } from '../lib/subviews'
import { FilterMenu, type FilterRowSpec } from './FilterMenu'
import {
  ALL_FACET,
  SECTION_FILTERS,
  facetLabel,
  isSectionFilterActive,
  sortLabel,
} from '../lib/sectionFilter'
import { useSectionFilter } from '../lib/useSectionFilter'
import { listArtifacts, listContexts, listDiscussions, listProjects, listProviders } from '../lib/sectionLists'
import { SECTION_META } from '../lib/sections'
import {
  PROJECT_SECTIONS,
  visibleCompositeSections,
  type ProjectSectionId,
} from '../lib/compositeSections'

/** One child node under an expanded section — indented, with a leading dot echoing the
 *  Recents rows, so the two-level tree reads clearly. */
export function SubNavRow({
  label,
  title,
  kind,
  depth = 2,
  active,
  onClick,
}: {
  label: string
  /** The row's full text when the label truncates (an artifact name, a thread's
   *  opening post) — the rail is narrow and these are real entity names. */
  title?: string
  /** A direct child of a composite can be a different resource kind from its
   *  parent; name that kind without spending another group row. */
  kind?: string
  /** Section → instance is level 2; composite → section is level 3;
   * section → composing resource is level 4. */
  depth?: 2 | 3 | 4
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg py-1.5 pr-2 text-[13px] transition ${
        depth === 4 ? 'pl-[3.5rem]' : depth === 3 ? 'pl-11' : 'pl-7'
      } ${
        active ? 'bg-panel-2 font-medium text-ink' : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-accent' : 'border border-line-strong bg-transparent'}`}
      />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {kind && <span className="shrink-0 text-[10px] text-ink-faint">{kind}</span>}
    </button>
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
      label="Your profile"
      title={`Your public profile — everything ${tenantName} shares`}
      active={activeOwner === tenantName}
      onClick={() => onOpenOwner(tenantName)}
    />
  )
}

/** The tail row: what the cap left out, unfolded IN PLACE (owner directive,
 *  2026-07-31: "Show all" must reveal the remaining rows under the section, not
 *  jump to another page — the rail is a disclosure tree, and this is one more
 *  disclosure). Not a `SubNavRow` — it names a QUANTITY, not a place, so it
 *  deliberately doesn't wear the instance dot (UI-19). While unfolded it reads
 *  "Show fewer", so the fold back out is the same control. */
function ShowAllRow({ hidden, open, onToggle }: { hidden: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className={`flex w-full items-center rounded-lg py-1.5 pl-7 pr-2 text-left text-[12px] text-ink-faint transition ${SIDEBAR_HOVER} hover:text-ink-soft`}
    >
      {open ? 'Show fewer' : `Show all — ${hidden} more`}
    </button>
  )
}

/** The empty state of an expanded section: the tree said "there are children
 *  here" and there are none, which is worth a word rather than a blank gap. */
function NoRowsRow({ children }: { children: ReactNode }) {
  return <p className="py-1.5 pl-7 pr-2 text-[12px] text-ink-faint">{children}</p>
}

/** The section row's "Filter & sort" — the facet's ONE home (UI-19). Reveals on
 *  row hover like every other row affordance (UI-7), and PINS visible whenever
 *  the filter is doing something: a narrowed list whose control is invisible
 *  reads as a broken list. */
export function SectionFilterMenu({ section }: { section: SectionId }) {
  const spec = SECTION_FILTERS[section]
  const [filter, setFilter] = useSectionFilter(section)
  if (!spec) return null
  const active = isSectionFilterActive(section, filter)
  const rows: FilterRowSpec[] = [
    {
      key: 'facet',
      label: spec.facetLabel,
      value: facetLabel(section, filter.facet),
      accent: filter.facet !== ALL_FACET,
      width: 224,
      options: [
        ...spec.facets.map((f) => ({
          label: f.label,
          selected: filter.facet === f.id,
          onSelect: () => setFilter({ ...filter, facet: f.id }),
        })),
        {
          label: spec.allLabel,
          dividerBefore: true,
          selected: filter.facet === ALL_FACET,
          onSelect: () => setFilter({ ...filter, facet: ALL_FACET }),
        },
      ],
    },
    {
      key: 'sort',
      label: 'Sort by',
      value: sortLabel(section, filter.sortBy),
      accent: filter.sortBy !== spec.defaultSort,
      width: 184,
      dividerBefore: true,
      options: spec.sorts.map((s) => ({
        label: s.label,
        selected: filter.sortBy === s.id,
        onSelect: () => setFilter({ ...filter, sortBy: s.id }),
      })),
    },
  ]
  return (
    <span className={`${active ? '' : HOVER_REVEAL} has-[[data-open=true]]:opacity-100 focus-within:opacity-100`}>
      <FilterMenu ariaLabel={`Filter & sort ${SECTION_META[section].label.toLowerCase()}`} rows={rows} />
    </span>
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

/** The instance children of whichever content section this is. A section absent
 *  from `SECTION_INSTANCE_KEY` renders nothing (it has declared surfaces, or no
 *  children at all). */
export function SectionInstanceChildren({ section, ...props }: { section: SectionId } & InstanceChildProps) {
  if (!SECTION_INSTANCE_KEY[section]) return null
  switch (section) {
    case 'projects':
      return <ProjectChildren {...props} />
    case 'artifacts':
      return <ArtifactChildren {...props} />
    case 'contexts':
      return <ContextChildren {...props} />
    case 'models':
      return <ProviderChildren {...props} />
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
  if (rows.length === 0) return <NoRowsRow>{empty}</NoRowsRow>
  const head = showAll ? rows : rows.slice(0, RAIL_INSTANCE_CAP)
  return (
    <>
      {head.map((r) => (
        <SubNavRow
          key={r.id}
          label={r.label}
          title={r.label}
          active={activeId === r.id}
          onClick={() => onOpenDetail(section, key ? { [key]: r.id } : {})}
        />
      ))}
      {rows.length > RAIL_INSTANCE_CAP && (
        <ShowAllRow
          hidden={rows.length - RAIL_INSTANCE_CAP}
          open={showAll}
          onToggle={() => setShowAll((v) => !v)}
        />
      )}
    </>
  )
}

function ProjectChildren(props: InstanceChildProps) {
  const [filter] = useSectionFilter('projects')
  const rel = useRelations()
  const myOrgIds = new Set((useMyOrgs().data ?? []).map((o) => o.tenant.id))
  const rows = listProjects(rel.allProjects(), filter, myOrgIds)
  const [showAll, setShowAll] = useState(false)
  if (rows.length === 0) return <NoRowsRow>No projects here yet.</NoRowsRow>
  const head = showAll ? rows : rows.slice(0, RAIL_INSTANCE_CAP)
  return (
    <>
      {head.map((project) => <ProjectBranch key={project.id} project={project} {...props} />)}
      {rows.length > RAIL_INSTANCE_CAP && (
        <ShowAllRow
          hidden={rows.length - RAIL_INSTANCE_CAP}
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
}: { project: Project } & InstanceChildProps) {
  const branchActive = activeSeed?.projectId === project.id
  const rootActive =
    branchActive && !activeSeed?.projectSectionId && !activeSeed?.workItemId && !activeSeed?.contributionId
  const [expanded, setExpanded] = useState(branchActive)
  useEffect(() => {
    if (branchActive) setExpanded(true)
  }, [branchActive])
  return (
    <>
      <div
        className={`group flex w-full items-center gap-2 rounded-lg py-1.5 pl-5 pr-2 text-[13px] transition ${
          rootActive ? 'bg-panel-2 font-medium text-ink' : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
        }`}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}
          aria-expanded={expanded}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition ${SIDEBAR_HOVER} hover:text-ink`}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${rootActive ? 'bg-accent' : 'border border-line-strong bg-transparent'}`}
        />
        <button
          onClick={() => onOpenDetail('projects', { projectId: project.id })}
          title={project.name}
          aria-current={rootActive ? 'page' : undefined}
          className="min-w-0 flex-1 truncate text-left"
        >
          {project.name}
        </button>
      </div>
      {expanded && (
        <div data-project-tree={project.id}>
          <ProjectResourceChildren
            project={project}
            activeSeed={activeSeed}
            activeSessionId={activeSessionId}
            onOpenDetail={onOpenDetail}
            onOpenSession={onOpenSession}
          />
        </div>
      )}
    </>
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
}: {
  project: Project
  activeSeed?: PaneSeed | null
  activeSessionId?: string | null
  onOpenDetail: InstanceChildProps['onOpenDetail']
  onOpenSession?: InstanceChildProps['onOpenSession']
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
}: {
  projectId: string
  section: (typeof PROJECT_SECTIONS)[number]
  rows: ProjectResourceRow[]
  activeSeed?: PaneSeed | null
  onOpenDetail: InstanceChildProps['onOpenDetail']
}) {
  const sectionActive =
    activeSeed?.projectId === projectId && activeSeed.projectSectionId === section.id
  const pageActive = sectionActive && !activeSeed?.workItemId && !activeSeed?.contributionId
  const [expanded, setExpanded] = useState(sectionActive)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    if (sectionActive) setExpanded(true)
  }, [sectionActive])
  const hasResources = rows.length > 0
  const visible = showAll ? rows : rows.slice(0, RAIL_INSTANCE_CAP)
  return (
    <>
      <div
        className={`group flex w-full items-center gap-2 rounded-lg py-1.5 pl-8 pr-2 text-[13px] transition ${
          pageActive ? 'bg-panel-2 font-medium text-ink' : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
        }`}
      >
        {hasResources ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${section.label}`}
            aria-expanded={expanded}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition ${SIDEBAR_HOVER} hover:text-ink`}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" aria-hidden />
        )}
        <button
          onClick={() => onOpenDetail('projects', { projectId, projectSectionId: section.id })}
          aria-current={pageActive ? 'page' : undefined}
          className="min-w-0 flex-1 truncate text-left"
        >
          {section.label}
        </button>
      </div>
      {hasResources && expanded && (
        <>
          {visible.map((row) => (
            <SubNavRow
              key={row.key}
              label={row.label}
              title={`${row.label} · ${row.kind}`}
              kind={row.kind}
              depth={4}
              active={row.active}
              onClick={row.open}
            />
          ))}
          {rows.length > RAIL_INSTANCE_CAP && (
            <button
              onClick={() => setShowAll((value) => !value)}
              aria-expanded={showAll}
              className={`flex w-full items-center rounded-lg py-1.5 pl-[3.5rem] pr-2 text-left text-[12px] text-ink-faint transition ${SIDEBAR_HOVER} hover:text-ink-soft`}
            >
              {showAll ? 'Show fewer' : `Show all — ${rows.length - RAIL_INSTANCE_CAP} more`}
            </button>
          )}
        </>
      )}
    </>
  )
}

function ArtifactChildren(props: InstanceChildProps) {
  const [filter] = useSectionFilter('artifacts')
  const rel = useRelations()
  const rows = listArtifacts(rel.allArtifacts(), filter)
  return (
    <InstanceRows
      section="artifacts"
      rows={rows.map((a) => ({ id: a.id, label: a.name }))}
      empty="No artifacts here yet."
      {...props}
    />
  )
}

function ContextChildren(props: InstanceChildProps) {
  const [filter] = useSectionFilter('contexts')
  const rows = listContexts(useSavedContexts().data?.contexts ?? [], filter)
  return (
    <InstanceRows
      section="contexts"
      rows={rows.map((c) => ({ id: c.id, label: c.label }))}
      empty="No contexts here yet."
      {...props}
    />
  )
}

function ProviderChildren(props: InstanceChildProps) {
  const [filter] = useSectionFilter('models')
  const rows = listProviders(useProviders().data ?? [], filter)
  return (
    <InstanceRows
      section="models"
      rows={rows.map((p) => ({ id: p.id, label: p.label }))}
      empty="No providers here yet."
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
