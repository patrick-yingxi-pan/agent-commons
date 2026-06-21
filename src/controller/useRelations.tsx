import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Connector, SectionId, Session } from '../types'
import {
  ALL_ARTIFACTS,
  PROJECTS,
  SCHEDULED_TASKS,
  type ArtifactItem,
  type Project,
  type ProjectContext,
  type ScheduledTask,
  type StepTool,
} from '../data/cowork'
import { SESSIONS } from '../data/sessions'
import { artifactFromDraft, opKey, type RelationOp } from '../data/relations'
import { slug } from '../data/liveSession'

/** ── Controller: the relationship overlay ──────────────────────────────────
 *  Holds the *editable* graph between Session / Project / Artifact / Context /
 *  Schedule as a thin overlay on top of the static seed data, seeded from it so
 *  the views read the same thing they did before any edit. `applyOp` is the one
 *  place a confirmed relation edit lands; the section views read through the
 *  selectors, so a confirmed edit shows up wherever that relationship is drawn.
 *
 *  All in-memory — refresh resets, like the rest of the mock. */

interface Overlay {
  /** session id → project id (or null when explicitly unfiled). */
  sessionProject: Record<string, string | null>
  /** artifact id → project id (overrides the seed `projectId`). */
  artifactProject: Record<string, string>
  /** Artifacts saved out of a session by an AI proposal. */
  extraArtifacts: ArtifactItem[]
  /** schedule id → project id (or null when unlinked). */
  scheduleProject: Record<string, string | null>
  /** project id → its scoped contexts (seeded from `Project.contexts`). */
  projectContexts: Record<string, ProjectContext[]>
  /** artifact id → the context label it derives from. */
  artifactSource: Record<string, string>
  /** schedule id → the artifact name it now saves each run. */
  scheduleArtifact: Record<string, string>
  /** schedule id → a session label it now opens each run. */
  scheduleSession: Record<string, string>
  /** schedule id → extra tool-contexts it now uses each run. */
  scheduleExtraTools: Record<string, StepTool[]>
  /** opKey → true for recurring schedule effects approved once, in advance. */
  standingApprovals: Record<string, true>
}

function seed(): Overlay {
  const sessionProject: Record<string, string | null> = {}
  const projectContexts: Record<string, ProjectContext[]> = {}
  for (const p of PROJECTS) {
    for (const sid of p.sessionIds) sessionProject[sid] = p.id
    projectContexts[p.id] = [...p.contexts]
  }
  const artifactProject: Record<string, string> = {}
  for (const a of ALL_ARTIFACTS) artifactProject[a.id] = a.projectId
  const scheduleProject: Record<string, string | null> = {}
  for (const t of SCHEDULED_TASKS) if (t.projectId) scheduleProject[t.id] = t.projectId
  return {
    sessionProject,
    artifactProject,
    extraArtifacts: [],
    scheduleProject,
    projectContexts,
    artifactSource: {},
    scheduleArtifact: {},
    scheduleSession: {},
    scheduleExtraTools: {},
    standingApprovals: {},
  }
}

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
  const [ov, setOv] = useState<Overlay>(seed)
  const artSeq = useRef(0)

  const applyOp = useCallback(
    (op: RelationOp) => {
      switch (op.kind) {
        case 'file-session':
          setOv((o) => ({ ...o, sessionProject: { ...o.sessionProject, [op.sessionId]: op.projectId } }))
          break
        case 'refile-artifact':
          setOv((o) => ({ ...o, artifactProject: { ...o.artifactProject, [op.artifactId]: op.projectId } }))
          break
        case 'save-artifact': {
          const id = `art-live-${slug(op.artifact.name)}-${++artSeq.current}`
          const pid = op.projectId ?? ''
          const item = artifactFromDraft(op.artifact, id, op.sessionTitle, pid)
          setOv((o) => ({
            ...o,
            extraArtifacts: [item, ...o.extraArtifacts],
            artifactProject: pid ? { ...o.artifactProject, [id]: pid } : o.artifactProject,
          }))
          break
        }
        case 'attach-context':
          attachConnector?.({ id: op.connectorId, label: op.connectorLabel, kind: op.connectorKind })
          break
        case 'scope-context':
          setOv((o) => {
            const cur = o.projectContexts[op.projectId] ?? []
            if (cur.some((c) => c.label === op.context.label)) return o
            return { ...o, projectContexts: { ...o.projectContexts, [op.projectId]: [...cur, op.context] } }
          })
          break
        case 'link-schedule-project':
          setOv((o) => ({ ...o, scheduleProject: { ...o.scheduleProject, [op.scheduleId]: op.projectId } }))
          break
        case 'set-artifact-source':
          setOv((o) => ({ ...o, artifactSource: { ...o.artifactSource, [op.artifactId]: op.contextLabel } }))
          break
        case 'set-schedule-session':
          setOv((o) => ({
            ...o,
            scheduleSession: { ...o.scheduleSession, [op.scheduleId]: op.sessionLabel },
            standingApprovals: { ...o.standingApprovals, [opKey(op)]: true },
          }))
          break
        case 'set-schedule-artifact':
          setOv((o) => ({
            ...o,
            scheduleArtifact: { ...o.scheduleArtifact, [op.scheduleId]: op.artifactName },
            standingApprovals: { ...o.standingApprovals, [opKey(op)]: true },
          }))
          break
        case 'schedule-add-tool':
          setOv((o) => {
            const cur = o.scheduleExtraTools[op.scheduleId] ?? []
            const tools = cur.some((t) => t.id === op.tool.id) ? cur : [...cur, op.tool]
            return {
              ...o,
              scheduleExtraTools: { ...o.scheduleExtraTools, [op.scheduleId]: tools },
              standingApprovals: { ...o.standingApprovals, [opKey(op)]: true },
            }
          })
          break
        default: {
          const _exhaustive: never = op
          return _exhaustive
        }
      }
    },
    [attachConnector],
  )

  const value = useMemo<RelationsValue>(() => {
    const projectIdForSession = (sid: string) =>
      sid in ov.sessionProject ? ov.sessionProject[sid] : null
    const artifactProjectId = (a: ArtifactItem) => ov.artifactProject[a.id] ?? a.projectId
    const allArtifacts = () => [...ov.extraArtifacts, ...ALL_ARTIFACTS]
    const scheduleProjectId = (schedId: string) =>
      schedId in ov.scheduleProject ? ov.scheduleProject[schedId] : null

    return {
      applyOp,
      projectIdForSession,
      projectForSessionId: (sid) => {
        const pid = projectIdForSession(sid)
        return pid ? PROJECTS.find((p) => p.id === pid) : undefined
      },
      sessionsForProject: (pid) =>
        SESSIONS.filter((s) => projectIdForSession(s.id) === pid),
      artifactProjectId,
      allArtifacts,
      artifactsForProject: (pid) => allArtifacts().filter((a) => artifactProjectId(a) === pid),
      artifactSourceFor: (aid) => ov.artifactSource[aid],
      scheduleProjectId,
      schedulesForProject: (pid) => SCHEDULED_TASKS.filter((t) => scheduleProjectId(t.id) === pid),
      scheduleArtifactFor: (schedId) => ov.scheduleArtifact[schedId],
      scheduleSessionFor: (schedId) => ov.scheduleSession[schedId],
      scheduleExtraToolsFor: (schedId) => ov.scheduleExtraTools[schedId] ?? [],
      isStandingApproved: (key) => !!ov.standingApprovals[key],
      contextsForProject: (pid) => ov.projectContexts[pid] ?? [],
      navigate: (section, projectId) => navigate?.(section, projectId),
    }
  }, [ov, applyOp, navigate])

  return <RelationsContext.Provider value={value}>{children}</RelationsContext.Provider>
}

export function useRelations(): RelationsValue {
  const ctx = useContext(RelationsContext)
  if (!ctx) throw new Error('useRelations must be used within a RelationsProvider')
  return ctx
}
