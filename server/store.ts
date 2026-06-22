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

export const store = {
  epoch: EPOCH,

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
    }))
  },
  /** A full session by id (messages/artifacts/repo included). */
  getSession(id: string): Session | undefined {
    return SESSIONS.find((s) => s.id === id)
  },
  demoSessionId: DEMO_SESSION_ID,

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
