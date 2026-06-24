/** ── The mock backend's state + event bus ──────────────────────────────────
 *  In-memory, seeded from server/data. In the real product this is a database +
 *  the Anthropic API; here it's plain objects the routes read and mutate, plus a
 *  tiny pub/sub the SSE channels subscribe to. Refresh-resets, like the rest of
 *  the mock — restarting the server reseeds (a new `epoch` tells clients to drop
 *  their cache).
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
  ContextTypeId,
  DiffLine,
  DispatchRun,
  Message,
  Project,
  RecentsSnapshot,
  RelationGraph,
  RelationOp,
  RunSessionEntry,
  SavedContextsSnapshot,
  ScheduledRun,
  ScheduledTask,
  ScheduleTemplate,
  ServerEvent,
  Session,
  SessionContext,
  UsageSnapshot,
} from '../contract/index.ts'
import {
  applyGraphOp,
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
import { USAGE } from './data/usage.ts'
import { AgentRegistry } from './registry.ts'
import { AgentJournal } from './journal.ts'
import { ResourceGuardian } from './guardian.ts'
import { LOCAL_AGENT_SEED } from './data/agents.ts'

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
// Monotonic counters for server-minted session + message ids. The conversation is
// now server-owned (a sent turn persists; a draft materializes into a real session
// on first send), so the backend mints these — the client no longer fabricates them.
let sessionSeq = 0
let messageSeq = 0

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

// Per-session attached contexts — the *attachment of record* (Primitive 1 of
// docs/shared-resource-coordination.md). Server-owned so every effect a session
// initiates can be mediated by naming one of these (Tiers A–C). Seeded for the
// demo sessions; created state is in-memory (mock semantics, refresh-resets).
const sessionContextBindings = new Map<string, SessionContext[]>([
  ['insights-launch', [{ id: 'repo-insights', type: 'repo', label: 'insights-dashboard', scope: '~/projects/insights-dashboard' }]],
  ['auth-refactor', [{ id: 'repo-auth', type: 'repo', label: 'auth-service', scope: '~/projects/auth-service' }]],
])

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

  // ── Capabilities (what this backend variant can do) ──
  /** The UI gates native-only affordances on these flags — never on sniffing
   *  Electron vs web. A native sidecar reports the local-* flags true; a remote
   *  web server reports them false (and the native endpoints 409). */
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
      updatedLabel: s.updatedLabel,
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
  /** A full session by id (messages/artifacts/repo included). */
  getSession(id: string): Session | undefined {
    return SESSIONS.find((s) => s.id === id)
  },
  demoSessionId: DEMO_SESSION_ID,

  /** Mint a server-owned message id. The conversation is the system of record, so
   *  persisted messages carry the backend's id — not one the client fabricated. */
  mintMessageId(role: 'user' | 'assistant'): string {
    return `m-${role[0]}-${(messageSeq += 1)}`
  },

  /** Materialize a new persisted session — the desktop app's "New chat" the moment
   *  it's first sent to. `firstMessage` seeds the title (its first words) + preview.
   *  Added to the live list + broadcast (`session.updated`) so every sidebar shows
   *  it; created state is in-memory (mock semantics, refresh-resets). */
  createSession(firstMessage?: string): Session {
    const now = Date.now()
    const session: Session = {
      id: `sess-${(sessionSeq += 1)}`,
      title: titleFrom(firstMessage),
      caps: ['chat'],
      updatedLabel: 'now',
      preview: (firstMessage ?? '').slice(0, 120),
      messages: [],
      status: 'active',
      environment: 'local',
      createdAt: now,
      updatedAt: now,
    }
    SESSIONS.unshift(session)
    emit({ type: 'session.updated', session })
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
    session.updatedLabel = 'now'
    session.updatedAt = Date.now()
    emit({ type: 'session.updated', session })
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
    return session
  },
  /** Delete a session (the row menu's "Delete"). Splices it from the seed and
   *  broadcasts a refresh; a server restart reseeds it (mock semantics). */
  removeSession(id: string): boolean {
    const i = SESSIONS.findIndex((s) => s.id === id)
    if (i === -1) return false
    const [removed] = SESSIONS.splice(i, 1)
    emit({ type: 'session.updated', session: removed })
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
    return next
  },

  // ── Dispatch ──
  /** The agent-run feed shown in the Dispatch section. */
  listDispatch(): DispatchRun[] {
    return DISPATCH_RUNS
  },

  // ── Contexts (the set-up ones, on the Contexts page) ──
  savedContexts(): SavedContextsSnapshot {
    return {
      contexts: SAVED_CONTEXTS,
      connectedConnectorIds: CONNECTED_CONNECTOR_IDS,
      connectedMcpIds: CONNECTED_MCP_IDS,
    }
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
  /** The usage snapshot the composer gauge renders. Mock: a fixture; a real
   *  backend reads the account's live meter + the open session's context fill. */
  usage(): UsageSnapshot {
    return USAGE
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
  /** Run a routine now: append a 'running' run, broadcast it, and finish it after
   *  a beat (the daemon uses the same path on a cadence). */
  runSchedule(id: string): ScheduledRun | undefined {
    const task = schedules.find((t) => t.id === id)
    if (!task) return undefined
    const run: ScheduledRun = {
      id: `run-live-${(runSeq += 1)}`,
      status: 'running',
      when: 'Just now',
      absolute: 'moments ago',
      duration: '—',
      reachedStep: 0,
      summary: 'Running on demand…',
      at: 0,
    }
    task.runs = [run, ...task.runs]
    const sessionId = runSessionId(task.id, run.id)
    emit({ type: 'run.started', taskId: task.id, taskName: task.name, sessionId, run })
    setTimeout(() => {
      run.status = 'ok'
      run.reachedStep = task.steps.length
      run.duration = `${8 + task.steps.length * 3}s`
      run.summary = `Ran on demand — delivered to ${task.delivery.target}`
      task.lastStatus = 'ok'
      emit({ type: 'run.finished', taskId: task.id, taskName: task.name, sessionId, run })
    }, 1600)
    return run
  },
  /** Set a routine's enabled state — to an explicit value, or toggle when the
   *  value is omitted. */
  setScheduleEnabled(id: string, enabled?: boolean): ScheduledTask | undefined {
    const task = schedules.find((t) => t.id === id)
    if (!task) return undefined
    task.enabled = enabled ?? !task.enabled
    return task
  },
  /** Add a routine from a template (lands paused), return it. */
  addSchedule(seed: Omit<ScheduledTask, 'id'>): ScheduledTask {
    const task: ScheduledTask = { ...seed, id: `s-new-${(scheduleSeq += 1)}` }
    schedules.unshift(task)
    return task
  },
  /** Remove a routine. */
  removeSchedule(id: string): void {
    const i = schedules.findIndex((t) => t.id === id)
    if (i >= 0) schedules.splice(i, 1)
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
      graph = applyGraphOp(graph, op, mintArtifactId)
    }
    emit({ type: 'relation.applied', op, by: 'user' })
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
