/** ── The mock backend's state + event bus ──────────────────────────────────
 *  In-memory working state, seeded from server/data, plus a tiny pub/sub the SSE
 *  channels subscribe to. In the real product this is a database + the Anthropic
 *  API; here it's plain objects the routes read and mutate.
 *
 *  When the real server runs, the UI-owned state is also durable: it's snapshotted
 *  to the filesystem on every mutation and rehydrated on boot (server/persist.ts),
 *  so a sent message / attached context / created session survives a restart. The
 *  seed is the *baseline*, written out on first boot; a later boot loads the
 *  snapshot. Tests leave persistence off and run purely in-memory. (Transient
 *  state — reservations, the live runner registry — is deliberately not persisted.)
 *
 *  State is added to this store as each resource's reads/commands migrate; Phase 1
 *  carries sessions + the event bus, the spine everything else hangs off. */
import type {
  Artifact,
  ArtifactContentLibrary,
  ArtifactItem,
  Capabilities,
  Connector,
  ConnectorDetail,
  ContextStatus,
  ContextTypeId,
  DiffLine,
  DispatchRun,
  Message,
  Project,
  RecentsSnapshot,
  RelationGraph,
  RelationOp,
  RunSessionEntry,
  SavedContext,
  SavedContextsSnapshot,
  ScheduledRun,
  ScheduledTask,
  ScheduleTemplate,
  ServerEvent,
  Session,
  SessionContext,
  SessionWorkspace,
  UpdateScheduleRequest,
  UsageSnapshot,
} from '../contract/index.ts'
import {
  applyGraphOp,
  emptyGraph,
  entryById,
  recentEntries,
  runSessionId,
  seedGraph,
} from '../contract/index.ts'
import { SESSIONS, DEMO_SESSION_ID } from './data/sessions.ts'
import { DISPATCH_RUNS, SCHEDULE_TEMPLATES, PROJECTS, ALL_ARTIFACTS, SCHEDULED_TASKS } from './data/cowork.ts'
import {
  DEFAULT_RECENT_IDS,
  FOLDER_OPTIONS,
  GITHUB_REPO_OPTIONS,
  LOCAL_REPO_OPTIONS,
} from './data/contextOptions.ts'
import { SAVED_CONTEXTS, CONNECTED_CONNECTOR_IDS, CONNECTED_MCP_IDS } from './data/savedContexts.ts'
import { connectorDetail } from './data/connectorDetails.ts'
import { ARTIFACT_CONTENT } from './data/artifactContent.ts'
import { createUsageMeter, estimateTokens, mintBudget } from './usage.ts'
import { mintAuthority } from './authority.ts'
import { ConflictError } from './conflict.ts'
import { scopeMatches } from './runner-runtime.ts'
import { contextBreakdown, intersectAuthority, authorityAdmits, projectAdmittedAuthority, unrestricted, isProjectEffectMonotonic, rolePermits, clampAuthority, clampBudget } from '../contract/index.ts'
import type { Agent, Authority, Budget, CapabilityType, Commission, CreateAgentRequest, ModelProvider, ProjectAction, ProjectEffectResult, ProjectEffectType, ProjectRole, ProjectSubGoal, ProxyRequest, ProxyResult, Reservation, SystemPromptEntry, UpdateAgentRequest, UpdateCommissionRequest } from '../contract/index.ts'
import { DEFAULT_PROVIDER, DEFAULT_PROVIDER_CONFIG, type ProviderConfig } from './data/providers.ts'
import { SYSTEM_PROMPTS, SP_DEFAULT_ID, DEFAULT_SYSTEM_PROMPT_BODY } from './data/prompts.ts'
import { SEED_COMMISSIONS } from './data/commissions.ts'
import { TOOL_DEFINITIONS } from './model/tools.ts'
import { systemPrompt } from './generate.ts'
import { RunnerRegistry } from './registry.ts'
import { RunnerJournal } from './journal.ts'
import { ResourceGuardian, GuardianError } from './guardian.ts'
import { LOCAL_RUNNER_SEED } from './data/runners.ts'
import { DEFAULT_AGENT } from './data/workers.ts'
import { EMPTY_WORKSPACE, workspaceFromSeed } from './workspace.ts'
import { STORE_VERSION, loadState, saveState, type PersistedState } from './persist.ts'

type Listener = (e: ServerEvent) => void

/** A monotonic-ish boot id. Math.random/Date are fine here (server side, not in
 *  the resumable-workflow sandbox); a fresh value each boot signals a reseed. */
const EPOCH = `e${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

// Which backend variant this process is: the default mock behaves like a NATIVE
// sidecar (it can touch the OS); `BACKEND=remote` makes it behave like a remote
// web server (native ops report unavailable). Same API, two fulfilments — this is
// how the one UI runs in both scenarios without env-sniffing (it reads the flags).
const BACKEND_MODE: 'mock' | 'remote' = process.env.BACKEND === 'remote' ? 'remote' : 'mock'
const NATIVE = BACKEND_MODE !== 'remote'

const listeners = new Set<Listener>()

// The canonical relationship graph — seeded from the entities' join fields, then
// mutated by confirmed ops (the one place a relation edit lands server-side).
let graph: RelationGraph = seedGraph(PROJECTS, ALL_ARTIFACTS, SCHEDULED_TASKS)
let artifactSeq = 0
const mintArtifactId = () => `art-live-${++artifactSeq}`

// A mutable copy of the schedules — runs are appended here (by run-now and the
// daemon), toggles flip `enabled`, so the runs feed is a single live source
// rather than a frozen snapshot.
const schedules: ScheduledTask[] = JSON.parse(JSON.stringify(SCHEDULED_TASKS))
let runSeq = 0
let scheduleSeq = 0

// A mutable copy of the dispatch feed — "New dispatch" prepends a one-off run that
// finishes a beat later. Transient (a one-off agent run), so it's NOT persisted —
// like the live runner registry, it rebuilds from seed on restart.
const dispatch: DispatchRun[] = JSON.parse(JSON.stringify(DISPATCH_RUNS))
let dispatchSeq = 0
// Monotonic counters for server-minted session + message ids. The conversation is
// now server-owned (a sent turn persists; a draft materializes into a real session
// on first send), so the backend mints these — the client no longer fabricates them.
let sessionSeq = 0
let messageSeq = 0

// The plan-usage meter (5-hour / weekly windows). Accumulates the model's real
// token usage from every turn (store.recordUsage); the context-window figure is
// computed per session in store.usage. Not persisted — usage windows are a live,
// rolling meter, reseeded on restart (mock semantics).
const usageMeter = createUsageMeter(() => Date.now())
// The real token weight of the resource-manipulation tool schema the backend
// declares on every request (server/model/tools.ts) — injected eagerly, so it's a
// loaded context category, not a deferred one. Static, so computed once.
const SYSTEM_TOOLS_TOKENS = estimateTokens(JSON.stringify(TOOL_DEFINITIONS))

// The seeded worker Agents (docs/agent-commons.md, D6) — one for now, the
// degenerate N=1 case. Every Conversation resolves to it until users create more.
const WORKER_AGENTS = new Map<string, Agent>([[DEFAULT_AGENT.id, DEFAULT_AGENT]])
const resolveAgent = (id?: string): Agent => WORKER_AGENTS.get(id ?? '') ?? DEFAULT_AGENT
let workerAgentSeq = 0

// The registered Model providers (docs/agent-commons.md, D9) — the cognition source
// each Agent binds. One seeded for now (the degenerate N=1 case), wrapping the single
// implicit Anthropic client. The contract `ModelProvider` is paired with its
// server-only `ProviderConfig` (credentials / concrete model id) by id — the config
// never leaves the server, mirroring how `Capabilities` hides the key.
const MODEL_PROVIDERS = new Map<string, ModelProvider>([[DEFAULT_PROVIDER.id, DEFAULT_PROVIDER]])
const PROVIDER_CONFIGS = new Map<string, ProviderConfig>([[DEFAULT_PROVIDER.id, DEFAULT_PROVIDER_CONFIG]])
const resolveProvider = (id?: string): ModelProvider => MODEL_PROVIDERS.get(id ?? '') ?? DEFAULT_PROVIDER
let providerSeq = 0

// The system-prompt library (docs/agent-commons.md, D10) — reusable, target-family-
// tagged prompts a user picks for an Agent. Seeded; the (prompt × provider) fit check
// is the pure `promptFitWarning` (contract), surfaced in the picker at selection.
const SYSTEM_PROMPT_LIB = new Map<string, SystemPromptEntry>(SYSTEM_PROMPTS.map((p) => [p.id, p]))
let systemPromptSeq = 0

// Commissions (docs/agent-commons.md, D7/D13) — the agent→Project assignments, the
// leaf of the D8 cascade. Keyed by id; `listCommissions(projectId)` gives a Project's
// Contributors. Persisted to disk like the agent/provider registries (see persist.ts).
const COMMISSIONS = new Map<string, Commission>(SEED_COMMISSIONS.map((c) => [c.id, c]))
let commissionSeq = 0

// Resolve a sub-goal holder (D11) to a human label: a Contributor identity is a
// commission id → its Agent's label; any other principal shows verbatim.
function holderLabel(holder: string): string {
  const commission = COMMISSIONS.get(holder)
  if (!commission) return holder
  return WORKER_AGENTS.get(commission.agentId)?.label ?? holder
}

// The holder's project role (D14), when the holder is a Contributor (a commission) — the
// standing surfaced on a sub-goal. An unset role reads as the 'writer' default; a
// non-commission principal has none (undefined).
function holderRole(holder: string): ProjectRole | undefined {
  const commission = COMMISSIONS.get(holder)
  return commission ? commission.role ?? 'writer' : undefined
}

// Runtime half of D8 (parent-shrink propagation): after a parent narrows, re-clamp the
// already-minted children so an over-grant can't outlive the shrink. Idempotent — a child
// already within its parent is untouched; a child that *inherits* (unset grant) follows the
// parent down on its own and needs no clamp.
function reclampCommissionsOf(agent: Agent): void {
  const provider = resolveProvider(agent.providerId)
  const parentAuthority = agent.authority ?? provider.authority ?? {}
  const parentWindows = agent.budget?.windows ?? provider.plan?.windows ?? usageMeter.planCeilings()
  for (const c of COMMISSIONS.values()) {
    if (c.agentId !== agent.id) continue
    const authority = c.authority ? clampAuthority(c.authority, parentAuthority) : c.authority
    const grant = c.grant ? clampBudget(c.grant, parentWindows) : c.grant
    COMMISSIONS.set(c.id, { ...c, authority, grant })
  }
}
function reclampAgentsOf(provider: ModelProvider): void {
  const parentWindows = provider.plan?.windows ?? usageMeter.planCeilings()
  for (const a of WORKER_AGENTS.values()) {
    if (a.providerId !== provider.id) continue
    const authority = a.authority ? clampAuthority(a.authority, provider.authority ?? {}) : a.authority
    const budget = a.budget ? clampBudget(a.budget, parentWindows) : a.budget
    const next: Agent = { ...a, authority, budget }
    WORKER_AGENTS.set(a.id, next)
    reclampCommissionsOf(next) // transitively re-clamp this agent's Contributors
  }
}

// Per-user recents — one non-evicting MRU id list per context type. Connectors /
// MCP seed from the connected accounts (their quick list shows every set-up
// element); the file-like types from the catalog defaults. Server-owned so it's
// per-user and syncs across devices (the audit flagged it as domain, not UI).
const CONTEXT_TYPES: ContextTypeId[] = ['files', 'photos', 'folder', 'repo', 'connector', 'mcp']
let recents: RecentsSnapshot = (() => {
  const out = {} as RecentsSnapshot
  for (const t of CONTEXT_TYPES) {
    out[t] =
      t === 'connector'
        ? [...CONNECTED_CONNECTOR_IDS]
        : t === 'mcp'
          ? [...CONNECTED_MCP_IDS]
          : [...DEFAULT_RECENT_IDS[t]]
  }
  return out
})()

// Per-user set-up contexts (the Contexts page) — connectors / MCP servers / repos
// and their auth status. A mutable copy of the seed so a connect / disconnect — the
// seam a real OAuth callback or token-expiry would use — is a live server mutation
// that broadcasts `connector.status` and reconciles every client. Persisted to disk
// (see persist.ts). The "Connected" quick lists derive from the *current* status.
const savedCtxs: SavedContext[] = JSON.parse(JSON.stringify(SAVED_CONTEXTS))
const connectedIds = (kind: 'connector' | 'mcp'): string[] =>
  savedCtxs.filter((c) => c.kind === kind && c.status === 'connected').map((c) => c.id)

// Per-session attached contexts — the *attachment of record* (Primitive 1 of
// docs/shared-resource-coordination.md). Server-owned so every effect a session
// initiates can be mediated by naming one of these (Tiers A–C). Seeded for the
// demo sessions; created state is persisted to disk (see persist.ts).
const sessionContextBindings = new Map<string, SessionContext[]>([
  ['insights-launch', [{ id: 'repo-insights', type: 'repo', label: 'insights-dashboard', scope: '~/projects/insights-dashboard' }]],
  ['auth-refactor', [{ id: 'repo-auth', type: 'repo', label: 'auth-service', scope: '~/projects/auth-service' }]],
])

// Per-session live workspace — the panels a conversation has grown (the *content*
// of its attached contexts). Server-owned so a runtime attach survives a reload,
// the way the conversation does. Lazily materialized from the session's flat seed
// fields on first read (server/workspace.ts), then replaced by the client's
// write-through as context attaches/detaches. Persisted to disk (see persist.ts).
const sessionWorkspaces = new Map<string, SessionWorkspace>()

/** A session title from its first message — the leading words, trimmed to a row-
 *  friendly length (mirrors how the desktop app titles a fresh chat). Empty input
 *  (a session created before its first send) falls back to a neutral label. */
function titleFrom(firstMessage?: string): string {
  const text = (firstMessage ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return 'New session'
  return text.length > 48 ? `${text.slice(0, 48).trimEnd()}…` : text
}

/** Publish a domain event to every open ambient SSE channel. */
function emit(e: ServerEvent): void {
  for (const fn of listeners) {
    try {
      fn(e)
    } catch {
      /* a dead channel shouldn't break the others */
    }
  }
}

// The native-runner registry — the broker's live view of connected hosts. In
// native/mock mode we seed the co-located runner (the one-runner registry the
// static capabilities describe); a remote web server seeds none.
const registry = new RunnerRegistry(emit)
if (NATIVE) registry.register(LOCAL_RUNNER_SEED)

// The effect journal — each runner's authoritative log of its host's effects (D2)
// + the server's projection of it. Emits `runner.effect` as effects project.
const journal = new RunnerJournal(emit)

// The resource guardian — per shared resource (a context element), a reservation
// ledger enforcing a capacity invariant (D5). The escrow that lets the broker
// refuse a second session's irreversible write up front. Emits `reservation.changed`.
const guardian = new ResourceGuardian(emit)

// A Project's sub-goal namespace (D11) lives under its guardian id:
// `${guardianId}:${subGoal}`. Two Contributors on different sub-goals get distinct
// resources (concurrent); the same sub-goal is one capacity-1 resource (mutual
// exclusion → first-come wins, the second re-reasons).
const subGoalKey = (guardianId: string, subGoal: string) => `${guardianId}:${subGoal}`

/** Run `effect` while holding `resourceKey` at the guardian, committing the irreversible
 *  step — releasing **only what this call acquired**, so a holder that already held the
 *  resource (a reservation kept across a consent gate, or a seeded hold) keeps it after.
 *  `guardian.reserve` is re-entrant, so without this a re-entrant effect would free a
 *  pre-existing hold. Mirrors the invoke route's `acquiredHere` care, shared so the two
 *  guard methods can't drift. A concurrent *different* holder is refused before `effect`
 *  runs (`reserve` throws `GuardianError` 'conflict'). */
function guardedRun<T>(resourceKey: string, holder: string, effect: () => T): T {
  const heldBefore = guardian.status(resourceKey).active.some((r) => r.holder === holder)
  const reservation = guardian.reserve(resourceKey, holder)
  try {
    const result = effect()
    guardian.commit(reservation.id)
    return result
  } finally {
    if (!heldBefore) guardian.release(reservation.id)
  }
}

// Seed one held sub-goal on the guarded Insights Project so the Coordination panel
// demonstrates a Contributor holding a sub-goal — reserved by the seeded commission (a
// Contributor). A *different* principal claiming the same sub-goal then conflicts. Long
// TTL so the demo claim doesn't lapse at the 60s default mid-session. (Transient, like
// the rest of the guardian ledger — rebuilt from this line on each boot.)
guardian.reserve(subGoalKey('p-insights', 'auth-refactor'), 'commission-insights-default', {
  ttlMs: 365 * 24 * 60 * 60 * 1000,
})

// ── Filesystem persistence ──────────────────────────────────────────────────
// Off until the real server entrypoint calls `store.initPersistence()`; tests
// drive the store in-memory. When on, every mutation snapshots the UI-owned state
// and writes it atomically, so a sent message / attached context / created session
// survives a restart. Reservations + the runner registry are intentionally NOT
// persisted: they're live/transient (a stale lock or a phantom offline runner must
// not outlive the process).
let persistEnabled = false

/** Snapshot the mutable, UI-owned state for the on-disk format. */
function snapshot(): PersistedState {
  return {
    version: STORE_VERSION,
    sessions: SESSIONS,
    bindings: [...sessionContextBindings.entries()],
    workspaces: [...sessionWorkspaces.entries()],
    schedules,
    recents,
    graph,
    savedContexts: savedCtxs,
    // The Agent Commons registries (D6/D9/D10/D7) — provider configs ride alongside
    // the providers so a restored one keeps its concrete model id.
    providers: [...MODEL_PROVIDERS.entries()],
    providerConfigs: [...PROVIDER_CONFIGS.entries()],
    systemPrompts: [...SYSTEM_PROMPT_LIB.entries()],
    agents: [...WORKER_AGENTS.entries()],
    commissions: [...COMMISSIONS.entries()],
    seq: {
      session: sessionSeq,
      message: messageSeq,
      schedule: scheduleSeq,
      run: runSeq,
      artifact: artifactSeq,
      provider: providerSeq,
      systemPrompt: systemPromptSeq,
      agent: workerAgentSeq,
      commission: commissionSeq,
    },
  }
}

/** Persist the current state (no-op until enabled). Called after every mutation. */
function persist(): void {
  if (persistEnabled) saveState(snapshot())
}

/** Replace the in-memory state with a loaded snapshot (rehydrate on boot). The
 *  seed containers are mutated in place (SESSIONS / schedules are imported / fixed
 *  bindings), the rest reassigned, and the id counters restored so freshly minted
 *  ids continue past the persisted ones. */
function rehydrate(s: PersistedState): void {
  SESSIONS.splice(0, SESSIONS.length, ...s.sessions)
  schedules.splice(0, schedules.length, ...s.schedules)
  // A live-minted run ('run-live-*') mints as 'running' and finishes a beat later
  // inside a setTimeout; both states persist. If the process restarted in that
  // window the completing timer is gone, so a persisted 'running' run would be
  // stuck in-flight forever — sweep it to a terminal state. (Seed runs that are
  // intentionally 'running' for visual variety aren't live-minted, so leave them.)
  for (const task of schedules) {
    for (const run of task.runs) {
      if (run.status === 'running' && run.id.startsWith('run-live-')) {
        run.status = 'failed'
        run.duration = run.duration === '—' ? '0s' : run.duration
        run.summary = 'Interrupted by a server restart'
      }
    }
  }
  recents = s.recents
  // Merge over an empty graph so a snapshot written before a slice existed (e.g.
  // projectInstructions) gains it as an empty map rather than `undefined`.
  graph = { ...emptyGraph(), ...s.graph }
  // Restore saved-context auth status (default to the seed for a pre-field snapshot).
  if (s.savedContexts) savedCtxs.splice(0, savedCtxs.length, ...s.savedContexts)
  sessionContextBindings.clear()
  for (const [k, v] of s.bindings) sessionContextBindings.set(k, v)
  sessionWorkspaces.clear()
  for (const [k, v] of s.workspaces) sessionWorkspaces.set(k, v)
  // The Agent Commons registries (D6/D9/D10/D7). Each is replaced only when the
  // snapshot carries it, so a pre-v4-shaped snapshot keeps the seeded set rather
  // than wiping it (defensive — a v4 snapshot always writes all five).
  replaceMap(MODEL_PROVIDERS, s.providers)
  replaceMap(PROVIDER_CONFIGS, s.providerConfigs)
  replaceMap(SYSTEM_PROMPT_LIB, s.systemPrompts)
  replaceMap(WORKER_AGENTS, s.agents)
  replaceMap(COMMISSIONS, s.commissions)
  sessionSeq = s.seq.session
  messageSeq = s.seq.message
  scheduleSeq = s.seq.schedule
  runSeq = s.seq.run
  artifactSeq = s.seq.artifact
  // The registry counters (default to the seed counter for a pre-v4 snapshot, so a
  // post-boot mint still lands past the seeds).
  providerSeq = s.seq.provider ?? providerSeq
  systemPromptSeq = s.seq.systemPrompt ?? systemPromptSeq
  workerAgentSeq = s.seq.agent ?? workerAgentSeq
  commissionSeq = s.seq.commission ?? commissionSeq
}

/** Replace a registry Map's contents from a snapshot's entry array, in place. A
 *  no-op when the snapshot omits the slice (a pre-v4 file), so the seeded set
 *  survives rather than being wiped to empty. */
function replaceMap<V>(map: Map<string, V>, entries?: [string, V][]): void {
  if (!entries) return
  map.clear()
  for (const [k, v] of entries) map.set(k, v)
}

/** How fast a run relights its rail — one step per this interval, then a final
 *  beat to finish. Perceptible in the UI, quick enough for tests. */
const RUN_STEP_MS = 300

/** Apply a routine's standing-approved effects on a run — the edits a user approved
 *  once, in advance, that now execute unprompted each run (the schedule is the unit
 *  of standing approval; docs/shared-resource-coordination.md). Today that's the
 *  "save <artifact> each run" approval (graph.scheduleArtifact): the run refreshes the
 *  routine's one delivered artifact and broadcasts `relation.applied` by:'standing' —
 *  a graph edit nobody confirmed *this* run, because it was pre-authorized. No
 *  standing approval on the routine → nothing happens.
 *
 *  The routine owns exactly ONE live artifact (keyed by its run-session source +
 *  name), refreshed in place each run rather than appended — the daemon fires
 *  indefinitely, so appending a fresh artifact per run would grow the persisted
 *  snapshot without bound. The first run mints it; later runs just re-stamp it. */
function applyStandingEffects(task: ScheduledTask, sessionId: string): void {
  const artifactName = graph.scheduleArtifact[task.id]
  if (!artifactName) return
  const source = `Scheduled run of ${task.name}`
  const op: RelationOp = {
    kind: 'save-artifact',
    artifact: { name: artifactName, kind: 'doc', meta: `Saved by ${task.name}` },
    sessionId,
    sessionTitle: source,
    projectId: task.projectId,
  }
  const existing = graph.extraArtifacts.find((a) => a.source === source && a.name === artifactName)
  if (existing) {
    graph = {
      ...graph,
      extraArtifacts: graph.extraArtifacts.map((a) =>
        a.id === existing.id ? { ...a, editedAt: Date.now(), meta: `Saved by ${task.name}` } : a,
      ),
    }
  } else {
    graph = applyGraphOp(graph, op, mintArtifactId, Date.now())
  }
  emit({ type: 'relation.applied', op, by: 'standing' })
}

export const store = {
  epoch: EPOCH,

  // ── Native-runner registry + effect journal ──
  /** The live registry of native runners + their advertised capabilities. The
   *  runner routes read/mutate this; changes broadcast ambient `runner.*` events. */
  registry,
  /** Each runner's authoritative effect log + the server's projection of it (D2).
   *  The invoke route records + reconciles; the sync route merges an outbox. */
  journal,
  /** Per-resource reservation ledgers enforcing a capacity invariant (D5). The
   *  reservation routes drive it; the invoke route reserves/commits for
   *  non-monotonic effects so a second session can't write a held resource. */
  guardian,

  /** Turn on filesystem persistence and rehydrate from the last snapshot (if any).
   *  Called once by the real server entrypoint; tests leave it off and run
   *  in-memory. On first boot (no snapshot) the seed is written out as the baseline. */
  initPersistence(): void {
    persistEnabled = true
    const loaded = loadState()
    if (loaded) rehydrate(loaded)
    else persist()
  },

  // ── Capabilities (what this backend variant can do) ──
  /** What this backend variant can do, advertised so the UI needn't sniff
   *  Electron vs web. A native sidecar reports the local-* flags true and fulfils
   *  the native endpoints; a remote web server reports them false and 409s those
   *  endpoints (the load-bearing, server-side gate — see the routes' `gate()`). */
  capabilities(): Capabilities {
    return {
      backend: BACKEND_MODE,
      epoch: EPOCH,
      features: {
        localFs: NATIVE,
        localGit: NATIVE,
        osPicker: NATIVE,
        clipboard: NATIVE,
        scheduledExecution: true, // a remote server can run schedules too
        streaming: true,
      },
    }
  },
  /** True when this backend can fulfill a native feature; the native routes use
   *  it to 409 with `capability_unavailable` on a remote server. */
  can(feature: 'localFs' | 'localGit' | 'osPicker' | 'clipboard'): boolean {
    return this.capabilities().features[feature]
  },

  // ── Native resources (only a native sidecar fulfills these) ──
  /** OS file/photo/folder picker → the chosen path. */
  fsPick(kind: string): { path: string; kind: string } {
    return { path: kind === 'file' ? '~/Documents/launch-assets/gtm-brief.md' : '~/projects/insights-dashboard', kind }
  },
  /** Scan a local folder → the artifacts it holds (what the workspace shows). */
  scanFolder(id: string): { id: string; label: string; artifacts: Artifact[] } | undefined {
    const f = FOLDER_OPTIONS.find((o) => o.id === id)
    return f ? { id: f.id, label: f.label, artifacts: f.artifacts } : undefined
  },
  /** Compute a local repo's working-tree diff (native git). */
  repoDiff(id: string): DiffLine[] | undefined {
    const repo =
      LOCAL_REPO_OPTIONS.find((r) => r.id === id) ?? GITHUB_REPO_OPTIONS.find((r) => r.id === id)
    return repo?.diff
  },

  // ── Event bus ──
  /** Subscribe to the ambient event stream; returns an unsubscribe fn. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  /** Publish a domain event to every open ambient SSE channel. */
  emit,

  // ── Sessions ──
  /** The lightweight list rows (no message bodies) for the sidebar/search. */
  listSessions(): Session[] {
    return SESSIONS.map((s) => ({
      id: s.id,
      title: s.title,
      caps: s.caps,
      preview: s.preview,
      isDemo: s.isDemo,
      // Sidebar filter/sort backing — cheap scalars, safe to ship in the list rows.
      status: s.status,
      environment: s.environment,
      updatedAt: s.updatedAt,
      createdAt: s.createdAt,
      pinned: s.pinned,
    }))
  },
  /** A full session by id — messages + the live, server-owned `workspace` (its
   *  panels). The workspace is materialized from the flat seed fields on first
   *  read, then reflects any attach/detach write-through. */
  getSession(id: string): Session | undefined {
    const session = SESSIONS.find((s) => s.id === id)
    if (!session) return undefined
    return { ...session, workspace: this.sessionWorkspace(id) }
  },
  demoSessionId: DEMO_SESSION_ID,

  /** A session's live workspace — the panels it has grown. Lazily seeded from the
   *  flat seed fields (server/workspace.ts) so a never-touched session still
   *  reports its seeded panels; an unknown / run session reports an empty one. */
  sessionWorkspace(id: string): SessionWorkspace {
    const stored = sessionWorkspaces.get(id)
    if (stored) return stored
    const session = SESSIONS.find((s) => s.id === id)
    const seeded = session ? workspaceFromSeed(session) : { ...EMPTY_WORKSPACE }
    sessionWorkspaces.set(id, seeded)
    return seeded
  },
  /** Replace a session's live workspace (the client's attach/detach write-through —
   *  it assembles the merged panels from the server-owned context catalogs and
   *  persists the result here, the system of record). Broadcasts `session.updated`
   *  so any other client reconciles. Returns the stored workspace. */
  setSessionWorkspace(id: string, workspace: SessionWorkspace): SessionWorkspace {
    sessionWorkspaces.set(id, workspace)
    const session = SESSIONS.find((s) => s.id === id)
    if (session) emit({ type: 'session.updated', session })
    persist()
    return workspace
  },

  /** Mint a server-owned message id. The conversation is the system of record, so
   *  persisted messages carry the backend's id — not one the client fabricated. */
  mintMessageId(role: 'user' | 'assistant'): string {
    return `m-${role[0]}-${(messageSeq += 1)}`
  },

  /** Materialize a new persisted session — the desktop app's "New chat" the moment
   *  it's first sent to. `firstMessage` seeds the title (its first words) + preview.
   *  Added to the live list + broadcast (`session.updated`) so every sidebar shows
   *  it; created state is persisted to disk (see persist.ts). */
  createSession(firstMessage?: string): Session {
    const now = Date.now()
    const session: Session = {
      id: `sess-${(sessionSeq += 1)}`,
      title: titleFrom(firstMessage),
      caps: ['chat'],
      agentId: DEFAULT_AGENT.id,
      preview: (firstMessage ?? '').slice(0, 120),
      messages: [],
      status: 'active',
      environment: 'local',
      createdAt: now,
      updatedAt: now,
    }
    SESSIONS.unshift(session)
    emit({ type: 'session.updated', session })
    persist()
    return session
  },

  /** The seeded worker Agents (docs/agent-commons.md, D6) — the degenerate N=1 set. */
  listAgents(): Agent[] {
    return [...WORKER_AGENTS.values()]
  },
  /** Resolve a Conversation's worker Agent; unset/unknown falls back to the seeded
   *  default. */
  getAgent(id?: string): Agent {
    return resolveAgent(id)
  },
  /** Mint a worker Agent through the D8 creation funnel (docs/agent-commons.md): both
   *  faces of the cascade are enforced here against the Agent's **provider** (D9 — the
   *  cascade root), so the *agent ⊆ provider* invariant holds by construction.
   *  Authority (the primary face — tools / connectors / scopes) is checked with
   *  `mintAuthority`; the token budget (the quota face) with `mintBudget` against the
   *  provider plan, falling back to the account plan for a provider that declares none.
   *  The single seam where an Agent's grants are validated — there is no other way to
   *  introduce one. The mutated registry is snapshotted to disk (persist.ts), so a
   *  created Agent survives a restart. */
  createAgent(input: Omit<Agent, 'id'>): Agent {
    const provider = resolveProvider(input.providerId)
    if (input.authority) mintAuthority(provider.authority, input.authority)
    if (input.budget) mintBudget(provider.plan?.windows ?? usageMeter.planCeilings(), input.budget)
    const agent: Agent = { ...input, id: `agent-${(workerAgentSeq += 1)}` }
    WORKER_AGENTS.set(agent.id, agent)
    persist()
    return agent
  },
  /** Create an Agent from a management request: resolve the `systemPrompt` body from the
   *  chosen library entry (D10), default the tool set to the full catalog (the default
   *  Agent's), and run the same D8 funnel via `createAgent`. An empty-string provider /
   *  prompt id means "none / default". The route validates that named ids exist first. */
  createAgentFromRequest(input: CreateAgentRequest): Agent {
    const entry = input.systemPromptId ? SYSTEM_PROMPT_LIB.get(input.systemPromptId) : undefined
    return this.createAgent({
      label: input.label,
      systemPrompt: entry?.body ?? DEFAULT_SYSTEM_PROMPT_BODY,
      systemPromptId: entry?.id,
      providerId: input.providerId || undefined,
      tools: input.tools ?? [...DEFAULT_AGENT.tools],
      instructions: input.instructions ?? '',
      authority: input.authority,
      budget: input.budget,
    })
  },
  /** Patch an Agent. A present field is applied (an empty-string provider / prompt id
   *  clears it to the default); an absent one is left unchanged. Changing the prompt
   *  re-resolves the body; changing the provider (or grants) re-validates authority /
   *  budget against the resulting provider — the D8 funnel runs again, so a patch can't
   *  smuggle an over-grant past it. Undefined when unknown (→ 404). */
  updateAgentFromRequest(id: string, patch: UpdateAgentRequest): Agent | undefined {
    const current = WORKER_AGENTS.get(id)
    if (!current) return undefined
    const providerId = 'providerId' in patch ? patch.providerId || undefined : current.providerId
    let systemPrompt = current.systemPrompt
    let systemPromptId = current.systemPromptId
    if ('systemPromptId' in patch) {
      const entry = patch.systemPromptId ? SYSTEM_PROMPT_LIB.get(patch.systemPromptId) : undefined
      systemPromptId = entry?.id
      systemPrompt = entry?.body ?? DEFAULT_SYSTEM_PROMPT_BODY
    }
    const authority = 'authority' in patch ? patch.authority : current.authority
    const budget = 'budget' in patch ? patch.budget : current.budget
    const provider = resolveProvider(providerId)
    if (authority) mintAuthority(provider.authority, authority)
    if (budget) mintBudget(provider.plan?.windows ?? usageMeter.planCeilings(), budget)
    const next: Agent = {
      ...current,
      label: patch.label ?? current.label,
      instructions: 'instructions' in patch ? patch.instructions ?? '' : current.instructions,
      tools: patch.tools ?? current.tools,
      providerId,
      systemPrompt,
      systemPromptId,
      authority,
      budget,
      id: current.id,
    }
    WORKER_AGENTS.set(id, next)
    reclampCommissionsOf(next) // D8 runtime: a narrowed Agent re-clamps its Contributors' grants
    persist()
    return next
  },
  /** Remove an Agent. Refuses (ConflictError → 409) the seeded default — Conversations
   *  resolve to it — and any Agent a Commission still assigns (it would orphan that
   *  Contributor), so the user removes those commissions first. False when unknown
   *  (→ 404). */
  deleteAgent(id: string): boolean {
    if (!WORKER_AGENTS.has(id)) return false
    if (id === DEFAULT_AGENT.id) throw new ConflictError('The default agent can’t be removed.')
    const commissioned = [...COMMISSIONS.values()].filter((c) => c.agentId === id)
    if (commissioned.length > 0) {
      throw new ConflictError(
        `${commissioned.length} commission${commissioned.length === 1 ? '' : 's'} still ${commissioned.length === 1 ? 'assigns' : 'assign'} this agent — remove ${commissioned.length === 1 ? 'it' : 'them'} first.`,
      )
    }
    WORKER_AGENTS.delete(id)
    persist()
    return true
  },

  // ── Model providers (the cognition source — docs/agent-commons.md, D9) ──
  /** The registered Model providers — the degenerate N=1 set for now. */
  listProviders(): ModelProvider[] {
    return [...MODEL_PROVIDERS.values()]
  },
  /** Resolve an Agent's Model provider; unset/unknown falls back to the seeded
   *  default. */
  getProvider(id?: string): ModelProvider {
    return resolveProvider(id)
  },
  /** The concrete model id a turn on this provider runs against — server-only
   *  config, never on the contract. Undefined = inherit `generate.ts`'s env default
   *  (the default provider), so `ANTHROPIC_MODEL` stays the one source for it. */
  providerModel(id?: string): string | undefined {
    return (PROVIDER_CONFIGS.get(id ?? '') ?? DEFAULT_PROVIDER_CONFIG).model
  },
  /** Mint a Model provider through the D8 funnel: its plan must attenuate the account
   *  plan (`planCeilings`), so the cascade root can never exceed the subscription it
   *  sits under. The single seam a provider plan is validated. */
  createProvider(input: Omit<ModelProvider, 'id'>, config: ProviderConfig = {}): ModelProvider {
    if (input.plan) mintBudget(usageMeter.planCeilings(), input.plan)
    const provider: ModelProvider = { ...input, id: `provider-${(providerSeq += 1)}` }
    MODEL_PROVIDERS.set(provider.id, provider)
    PROVIDER_CONFIGS.set(provider.id, config)
    persist()
    return provider
  },
  /** Patch a provider's own fields (label / family / effort levels / plan / authority).
   *  Re-validates a changed plan against the account plan — the same cascade-root
   *  invariant `createProvider` asserts. D8 is checked at each child's *own* creation,
   *  so tightening a provider does NOT retro-invalidate Agents already minted under it
   *  (no per-turn re-check — the documented model). Undefined when unknown (→ 404). */
  updateProvider(id: string, patch: Partial<Omit<ModelProvider, 'id'>>): ModelProvider | undefined {
    const current = MODEL_PROVIDERS.get(id)
    if (!current) return undefined
    if (patch.plan) mintBudget(usageMeter.planCeilings(), patch.plan)
    const next: ModelProvider = { ...current, ...patch, id: current.id }
    MODEL_PROVIDERS.set(id, next)
    reclampAgentsOf(next) // D8 runtime: a narrowed provider re-clamps its Agents (+ their commissions)
    persist()
    return next
  },
  /** Remove a provider. Refuses (ConflictError → 409) the seeded default — sessions
   *  resolve to it — and any provider an Agent still binds, so the user repoints those
   *  Agents first rather than silently orphaning them onto the fallback. False when
   *  unknown (→ 404). The removal is snapshotted to disk (persist.ts). */
  deleteProvider(id: string): boolean {
    if (!MODEL_PROVIDERS.has(id)) return false
    if (id === DEFAULT_PROVIDER.id) throw new ConflictError('The default provider can’t be removed.')
    const bound = [...WORKER_AGENTS.values()].filter((a) => a.providerId === id)
    if (bound.length > 0) {
      throw new ConflictError(
        `${bound.length} agent${bound.length === 1 ? '' : 's'} still ${bound.length === 1 ? 'runs' : 'run'} on this provider — repoint ${bound.length === 1 ? 'it' : 'them'} first.`,
      )
    }
    MODEL_PROVIDERS.delete(id)
    PROVIDER_CONFIGS.delete(id)
    persist()
    return true
  },

  // ── System-prompt library (docs/agent-commons.md, D10) ──
  /** The reusable, target-family-tagged system prompts a user picks for an Agent. */
  listSystemPrompts(): SystemPromptEntry[] {
    return [...SYSTEM_PROMPT_LIB.values()]
  },
  /** Resolve one library entry by id (undefined when unknown — unlike provider/agent
   *  there is no "default prompt to fall back to" at this seam; the caller decides). */
  getSystemPrompt(id?: string): SystemPromptEntry | undefined {
    return id ? SYSTEM_PROMPT_LIB.get(id) : undefined
  },
  /** Add a prompt to the library. A plain registry add (prompt text is not a
   *  capability, so there is no attenuation funnel here — the fit *warning* is the
   *  selection-time check, `promptFitWarning`, surfaced in the picker). */
  createSystemPrompt(input: Omit<SystemPromptEntry, 'id'>): SystemPromptEntry {
    const entry: SystemPromptEntry = { ...input, id: `sp-new-${(systemPromptSeq += 1)}` }
    SYSTEM_PROMPT_LIB.set(entry.id, entry)
    persist()
    return entry
  },
  /** Patch a library prompt's fields (label / body / target family). A plain registry
   *  edit — no attenuation funnel (prompt text isn't a capability). Undefined when
   *  unknown (→ 404). */
  updateSystemPrompt(id: string, patch: Partial<Omit<SystemPromptEntry, 'id'>>): SystemPromptEntry | undefined {
    const current = SYSTEM_PROMPT_LIB.get(id)
    if (!current) return undefined
    const next: SystemPromptEntry = { ...current, ...patch, id: current.id }
    SYSTEM_PROMPT_LIB.set(id, next)
    persist()
    return next
  },
  /** Remove a library prompt. Refuses (ConflictError → 409) the seeded default — the
   *  default Agent's body is single-sourced from it — and any prompt an Agent still
   *  references (`systemPromptId`), so the user repoints those Agents first. False when
   *  unknown (→ 404). */
  deleteSystemPrompt(id: string): boolean {
    if (!SYSTEM_PROMPT_LIB.has(id)) return false
    if (id === SP_DEFAULT_ID) throw new ConflictError('The default system prompt can’t be removed.')
    const used = [...WORKER_AGENTS.values()].filter((a) => a.systemPromptId === id)
    if (used.length > 0) {
      throw new ConflictError(
        `${used.length} agent${used.length === 1 ? '' : 's'} still ${used.length === 1 ? 'uses' : 'use'} this prompt — repoint ${used.length === 1 ? 'it' : 'them'} first.`,
      )
    }
    SYSTEM_PROMPT_LIB.delete(id)
    persist()
    return true
  },

  // ── Commissions (the agent→Project assignment — docs/agent-commons.md, D7/D13) ──
  /** A Project's Contributors (its commissions), or all commissions when no project
   *  is given. The Contributor role is just an Agent that appears here for a Project. */
  listCommissions(projectId?: string): Commission[] {
    const all = [...COMMISSIONS.values()]
    return projectId ? all.filter((c) => c.projectId === projectId) : all
  },
  /** Resolve one commission by id (undefined when unknown). */
  getCommission(id: string): Commission | undefined {
    return COMMISSIONS.get(id)
  },
  /** Mint a Commission through the **leaf** of the D8 funnel: its grant + authority must
   *  attenuate the *Agent's* (which themselves inherit the provider when unset) — so
   *  *commission ⊆ agent ⊆ provider* holds by construction, an over-grant is
   *  unrepresentable at mint, and a Commission can never carry authority the Agent never
   *  held (the confused-deputy wall, fatal where the commissioner is a stranger). The
   *  caller must have validated the agent + project exist; this asserts the cascade.
   *  Persisted to disk like the agent/provider registries (persist.ts).
   *
   *  Known limitation (token face): the parent is a *single* tier — the Agent's own
   *  budget, else the provider plan, else the account plan — not a per-window merge of
   *  the chain. So if an Agent declared a *partial* budget (only some windows), a
   *  commission tightening an *inherited* window is rejected. It errs safe (over-reject,
   *  never over-grant) and is unreachable today (every seed uses the full account window
   *  set); a per-window effective-budget merge (which would also touch `createAgent`,
   *  slice 3) is the proper fix when partial window sets are introduced. The unknown-agent
   *  guard throws a plain `Error` on purpose — the route pre-validates, so reaching it
   *  signals a bypassed-validation bug (a 500), not a client error. */
  createCommission(input: Omit<Commission, 'id'>): Commission {
    const agent = WORKER_AGENTS.get(input.agentId)
    if (!agent) throw new Error(`createCommission: unknown agent '${input.agentId}'`)
    const provider = resolveProvider(agent.providerId)
    // Attenuate against the Agent's *effective* grants: an Agent that left a face unset
    // inherits its provider's there, so that inherited ceiling is the parent.
    if (input.authority) mintAuthority(agent.authority ?? provider.authority, input.authority)
    if (input.grant) {
      mintBudget(agent.budget?.windows ?? provider.plan?.windows ?? usageMeter.planCeilings(), input.grant)
    }
    // Role is the D14 baseline; default to 'writer' (the ordinary Contributor) when unset.
    const commission: Commission = { ...input, role: input.role ?? 'writer', id: `commission-${(commissionSeq += 1)}` }
    COMMISSIONS.set(commission.id, commission)
    persist()
    return commission
  },
  /** Re-grant a commission — narrow (or restore) the authority / sub-budget it carries
   *  onto the Project. Re-runs the same leaf funnel `createCommission` uses (attenuate
   *  against the Agent's effective ceiling), so a patch can't smuggle a grant past the
   *  Agent. A present field is applied; an absent one is left unchanged. Undefined when
   *  unknown (→ 404). */
  updateCommission(id: string, patch: UpdateCommissionRequest): Commission | undefined {
    const commission = COMMISSIONS.get(id)
    if (!commission) return undefined
    const agent = WORKER_AGENTS.get(commission.agentId)
    const provider = resolveProvider(agent?.providerId)
    const authority = 'authority' in patch ? patch.authority : commission.authority
    const grant = 'grant' in patch ? patch.grant : commission.grant
    // Role (D14) re-assignment: present ⇒ apply, absent ⇒ unchanged.
    const role = patch.role ?? commission.role
    if (authority) mintAuthority(agent?.authority ?? provider.authority, authority)
    if (grant) {
      mintBudget(agent?.budget?.windows ?? provider.plan?.windows ?? usageMeter.planCeilings(), grant)
    }
    const next: Commission = { ...commission, role, authority, grant, id: commission.id }
    COMMISSIONS.set(id, next)
    persist()
    return next
  },
  /** Un-commission an Agent from its Project. Cascade-releases any in-flight sub-goals
   *  this Contributor held at the Guardian (freeing them for re-claim), so removing a
   *  Contributor leaves no dangling reservation. False when unknown (→ 404). No protected
   *  default — a commission has no fallback role to preserve (unlike a provider/agent). */
  deleteCommission(id: string): boolean {
    const commission = COMMISSIONS.get(id)
    if (!commission) return false
    this.projectSubGoals(commission.projectId)
      .filter((s) => s.holder === id)
      .forEach((s) => this.releaseSubGoal(s.reservationId))
    COMMISSIONS.delete(id)
    persist()
    return true
  },

  /** The **effective authority** a Contributor carries onto its Project (D12,
   *  docs/agent-commons.md): the agent's granted authority (commission ?? agent ??
   *  provider — the D8 ceiling) **clamped** to what the Project admits
   *  (`projectAdmittedAuthority`). So a commissioned Agent sees the *Project's*
   *  connectors / scopes, never its owner's ambient set — default-deny on anything the
   *  Project doesn't admit, even for an Agent granted everything. Undefined for an
   *  unknown commission. */
  commissionAuthority(commissionId: string): Authority | undefined {
    const commission = COMMISSIONS.get(commissionId)
    if (!commission) return undefined
    const agent = WORKER_AGENTS.get(commission.agentId)
    if (!agent) return undefined
    const provider = resolveProvider(agent.providerId)
    // The ceiling: the most authority this Contributor could hold (the D8 cascade).
    const granted = commission.authority ?? agent.authority ?? provider.authority ?? {}
    const project = PROJECTS.find((p) => p.id === commission.projectId)
    // The wall: clamp the ceiling to what the Project exposes. Fail **closed** — a
    // commission whose Project is somehow gone admits no data (the route validates the
    // Project at mint, so this is defensive, but a security boundary must not fail open).
    const admitted = project ? projectAdmittedAuthority(project.contexts) : { connectors: [], scopes: [] }
    return intersectAuthority(granted, admitted)
  },
  /** The D12 mediation check, lifted from *(session, context)* to *(Project,
   *  commission, context)*: whether a Contributor may reach `target` on `dimension`.
   *  True iff the commission's **effective** (Project-clamped) authority admits it — so
   *  the owner's ambient connectors, absent from the Project, are unreachable. A
   *  missing commission reaches nothing. */
  commissionCanReach(commissionId: string, dimension: 'tools' | 'connectors' | 'scopes', target: string): boolean {
    const effective = this.commissionAuthority(commissionId)
    return effective ? authorityAdmits(effective, dimension, target) : false
  },
  /** Effect-time D12 scope wall for the host invoke path (OQ3): may this Commission's
   *  Contributor act on a filesystem `target`? The commission's **effective**
   *  (Project-clamped) `scopes` bound its file reach — `projectAdmittedAuthority` derives
   *  them from the Project's folder/repo contexts, so a path outside the Project's admitted
   *  roots is unreachable even to an Agent granted everything. **Unknown commission ⇒
   *  `false` (fail closed)** — a security boundary must not fail open. Unrestricted scopes
   *  (`'*'` / absent) impose no file wall. A concrete set admits only a `target` within one
   *  root (the same prefix boundary as context mediation, `scopeMatches`). A non-`fs.*`
   *  capability carries no commission scope bound here — its command `target` isn't a path,
   *  and the host grant (D3) + context mediation already bound it — so it passes. */
  commissionAdmitsTarget(commissionId: string, capability: CapabilityType, target: string): boolean {
    const effective = this.commissionAuthority(commissionId)
    if (!effective) return false // fail closed: no commission ⇒ no reach
    if (!capability.startsWith('fs.')) return true // commission scopes bound file reach only
    if (unrestricted(effective.scopes)) return true // no file wall
    return effective.scopes!.some((root) => scopeMatches(root, target))
  },
  /** Does this Commission's **role** (D14) permit `action` on its Project? The role is the
   *  permission baseline composed into the cascade alongside the D12 reach. **Unknown
   *  commission ⇒ `false` (fail closed)**; an unset role defaults to `'writer'` (the
   *  ordinary Contributor), so an old persisted commission still gates correctly. */
  commissionRolePermits(commissionId: string, action: ProjectAction): boolean {
    const commission = COMMISSIONS.get(commissionId)
    if (!commission) return false
    return rolePermits(commission.role ?? 'writer', action)
  },

  /** Append a message to a session's thread — the write that makes "send" real.
   *  Persists only for a known (listed) session; a draft is materialized via
   *  `createSession` first, and synthesized run / unknown ids aren't persisted here
   *  (returns undefined). Refreshes the row's preview + activity, then broadcasts
   *  `session.updated` so every client's list reflects the new turn. */
  appendMessage(id: string, message: Message): Session | undefined {
    const session = SESSIONS.find((s) => s.id === id)
    if (!session) return undefined
    session.messages = [...(session.messages ?? []), message]
    session.preview = message.content.slice(0, 120)
    session.updatedAt = Date.now()
    emit({ type: 'session.updated', session })
    persist()
    return session
  },
  /** Hand a Conversation off to a different worker Agent mid-thread (D16) — re-bind the
   *  session's driver. Subsequent turns are driven by, and stamped with (Message.agentId),
   *  the new Agent; the binding is *current-driver*, not immutable. Refuses an unknown
   *  Agent (ConflictError → 409). */
  setSessionAgent(sessionId: string, agentId: string): Session | undefined {
    const session = SESSIONS.find((s) => s.id === sessionId)
    if (!session) return undefined
    if (!WORKER_AGENTS.has(agentId)) {
      throw new ConflictError(`No agent '${agentId}' to hand off to — it may have been removed.`)
    }
    session.agentId = agentId
    session.updatedAt = Date.now()
    emit({ type: 'session.updated', session })
    persist()
    return session
  },

  /** Edit a session's row-level fields from the sidebar's row menu — rename
   *  (title), pin/unpin, or archive/unarchive. Mutates in place and broadcasts
   *  `session.updated` so every client's list refreshes. */
  patchSession(
    id: string,
    patch: { title?: string; status?: 'active' | 'archived'; pinned?: boolean },
  ): Session | undefined {
    const session = SESSIONS.find((s) => s.id === id)
    if (!session) return undefined
    if (patch.title !== undefined) session.title = patch.title
    if (patch.status !== undefined) session.status = patch.status
    if (patch.pinned !== undefined) session.pinned = patch.pinned
    emit({ type: 'session.updated', session })
    persist()
    return session
  },
  /** Delete a session (the row menu's "Delete"). Splices it from the seed and
   *  broadcasts a refresh; a server restart reseeds it (mock semantics). */
  removeSession(id: string): boolean {
    const i = SESSIONS.findIndex((s) => s.id === id)
    if (i === -1) return false
    const [removed] = SESSIONS.splice(i, 1)
    emit({ type: 'session.updated', session: removed })
    persist()
    return true
  },

  // ── Session ↔ context bindings (the attachment of record — Primitive 1) ──
  /** The contexts attached to a session — the set every effect this session
   *  initiates is mediated against (docs/shared-resource-coordination.md). */
  sessionContexts(sessionId: string): SessionContext[] {
    return sessionContextBindings.get(sessionId) ?? []
  },
  /** Resolve one attached context for a session — the lookup the broker uses to
   *  mediate an effect (Primitive 2). Undefined when it isn't attached. */
  resolveSessionContext(sessionId: string, contextId: string): SessionContext | undefined {
    return sessionContextBindings.get(sessionId)?.find((c) => c.id === contextId)
  },
  /** Attach a context to a session (idempotent by context id — re-attaching
   *  replaces it). Broadcasts `session.contexts.changed`; returns the new list. */
  attachContext(sessionId: string, ctx: SessionContext): SessionContext[] {
    const list = sessionContextBindings.get(sessionId) ?? []
    const next = [...list.filter((c) => c.id !== ctx.id), ctx]
    sessionContextBindings.set(sessionId, next)
    emit({ type: 'session.contexts.changed', sessionId, contexts: next })
    persist()
    return next
  },
  /** Detach a context from a session. Returns the new list, or undefined when the
   *  context wasn't attached (so the route can 404). */
  detachContext(sessionId: string, contextId: string): SessionContext[] | undefined {
    const list = sessionContextBindings.get(sessionId)
    if (!list || !list.some((c) => c.id === contextId)) return undefined
    const next = list.filter((c) => c.id !== contextId)
    sessionContextBindings.set(sessionId, next)
    emit({ type: 'session.contexts.changed', sessionId, contexts: next })
    persist()
    return next
  },

  // ── Dispatch ──
  /** The agent-run feed shown in the Dispatch section. */
  listDispatch(): DispatchRun[] {
    return dispatch
  },
  /** Kick off a one-off dispatch (a single on-demand agent run). It lands
   *  'running', broadcasts, then finishes 'done' a beat later (the mock stand-in
   *  for a real agent run) and broadcasts again. Returns the run. */
  addDispatch(title: string, detail?: string): DispatchRun {
    const run: DispatchRun = {
      id: `d-new-${(dispatchSeq += 1)}`,
      title,
      status: 'running',
      startedAt: Date.now(),
      detail: detail?.trim() || 'Working on it…',
    }
    dispatch.unshift(run)
    emit({ type: 'dispatch.changed' })
    setTimeout(() => {
      // startedAt is the start time — it doesn't change as the run settles; the UI
      // re-derives "started 4 minutes ago" → "4 minutes ago" from it live.
      run.status = 'done'
      emit({ type: 'dispatch.changed' })
    }, RUN_STEP_MS * 4)
    return run
  },

  // ── Contexts (the set-up ones, on the Contexts page) ──
  savedContexts(): SavedContextsSnapshot {
    return {
      contexts: savedCtxs,
      connectedConnectorIds: connectedIds('connector'),
      connectedMcpIds: connectedIds('mcp'),
    }
  },
  /** Set a saved connector / MCP server's auth status — the connect / disconnect on
   *  the Contexts page, and the seam a real OAuth callback or token-expiry would use.
   *  Mutates the record, broadcasts `connector.status` so every client reconciles,
   *  and persists. Returns the new snapshot, or undefined for an unknown id. */
  setConnectorStatus(id: string, status: ContextStatus): SavedContextsSnapshot | undefined {
    const ctx = savedCtxs.find((c) => c.id === id)
    if (!ctx) return undefined
    ctx.status = status
    emit({ type: 'connector.status', id, status })
    persist()
    return this.savedContexts()
  },
  /** The sidebar detail for one connector / MCP server (mock: derived locally;
   *  a real backend fetches live resources from the connected service). */
  connectorDetail(connector: Connector): ConnectorDetail {
    return connectorDetail(connector)
  },

  // ── Artifact bodies ──
  artifactContent(): ArtifactContentLibrary {
    return ARTIFACT_CONTENT
  },

  // ── Usage (the composer gauge: context window + plan limit windows) ──
  /** Record one turn's real token usage (from the model's Messages response)
   *  against the rolling plan windows. Called by the message route after every
   *  turn — including the tour's ephemeral ones, since they consume real tokens. */
  recordUsage(inputTokens: number, outputTokens: number): void {
    usageMeter.record(inputTokens, outputTokens)
  },
  /** Spend-time enforcement (D8): the plan window this Agent's effective budget has
   *  exhausted (consumed ≥ its effective ceiling), or null. The message route refuses a
   *  turn when this is non-null — the per-turn gate the mint-time funnel doesn't provide. */
  overSpendLimit(budget?: Budget): { label: string; ceiling: number } | null {
    return usageMeter.overLimit(budget)
  },
  /** The usage snapshot the composer gauge renders: the open session's real
   *  context-window fill (system+tools baseline + an estimate of every message in
   *  the thread) plus the live plan windows. `sessionId` selects which thread the
   *  context figure reflects; omitted = baseline only. */
  usage(sessionId?: string): UsageSnapshot {
    let messageTokens = 0
    const session = sessionId ? SESSIONS.find((s) => s.id === sessionId) : undefined
    for (const m of session?.messages ?? []) messageTokens += estimateTokens(m.content)
    // System tools + system prompt are computed from the *actual* request the
    // backend sends — both injected eagerly — so they're real loaded categories.
    const agent = resolveAgent(session?.agentId)
    const systemPromptTokens = estimateTokens(systemPrompt({ id: sessionId ?? '', title: session?.title ?? '', isDemo: session?.isDemo }, agent))
    return {
      context: contextBreakdown({ messageTokens, systemToolsTokens: SYSTEM_TOOLS_TOKENS, systemPromptTokens }),
      limits: usageMeter.planLimits(),
    }
  },

  // ── Schedule templates (the "New schedule" starters) ──
  scheduleTemplates(): ScheduleTemplate[] {
    return SCHEDULE_TEMPLATES
  },

  // ── Entity graph (Projects / Artifacts / Schedules + the relationship graph) ──
  listProjects(): Project[] {
    return PROJECTS
  },
  /** Route a non-monotonic Project effect through the Project's guardian (D11,
   *  docs/agent-commons.md): a guarded Project is a shared resource, so its
   *  irreversible effects serialize at its guardian. Reserves the Project's guardian
   *  for `holder`, runs `effect` (the irreversible step) under a commit, then releases
   *  the lease. A concurrent effect by a *different* holder is refused
   *  (`GuardianError` 'conflict') — the escrow turning a second principal away up
   *  front. An unguarded Project (no `guardianId`) runs the effect directly
   *  (coordination-free). This is the *coarse* (whole-Project) lock; `guardSubGoalEffect`
   *  is the fine-grained, multi-principal form (D11). */
  guardProjectEffect<T>(projectId: string, holder: string, effect: () => T): T {
    const project = PROJECTS.find((p) => p.id === projectId)
    if (!project?.guardianId) return effect()
    return guardedRun(project.guardianId, holder, effect)
  },

  // ── Multi-principal coordination — sub-goal reservation (D11) ──
  /** Claim a **sub-goal** on a guarded Project for `holder` (a Contributor) — "I'm
   *  handling the auth refactor": a held, TTL'd, reversible reservation keyed
   *  `${guardianId}:${subGoal}`. Different sub-goals are distinct resources (Contributors
   *  proceed concurrently); the *same* sub-goal is capacity-1, so a second *different*
   *  holder is refused (`GuardianError` 'conflict') and re-reasons. Re-entrant for the
   *  same holder. Throws if the Project isn't guarded. */
  reserveSubGoal(projectId: string, holder: string, subGoal: string): Reservation {
    const project = PROJECTS.find((p) => p.id === projectId)
    if (!project?.guardianId) {
      throw new GuardianError('conflict', `Project '${projectId}' is not a guarded resource`)
    }
    return guardian.reserve(subGoalKey(project.guardianId, subGoal), holder)
  },
  /** Release a sub-goal claim (free the lease so another Contributor may take it). */
  releaseSubGoal(reservationId: string): Reservation {
    return guardian.release(reservationId)
  },
  /** Run a non-monotonic Project effect under a **sub-goal** reservation (D11) — the
   *  fine-grained form of `guardProjectEffect`: reserve → commit → release, but keyed to
   *  one sub-goal, so two Contributors' effects on *different* sub-goals don't serialize
   *  against each other. The consent gate is the serialization gate. */
  guardSubGoalEffect<T>(projectId: string, holder: string, subGoal: string, effect: () => T): T {
    const project = PROJECTS.find((p) => p.id === projectId)
    if (!project?.guardianId) return effect()
    return guardedRun(subGoalKey(project.guardianId, subGoal), holder, effect)
  },
  /** Fire a Contributor's externally-effectful action on a shared Project (D11/D12) — the
   *  real path through the Guardian seam (the slice-4 "forward" effect, now wired). A
   *  monotonic effect (observe / query) runs coordination-free; a non-monotonic one
   *  (write / mutate / charge) is serialized on its sub-goal reservation, so a concurrent
   *  *different* principal on the same sub-goal is refused (`GuardianError` 'conflict').
   *  The connector/MCP reach (D12) is checked by the route before this runs. Mock
   *  fulfilment; the seam is real. */
  runProjectEffect(
    projectId: string,
    commissionId: string,
    subGoal: string,
    type: ProjectEffectType,
    target: string,
  ): ProjectEffectResult {
    const monotonic = isProjectEffectMonotonic(type)
    const project = PROJECTS.find((p) => p.id === projectId)
    const guarded = !monotonic && !!project?.guardianId
    const fulfil = (): ProjectEffectResult => ({
      projectId,
      commissionId,
      type,
      target,
      guarded,
      output: `${monotonic ? 'observed' : 'applied'} ${type} on '${target}'`,
    })
    // Non-monotonic ⇒ serialize on the sub-goal reservation (a no-op for an unguarded
    // Project); monotonic ⇒ coordination-free (CALM).
    return monotonic ? fulfil() : this.guardSubGoalEffect(projectId, commissionId, subGoal, fulfil)
  },
  /** Agent-to-agent proxy (D15): A's Agent asks B's Agent (`toAgentId`) to act on B's private
   *  resource. **B acts under its *own* authority** — the requester's authority is never used
   *  and no credential crosses back; A receives only the result. Fulfils when B's authority
   *  admits the connector/MCP target (a `charge` needs no reach), else denies (B's side lacks
   *  the reach / declines). Mock fulfilment; the seam is real. Undefined for an unknown owner
   *  Agent (→ 404). */
  runAgentProxy(toAgentId: string, req: ProxyRequest): ProxyResult | undefined {
    const to = WORKER_AGENTS.get(toAgentId)
    if (!to) return undefined
    const reaches = req.capability.startsWith('connector.') || req.capability.startsWith('mcp.')
    const auth = to.authority ?? resolveProvider(to.providerId).authority ?? {}
    if (reaches && !authorityAdmits(auth, 'connectors', req.target)) {
      return { status: 'denied', actedBy: to.id, reason: `${to.label} may not reach '${req.target}'` }
    }
    return { status: 'fulfilled', actedBy: to.id, output: `${to.label} performed ${req.capability} on '${req.target}'` }
  },
  /** The sub-goals currently in flight on a Project — one entry per active Contributor
   *  claim (held or committed), the Coordination panel's read. Enumerates the guardian's
   *  resources under the Project's prefix; holders are resolved to their Agent label. */
  projectSubGoals(projectId: string): ProjectSubGoal[] {
    const project = PROJECTS.find((p) => p.id === projectId)
    if (!project?.guardianId) return []
    const prefix = `${project.guardianId}:`
    const out: ProjectSubGoal[] = []
    for (const key of guardian.resourceIds()) {
      if (!key.startsWith(prefix)) continue
      const subGoal = key.slice(prefix.length)
      for (const r of guardian.status(key).active) {
        out.push({
          subGoal,
          holder: r.holder,
          holderLabel: holderLabel(r.holder),
          holderRole: holderRole(r.holder),
          reservationId: r.id,
          status: r.status,
        })
      }
    }
    return out
  },
  /** The base artifacts (the relation graph carries any saved-out extras). */
  listArtifacts(): ArtifactItem[] {
    return ALL_ARTIFACTS
  },
  listSchedules(): ScheduledTask[] {
    return schedules
  },

  // ── Scheduled runs (a single live feed; runs are server-owned) ──
  /** The left rail's recent runs (newest-first, capped). */
  recentRuns(): RunSessionEntry[] {
    return recentEntries(schedules)
  },
  /** The synthesized session for a run id (resolves `srun-*`). */
  runSession(id: string): Session | undefined {
    return entryById(schedules, id)?.session
  },
  /** Run a routine now: append a 'running' run, broadcast it, relight its rail one
   *  step at a time (`run.progress`), then finish it (`run.finished`). On finish any
   *  standing-approved effect the routine carries is applied unprompted
   *  (`relation.applied` by:'standing'). The daemon uses this same path on a cadence. */
  runSchedule(id: string): ScheduledRun | undefined {
    const task = schedules.find((t) => t.id === id)
    if (!task) return undefined
    const run: ScheduledRun = {
      id: `run-live-${(runSeq += 1)}`,
      status: 'running',
      duration: '—',
      reachedStep: 0,
      summary: 'Running on demand…',
      at: Date.now(),
    }
    task.runs = [run, ...task.runs]
    const sessionId = runSessionId(task.id, run.id)
    emit({ type: 'run.started', taskId: task.id, taskName: task.name, sessionId, run })
    persist()
    const steps = task.steps.length
    // Advance the rail one step per beat so a connected client sees the run progress
    // (`run.progress`) rather than jump from 0 → done.
    for (let i = 1; i <= steps; i += 1) {
      setTimeout(() => {
        if (run.status !== 'running') return // superseded (e.g. swept after a restart)
        run.reachedStep = i
        emit({ type: 'run.progress', taskId: task.id, runId: run.id, reachedStep: i, status: 'running' })
        persist()
      }, i * RUN_STEP_MS)
    }
    // A final beat after the last step: mark done, apply standing effects, finish.
    setTimeout(() => {
      if (run.status !== 'running') return
      run.status = 'ok'
      run.reachedStep = steps
      run.duration = `${8 + steps * 3}s`
      run.summary = `Ran on demand — delivered to ${task.delivery.target}`
      task.lastStatus = 'ok'
      applyStandingEffects(task, sessionId)
      emit({ type: 'run.finished', taskId: task.id, taskName: task.name, sessionId, run })
      persist()
    }, (steps + 1) * RUN_STEP_MS)
    return run
  },
  /** Set a routine's enabled state — to an explicit value, or toggle when the
   *  value is omitted. */
  setScheduleEnabled(id: string, enabled?: boolean): ScheduledTask | undefined {
    const task = schedules.find((t) => t.id === id)
    if (!task) return undefined
    task.enabled = enabled ?? !task.enabled
    persist()
    return task
  },
  /** Merge a partial patch of a routine's OWN fields (the entity edits behind the
   *  detail page — name, prompt, cadence, model, steps, …). Only the fields present
   *  in the patch are written; id / runs / run-derived state are never touched
   *  (cross-entity bindings live in the relation graph, not here). Returns the
   *  updated task, or undefined if no routine has that id. */
  updateSchedule(id: string, patch: UpdateScheduleRequest): ScheduledTask | undefined {
    const task = schedules.find((t) => t.id === id)
    if (!task) return undefined
    if (patch.enabled !== undefined) task.enabled = patch.enabled
    if (patch.name !== undefined) task.name = patch.name
    if (patch.prompt !== undefined) task.prompt = patch.prompt
    if (patch.cadence !== undefined) task.cadence = patch.cadence
    if (patch.trigger !== undefined) task.trigger = patch.trigger
    if (patch.next !== undefined) task.next = patch.next
    if (patch.timezone !== undefined) task.timezone = patch.timezone
    if (patch.model !== undefined) task.model = patch.model
    if (patch.notifyOnFailure !== undefined) task.notifyOnFailure = patch.notifyOnFailure
    if (patch.delivery !== undefined) task.delivery = patch.delivery
    if (patch.steps !== undefined) task.steps = patch.steps
    persist()
    return task
  },
  /** Add a routine from a template (lands paused), return it. */
  addSchedule(seed: Omit<ScheduledTask, 'id'>): ScheduledTask {
    const task: ScheduledTask = { ...seed, id: `s-new-${(scheduleSeq += 1)}` }
    schedules.unshift(task)
    persist()
    return task
  },
  /** Remove a routine. */
  removeSchedule(id: string): void {
    const i = schedules.findIndex((t) => t.id === id)
    if (i >= 0) schedules.splice(i, 1)
    persist()
  },

  // ── Recents (per-user Add-context shortcut lists) ──
  recents(): RecentsSnapshot {
    return recents
  },
  /** Promote an id to the front of its type's list — non-evicting; the list only
   *  grows. Broadcasts so every open picker (and other devices) reflects it. */
  pushRecent(type: ContextTypeId, id: string): RecentsSnapshot {
    const list = recents[type] ?? []
    recents = { ...recents, [type]: [id, ...list.filter((x) => x !== id)] }
    emit({ type: 'recents.changed', contextType: type, ids: recents[type] })
    persist()
    return recents
  },

  /** The current relationship graph (seed + applied edits). */
  relationGraph(): RelationGraph {
    return graph
  },
  /** Apply a confirmed relation op (the canonical write), broadcast it, and return the
   *  (possibly unchanged) graph. Three kinds of op land here:
   *   • An **Agent Commons CRUD** op (D6/D9/D10/D7) edits a *registry*, not the graph,
   *     so it's executed through the same mutator the Agents hub uses (the D8 funnel +
   *     the 409 guards) — Claude proposing it and the user confirming the card is just
   *     another caller of that one seam. A stale reference (the agent was removed after
   *     the proposal) is a `ConflictError` → 409.
   *   • `attach-context` is a live-session effect, not a graph edit (the caller applies
   *     it), so it's a graph no-op here.
   *   • Every other op is a relationship-graph edit, applied by the pure reducer.
   *  All three broadcast `relation.applied` and persist. */
  applyRelationOp(op: RelationOp): RelationGraph {
    switch (op.kind) {
      case 'create-provider':
        // A user-confirmed provider is a proper cascade root: grant everything (the
        // account plan still bounds it), matching the seeded default's explicit '*'.
        this.createProvider({
          label: op.label,
          modelFamily: op.modelFamily,
          effortLevels: ['Low', 'Medium', 'High'],
          authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] },
        })
        break
      case 'create-prompt':
        this.createSystemPrompt({ label: op.label, body: op.body, targetFamily: op.targetFamily })
        break
      case 'create-agent':
        this.createAgentFromRequest({
          label: op.label,
          providerId: op.providerId,
          systemPromptId: op.systemPromptId,
          instructions: op.instructions,
        })
        break
      case 'commission-agent':
        if (!WORKER_AGENTS.has(op.agentId)) {
          throw new ConflictError(`No agent '${op.agentId}' to commission — it may have been removed.`)
        }
        this.createCommission({ agentId: op.agentId, projectId: op.projectId, role: op.role })
        break
      case 'uncommission-agent':
        // Idempotent: a commission already gone (e.g. removed in the hub first) is a
        // benign no-op, not an error — the Contributor is absent either way.
        this.deleteCommission(op.commissionId)
        break
      case 'handoff-agent':
        this.setSessionAgent(op.sessionId, op.agentId) // D16: re-bind the Conversation's driver
        break
      case 'attach-context':
        break // a live-session effect, applied by the caller
      default:
        graph = applyGraphOp(graph, op, mintArtifactId, Date.now())
    }
    emit({ type: 'relation.applied', op, by: 'user' })
    persist()
    return graph
  },
}

/** The scheduled-run daemon: on a cadence, fire a run for a random enabled
 *  routine and broadcast it — so a connected UI sees runs appear with no request
 *  (the ambient-push showcase). Returns a stop handle. In the real product this
 *  is a server-side cron executing the workflow against the Anthropic API. */
export function startRunDaemon(intervalMs = 45_000): () => void {
  const tick = () => {
    const active = schedules.filter((t) => t.enabled)
    if (active.length === 0) return
    // Vary by the run counter rather than Math.random for reproducibility.
    const task = active[runSeq % active.length]
    store.runSchedule(task.id)
  }
  const handle = setInterval(tick, intervalMs)
  return () => clearInterval(handle)
}
