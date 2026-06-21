import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import type {
  ArtifactItem,
  Connector,
  Project,
  ProjectContext,
  RelationGraph,
  RelationOp,
  ScheduledTask,
  SectionId,
  Session,
  StepTool,
} from '../types'
import { emptyGraph } from '../../contract/index.ts'
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
  // ── Project ↔ Context ──
  contextsForProject: (pid: string) => ProjectContext[]
  // ── Nav bridge (the card's "View in …" deep-link) ──
  navigate: (section: SectionId, projectId?: string) => void
}

const RelationsContext = createContext<RelationsValue | null>(null)

export function RelationsProvider({
  attachConnector,
  navigate,
  children,
}: {
  /** Attaches a connector to the live session (wired to the session controller). */
  attachConnector?: (c: Connector) => void
  /** Opens a cross-cutting section, optionally a specific project. */
  navigate?: (section: SectionId, projectId?: string) => void
  children: ReactNode
}) {
  const projects = useProjects().data ?? NO_PROJECTS
  const baseArtifacts = useArtifacts().data ?? NO_ARTIFACTS
  const schedules = useSchedules().data ?? NO_SCHEDULES
  const sessions = useSessions().data ?? NO_SESSIONS
  const graph = useRelationGraph().data ?? EMPTY_GRAPH

  const applyOp = useCallback(
    (op: RelationOp) => {
      if (op.kind === 'attach-context') {
        attachConnector?.({ id: op.connectorId, label: op.connectorLabel, kind: op.connectorKind })
        return
      }
      // Optimistic + canonical; a failed POST leaves the optimistic patch, which
      // the next /relations fetch (or a server event) reconciles.
      void applyRelationOp(op)
    },
    [attachConnector],
  )

  const value = useMemo<RelationsValue>(() => {
    const projectIdForSession = (sid: string) =>
      sid in graph.sessionProject ? graph.sessionProject[sid] : null
    const artifactProjectId = (a: ArtifactItem) => graph.artifactProject[a.id] ?? a.projectId
    const allArtifacts = () => [...graph.extraArtifacts, ...baseArtifacts]
    const scheduleProjectId = (schedId: string) =>
      schedId in graph.scheduleProject ? graph.scheduleProject[schedId] : null

    return {
      applyOp,
      projectIdForSession,
      projectForSessionId: (sid) => {
        const pid = projectIdForSession(sid)
        return pid ? projects.find((p) => p.id === pid) : undefined
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
      contextsForProject: (pid) => graph.projectContexts[pid] ?? [],
      navigate: (section, projectId) => navigate?.(section, projectId),
    }
  }, [projects, baseArtifacts, schedules, sessions, graph, applyOp, navigate])

  return <RelationsContext.Provider value={value}>{children}</RelationsContext.Provider>
}

export function useRelations(): RelationsValue {
  const ctx = useContext(RelationsContext)
  if (!ctx) throw new Error('useRelations must be used within a RelationsProvider')
  return ctx
}
