/** Read hooks — the UI's window onto server-owned data. Each is a one-liner over
 *  the query cache, so a component swaps a `import { SESSIONS }` for a
 *  `useSessions()` and gains: a real fetch, a loading/error state, and live
 *  updates when the server pushes a change. Hooks grow per resource as reads
 *  migrate; Phase 1 covers capabilities + sessions. */
import { useQuery, resetAll, invalidate, peek, type QueryState } from './cache.ts'
import { API_BASE, apiGet, apiPost, apiUrl } from './client.ts'
import { keys, paths } from './keys.ts'
import { switchAccount, refreshAccount, accountGeneration, type Account } from './account.ts'
import type { AuthAccount, Tenant as TenantT, TenantRole as TenantRoleT } from '../../contract/index.ts'
import type {
  Runner,
  Agent,
  AgentDirectoryEntry,
  AuditEntry,
  Authority,
  Commission,
  AgentChangeProposal,
  AgentResolvedItem,
  AppNotification,
  OpenSubGoal,
  OwnerProfile,
  ProjectDirectoryEntry,
  SearchResponse,
  WatchState,
  CapabilityEffect,
  ArtifactContentLibrary,
  ArtifactItem,
  Capabilities,
  Connector,
  ConnectorDetail,
  DispatchRun,
  Identity,
  FsCatalog,
  FsFileContent,
  FsFolderContents,
  FsSource,
  ModelProvider,
  ProjectSubGoal,
  SystemPromptEntry,
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

/** Who's signed in + which tenant (design F2 / P1 §4). The UI labels the account chip
 *  with this; the server stays the authorization gate. On the desktop/mock backend it's
 *  the single local user ("You" · Personal); on the web it's the IdP principal + org. */
export function useMe(): QueryState<Identity> {
  return useQuery(keys.me, () => apiGet<Identity>(paths.me))
}

/** Switch the active account AND reset the world (multi-account §6.1; P6:
 *  verified). Ordering is the whole design:
 *    1. Mint the session server-side (`POST /v1/auth/session`) — the HttpOnly
 *       cookie lands BEFORE any client state moves, so everything that reopens
 *       next already rides the new identity. A raw fetch, deliberately outside
 *       client.ts's wrapper: the transition request is definitionally
 *       cross-identity, and the wrapper's echo tripwire would (correctly!)
 *       flag its response.
 *    2. Record the pick (`switchAccount`) — generation bump; events.ts reopens
 *       its stream on the new cookie.
 *    3. `resetAll` — every cached read refetches as the new account.
 *  A failed mint changes nothing (no partial switch); a same-account pick is a
 *  no-op. Passing null signs out (DELETE — back to the backend default). */
/** The signed-in account's workspaces (P7) — the chip menu's real switch
 *  targets, distinct from the seeded dev directory (`useIdentities`). */
export function useMyWorkspaces(enabled = true): QueryState<Array<{ tenant: TenantT; role: TenantRoleT }>> {
  return useQuery(keys.meWorkspaces, () => apiGet<Array<{ tenant: TenantT; role: TenantRoleT }>>(paths.meWorkspaces), enabled)
}

/** The accounts signed in on THIS browser (multi-account §12) — the switcher's
 *  instant-hop rows and the auth screen's "Choose an account" picker,
 *  GitHub-style. Server-resolved from the signed account-stack cookie; empty
 *  until a real sign-in / sign-up happens here (seed/dev picks don't count). */
export function useAuthAccounts(enabled = true): QueryState<AuthAccount[]> {
  return useQuery(keys.authAccounts, () => apiGet<AuthAccount[]>(paths.authAccounts), enabled)
}

/** Onboarding (P7): both endpoints mint the session cookie server-side; on
 *  success the caller ADOPTS it — same choreography tail as a switch (the mint
 *  already happened, so only the client half runs: generation bump → stream
 *  re-bind → cache reset). Raw fetches, deliberately outside client.ts's
 *  wrapper: an auth transition is definitionally cross-identity and the
 *  wrapper's echo tripwire would (correctly) flag its response. Failures
 *  surface as the server's message (a 409 duplicate email, a 401 bad
 *  credential) for the form to show. */
async function authFlow(path: string, body: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => undefined)
  if (!res.ok) return { ok: false, message: json?.error?.message ?? `Failed (${res.status})` }
  adoptMintedSession({ userId: json.user.id, tenantId: json.tenant.id })
  return { ok: true }
}

export const signUp = (name: string, email: string, password: string) =>
  authFlow(paths.authSignup, { name, email, password })
export const signIn = (email: string, password: string) => authFlow(paths.authLogin, { email, password })

/** Create an org workspace under the signed-in account and switch into it. */
export async function createWorkspace(name: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const tenant = await apiPost<TenantT>(paths.workspaces, { name })
    invalidate(keys.meWorkspaces)
    const me = peek<Identity>(keys.me)
    await switchActiveAccount({ userId: me?.user.id ?? '', tenantId: tenant.id })
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Failed to create workspace' }
  }
}

/** The client half of a switch whose session the SERVER already minted (a
 *  signup/login response set the cookie): record the pick and reset the world. */
export function adoptMintedSession(next: Account): void {
  switchAccount(next)
  resetAll()
}

/** True while a switch's mint round-trip is in flight — a second pick is
 *  ignored rather than raced: interleaved `Set-Cookie` responses could land in
 *  either order, leaving the cookie and the client's belief disagreeing (the
 *  echo tripwire would catch it loudly, but not starting the race is better). */
let switching = false

export function switchActiveAccount(next: Account | null): Promise<boolean> {
  return guardedSwitch(next)
}

/** Instant hop to an account REMEMBERED on this browser (§12): POST the bare
 *  userId — the server validates it against the signed stack cookie and lands
 *  it on its last-active workspace. No credential re-entry (GitHub-style); the
 *  stack cookie is the proof it already signed in here. */
export function switchToAccount(userId: string): Promise<boolean> {
  return guardedSwitch({ userId })
}

/** Sign the ACTIVE account out (its stack entry is forgotten server-side; the
 *  other remembered accounts stay). `all` forgets every remembered account. */
export function signOut(all = false): Promise<boolean> {
  return guardedSwitch(null, all ? '?all=1' : '')
}

async function guardedSwitch(body: { userId?: string; tenantId?: string } | null, query = ''): Promise<boolean> {
  if (switching) return false
  switching = true
  try {
    return await performSwitch(body, query)
  } finally {
    switching = false
  }
}

async function performSwitch(body: { userId?: string; tenantId?: string } | null, query: string): Promise<boolean> {
  const before = accountGeneration()
  // The account the switch LANDED on — for a POST, read from the response's
  // resolved Identity (server truth: a bare stack pick doesn't even know its
  // landing tenant until the server answers); null for a sign-out.
  let landed: Account | null = null
  try {
    const res = await fetch(`${API_BASE}${paths.authSession}${query}`, {
      method: body ? 'POST' : 'DELETE',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok && res.status !== 204) throw new Error(`auth/session ${res.status}`)
    if (body) {
      const me = (await res.json()) as Identity
      landed = { userId: me.user.id, tenantId: me.tenant.id }
    }
  } catch (err) {
    console.error('[account] switch failed — staying on the current account:', err)
    return false
  }
  if (accountGeneration() !== before) return false // a concurrent switch won the race
  // The SERVER session changed (a mint or a sign-out landed) — always refresh,
  // bypassing switchAccount's same-account no-op: after a page reload the
  // in-memory pick is null while the cookie carries the identity, so a
  // sign-out (null → null) would otherwise never reset the world. The UI's
  // active-row guard is what prevents pointless same-account mints.
  refreshAccount(landed)
  resetAll()
  return true
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

/** The system-prompt library (docs/agent-commons.md, D10) — reusable, target-family-
 *  tagged prompts a user picks for an Agent. The picker checks each entry's family
 *  against the chosen provider's via the shared `promptFitWarning`. */
export function useSystemPrompts(): QueryState<SystemPromptEntry[]> {
  return useQuery(keys.systemPrompts, () => apiGet<SystemPromptEntry[]>(paths.systemPrompts))
}

/** The user-created worker Agents (docs/agent-commons.md, D6) — one seeded for now.
 *  Powers the commission picker + resolves a Contributor's agent label. */
export function useAgents(): QueryState<Agent[]> {
  return useQuery(keys.workerAgents, () => apiGet<Agent[]>(paths.agents))
}

/** The Agent tool CATALOG — the names an explicit tool grant can spell out. An omitted
 *  grant is the EMPTY set (INV-9 minimal risk), so the dialog's "full catalog" grant
 *  reads this live list rather than hard-coding a mirror of the server's tools. */
export function useAgentToolCatalog(): QueryState<{ tools: string[] }> {
  return useQuery(keys.agentTools, () => apiGet<{ tools: string[] }>(paths.agentTools))
}

/** A Project's Contributors — the commissions assigning Agents onto it
 *  (docs/agent-commons.md, D7/D13). Keyed per project. */
export function useCommissions(projectId?: string): QueryState<Commission[]> {
  return useQuery(keys.commissions(projectId), () => apiGet<Commission[]>(paths.commissions(projectId)))
}

/** A commission's effective, Project-clamped authority (docs/agent-commons.md, D12) —
 *  what the Contributor actually reaches on its Project, never the owner's ambient set.
 *  Derived server-side; the Contributor row shows it. */
export function useCommissionAuthority(id: string): QueryState<Authority> {
  return useQuery(keys.commissionAuthority(id), () => apiGet<Authority>(paths.commissionAuthority(id)))
}

/** A Project's in-flight sub-goal reservations (docs/agent-commons.md, D11) — who's
 *  handling what. The Coordination panel's read. */
export function useProjectSubGoals(projectId: string): QueryState<ProjectSubGoal[]> {
  return useQuery(keys.projectSubGoals(projectId), () =>
    apiGet<ProjectSubGoal[]>(paths.projectSubGoals(projectId)),
  )
}

/** A Project's open-work backlog (docs/agent-commons.md, D19) — posted items awaiting a
 *  taker plus the resolved credit lines. Refreshed live on `openwork.changed`. */
export function useOpenSubGoals(projectId: string): QueryState<OpenSubGoal[]> {
  return useQuery(keys.openSubGoals(projectId), () => apiGet<OpenSubGoal[]>(paths.openSubGoals(projectId)))
}

/** The shared-Project discovery directory (docs/agent-commons.md, D17) — every Project
 *  any tenant made public, redacted to its public face + public aggregates. Revalidates
 *  on mount (SWR, the profile/search rationale): the list composes OTHER tenants' share
 *  acts, which no event delivered to this tenant covers. */
export function useProjectDirectory(q?: string): QueryState<ProjectDirectoryEntry[]> {
  return useQuery(keys.directoryProjects(q), () => apiGet<ProjectDirectoryEntry[]>(paths.directoryProjects(q)), true, true)
}

/** The published-Agent discovery directory (D17/D18) — each entry a forkable DEFINITION
 *  plus its public track record; capability never rides an entry. Revalidates on mount
 *  (SWR): publish/unpublish is another tenant's private relation act. */
export function useAgentDirectory(q?: string): QueryState<AgentDirectoryEntry[]> {
  return useQuery(keys.directoryAgents(q), () => apiGet<AgentDirectoryEntry[]>(paths.directoryAgents(q)), true, true)
}

/** A published definition's review queue (D25): the owner sees every proposal, a
 *  proposer their own. `enabled: false` holds the fetch until a dialog opens. */
export function useAgentProposals(agentId: string, enabled = true): QueryState<AgentChangeProposal[]> {
  return useQuery(keys.agentProposals(agentId), () => apiGet<AgentChangeProposal[]>(paths.agentProposals(agentId)), enabled)
}

/** A published definition's resolved-work track record (D13/S10) — the concrete,
 *  P8-redacted acts behind its contribution count. `enabled: false` holds the fetch
 *  until the detail dialog opens; revalidates when it does (SWR — `openwork.changed`
 *  refreshes a LIVE view, but a dialog opened later must not serve a frozen first
 *  fetch next to a count that moved). */
export function useAgentResolvedWork(agentId: string, enabled = true): QueryState<AgentResolvedItem[]> {
  return useQuery(keys.agentResolvedWork(agentId), () => apiGet<AgentResolvedItem[]>(paths.agentResolvedWork(agentId)), enabled, true)
}

/** The caller's notification inbox (D24), newest first — refreshed live by the
 *  tenant-targeted `notification.changed` event. */
export function useNotifications(): QueryState<AppNotification[]> {
  return useQuery(keys.notifications, () => apiGet<AppNotification[]>(paths.notifications))
}

/** The caller's watch state for one Project (D24). */
export function useWatchState(projectId: string): QueryState<WatchState> {
  return useQuery(keys.projectWatch(projectId), () => apiGet<WatchState>(paths.projectWatch(projectId)))
}

/** A workspace's public face (docs/agent-commons.md, D21): its shared Projects,
 *  published Agents, public stats, and recent public acts — keyed by display name,
 *  the same public identity the directories expose. 404 (surfaced as `error`) for a
 *  name with no public rows. */
export function useOwnerProfile(name: string): QueryState<OwnerProfile> {
  // Revalidate on mount: the profile composes many other reads (D21), so no
  // per-entity invalidation covers it — SWR keeps it honest without flicker.
  return useQuery(keys.ownerProfile(name), () => apiGet<OwnerProfile>(paths.ownerProfile(name)), true, true)
}

/** Global search (D22): typed grouped hits across everything the caller can see —
 *  private workspace + the commons. Keyed per query; empty query answers no groups. */
export function useGlobalSearch(q: string): QueryState<SearchResponse> {
  // Revalidate on mount (SWR): search composes EVERY read (D22) — a cached answer
  // from before an entity changed would otherwise be served forever.
  return useQuery(keys.search(q), () => apiGet<SearchResponse>(paths.search(q)), true, true)
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

/** The server-known filesystem sources for the picker's source switcher — the web
 *  backend's cloud storage plus any fs-capable runner (contract/fs.ts). The client
 *  prepends its own `ui-host` source. */
export function useFsSources(): QueryState<FsSource[]> {
  return useQuery(keys.fsSources, () => apiGet<FsSource[]>(paths.fsSources))
}

/** A served source's top-level catalog (files / photos / folders). `enabled` is
 *  false for the client-side `ui-host` source (read in the browser, not here). */
export function useFsCatalog(source: string, enabled = true): QueryState<FsCatalog> {
  return useQuery(keys.fsCatalog(source), () => apiGet<FsCatalog>(paths.fsCatalog(source)), enabled)
}

/** The artifacts inside a served folder (the workspace view of an attached folder). */
export function useFsFolder(source: string, path: string, enabled = true): QueryState<FsFolderContents> {
  return useQuery(keys.fsFolder(source, path), () => apiGet<FsFolderContents>(paths.fsFolder(source, path)), enabled)
}

/** A served file's textual content (the editable preview). */
export function useFsText(source: string, path: string, enabled = true): QueryState<FsFileContent> {
  return useQuery(keys.fsText(source, path), () => apiGet<FsFileContent>(paths.fsText(source, path)), enabled)
}

/** Absolute URL for a served file's raw bytes (an image), to use as an `<img src>`. */
export function fsContentUrl(source: string, path: string): string {
  return apiUrl(paths.fsContent(source, path))
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

/** The per-user recents snapshot (one MRU id list per context type). */
export function useRecents(): QueryState<RecentsSnapshot> {
  return useQuery(keys.recents, () => apiGet<RecentsSnapshot>(paths.recents))
}

/** The detective audit trail (docs/agent-commons.md, D15/OQ7) — cross-user effects,
 *  newest first; refreshed live on the `audit.entry` event. */
export function useAuditLog(): QueryState<AuditEntry[]> {
  return useQuery(keys.auditLog, () => apiGet<AuditEntry[]>(paths.audit))
}
