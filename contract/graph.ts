/** ── Contract: the relationship graph reducer ──────────────────────────────
 *  The relationship graph (RelationGraph) is the editable join-state between the
 *  five entities. This module is the single source of truth for how it's seeded
 *  and how a confirmed `RelationOp` changes it — used by BOTH the server (the
 *  canonical apply, which persists + broadcasts) and pure client projections /
 *  tests. The live client publishes only acknowledged edits. */
import type { RelationGraph } from './api.ts'
import type { ArtifactItem, Project, ProjectContext, ScheduledTask } from './cowork.ts'
import {
  artifactFromDraft,
  artifactMatchesSave,
  opKey,
  projectContextMatchesSelector,
  projectContextSelectorIsAmbiguous,
  type RelationOp,
} from './relations.ts'

function sameProjectContext(a: ProjectContext, b: ProjectContext): boolean {
  if (a.source?.kind === 'mcp' || b.source?.kind === 'mcp') {
    return a.source?.kind === 'mcp' && b.source?.kind === 'mcp' && a.source.id === b.source.id
  }
  return a.label === b.label
}

/** A graph with every slice empty. */
export function emptyGraph(): RelationGraph {
  return {
    revision: 0,
    sessionProject: {},
    artifactProject: {},
    scheduleProject: {},
    projectContexts: {},
    projectInstructions: {},
    projectDescriptions: {},
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
 *  `mintArtifactId` lets the server mint a stable id while pure callers inject
 *  deterministic ids.
 *  `now` (epoch ms) stamps the edit time of a freshly-saved artifact — injected,
 *  not read here, so the reducer stays pure; callers pass `Date.now()` and tests
 *  a fixed value (the default 0 is a deterministic sentinel for the ops that
 *  don't mint an artifact). */
export function applyGraphOp(
  graph: RelationGraph,
  op: RelationOp,
  mintArtifactId: () => string,
  now: number = 0,
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
        updatedAt: now,
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
      const source = op.sessionTitle ?? 'Created here'
      // Replay guard (the create-project pattern — keep the shared reducer safe for
      // ANY op producer): a second apply of the same save (two clients confirming
      // one pending card before the SSE invalidate lands, distinct request ids)
      // must not mint a duplicate. Match the immutable save origin and tenant,
      // as opAppliedInGraph does; an editable display name is not this identity.
      if (graph.extraArtifacts.some((a) => artifactMatchesSave(a, op))) return graph
      const id = mintArtifactId()
      const pid = op.projectId ?? ''
      // A user-created artifact (no session) cites a neutral source rather than a
      // conversation title; an AI save-out passes the real session title + id (the
      // id is the stable join the gallery's "From ‹conversation›" door resolves by).
      const item = artifactFromDraft(op.artifact, id, source, pid, now, op.sessionId, op.ownerTenantId)
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
      if (cur.some((candidate) => sameProjectContext(candidate, op.context))) return graph
      return {
        ...graph,
        projectContexts: { ...graph.projectContexts, [op.projectId]: [...cur, op.context] },
      }
    }
    case 'unscope-context': {
      // The inverse of scope-context. A source-qualified selector uses the stable
      // MCP identity; a legacy label selector is accepted only when unambiguous,
      // so a mutable display label can never remove the wrong same-label context.
      const cur = graph.projectContexts[op.projectId] ?? []
      if (projectContextSelectorIsAmbiguous(cur, op)) return graph
      if (!cur.some((c) => projectContextMatchesSelector(c, op))) return graph
      return {
        ...graph,
        projectContexts: {
          ...graph.projectContexts,
          [op.projectId]: cur.filter((c) => !projectContextMatchesSelector(c, op)),
        },
      }
    }
    case 'set-project-instructions':
      // Overlay the project's instructions (read with a fallback to the seed). An
      // empty string is a real value here — it clears the instructions back to none.
      return {
        ...graph,
        projectInstructions: { ...graph.projectInstructions, [op.projectId]: op.instructions },
      }
    case 'set-project-description':
      // The public "about" of a shared project (D26). Capped in the shared reducer
      // so both appliers agree on the bound; empty clears it.
      return {
        ...graph,
        projectDescriptions: { ...graph.projectDescriptions, [op.projectId]: op.description.slice(0, 10_000) },
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
    case 'share-project':
      // P8 — flip a created Project's shared flag (owner-only; enforced by the store's
      // opDeniedForTenant, which refuses a non-owner). A real graph edit (unlike the
      // store-executed commons ops below). Only created Projects live in extraProjects, so
      // this is a no-op for a seed id (seed Projects aren't shareable in this slice).
      // Sharing turns the Project into a COORDINATED shared resource (D11): it gains a
      // `guardianId` (= its own id, the seed convention) so cross-tenant Contributors
      // serialize on its sub-goals and the D11 guardian / D12 clamp tier can reach it (the
      // Phase-2 cooperation bridge). Kept on un-share so in-flight reservations aren't
      // orphaned mid-flight; re-sharing reuses the same namespace.
      return {
        ...graph,
        extraProjects: graph.extraProjects.map((p) =>
          p.id === op.projectId
            ? { ...p, shared: op.shared, guardianId: op.shared ? (p.guardianId ?? op.projectId) : p.guardianId }
            : p,
        ),
      }
    // Agent Commons CRUD (create-provider / -prompt / -agent, (un)commission-agent) are
    // registry mutations, not relationship-graph edits: the canonical write executes them
    // through the store's registry mutators (the D8 funnels), so — like attach-context —
    // they leave the graph unchanged here. (Listed explicitly to keep the switch
    // exhaustive; the optimistic client path therefore correctly does nothing for them.)
    case 'create-provider':
    case 'create-prompt':
    case 'create-agent':
    case 'commission-agent':
    case 'uncommission-agent':
    case 'handoff-agent': // a Session↔Agent re-bind (D16), executed by the store, not a graph edit
    case 'set-commission-cap': // a Project D13 cap set, executed by the store, not a graph edit
    case 'set-project-default-role': // a Project D14 picker pre-selection, executed by the store like the cap
      return graph
    default: {
      const _exhaustive: never = op
      return _exhaustive
    }
  }
}

/** Whether a one-off op's EFFECT is already present in the graph. The consent card
 *  derives its confirmed state from this, so a reopened thread doesn't re-offer an
 *  already-applied edit (the persisted message keeps its proposal forever; the
 *  GRAPH — not component state — is the record of what was applied, the same way
 *  standing ops read `standingApprovals`). Returns `undefined` for ops whose effect
 *  doesn't live in the graph (attach-context is a live-session effect; the Agent
 *  Commons CRUD ops execute in the store's registries; handoff / cap ride other
 *  stores; standing ops are covered by `standingApprovals`) — the card falls back
 *  to its in-memory state for those. */
export function opAppliedInGraph(graph: RelationGraph, op: RelationOp): boolean | undefined {
  switch (op.kind) {
    case 'file-session':
      return op.sessionId in graph.sessionProject && graph.sessionProject[op.sessionId] === op.projectId
    case 'create-project':
      // The project exists AND — when the op files a session — the filing holds.
      return (
        graph.extraProjects.some((p) => p.id === op.projectId) &&
        (!op.sessionId || graph.sessionProject[op.sessionId] === op.projectId)
      )
    case 'refile-artifact':
      return graph.artifactProject[op.artifactId] === (op.projectId ?? '')
    case 'save-artifact':
      // The minted id isn't on the op, so match the immutable save origin and
      // tenant stamped by artifactFromDraft, even after a display rename.
      // A save with a different citing source remains a distinct proposal.
      return graph.extraArtifacts.some((a) => artifactMatchesSave(a, op))
    case 'scope-context':
      return (graph.projectContexts[op.projectId] ?? []).some((c) => sameProjectContext(c, op.context))
    case 'unscope-context':
      // Applied ⇔ the selected context is absent. An ambiguous legacy label is
      // deliberately not applied: the server rejects it and the card must not
      // be treated as settled by a client that has not refreshed its graph.
      {
        const contexts = graph.projectContexts[op.projectId] ?? []
        return !projectContextSelectorIsAmbiguous(contexts, op) &&
          !contexts.some((c) => projectContextMatchesSelector(c, op))
      }
    case 'set-project-instructions':
      return graph.projectInstructions?.[op.projectId] === op.instructions
    case 'set-project-description':
      return graph.projectDescriptions?.[op.projectId] === op.description.slice(0, 10_000)
    case 'link-schedule-project':
      return op.scheduleId in graph.scheduleProject && graph.scheduleProject[op.scheduleId] === op.projectId
    case 'set-artifact-source':
      return graph.artifactSource[op.artifactId] === op.contextLabel
    case 'share-project': {
      // Derivable only for created projects (the slice this reducer flips); a seed
      // id's shared flag lives server-side, so the card keeps its local state.
      const p = graph.extraProjects.find((x) => x.id === op.projectId)
      return p ? (p.shared === true) === op.shared : undefined
    }
    case 'set-project-default-role': {
      // Same shape as share-project: the store mutates the created-project object the
      // graph slice carries, so a refetched graph answers; a seed id stays server-side.
      const p = graph.extraProjects.find((x) => x.id === op.projectId)
      return p ? p.defaultRole === op.role : undefined
    }
    case 'attach-context':
    case 'create-provider':
    case 'create-prompt':
    case 'create-agent':
    case 'commission-agent':
    case 'uncommission-agent':
    case 'handoff-agent':
    case 'set-commission-cap':
    case 'set-schedule-session':
    case 'set-schedule-artifact':
    case 'schedule-add-tool':
      return undefined
    default: {
      const _exhaustive: never = op
      return _exhaustive
    }
  }
}
