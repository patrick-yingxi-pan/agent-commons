/** Read hooks — the UI's window onto server-owned data. Each is a one-liner over
 *  the query cache, so a component swaps a `import { SESSIONS }` for a
 *  `useSessions()` and gains: a real fetch, a loading/error state, and live
 *  updates when the server pushes a change. Hooks grow per resource as reads
 *  migrate; Phase 1 covers capabilities + sessions. */
import { useQuery, type QueryState } from './cache.ts'
import { apiGet } from './client.ts'
import { keys, paths } from './keys.ts'
import type {
  Runner,
  CapabilityEffect,
  ArtifactContentLibrary,
  ArtifactItem,
  Capabilities,
  Connector,
  ConnectorDetail,
  DispatchRun,
  ModelProvider,
  Project,
  RecentsSnapshot,
  RelationGraph,
  ResourceStatus,
  RunSessionEntry,
  SavedContextsSnapshot,
  ScheduledTask,
  ScheduleTemplate,
  Session,
  SessionContext,
  UsageSnapshot,
} from '../../contract/index.ts'

/** What this backend can do — advertised so the UI needn't sniff Electron vs web.
 *  The native-only affordance gate is enforced server-side (those endpoints 409 on
 *  a remote backend); a component may also read these flags to pre-hide one. */
export function useCapabilities(): QueryState<Capabilities> {
  return useQuery(keys.capabilities, () => apiGet<Capabilities>(paths.capabilities))
}

/** The live registry of native runners (one per connected host) + the
 *  capabilities each advertises. Updates as runners connect/disconnect/re-grant
 *  (the `runner.*` ambient events invalidate this). */
export function useRunners(): QueryState<Runner[]> {
  return useQuery(keys.runners, () => apiGet<Runner[]>(paths.runners))
}

/** The registered Model providers (docs/agent-commons.md, D9) — the cognition
 *  sources an Agent binds. Account-scoped, referenceable by id; one seeded for now. */
export function useProviders(): QueryState<ModelProvider[]> {
  return useQuery(keys.providers, () => apiGet<ModelProvider[]>(paths.providers))
}

/** A runner's authoritative effect log (the server's projection of it). Updates
 *  as effects project (`runner.effect` invalidates it). */
export function useRunnerEffects(runnerId: string): QueryState<CapabilityEffect[]> {
  return useQuery(keys.runnerEffects(runnerId), () =>
    apiGet<CapabilityEffect[]>(paths.runnerEffects(runnerId)),
  )
}

/** A shared resource's guardian state — its capacity and the reservations
 *  currently active (D5). Updates on `reservation.changed`. */
export function useResourceStatus(key: string): QueryState<ResourceStatus> {
  return useQuery(keys.resourceStatus(key), () => apiGet<ResourceStatus>(paths.resource(key)))
}

/** The session list (lightweight rows) for the sidebar + search. */
export function useSessions(): QueryState<Session[]> {
  return useQuery(keys.sessions, () => apiGet<Session[]>(paths.sessions))
}

/** A full session by id (messages / artifacts / repo included). */
export function useSession(id: string): QueryState<Session> {
  return useQuery(keys.session(id), () => apiGet<Session>(paths.session(id)))
}

/** The contexts attached to a session — the attachment of record every effect
 *  routed through this session is mediated against. Updates on
 *  `session.contexts.changed`. */
export function useSessionContexts(id: string): QueryState<SessionContext[]> {
  return useQuery(keys.sessionContexts(id), () =>
    apiGet<SessionContext[]>(paths.sessionContexts(id)),
  )
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

/** The composer's usage snapshot (context window + plan limit windows). Keyed to
 *  the open session so the context-window figure reflects that thread; the plan
 *  windows are account-global but ride along in the same snapshot. */
export function useUsage(sessionId?: string): QueryState<UsageSnapshot> {
  return useQuery(keys.usage(sessionId), () => apiGet<UsageSnapshot>(paths.usage(sessionId)))
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
