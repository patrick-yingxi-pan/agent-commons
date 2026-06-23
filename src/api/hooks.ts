/** Read hooks — the UI's window onto server-owned data. Each is a one-liner over
 *  the query cache, so a component swaps a `import { SESSIONS }` for a
 *  `useSessions()` and gains: a real fetch, a loading/error state, and live
 *  updates when the server pushes a change. Hooks grow per resource as reads
 *  migrate; Phase 1 covers capabilities + sessions. */
import { useQuery, type QueryState } from './cache.ts'
import { apiGet } from './client.ts'
import { keys, paths } from './keys.ts'
import type {
  Agent,
  CapabilityEffect,
  ArtifactContentLibrary,
  ArtifactItem,
  Capabilities,
  Connector,
  ConnectorDetail,
  DispatchRun,
  Project,
  RecentsSnapshot,
  RelationGraph,
  RunSessionEntry,
  SavedContextsSnapshot,
  ScheduledTask,
  ScheduleTemplate,
  Session,
  UsageSnapshot,
} from '../../contract/index.ts'

/** What this backend can do — the UI gates native-only affordances on this,
 *  never on sniffing Electron vs web. */
export function useCapabilities(): QueryState<Capabilities> {
  return useQuery(keys.capabilities, () => apiGet<Capabilities>(paths.capabilities))
}

/** The live registry of native agents (one per connected host) + the
 *  capabilities each advertises. Updates as agents connect/disconnect/re-grant
 *  (the `agent.*` ambient events invalidate this). */
export function useAgents(): QueryState<Agent[]> {
  return useQuery(keys.agents, () => apiGet<Agent[]>(paths.agents))
}

/** An agent's authoritative effect log (the server's projection of it). Updates
 *  as effects project (`agent.effect` invalidates it). */
export function useAgentEffects(agentId: string): QueryState<CapabilityEffect[]> {
  return useQuery(keys.agentEffects(agentId), () =>
    apiGet<CapabilityEffect[]>(paths.agentEffects(agentId)),
  )
}

/** The session list (lightweight rows) for the sidebar + search. */
export function useSessions(): QueryState<Session[]> {
  return useQuery(keys.sessions, () => apiGet<Session[]>(paths.sessions))
}

/** A full session by id (messages / artifacts / repo included). */
export function useSession(id: string): QueryState<Session> {
  return useQuery(keys.session(id), () => apiGet<Session>(paths.session(id)))
}

/** The Dispatch section's agent-run feed. */
export function useDispatchRuns(): QueryState<DispatchRun[]> {
  return useQuery(keys.dispatch, () => apiGet<DispatchRun[]>(paths.dispatch))
}

/** The set-up contexts (Contexts page) + which connector/MCP ids are connected. */
export function useSavedContexts(): QueryState<SavedContextsSnapshot> {
  return useQuery(keys.savedContexts, () => apiGet<SavedContextsSnapshot>(paths.savedContexts))
}

/** The sidebar detail for one connector / MCP server (keyed by its id). */
export function useConnectorDetail(connector: Connector): QueryState<ConnectorDetail> {
  return useQuery(keys.connectorDetail(connector.id), () =>
    apiGet<ConnectorDetail>(paths.connectorDetail(connector)),
  )
}

/** The composer's usage snapshot (context window + plan limit windows). */
export function useUsage(): QueryState<UsageSnapshot> {
  return useQuery(keys.usage, () => apiGet<UsageSnapshot>(paths.usage))
}

/** The artifact-body library, keyed by file name. */
export function useArtifactContent(): QueryState<ArtifactContentLibrary> {
  return useQuery(keys.artifactContent, () => apiGet<ArtifactContentLibrary>(paths.artifactContent))
}

/** The "New schedule" starter templates. */
export function useScheduleTemplates(): QueryState<ScheduleTemplate[]> {
  return useQuery(keys.scheduleTemplates, () => apiGet<ScheduleTemplate[]>(paths.scheduleTemplates))
}

/** The projects list. */
export function useProjects(): QueryState<Project[]> {
  return useQuery(keys.projects, () => apiGet<Project[]>(paths.projects))
}

/** The base artifacts (the relation graph carries any saved-out extras). */
export function useArtifacts(): QueryState<ArtifactItem[]> {
  return useQuery(keys.artifacts, () => apiGet<ArtifactItem[]>(paths.artifacts))
}

/** The scheduled routines. */
export function useSchedules(): QueryState<ScheduledTask[]> {
  return useQuery(keys.schedules, () => apiGet<ScheduledTask[]>(paths.schedules))
}

/** The relationship graph (seed + applied edits). */
export function useRelationGraph(): QueryState<RelationGraph> {
  return useQuery(keys.relations, () => apiGet<RelationGraph>(paths.relations))
}

/** The left rail's recent-runs feed (a single live source; updates on run events). */
export function useRecentRuns(): QueryState<RunSessionEntry[]> {
  return useQuery(keys.recentRuns, () => apiGet<RunSessionEntry[]>(paths.recentRuns))
}

/** The per-user recents snapshot (one MRU id list per context type). */
export function useRecents(): QueryState<RecentsSnapshot> {
  return useQuery(keys.recents, () => apiGet<RecentsSnapshot>(paths.recents))
}
