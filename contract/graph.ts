/** ── Contract: the relationship graph reducer ──────────────────────────────
 *  The relationship graph (RelationGraph) is the editable join-state between the
 *  five entities. This module is the single source of truth for how it's seeded
 *  and how a confirmed `RelationOp` changes it — used by BOTH the server (the
 *  canonical apply, which persists + broadcasts) and the client (an optimistic
 *  apply, so a confirmed card feels instant). One reducer, two callers. */
import type { RelationGraph } from './api.ts'
import type { ArtifactItem, Project, ScheduledTask } from './cowork.ts'
import { artifactFromDraft, opKey, type RelationOp } from './relations.ts'

/** A graph with every slice empty. */
export function emptyGraph(): RelationGraph {
  return {
    sessionProject: {},
    artifactProject: {},
    scheduleProject: {},
    projectContexts: {},
    artifactSource: {},
    scheduleArtifact: {},
    scheduleSession: {},
    scheduleExtraTools: {},
    extraArtifacts: [],
    extraProjects: [],
    standingApprovals: {},
  }
}

/** Seed the graph from the base entities — the FK/join rows that live on them
 *  today (a project's sessions + contexts, an artifact's project, a schedule's
 *  project). The same derivation the client used from frozen consts, now from
 *  server-owned data. */
export function seedGraph(
  projects: Project[],
  artifacts: ArtifactItem[],
  schedules: ScheduledTask[],
): RelationGraph {
  const g = emptyGraph()
  for (const p of projects) {
    for (const sid of p.sessionIds) g.sessionProject[sid] = p.id
    g.projectContexts[p.id] = [...p.contexts]
  }
  for (const a of artifacts) g.artifactProject[a.id] = a.projectId
  for (const t of schedules) if (t.projectId) g.scheduleProject[t.id] = t.projectId
  return g
}

/** Apply a confirmed op to the graph, returning a NEW graph (immutable). The
 *  `attach-context` op isn't a graph edit (it attaches to the live session), so
 *  it leaves the graph unchanged here; the caller handles that side effect.
 *  `mintArtifactId` lets the server mint a stable id while the client uses a
 *  temporary one (replaced when the server's authoritative graph comes back). */
export function applyGraphOp(
  graph: RelationGraph,
  op: RelationOp,
  mintArtifactId: () => string,
): RelationGraph {
  switch (op.kind) {
    case 'file-session':
      return { ...graph, sessionProject: { ...graph.sessionProject, [op.sessionId]: op.projectId } }
    case 'create-project': {
      // File the session under the (new or already-created) project — when the op
      // carries one. A user creating a project from the Projects page passes no
      // session, so an empty project is minted. A replayed op finds the project
      // present, so it just (re)files rather than duplicating.
      const filed = op.sessionId
        ? { ...graph.sessionProject, [op.sessionId]: op.projectId }
        : graph.sessionProject
      // Re-file only, never mint a duplicate, when the project already exists.
      // "Exists" = a created project (extraProjects) OR a SEED project: the graph
      // carries no seed Project objects, but seedGraph records every seed project as
      // a projectContexts key, so that map is the reducer's view of seed ids. (The
      // New-project button's uniqueProjectId already avoids a collision; this keeps
      // the shared reducer safe for any other op producer — a seed-id collision
      // would otherwise mint a duplicate id visible through allProjects().)
      const exists =
        graph.extraProjects.some((p) => p.id === op.projectId) || op.projectId in graph.projectContexts
      if (exists) {
        return { ...graph, sessionProject: filed }
      }
      const project: Project = {
        id: op.projectId,
        name: op.projectName,
        description: op.projectDescription,
        updated: 'just now',
        instructions: '',
        scheduled: [],
        contexts: [],
        sessionIds: op.sessionId ? [op.sessionId] : [],
      }
      return { ...graph, extraProjects: [project, ...graph.extraProjects], sessionProject: filed }
    }
    case 'refile-artifact':
      // null = unfile: map to '' (an unknown project id), which the gallery groups
      // under "Unfiled" — distinct from an absent key, which falls back to the
      // artifact's own seed projectId.
      return { ...graph, artifactProject: { ...graph.artifactProject, [op.artifactId]: op.projectId ?? '' } }
    case 'save-artifact': {
      const id = mintArtifactId()
      const pid = op.projectId ?? ''
      // A user-created artifact (no session) cites a neutral source rather than a
      // conversation title; an AI save-out passes the real session title.
      const item = artifactFromDraft(op.artifact, id, op.sessionTitle ?? 'Created here', pid)
      return {
        ...graph,
        extraArtifacts: [item, ...graph.extraArtifacts],
        artifactProject: pid ? { ...graph.artifactProject, [id]: pid } : graph.artifactProject,
      }
    }
    case 'attach-context':
      return graph // a live-session effect, not a graph edit
    case 'scope-context': {
      const cur = graph.projectContexts[op.projectId] ?? []
      if (cur.some((c) => c.label === op.context.label)) return graph
      return {
        ...graph,
        projectContexts: { ...graph.projectContexts, [op.projectId]: [...cur, op.context] },
      }
    }
    case 'link-schedule-project':
      return { ...graph, scheduleProject: { ...graph.scheduleProject, [op.scheduleId]: op.projectId } }
    case 'set-artifact-source':
      return { ...graph, artifactSource: { ...graph.artifactSource, [op.artifactId]: op.contextLabel } }
    case 'set-schedule-session':
      return {
        ...graph,
        scheduleSession: { ...graph.scheduleSession, [op.scheduleId]: op.sessionLabel },
        standingApprovals: { ...graph.standingApprovals, [opKey(op)]: true },
      }
    case 'set-schedule-artifact':
      return {
        ...graph,
        scheduleArtifact: { ...graph.scheduleArtifact, [op.scheduleId]: op.artifactName },
        standingApprovals: { ...graph.standingApprovals, [opKey(op)]: true },
      }
    case 'schedule-add-tool': {
      const cur = graph.scheduleExtraTools[op.scheduleId] ?? []
      const tools = cur.some((t) => t.id === op.tool.id) ? cur : [...cur, op.tool]
      return {
        ...graph,
        scheduleExtraTools: { ...graph.scheduleExtraTools, [op.scheduleId]: tools },
        standingApprovals: { ...graph.standingApprovals, [opKey(op)]: true },
      }
    }
    default: {
      const _exhaustive: never = op
      return _exhaustive
    }
  }
}
