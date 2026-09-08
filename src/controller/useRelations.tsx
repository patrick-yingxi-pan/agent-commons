import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  ArtifactItem,
  CreateProjectRequest,
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
import { artifactRegistryRows } from '../lib/artifactRegistry.ts'
import { OWNER_SECTION } from '../lib/paneNav'
import {
  useArtifacts,
  useProjects,
  useRelationGraph,
  useSchedules,
  useSessions,
} from '../api'
import {
  createRelationMutationController,
  IDLE_RELATION_MUTATION,
  type RelationMutationOutcome,
  type RelationMutationStatus,
  type ProjectCreationOutcome,
} from './relationMutationsCore.ts'
import { clearRelationMutationsOnAccountSwitch, relationMutationDeps } from './relationMutations.ts'

/** ── Controller: the relationship overlay ──────────────────────────────────
 *  The editable graph between Session / Project / Artifact / Context / Schedule
 *  now lives on the backend (GET /relations, POST /relations/ops). This provider
 *  reads the graph + the base entities through the API and exposes the same
 *  selectors the section views always used, so a confirmed edit shows up wherever
 *  that relationship is drawn — only now it's server-owned and survives a reload
 *  (and, via the event stream, syncs across clients).
 *
 *  `applyOp` enters one account-scoped FIFO. It projects only the authoritative
 *  acknowledgement, exposes failure/retry honestly, and prevents overlapping
 *  full-graph responses from rewinding the cache. `attach-context` remains a
 *  live-session effect handed to the session controller. */

// Stable empty fallbacks so the selectors' useMemo deps don't churn while loading.
const NO_PROJECTS: Project[] = []
const NO_ARTIFACTS: ArtifactItem[] = []
const NO_SCHEDULES: ScheduledTask[] = []
const NO_SESSIONS: Session[] = []
const EMPTY_GRAPH: RelationGraph = emptyGraph()

export interface RelationsValue {
  applyOp: (op: RelationOp) => Promise<RelationMutationOutcome>
  createProject: (input: CreateProjectRequest) => Promise<ProjectCreationOutcome>
  mutation: RelationMutationStatus
  retryMutation: () => void
  discardMutation: () => void
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
  /** The project's public ABOUT text (D26), BY ID — the ONE text describing what
   *  the project is.
   *
   *  It arrives by two routes: written into the project record at creation (the
   *  New project dialog's Description field) and edited afterwards through
   *  `set-project-description`, which lands in the graph as an overlay. That
   *  overlay is applied inside `allProjects()`, so **a caller holding a `Project`
   *  should read `project.description`** — this exists for the callers that hold
   *  only an id, which in practice is the consent card's content preview
   *  (`relationContentPreview` diffs the proposed body against the current one).
   *
   *  Before 2026-08-13 `description` and `readme` were two different FIELDS, and
   *  the project page showed both — the first as a sub-line under the title, the
   *  second as an empty "No README yet" a few rows below asking for the same
   *  thing. Nobody creating a project ever filled the second one. */
  descriptionForProject: (pid: string) => string | undefined
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
  const artifacts = useArtifacts().data ?? NO_ARTIFACTS
  const schedules = useSchedules().data ?? NO_SCHEDULES
  const sessions = useSessions().data ?? NO_SESSIONS
  const graph = useRelationGraph().data ?? EMPTY_GRAPH
  const [mutation, setMutation] = useState<RelationMutationStatus>(IDLE_RELATION_MUTATION)
  const mutationControllerRef = useRef<ReturnType<typeof createRelationMutationController> | null>(null)
  if (!mutationControllerRef.current) {
    mutationControllerRef.current = createRelationMutationController({
      ...relationMutationDeps,
      setStatus: setMutation,
    })
  }
  const mutationController = mutationControllerRef.current

  useEffect(
    () => clearRelationMutationsOnAccountSwitch(mutationController.clearAll),
    [mutationController],
  )

  const applyOp = useCallback(
    (op: RelationOp) => {
      // attach-context is a SESSION mutation, not a graph op: the consent card
      // attaches it to its OWN session (useSessionContextCommands — the
      // equal-panes model has no "active session" for a root bridge to guess).
      // Reaching here without one is a wiring error; never POST it as a graph op.
      if (op.kind === 'attach-context') return Promise.resolve('discarded' as const)
      return mutationController.enqueue(op)
    },
    [mutationController],
  )
  const createProject = useCallback(
    (input: CreateProjectRequest) => mutationController.enqueueProject(input),
    [mutationController],
  )

  const value = useMemo<ProvidedRelations>(() => {
    const projectIdForSession = (sid: string) =>
      sid in graph.sessionProject ? graph.sessionProject[sid] : null
    const artifactProjectId = (a: ArtifactItem) => graph.artifactProject[a.id] ?? a.projectId
    const allArtifacts = () => artifactRegistryRows(graph.extraArtifacts, artifacts)
    const scheduleProjectId = (schedId: string) =>
      schedId in graph.scheduleProject ? graph.scheduleProject[schedId] : null

    /** The merged project list with the description OVERLAY already applied.
     *
     *  Applied HERE, at the one merge point, rather than by each reader —
     *  because "one text about the project" (2026-08-13) is a claim about every
     *  surface that fronts a project, not just the one that edits it. The first
     *  cut resolved the overlay inside the About section alone, and the result
     *  was a merge that had moved the duplication rather than removed it: About
     *  showed the edit, the Projects hub row showed the text the project was
     *  created with, and hub SEARCH could not find the new words. A funnel every
     *  caller has to remember is not a funnel.
     *
     *  Untouched rows keep their identity (`.map` returns `p` itself unless
     *  there is an edit), and the whole pass is skipped when nothing has been
     *  edited — which is every session that has not used the editor. */
    const withDescriptions = (list: Project[]): Project[] => {
      const edits = graph.projectDescriptions
      if (!edits || Object.keys(edits).length === 0) return list
      return list.map((p) => (edits[p.id] === undefined ? p : { ...p, description: edits[p.id]! }))
    }
    const merged = () => withDescriptions([...graph.extraProjects, ...projects])

    return {
      applyOp,
      createProject,
      mutation,
      retryMutation: mutationController.retry,
      discardMutation: mutationController.discard,
      allProjects: merged,
      isCreatedProject: (pid) => graph.extraProjects.some((p) => p.id === pid),
      projectIdForSession,
      projectForSessionId: (sid) => {
        const pid = projectIdForSession(sid)
        // The SAME merged list allProjects() serves — a session filed into a
        // runtime-created project (graph.extraProjects) must resolve too, or the
        // thread's breadcrumb goes blank for exactly the projects Claude creates.
        return pid ? merged().find((p) => p.id === pid) : undefined
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
        graph.projectInstructions?.[pid] ?? merged().find((p) => p.id === pid)?.instructions,
      descriptionForProject: (pid) => merged().find((p) => p.id === pid)?.description,
      navigate: (section, id, subId) => navigate?.(section, id, subId),
    }
  }, [projects, artifacts, schedules, sessions, graph, applyOp, createProject, mutationController, mutation, navigate])

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
