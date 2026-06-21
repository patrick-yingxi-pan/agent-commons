/** Read hooks — the UI's window onto server-owned data. Each is a one-liner over
 *  the query cache, so a component swaps a `import { SESSIONS }` for a
 *  `useSessions()` and gains: a real fetch, a loading/error state, and live
 *  updates when the server pushes a change. Hooks grow per resource as reads
 *  migrate; Phase 1 covers capabilities + sessions. */
import { useQuery, type QueryState } from './cache.ts'
import { apiGet } from './client.ts'
import { keys, paths } from './keys.ts'
import type {
  ArtifactContentLibrary,
  ArtifactItem,
  Capabilities,
  Connector,
  ConnectorDetail,
  DispatchRun,
  Project,
  RelationGraph,
  SavedContextsSnapshot,
  ScheduledTask,
  ScheduleTemplate,
  Session,
} from '../../contract/index.ts'

/** What this backend can do — the UI gates native-only affordances on this,
 *  never on sniffing Electron vs web. */
export function useCapabilities(): QueryState<Capabilities> {
  return useQuery(keys.capabilities, () => apiGet<Capabilities>(paths.capabilities))
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
