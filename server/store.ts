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
 *  state — reservations, the live agent registry — is deliberately not persisted.)
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
import { createUsageMeter, estimateTokens } from './usage.ts'
import { AgentRegistry } from './registry.ts'
import { AgentJournal } from './journal.ts'
import { ResourceGuardian } from './guardian.ts'
import { LOCAL_AGENT_SEED } from './data/agents.ts'
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
// like the live agent registry, it rebuilds from seed on restart.
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

// The native-agent registry — the broker's live view of connected hosts. In
// native/mock mode we seed the co-located agent (the one-agent registry the
// static capabilities describe); a remote web server seeds none.
const registry = new AgentRegistry(emit)
if (NATIVE) registry.register(LOCAL_AGENT_SEED)

// The effect journal — each agent's authoritative log of its host's effects (D2)
// + the server's projection of it. Emits `agent.effect` as effects project.
const journal = new AgentJournal(emit)

// The resource guardian — per shared resource (a context element), a reservation
// ledger enforcing a capacity invariant (D5). The escrow that lets the broker
// refuse a second session's irreversible write up front. Emits `reservation.changed`.
const guardian = new ResourceGuardian(emit)

// ── Filesystem persistence ──────────────────────────────────────────────────
// Off until the real server entrypoint calls `store.initPersistence()`; tests
// drive the store in-memory. When on, every mutation snapshots the UI-owned state
// and writes it atomically, so a sent message / attached context / created session
// survives a restart. Reservations + the agent registry are intentionally NOT
// persisted: they're live/transient (a stale lock or a phantom offline agent must
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
    seq: {
      session: sessionSeq,
      message: messageSeq,
      schedule: scheduleSeq,
      run: runSeq,
      artifact: artifactSeq,
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
  sessionSeq = s.seq.session
  messageSeq = s.seq.message
  scheduleSeq = s.seq.schedule
  runSeq = s.seq.run
  artifactSeq = s.seq.artifact
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

  // ── Native-agent registry + effect journal ──
  /** The live registry of native agents + their advertised capabilities. The
   *  agent routes read/mutate this; changes broadcast ambient `agent.*` events. */
  registry,
  /** Each agent's authoritative effect log + the server's projection of it (D2).
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
  /** The usage snapshot the composer gauge renders: the open session's real
   *  context-window fill (system+tools baseline + an estimate of every message in
   *  the thread) plus the live plan windows. `sessionId` selects which thread the
   *  context figure reflects; omitted = baseline only. */
  usage(sessionId?: string): UsageSnapshot {
    let messageTokens = 0
    const session = sessionId ? SESSIONS.find((s) => s.id === sessionId) : undefined
    for (const m of session?.messages ?? []) messageTokens += estimateTokens(m.content)
    return usageMeter.snapshot(messageTokens)
  },

  // ── Schedule templates (the "New schedule" starters) ──
  scheduleTemplates(): ScheduleTemplate[] {
    return SCHEDULE_TEMPLATES
  },

  // ── Entity graph (Projects / Artifacts / Schedules + the relationship graph) ──
  listProjects(): Project[] {
    return PROJECTS
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
  /** Apply a confirmed relation op (the canonical write), broadcast it, and
   *  return the updated graph. `attach-context` is a live-session effect, not a
   *  graph edit, so it's a no-op here. */
  applyRelationOp(op: RelationOp): RelationGraph {
    if (op.kind !== 'attach-context') {
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
