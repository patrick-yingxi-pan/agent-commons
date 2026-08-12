import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import type {
  ArtifactItem,
  Project,
  ProjectContext,
  RelationGraph,
  RelationOp,
  ScheduledTask,
  SectionId,
  Session,
  StepTool,
} from '../types'
import { emptyGraph, opAppliedInGraph } from '../../contract/index.ts'
import { OWNER_SECTION } from '../lib/paneNav'
import {
  applyRelationOp,
  useArtifacts,
  useProjects,
  useRelationGraph,
  useSchedules,
  useSessions,
} from '../api'

/** ── Controller: the relationship overlay ──────────────────────────────────
 *  The editable graph between Session / Project / Artifact / Context / Schedule
 *  now lives on the backend (GET /relations, POST /relations/ops). This provider
 *  reads the graph + the base entities through the API and exposes the same
 *  selectors the section views always used, so a confirmed edit shows up wherever
 *  that relationship is drawn — only now it's server-owned and survives a reload
 *  (and, via the event stream, syncs across clients).
 *
 *  `applyOp` patches the cached graph optimistically (the card flips instantly)
 *  and POSTs the canonical write; `attach-context` is a live-session effect, so
 *  it's handed to the session controller instead of the graph. */

// Stable empty fallbacks so the selectors' useMemo deps don't churn while loading.
const NO_PROJECTS: Project[] = []
const NO_ARTIFACTS: ArtifactItem[] = []
const NO_SCHEDULES: ScheduledTask[] = []
const NO_SESSIONS: Session[] = []
const EMPTY_GRAPH: RelationGraph = emptyGraph()

export interface RelationsValue {
  applyOp: (op: RelationOp) => void
  // ── Projects ──
  /** The seed projects plus any created by a confirmed proposal (graph extras). */
  allProjects: () => Project[]
  /** Whether a Project was CREATED at runtime (lives in the graph's extraProjects) rather than
   *  seeded — only created Projects are shareable across tenants (P8; the `share-project` op
   *  no-ops on a seed id), so the share control is offered only for these. */
  isCreatedProject: (pid: string) => boolean
  // ── Session ↔ Project ──
  projectIdForSession: (sid: string) => string | null
  projectForSessionId: (sid: string) => Project | undefined
  sessionsForProject: (pid: string) => Session[]
  // ── Artifacts ──
  artifactProjectId: (a: ArtifactItem) => string
  allArtifacts: () => ArtifactItem[]
  artifactsForProject: (pid: string) => ArtifactItem[]
  artifactSourceFor: (aid: string) => string | undefined
  // ── Schedules ──
  scheduleProjectId: (schedId: string) => string | null
  schedulesForProject: (pid: string) => ScheduledTask[]
  scheduleArtifactFor: (schedId: string) => string | undefined
  scheduleSessionFor: (schedId: string) => string | undefined
  scheduleExtraToolsFor: (schedId: string) => StepTool[]
  isStandingApproved: (key: string) => boolean
  /** Whether a one-off op's effect is already IN the graph (contract `opAppliedInGraph`)
   *  — the consent card's remount-proof confirmed state; undefined = not derivable
   *  (the card falls back to its in-memory state). */
  appliedInGraph: (op: RelationOp) => boolean | undefined
  // ── Project ↔ Context ──
  contextsForProject: (pid: string) => ProjectContext[]
  // ── Project instructions (the CURRENT value: edited overlay, else the seed —
  //    the same overlay-or-seed read the project page renders) ──
  instructionsForProject: (pid: string) => string | undefined
  /** The project's public README (D26) — served to every viewer of a shared project. */
  readmeForProject: (pid: string) => string | undefined
  // ── Nav bridge (the card's "View in …" deep-link). The id's meaning follows the
  //    section (a project / a schedule / an owner display name under the Commons);
  //    the optional subId narrows to a sub-entity page (today: a project's work item).
  navigate: (section: SectionId, id?: string, subId?: string) => void
  /** ── The OWNER door — a display name → that namespace's public profile (D21).
   *  Every byline, follower row, @-mention, credit line and roster entry in the
   *  app opens the same page, so they share ONE method instead of each spelling
   *  out `navigate('<section>', name)`: which section HOSTS a profile is one
   *  fact (OWNER_SECTION), and it moved once already. Composed in
   *  `useRelations()` from the same `navigate` a pane may have overridden, so an
   *  owner door stays pane-local exactly like every other door (ADAPT-17) —
   *  building it in the provider would have captured the ROOT bridge and quietly
   *  driven the primary pane from inside a split. Locked by
   *  `src/lib/owner-door.test.ts`. */
  openOwner: (name: string) => void
}

/** The PROVIDED half — everything but `openOwner`, which `useRelations()`
 *  composes below from the pane-scoped navigate. Typed as an omission rather
 *  than provided-and-overwritten, so the root-bridge version of the owner door
 *  cannot exist at all: a placeholder here would be dead code that silently
 *  drives the PRIMARY pane the day something reads the context directly. */
type ProvidedRelations = Omit<RelationsValue, 'openOwner'>

const RelationsContext = createContext<ProvidedRelations | null>(null)

/** Pane-scoped override of the nav bridge (universal split, ADAPT-17's
 *  pane-locality rule): a split pane hosting a section page provides its own
 *  `navigate` here, and every `useRelations()` consumer BELOW it — owner
 *  bylines, context rows, work-item links, "View in …" — lands in the pane
 *  instead of driving the primary. The data half of the relations value is
 *  untouched (one store); only the nav concern is pane-scoped. Default null =
 *  the root bridge (the primary controller) — the un-split app is unchanged. */
export const SectionNavOverride = createContext<RelationsValue['navigate'] | null>(null)

export function RelationsProvider({
  navigate,
  children,
}: {
  /** Opens a cross-cutting section, optionally a specific entity (and sub-entity). */
  navigate?: (section: SectionId, id?: string, subId?: string) => void
  children: ReactNode
}) {
  const projects = useProjects().data ?? NO_PROJECTS
  const baseArtifacts = useArtifacts().data ?? NO_ARTIFACTS
  const schedules = useSchedules().data ?? NO_SCHEDULES
  const sessions = useSessions().data ?? NO_SESSIONS
  const graph = useRelationGraph().data ?? EMPTY_GRAPH

  const applyOp = useCallback(
    (op: RelationOp) => {
      // attach-context is a SESSION mutation, not a graph op: the consent card
      // attaches it to its OWN session (useSessionContextCommands — the
      // equal-panes model has no "active session" for a root bridge to guess).
      // Reaching here without one is a wiring error; never POST it as a graph op.
      if (op.kind === 'attach-context') return
      // Optimistic + canonical; a failed POST leaves the optimistic patch, which
      // the next /relations fetch (or a server event) reconciles.
      void applyRelationOp(op)
    },
    [],
  )

  const value = useMemo<ProvidedRelations>(() => {
    const projectIdForSession = (sid: string) =>
      sid in graph.sessionProject ? graph.sessionProject[sid] : null
    const artifactProjectId = (a: ArtifactItem) => graph.artifactProject[a.id] ?? a.projectId
    const allArtifacts = () => [...graph.extraArtifacts, ...baseArtifacts]
    const scheduleProjectId = (schedId: string) =>
      schedId in graph.scheduleProject ? graph.scheduleProject[schedId] : null

    return {
      applyOp,
      allProjects: () => [...graph.extraProjects, ...projects],
      isCreatedProject: (pid) => graph.extraProjects.some((p) => p.id === pid),
      projectIdForSession,
      projectForSessionId: (sid) => {
        const pid = projectIdForSession(sid)
        // Search the SAME merged list allProjects() serves — a session filed into a
        // runtime-created project (graph.extraProjects) must resolve too, or the
        // thread's breadcrumb goes blank for exactly the projects Claude creates.
        return pid ? [...graph.extraProjects, ...projects].find((p) => p.id === pid) : undefined
      },
      sessionsForProject: (pid) => sessions.filter((s) => projectIdForSession(s.id) === pid),
      artifactProjectId,
      allArtifacts,
      artifactsForProject: (pid) => allArtifacts().filter((a) => artifactProjectId(a) === pid),
      artifactSourceFor: (aid) => graph.artifactSource[aid],
      scheduleProjectId,
      schedulesForProject: (pid) => schedules.filter((t) => scheduleProjectId(t.id) === pid),
      scheduleArtifactFor: (schedId) => graph.scheduleArtifact[schedId],
      scheduleSessionFor: (schedId) => graph.scheduleSession[schedId],
      scheduleExtraToolsFor: (schedId) => graph.scheduleExtraTools[schedId] ?? [],
      isStandingApproved: (key) => !!graph.standingApprovals[key],
      appliedInGraph: (op) => opAppliedInGraph(graph, op),
      contextsForProject: (pid) => graph.projectContexts[pid] ?? [],
      // Overlay-or-seed — the SAME current value the project page renders, so a
      // consent card previewing an instructions edit diffs against what the user
      // actually sees (an overlay-only read showed an edit as a blind create).
      instructionsForProject: (pid) =>
        graph.projectInstructions?.[pid] ??
        [...graph.extraProjects, ...projects].find((p) => p.id === pid)?.instructions,
      readmeForProject: (pid) => graph.projectReadmes?.[pid],
      navigate: (section, id, subId) => navigate?.(section, id, subId),
    }
  }, [projects, baseArtifacts, schedules, sessions, graph, applyOp, navigate])

  return <RelationsContext.Provider value={value}>{children}</RelationsContext.Provider>
}

export function useRelations(): RelationsValue {
  const ctx = useContext(RelationsContext)
  if (!ctx) throw new Error('useRelations must be used within a RelationsProvider')
  // Compose the nearest pane's nav override (see SectionNavOverride above): the
  // one funnel that makes EVERY entity door pane-local when pane-hosted, with
  // zero per-callsite wiring.
  const override = useContext(SectionNavOverride)
  return useMemo(() => {
    // One composed navigate, and `openOwner` built FROM it — so the owner door
    // is pane-local wherever the bylines are, without a per-callsite prop.
    const nav = override ?? ctx.navigate
    return { ...ctx, navigate: nav, openOwner: (name: string) => nav(OWNER_SECTION, name) }
  }, [ctx, override])
}
