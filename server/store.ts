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
  ToolActivity,
  UpdateScheduleRequest,
  UsageSnapshot,
} from '../contract/index.ts'
import {
  applyGraphOp,
  connectorsFor,
  emptyGraph,
  recentEntries,
  runPrompt,
  runRecap,
  runSessionId,
  seedGraph,
} from '../contract/index.ts'
import { SESSIONS } from './data/sessions.ts'
import { DISPATCH_RUNS, SCHEDULE_TEMPLATES, PROJECTS, ALL_ARTIFACTS, SCHEDULED_TASKS } from './data/cowork.ts'
import {
  DEFAULT_RECENT_IDS,
  GITHUB_REPO_OPTIONS,
  LOCAL_REPO_OPTIONS,
} from './data/contextOptions.ts'
import { join } from 'node:path'
import { fsReader, type FsReader } from './fs.ts'
import type { FsCatalog, FsFileContent, FsFolderContents, FsSource, Identity } from '../contract/index.ts'
import { fsRecentKey } from '../contract/index.ts'
import { resolveIdentity, ANONYMOUS_IDENTITY, LOCAL_IDENTITY } from './identity.ts'
import { positiveNumberEnv, nonNegativeIntEnv } from './env.ts'
import { SAVED_CONTEXTS, CONNECTED_CONNECTOR_IDS, CONNECTED_MCP_IDS } from './data/savedContexts.ts'
import { connectorDetail } from './data/connectorDetails.ts'
import { connectorActionResult } from './model/connectorTools.ts'
import { ARTIFACT_CONTENT } from './data/artifactContent.ts'
import { createUsageMeter, estimateTokens, mintBudget } from './usage.ts'
import { mintAuthority } from './authority.ts'
import { ConflictError, ValidationError } from './conflict.ts'
import { LimitError } from './limit.ts'
import { scopeMatches } from './runner-runtime.ts'
import { contextBreakdown, intersectAuthority, authorityAdmits, projectAdmittedAuthority, unrestricted, isProjectEffectMonotonic, rolePermits, roleRank, PROJECT_ROLES, clampAuthority, clampBudget, probeScore, SEARCH_GROUP_CAP, NOTIFICATION_CAP } from '../contract/index.ts'
import type { Agent, AgentChangeProposal, AgentDirectoryEntry, AgentResolvedItem, AppNotification, AuditEntry, ProposalCheck, Authority, Budget, CapabilityType, Commission, CreateAgentRequest, ModelInfo, ModelProvider, OpenSubGoal, OwnerActivity, OwnerProfile, PostOpenSubGoalRequest, PrincipalRef, ProjectAction, ProjectDirectoryEntry, ProjectEffectResult, ProjectEffectType, ProjectRole, ProjectSubGoal, PromptProbeResult, ProposeAgentChangeRequest, ProxyRequest, ProxyResult, Reservation, SearchGroup, SearchHit, SearchResponse, SystemPromptEntry, UpdateAgentRequest, UpdateCommissionRequest, WatchState, WorkItemComment } from '../contract/index.ts'
import { DEFAULT_PROVIDER, DEFAULT_PROVIDER_CONFIG, SEED_PROVIDERS, SEED_PROVIDER_CONFIGS, ProviderProbeError, validApiKeyEnv, type ProviderConfig } from './data/providers.ts'
import { SYSTEM_PROMPTS, SP_DEFAULT_ID, DEFAULT_SYSTEM_PROMPT_BODY } from './data/prompts.ts'
import { SEED_COMMISSIONS } from './data/commissions.ts'
import { TOOL_DEFINITIONS } from './model/tools.ts'
import { systemPrompt, resolvedModelId } from './generate.ts'
import { RunnerRegistry } from './registry.ts'
import { RunnerJournal } from './journal.ts'
import { RelayRuntime, hashRelaySecret, mintRelaySecret, relaySecretHint, sameSecretHash } from './relay.ts'
import { ResourceGuardian, GuardianError } from './guardian.ts'
import { LOCAL_RUNNER_SEED, RUNNER_FS_ROOTS } from './data/runners.ts'
import { DEFAULT_AGENT } from './data/workers.ts'
import { EMPTY_WORKSPACE, workspaceFromSeed } from './workspace.ts'
import { STORE_VERSION, loadState, saveState, type PersistedState, type StoredNotification, type StoredAgentProposal, type StoredA2aPeer, type StoredOpenSubGoal, type StoredWorkItemComment } from './persist.ts'
import { eventlog } from './eventlog.ts'
import { accounts } from './accounts.ts'

/** An ambient-event subscriber. `seq` is the event's global sequence number
 *  (server/eventlog.ts — the SSE `id:` field that makes the stream resumable);
 *  optional so existing single-arg subscribers stay valid. */
type Listener = (e: ServerEvent, seq?: number) => void

/** A monotonic-ish boot id. Math.random/Date are fine here (server side, not in
 *  the resumable-workflow sandbox); a fresh value each boot signals a reseed. */
const EPOCH = `e${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

// Which backend variant this process is: the default mock behaves like a NATIVE
// sidecar (it can touch the OS); `BACKEND=remote` makes it behave like a remote
// web server (native ops report unavailable). Same API, two fulfilments — this is
// how the one UI runs in both scenarios without env-sniffing (it reads the flags).
const BACKEND_MODE: 'mock' | 'remote' = process.env.BACKEND === 'remote' ? 'remote' : 'mock'
const NATIVE = BACKEND_MODE !== 'remote'

/** The tenant a tenant-scoped entity belongs to when it carries none — the backend's
 *  default principal's tenant (personal on desktop/mock; the web tenant on remote). Used
 *  to stamp created entities and to bucket seed/legacy rows so they're visible to the
 *  default reader on BOTH backends (F2 / PD9). Threading the *request's* tenant into the
 *  store mutators is a later slice; until then writes default here, matching the reads. */
function defaultTenantId(): string {
  return resolveIdentity(BACKEND_MODE).tenant.id
}

/** Whether an UNSTAMPED (seed/legacy) row is visible to `tenantId`. The untagged
 *  seeds are the FLAGSHIP demo world (docs/demo-accounts.md): they belong to the
 *  backend's default principal AND to Ada/Acme — the same seat's two faces (the
 *  desktop's local user; the web's default principal) — so the flagship dataset
 *  reads identically on both backends, and signing in as Ada on the desktop
 *  shows the same flagship world instead of an empty one. This never widens
 *  user data: every RUNTIME-created row is stamped with its creator's tenant at
 *  creation, so only seed rows are ever unstamped. (Ownership checks for writes
 *  still resolve to `defaultTenantId()` — visibility is the demo affordance,
 *  authority stays strict.) */
function seedVisibleTo(tenantId: string): boolean {
  return tenantId === defaultTenantId() || tenantId === 'tenant-acme'
}

/** FWD-6 O-D5 — member access is a UNION at the walls, never a switched world:
 *  a caller READS as their namespace plus every org they hold a seat in;
 *  owner-grade WRITES require the org's `owner` seat. One funnel pair, so the
 *  rule can't drift per surface (in practice only Projects carry org stamps —
 *  sessions/artifacts stamp their creator — so the union is precise by
 *  construction). Dev-seam synthetic tenants hold no seats (`seatIn` is
 *  namespace-rooted), so impersonation tests see exactly the old walls. */
function tenantReadsAs(callerTenant: string, owner: string): boolean {
  return owner === callerTenant || accounts.seatIn(callerTenant, owner) !== undefined
}
function tenantWritesAs(callerTenant: string, owner: string): boolean {
  return owner === callerTenant || accounts.seatIn(callerTenant, owner) === 'owner'
}

/** The tenant-visibility test every scoped read shares: a stamped row matches
 *  the caller's READ union (their namespace + org seats, FWD-6); an unstamped
 *  row follows the flagship rule above. */
function rowVisibleTo(row: { tenantId?: string }, tenantId: string): boolean {
  return row.tenantId ? tenantReadsAs(tenantId, row.tenantId) : seedVisibleTo(tenantId)
}

// ── Served filesystem sources (the Files / Photos / Folder context types) ──────
// Those three types are served from a REAL filesystem (contract/fs.ts, server/fs.ts).
// The web backend's own "cloud storage" is one source: a real directory it reads +
// serves over /fs/* — the in-repo `sample-cloud/` by default (deterministic,
// reviewable), env-overridable to a real path. Available on BOTH backends (it's the
// only source on a bare remote web server). Runner-host sources are resolved in
// `resolveFsReader` (the broker proxies each runner); the UI-host source is
// client-side and never resolved here.
const CLOUD_ROOT = process.env.CONTEXT_CLOUD_ROOT ?? join(process.cwd(), 'sample-cloud')
const cloudReader = fsReader(CLOUD_ROOT)
const CLOUD_SOURCE: FsSource = { id: 'cloud', kind: 'cloud', label: 'Cloud storage' }

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

/** Pristine seed sessions, captured before any rehydrate mutates SESSIONS in
 *  place — the reference `reconcileSeedTenancy` re-ensures rows/stamps from
 *  (SCHEDULED_TASKS / DISPATCH_RUNS stay pristine on their own: `schedules` /
 *  `dispatch` are deep copies, but `SESSIONS` is spliced directly). */
const SEED_SESSIONS: readonly Session[] = JSON.parse(JSON.stringify(SESSIONS))
// (Seeded runs materialize their session rows below, right after the mint-funnel
// definitions — deliberately AFTER this pristine capture: run sessions are
// derived rows, re-ensured from the schedules on every boot, not seed-session
// rows for reconcileSeedTenancy to manage.)
// The detective audit trail (docs/agent-commons.md, D15/OQ7) — an append-only log of
// effects on the cross-user channels (proxy / Project effect / commissioned host invoke),
// recorded whether fulfilled or denied. Persisted (additive) so the watch survives a
// restart. Unbounded in the prototype (the demo volume is tiny); production would rotate it.
const auditLog: AuditEntry[] = []
let auditSeq = 0

// The Project open-work backlog (docs/agent-commons.md, D19) — posted work items, the
// issues-tray analog. Persisted (additive, like `auditLog`) so an un-taken item survives
// a restart; standing dispatch is synchronous at post time, so nothing in-flight ever
// needs crash recovery — only the items themselves persist.
// The stored work-item shape (`StoredOpenSubGoal`, server/persistence/format.ts):
// the wire type plus the poster's RAW tenant id — the strict authorization anchor
// for retract (review finding: display names are attacker-controlled —
// `createWorkspace` has no uniqueness guard — so a name comparison would let a
// colliding-name tenant close a victim's items) — and the acting principals of its
// post/retract acts (FWD-5 Phase 1). Server-private, stripped below.

/** The comment redaction seam stored → wire: drop the principal, serve its KIND. */
function publicWorkItemComment(c: StoredWorkItemComment): WorkItemComment {
  const { principal, ...pub } = c
  return { ...pub, ...(principal ? { authorKind: principal.kind } : {}) }
}

/** The one redaction seam stored → wire: drop the poster's raw tenant id and the
 *  act principals; the wire face carries display names + principal KINDs only. */
function publicOpenSubGoal(item: StoredOpenSubGoal): OpenSubGoal {
  const { postedByTenant, postedByPrincipal, retractedByPrincipal, comments, ...pub } = item
  void postedByTenant
  return {
    ...pub,
    ...(postedByPrincipal ? { postedByKind: postedByPrincipal.kind } : {}),
    ...(retractedByPrincipal ? { retractedByKind: retractedByPrincipal.kind } : {}),
    ...(comments ? { comments: comments.map(publicWorkItemComment) } : {}),
  }
}

const openSubGoals: StoredOpenSubGoal[] = []
let openSubGoalSeq = 0
// D23 discussion bounds — enough to coordinate, not a blob store (a hostile poster
// gets a cap, not a forum). Coarse by design; the design log records the trade-off.
const MAX_WORK_ITEM_COMMENTS = 100
const MAX_WORK_ITEM_COMMENT_CHARS = 2000
// D29 — max notification RECIPIENTS one comment's `@mentions` may fan out to (review
// F1: the cap is on resolved targets, not token matches — a display name borne by K
// workspaces still can't ring K bells, so a comment can't become an amplifier).
const MENTION_CAP = 10
// Longest display name (chars) resolvable as a mention target. Bounds the per-`@`
// candidate scan so parsing is O(bodyLen) — independent of registry size AND its
// first-char distribution (review F2: a bucket index still scanned O(bucketSize) when
// names clustered on one first char). A name longer than this simply isn't mentionable.
const MENTION_MAX_NAME_LEN = 80

// ── D24 — watching + the per-tenant notification inbox ──────────────────────
// Watch subscriptions: projectId → the tenant ids watching it. Persisted as
// [tenantId, projectId] pairs (a project has many watchers).
const watches = new Map<string, Set<string>>()
// The inbox: derived, capped, disposable rows (the acts themselves remain on their
// backlogs/profiles). Each row carries its RECIPIENT tenant — server-private; the
// tenant-scoped read serves only the caller's own rows, without the field.
const notifications: StoredNotification[] = []
let notificationSeq = 0

// ── D25 — change proposals against published definitions, keyed by agent id ──
const AGENT_PROPOSALS = new Map<string, StoredAgentProposal[]>()

// ── D28 — registered A2A peers (verified identity at the edge) ───────────────
const A2A_PEERS = new Map<string, StoredA2aPeer>()
let a2aPeerSeq = 0

/** Wire face of a peer: everything but the hash. */
function publicPeer(p: StoredA2aPeer): A2aPeer {
  const { tokenHash, ...pub } = p
  void tokenHash
  return pub
}
// Proposal bounds — a review queue, not a blob store (the D23 posture).
const MAX_OPEN_PROPOSALS = 20
const MAX_PROPOSAL_PROMPT_CHARS = 8000
const MAX_PROPOSAL_NOTE_CHARS = 2000

/** The one redaction seam stored → wire: drop the proposer's raw tenant id and the
 *  act principals (FWD-5 Phase 1); serve display names + principal KINDs only. */
function publicProposal(p: StoredAgentProposal): AgentChangeProposal {
  const { proposedByTenant, proposedByPrincipal, comments, ...pub } = p
  void proposedByTenant
  return {
    ...pub,
    ...(proposedByPrincipal ? { proposedByKind: proposedByPrincipal.kind } : {}),
    ...(comments ? { comments: comments.map(publicWorkItemComment) } : {}),
  }
}

/** The review check (D27) — computed at read time for a prompt-changing proposal:
 *  the D10 static-tag face (which authored-for tag the replacement would discard,
 *  which provider family it runs on). Advisory, never gating; a scored probe of
 *  untagged bespoke text would be fabricated, so v1 reports what is knowable. */
function proposalCheck(p: StoredAgentProposal, agent: Agent): ProposalCheck | undefined {
  if (p.fields.systemPrompt === undefined) return undefined
  const providerFamily = resolveProvider(agent.providerId).modelFamily ?? 'claude'
  const replaced = agent.systemPromptId ? SYSTEM_PROMPT_LIB.get(agent.systemPromptId) : undefined
  return {
    providerFamily,
    ...(replaced ? { replacesFamily: replaced.targetFamily } : {}),
    note: replaced
      ? `Replaces a prompt authored for ${replaced.targetFamily} with untagged text; it will run on the ${providerFamily} family — run the fit probe after merging (D10).`
      : `Replaces the current prompt with untagged text; it will run on the ${providerFamily} family — run the fit probe after merging (D10).`,
  }
}

/** A proposal as SERVED: the redacted row plus its computed check. */
function serveProposal(p: StoredAgentProposal, agent: Agent): AgentChangeProposal {
  const check = proposalCheck(p, agent)
  return { ...publicProposal(p), ...(check ? { check } : {}) }
}

/** Fan one public act out to its interested tenants (D24), always MINUS the actor
 *  (you don't need a bell for what you just did). Synchronous and unbatched — the
 *  seam where a real digest/queue would go. No persist() here: every call site
 *  persists after its own mutation. */
function notifyTenants(
  recipients: Iterable<string>,
  actorTenant: string,
  row: Omit<StoredNotification, 'id' | 'read' | 'at' | 'tenantId'>,
): void {
  const at = Date.now()
  const unique = new Set(recipients)
  unique.delete(actorTenant)
  for (const tenantId of unique) {
    notifications.push({ ...row, id: `ntf-${(notificationSeq += 1)}`, tenantId, at, read: false })
    // Per-tenant cap: evict oldest (a pointer cache, not a second history).
    const mine = notifications.filter((x) => x.tenantId === tenantId)
    if (mine.length > NOTIFICATION_CAP) {
      const drop = new Set(mine.slice(0, mine.length - NOTIFICATION_CAP).map((x) => x.id))
      for (let i = notifications.length - 1; i >= 0; i -= 1) {
        if (drop.has(notifications[i].id)) notifications.splice(i, 1)
      }
    }
    emit({ type: 'notification.changed', tenantId })
  }
}

/** A work item's interested tenants: the Project's watchers, its owner, and the
 *  item's poster (participants are implicit watchers of their thread) — RE-CHECKED
 *  against the Project's visibility AT MINT TIME (review finding: watches and the
 *  poster anchor outlive an un-share, and a notification must never tell a tenant
 *  something the walls wouldn't show it if it went looking — so on a now-private
 *  Project the audience collapses to the owner alone). */
function workItemAudience(item: StoredOpenSubGoal): Set<string> {
  const project = findProject(item.projectId)
  const ownerTenant = project?.tenantId ?? defaultTenantId()
  if (project?.shared !== true) return new Set([ownerTenant])
  const out = new Set<string>(watches.get(item.projectId) ?? [])
  out.add(ownerTenant)
  if (item.postedByTenant) out.add(item.postedByTenant)
  return out
}

/** The workspaces a comment names with `@<display name>` (D29), resolved SERVER-SIDE
 *  against the account registry (the client never receives an enumerable name list —
 *  a mention can't become an identity oracle). Match rules: the `@` must follow a
 *  non-word char (so an email local part like `ada@acme` is NOT a mention); the name
 *  that follows is the LONGEST registered display name whose end lands on a word
 *  boundary (so `@Beta Platform` binds the two-word name, and `@Ada` won't match
 *  inside `@Adam`). "Word char" is Unicode-aware (`\p{L}\p{N}_`), matching the client
 *  highlighter and excluding `x_@Name` / `@Name_x` (review F3). A display name is not
 *  unique (createWorkspace has no guard), so a match resolves to the tenants bearing
 *  it — the display name IS the public identity the whole system trusts; case-folded,
 *  like a handle. The result set is HARD-capped at MENTION_CAP *recipients* — NOT
 *  token matches — so a name borne by K workspaces can't fan one comment out to K
 *  bells (review F1): a self-serviceable notification amplifier. Resolution is a
 *  length-descending HASH lookup (the longest candidate substring that is a registered
 *  name and ends on a boundary wins), so the work per `@` is O(MENTION_MAX_NAME_LEN²) —
 *  bounded, independent of registry size AND its first-char distribution (review F2:
 *  a first-char bucket still scanned O(bucketSize) when names clustered on one char).
 *  Never widens visibility — the caller decides whether to honour the result (only a
 *  shared Project does; see commentOnOpenSubGoal). */
function resolveMentions(body: string): Set<string> {
  const byName = new Map<string, string[]>() // lower(name) → tenant ids bearing it
  let maxLen = 0 // longest registered (mentionable) name — bounds the per-`@` scan
  for (const [tid, t] of accounts.tenants) {
    const name = t.name
    if (name.length === 0 || name.length > MENTION_MAX_NAME_LEN) continue
    const key = name.toLowerCase()
    const arr = byName.get(key)
    if (arr) {
      arr.push(tid) // a duplicate display name — one key, several bearers
      continue
    }
    byName.set(key, [tid])
    if (name.length > maxLen) maxLen = name.length
  }
  const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch)
  const hits = new Set<string>()
  for (let i = 0; i < body.length && hits.size < MENTION_CAP; i += 1) {
    if (body[i] !== '@' || isWord(body[i - 1])) continue
    // Longest-match by length-descending hash lookup: the longest candidate that is a
    // registered name AND ends on a word boundary wins. O(maxLen²) per `@`, never O(registry).
    const upper = Math.min(maxLen, body.length - (i + 1))
    for (let len = upper; len >= 1; len -= 1) {
      const end = i + 1 + len
      if (isWord(body[end])) continue // the name must end at a boundary
      const ids = byName.get(body.slice(i + 1, end).toLowerCase())
      if (!ids) continue
      for (const tid of ids) {
        hits.add(tid)
        if (hits.size >= MENTION_CAP) break // the resolved-target hard cap (F1)
      }
      i = end - 1 // skip past the matched name
      break
    }
  }
  return hits
}
// Monotonic counters for server-minted session + message ids. The conversation is
// now server-owned (a sent turn persists; a draft materializes into a real session
// on first send), so the backend mints these — the client no longer fabricates them.
let sessionSeq = 0
let messageSeq = 0

// The plan-usage meter (5-hour / weekly windows). Accumulates the model's real
// token usage from every turn (store.recordUsage); the context-window figure is
// computed per session in store.usage. Not persisted — usage windows are a live,
// rolling meter, reseeded on restart (mock semantics).
//
// Usage is metered PER TENANT (F2/PD9): the default tenant owns the seeded demo meter
// (`usageMeter`, so the gauge on the single-tenant mock reads exactly as before, and its
// constant ceilings remain the mint-time cascade root); every other tenant gets its own
// *fresh* meter, created lazily, so one tenant's spend can't deplete another's window or
// leak into another's gauge. `meterFor(t)` resolves the right meter for a caller.
const usageMeter = createUsageMeter(() => Date.now())
const tenantMeters = new Map<string, ReturnType<typeof createUsageMeter>>()
const meterFor = (tenantId?: string): ReturnType<typeof createUsageMeter> => {
  const t = tenantId ?? defaultTenantId()
  if (t === defaultTenantId()) return usageMeter
  let m = tenantMeters.get(t)
  if (!m) {
    m = createUsageMeter(() => Date.now(), false) // a new tenant starts at zero consumption
    tenantMeters.set(t, m)
  }
  return m
}

// Generation-outcome counters (F6 PD31 observability): how each turn resolved — `ok` (the
// model answered), `fallback` (endpoint unreachable/slow → the degraded local reply),
// `aborted` (the turn was EXPLICITLY cancelled via the cancel route — a viewer disconnect
// merely detaches the view and the turn completes; server/turns.ts), `error` (fatal error).
// A global ops counter (model-endpoint health, not per-tenant billing), exposed at /metrics;
// transient like the request counters (reset each boot), so not persisted.
export type GenerationOutcome = 'ok' | 'fallback' | 'aborted' | 'error'
const generationCounts = new Map<GenerationOutcome, number>()
// The real token weight of the resource-manipulation tool schema the backend
// declares on every request (server/model/tools.ts) — injected eagerly, so it's a
// loaded context category, not a deferred one. Static, so computed once.
const SYSTEM_TOOLS_TOKENS = estimateTokens(JSON.stringify(TOOL_DEFINITIONS))

// The seeded worker Agents (docs/agent-commons.md, D6) — one for now, the
// degenerate N=1 case. Every Conversation resolves to it until users create more.
const WORKER_AGENTS = new Map<string, Agent>([[DEFAULT_AGENT.id, DEFAULT_AGENT]])
const resolveAgent = (id?: string): Agent => WORKER_AGENTS.get(id ?? '') ?? DEFAULT_AGENT
let workerAgentSeq = 0

/** Resolve a Project by id across both homes — the seeded set (`PROJECTS`) and the ones
 *  created at runtime (`graph.extraProjects`). The single lookup behind the D13 cap so it
 *  works regardless of where a Project came from. */
const findProject = (id: string): Project | undefined =>
  PROJECTS.find((p) => p.id === id) ?? graph.extraProjects.find((p) => p.id === id)

/** The tenant a project belongs to (F2/PD9) — a seed/legacy or unknown project has no
 *  `tenantId`, so it belongs to the backend's default tenant. */
const projectTenant = (projectId: string): string => findProject(projectId)?.tenantId ?? defaultTenantId()

/** A tenant's public display name (D17 — the directory's `owner` face and an open-work
 *  item's `postedBy`). Resolves through the account registry; an unregistered id (a
 *  test-minted tenant) falls back to the raw id, which is what such a test asserts on. */
const tenantName = (tenantId: string): string => accounts.tenants.get(tenantId)?.name ?? tenantId

/** Resolve an artifact across both homes — seeded (`ALL_ARTIFACTS`) + created
 *  (`graph.extraArtifacts`) — mirroring `findProject`. */
const findArtifact = (id: string): ArtifactItem | undefined =>
  ALL_ARTIFACTS.find((a) => a.id === id) ?? graph.extraArtifacts.find((a) => a.id === id)

/** Agent-Commons registry visibility (F2/PD9). Unlike CONTENT (sessions/projects/artifacts,
 *  where a seed row belongs to the default tenant and is private to it), a registry entry is
 *  INFRASTRUCTURE: a seeded/shared one (no `tenantId` — e.g. the default agent/provider/prompt
 *  every tenant needs) is visible to ALL tenants, while a *created* one is private to its
 *  tenant. No tenant arg ⇒ everything (internal callers / tests). */
const registryVisible = <T extends { tenantId?: string }>(entry: T, tenantId?: string): boolean =>
  tenantId === undefined || entry.tenantId === undefined || entry.tenantId === tenantId

/** P8 role self-assign clamp (B8): a Commission owned by a tenant that is NOT the Project's
 *  owner may not hold a role above 'writer' — only the Project owner grants maintainer/owner.
 *  Both the mint (`createCommission`) and the re-grant (`updateCommission`) run through THIS one
 *  clamp, so a cross-tenant Contributor can't self-elevate via either path (join clamped, then
 *  PATCH-to-owner would be the bypass). reader/writer pass through; owner/maintainer clamp to
 *  writer. `owningTenant` undefined (internal/seed mint) ⇒ no clamp. An owner-driven cross-tenant
 *  elevation path is a Phase 2 item (docs/design/test-plan-coop-lifecycle.md). */
const clampContributorRole = (role: ProjectRole, owningTenant: string | undefined, projectId: string): ProjectRole => {
  // Normalize an unknown/invalid role to the safe baseline first (defense in depth: POST
  // /commissions 400s an invalid role, but the op path casts the JSON body unchecked, so a
  // hand-crafted commission-agent op could carry e.g. 'superadmin' — which must never be stored,
  // else roleRank(invalid) = PROJECT_ROLES.length outranks 'owner' and rolePermits throws on the
  // absent ROLE_ACTIONS key. P8 review finding). Then apply the cross-tenant self-assign clamp.
  const safe: ProjectRole = PROJECT_ROLES.includes(role) ? role : 'writer'
  const projectOwner = findProject(projectId)?.tenantId ?? defaultTenantId()
  if (owningTenant !== undefined && owningTenant !== projectOwner && roleRank(safe) > roleRank('writer')) return 'writer'
  return safe
}

/** The tenant an artifact belongs to (F2/PD9) — seed/legacy or unknown ⇒ the default
 *  tenant (parallels `projectTenant`; independent of the artifact's project). */
const artifactTenant = (artifactId: string): string => findArtifact(artifactId)?.tenantId ?? defaultTenantId()

/** The public face of a SHARED Project shown to a NON-owner (P8): identity + description
 *  only. The owner-scoped membership fields are emptied so the frozen Project object can't
 *  leak the owner's session ids / attached contexts / instructions across the tenant boundary
 *  (the graph's join maps are already owner-scoped; this closes the object-field channel). */
const publicSharedProject = (p: Project): Project => ({
  ...p,
  sessionIds: [],
  contexts: [],
  scheduled: [],
  instructions: '',
})

/** The public face of a Commission on a SHARED Project shown to a NON-owner (P8): the
 *  Contributor IDENTITY (agent / project / role) only. The D12 posture — `authority`, token
 *  `grant`, `reservationId` — is stripped, mirroring what `GET /commissions/:id/authority`
 *  deliberately refuses to leak: the public Contributor list is who-contributes, not the
 *  private reach/budget of another tenant's agent. */
const publicCommission = (c: Commission): Commission => ({
  id: c.id,
  tenantId: c.tenantId,
  agentId: c.agentId,
  // Resolved at READ time (never stored, so it can't go stale on an agent rename): the
  // Contributor's display label — WHO contributes is exactly what the public face is for.
  agentLabel: WORKER_AGENTS.get(c.agentId)?.label,
  projectId: c.projectId,
  role: c.role,
})

/** Project the relation graph to a tenant's view (F2/PD9): a tenant sees only its own
 *  projects/artifacts — seed rows themed per demo account (docs/demo-accounts.md) plus
 *  its created ones — and the join rows that reference an entity it can see. Unstamped
 *  seeds follow the flagship rule (`rowVisibleTo`). Scopes the PROJECT + ARTIFACT axes;
 *  the schedule-only joins are left intact (schedule reads are scoped at the list). */
function projectGraphForTenant(g: RelationGraph, tenantId: string): RelationGraph {
  const projVisible = (pid: string): boolean => {
    const p = findProject(pid)
    return p ? rowVisibleTo(p, tenantId) : seedVisibleTo(tenantId)
  }
  const artVisible = (aid: string): boolean => {
    const a = findArtifact(aid)
    return a ? rowVisibleTo(a, tenantId) : seedVisibleTo(tenantId)
  }
  const byProjValue = (m: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(m).filter(([, pid]) => projVisible(pid)))
  const byProjKey = <V>(m: Record<string, V>): Record<string, V> =>
    Object.fromEntries(Object.entries(m).filter(([pid]) => projVisible(pid)))
  const byArtKey = <V>(m: Record<string, V>): Record<string, V> =>
    Object.fromEntries(Object.entries(m).filter(([aid]) => artVisible(aid)))
  return {
    ...g,
    // A SHARED Project (P8) is visible to every tenant so a non-owner can see it exists and
    // commission onto it — but to a NON-owner it's REDACTED to public metadata: the join maps
    // below are already owner-scoped (projVisible), and the Project object's own membership
    // fields (`sessionIds`/`contexts`/`scheduled`/`instructions`) are stripped here too, else
    // the frozen object leaks the owner's session ids + count across the tenant boundary. The
    // owner keeps the full object.
    extraProjects: g.extraProjects.flatMap((p) => {
      // Stamp the public identity on every emitted row (the D17 posture, now on the
      // projection too): `ownerName` is the workspace DISPLAY name; `own` is
      // viewer-relative and drives the owner/visitor affordance split client-side. A
      // foreign row also drops the raw `tenantId` — the display name is the public
      // face; the raw id of a foreign tenant never crosses (mirrors the directory).
      const ownerName = tenantName(p.tenantId ?? defaultTenantId())
      if (rowVisibleTo(p, tenantId)) {
        // FWD-6 O-D6: `own` is WRITE-grade — the owner tenant itself, or an org
        // OWNER seat. A member sees the full object (they're inside the wall)
        // with visitor-style affordances (own: false).
        return [{ ...p, ownerName, own: p.tenantId ? tenantWritesAs(tenantId, p.tenantId) : true }]
      }
      return p.shared === true ? [{ ...publicSharedProject(p), ownerName, own: false, tenantId: undefined }] : []
    }),
    extraArtifacts: g.extraArtifacts.filter((a) => rowVisibleTo(a, tenantId)),
    sessionProject: byProjValue(g.sessionProject),
    // An artifact→project row needs the artifact visible; the value is gated on project
    // visibility ONLY when it's a real project id — `''` is the reducer's "unfiled"
    // sentinel (refile → projectId:null), not a project, so it must survive for the owner
    // (else the client resolves `artifactProject[id] ?? art.projectId` back to the original
    // project and the unfile silently snaps back in a non-default tenant's own view).
    artifactProject: Object.fromEntries(Object.entries(g.artifactProject).filter(([aid, pid]) => artVisible(aid) && (pid === '' || projVisible(pid)))),
    scheduleProject: byProjValue(g.scheduleProject),
    projectContexts: byProjKey(g.projectContexts),
    projectInstructions: byProjKey(g.projectInstructions),
    // The README is the PUBLIC "about" (D26): unlike instructions (owner-scoped),
    // its row survives for any viewer of a SHARED project — the same visibility
    // the project object itself has in this projection.
    projectReadmes: Object.fromEntries(
      Object.entries(g.projectReadmes).filter(([pid]) => {
        if (projVisible(pid)) return true
        const p = findProject(pid)
        return p?.shared === true
      }),
    ),
    artifactSource: byArtKey(g.artifactSource),
  }
}

// The registered Model providers (docs/agent-commons.md, D9) — the cognition source
// each Agent binds. One seeded for now (the degenerate N=1 case), wrapping the single
// implicit Anthropic client. The contract `ModelProvider` is paired with its
// server-only `ProviderConfig` (credentials / concrete model id) by id — the config
// never leaves the server, mirroring how `Capabilities` hides the key.
const MODEL_PROVIDERS = new Map<string, ModelProvider>(SEED_PROVIDERS.map((p) => [p.id, p]))
const PROVIDER_CONFIGS = new Map<string, ProviderConfig>(SEED_PROVIDER_CONFIGS)
const resolveProvider = (id?: string): ModelProvider => MODEL_PROVIDERS.get(id ?? '') ?? DEFAULT_PROVIDER
let providerSeq = 0

// ── Provider model catalogs (the flexible per-provider model list) ───────────
// A provider may carry a `models` catalog (contract `ModelInfo[]` — every metadata
// field optional, absence = unknown), obtained from its endpoint's list API
// ('listed') or declared on the request ('static'). These helpers are the single
// validation/replacement funnel for both.

/** Refuse a malformed caller-declared catalog loudly (INV-9: an invalid value is
 *  refused, never silently normalized). `undefined` = no catalog, always valid. */
function assertCatalogModels(models: ModelInfo[] | undefined): void {
  if (models === undefined) return
  if (!Array.isArray(models) || models.length === 0) {
    throw new ValidationError('`models` must be a non-empty array of catalog entries.')
  }
  const seen = new Set<string>()
  for (const m of models) {
    if (!m || typeof m.id !== 'string' || !m.id || typeof m.label !== 'string' || !m.label) {
      throw new ValidationError('Every catalog model needs a non-empty string `id` and `label`.')
    }
    if (seen.has(m.id)) throw new ValidationError(`Duplicate catalog model id '${m.id}'.`)
    seen.add(m.id)
  }
}

/** The provider a session's turns effectively route through — the same INV-9
 *  inherit chain the messages route resolves (`session pick ?? agent's ?? default`).
 *  Shared by the model-pick wall, the catalog-refresh sweep, and the usage snapshot
 *  so "which provider is this session on" has exactly one answer. */
function effectiveProviderOf(session?: Session): ModelProvider {
  return resolveProvider(session?.providerId ?? resolveAgent(session?.agentId).providerId)
}

/** The session-modelId wall: a concrete model pick must name an entry in the
 *  effective provider's catalog — an unknown id (or a pick on a provider that
 *  enumerates nothing) is refused, never normalized. */
function assertModelInCatalog(modelId: string, providerId?: string, agentId?: string): void {
  const provider = resolveProvider(providerId ?? resolveAgent(agentId).providerId)
  if (provider.models?.some((m) => m.id === modelId)) return
  throw new ValidationError(
    provider.models?.length
      ? `Provider '${provider.label}' lists no model '${modelId}' — the pick must name a catalog entry.`
      : `Provider '${provider.label}' doesn't enumerate models — a concrete model can't be picked on it.`,
  )
}

/** THE model-pick invariant, enforced centrally: a stored `session.modelId`
 *  always names an entry in the catalog of the provider the session CURRENTLY
 *  resolves to. Re-validates every held pick against the live resolution and
 *  clears the ones whose namespace moved (each cleared row broadcast so open
 *  composers reconcile). Called by every mutation that can change a session's
 *  effective provider or its catalog — the direct paths (session provider patch,
 *  provider delete) clear inline where they already hold the row, and the
 *  indirect ones (catalog replacement, an Agent re-bind, an Agent hand-off, an
 *  Agent delete) run this sweep — so a validated-once pick can never dangle. */
function sweepSessionModelPicks(): void {
  for (const s of SESSIONS) {
    if (!s.modelId) continue
    const provider = effectiveProviderOf(s)
    if (provider.kind !== 'session' && provider.models?.some((m) => m.id === s.modelId)) continue
    delete s.modelId
    emit({ type: 'session.updated', session: s })
  }
}

/** Replace a provider's model catalog (registration fetch, static declaration, or
 *  the refresh route) and stamp how it was obtained. Session model picks the new
 *  catalog no longer lists are cleared by the invariant sweep — the same
 *  documented cascade as a provider delete (the pick's namespace changed). */
function replaceProviderModels(id: string, models: ModelInfo[], source: 'listed' | 'static'): ModelProvider | undefined {
  const current = MODEL_PROVIDERS.get(id)
  if (!current) return undefined
  assertCatalogModels(models)
  const next: ModelProvider = { ...current, models, catalogSource: source }
  MODEL_PROVIDERS.set(id, next)
  sweepSessionModelPicks()
  persist()
  return next
}

// The system-prompt library (docs/agent-commons.md, D10) — reusable, target-family-
// tagged prompts a user picks for an Agent. Seeded; the (prompt × provider) fit check
// is the pure `promptFitWarning` (contract), surfaced in the picker at selection.
const SYSTEM_PROMPT_LIB = new Map<string, SystemPromptEntry>(SYSTEM_PROMPTS.map((p) => [p.id, p]))
let systemPromptSeq = 0

// Per-tenant default flags for the two agent-binding registries (providers + system
// prompts) — a **UI pre-selection shortcut**, nothing more: the flagged entry is what
// a picker pre-selects; the API never resolves an absent binding to it (see
// `ValidationError`). A pointer, not a stored field, so at-most-one-per-tenant holds
// by construction and the flag is stamped viewer-relative at serve time (a private
// entry flagged by tenant A never reads as B's default). Zero defaults is a valid
// state — the UI then falls back to the first listed entry (`defaultEntry`). Unseeded
// on purpose: the seeded Anthropic provider / default prompt already sort first.
const REGISTRY_DEFAULTS = new Map<string, { providerId?: string; promptId?: string }>()
const defaultsFor = (tenantId?: string) => REGISTRY_DEFAULTS.get(tenantId ?? defaultTenantId())
function setRegistryDefault(field: 'providerId' | 'promptId', id: string | undefined, tenantId?: string): void {
  const key = tenantId ?? defaultTenantId()
  const next = { ...REGISTRY_DEFAULTS.get(key), [field]: id }
  if (next.providerId === undefined && next.promptId === undefined) REGISTRY_DEFAULTS.delete(key)
  else REGISTRY_DEFAULTS.set(key, next)
}
// Deletion hygiene: a removed entry must not linger as any tenant's default pointer.
function dropRegistryDefault(field: 'providerId' | 'promptId', id: string): void {
  for (const [key, value] of REGISTRY_DEFAULTS) {
    if (value[field] === id) setRegistryDefault(field, undefined, key)
  }
}

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
// element); files / photos / folder seed from the live cloud-storage scan
// (source-qualified ids — see fsRecentKey) so the quick list isn't empty out of the
// box; repo from the catalog defaults. Server-owned so it's per-user and syncs
// across devices (the audit flagged it as domain, not UI).
const CONTEXT_TYPES: ContextTypeId[] = ['files', 'photos', 'folder', 'repo', 'connector', 'mcp']
// Seed the fs types from the cloud catalog (the always-present source), newest first.
const seedFsRecents = (): { files: string[]; photos: string[]; folder: string[] } => {
  const cat = cloudReader.list()
  const key = (id: string) => fsRecentKey(CLOUD_SOURCE.id, id)
  return {
    files: cat.files.slice(0, 6).map((f) => key(f.id)),
    photos: cat.photos.slice(0, 7).map((p) => key(p.id)),
    folder: cat.folders.slice(0, 6).map((d) => key(d.id)),
  }
}
let recents: RecentsSnapshot = (() => {
  const fsSeed = seedFsRecents()
  const out = {} as RecentsSnapshot
  for (const t of CONTEXT_TYPES) {
    out[t] =
      t === 'connector'
        ? [...CONNECTED_CONNECTOR_IDS]
        : t === 'mcp'
          ? [...CONNECTED_MCP_IDS]
          : t === 'files' || t === 'photos' || t === 'folder'
            ? fsSeed[t]
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

/** Publish a domain event to every open ambient SSE channel. The single publish
 *  point, so the event log stamps each event's global seq exactly once (the
 *  resumable-stream backbone — server/eventlog.ts, design §5.3). */
function emit(e: ServerEvent): void {
  const seq = eventlog.record(e)
  for (const fn of listeners) {
    try {
      fn(e, seq)
    } catch {
      /* a dead channel shouldn't break the others */
    }
  }
}

// ── The one session mint funnel ──────────────────────────────────────────────
// Every session is registered through here — human-created (`store.createSession`,
// the "New chat" materialized on first send) and agent-created (`ensureRunSession`,
// a scheduled routine's run) — so the two kinds share one shape (the full uniform
// property set), one route surface, and one permission wall, and differ ONLY in
// the initiator stamp: `scheduledRunOf` present ⇒ an agent (that routine's run)
// opened the conversation; absent ⇒ a person did. `quiet` is the boot-time
// seed/rehydrate materialization: rows register without broadcasting (no SSE
// subscriber exists yet, and the event log's seq must not inflate at boot) and
// without a per-row snapshot write.

function mintSession(
  input: {
    id: string
    title: string
    preview: string
    tenantId?: string
    providerId?: string
    modelId?: string
    connectors?: Connector[]
    scheduledRunOf?: { taskId: string; taskName: string }
    messages?: Message[]
    /** Row timestamps (an agent session is stamped with its run's `at`, so seeded
     *  history keeps its fixture chronology); default = now. */
    at?: number
  },
  opts?: { quiet?: boolean },
): Session {
  const now = input.at ?? Date.now()
  const session: Session = {
    id: input.id,
    title: input.title,
    caps: ['chat'],
    agentId: DEFAULT_AGENT.id,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    // Tenancy: stamped when the initiator carries one (a human create always does;
    // an agent session mirrors its ROUTINE's stamp verbatim, so an unstamped
    // flagship seed keeps the two-faces visibility rule — F2/PD9, seedVisibleTo).
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    ...(input.connectors ? { connectors: input.connectors } : {}),
    ...(input.scheduledRunOf ? { scheduledRunOf: input.scheduledRunOf } : {}),
    preview: input.preview,
    messages: input.messages ?? [],
    status: 'active',
    environment: 'local',
    createdAt: now,
    updatedAt: now,
  }
  // Agent sessions append (the sessions LIST excludes them — they surface through
  // the Scheduled rail/feed — so seed-list order must not shift under them);
  // human sessions lead the list, newest first.
  if (session.scheduledRunOf) SESSIONS.push(session)
  else SESSIONS.unshift(session)
  if (!opts?.quiet) {
    emit({ type: 'session.updated', session })
    persist()
  }
  return session
}

/** The recap's fixed per-session message id — the settle idempotency key (the
 *  opening prompt is `m1`; route-minted follow-up turns are `m-u-N`/`m-a-N`, so
 *  neither can collide with or masquerade as the recap). */
const RUN_RECAP_MESSAGE_ID = 'm2'

/** How much run history a routine retains — the daemon accretes a run every
 *  tick forever, and each run now carries a session row, so without a cap the
 *  store grows without bound (the principle tests/store-runs.test.ts pins for
 *  standing artifacts applies here too). Old runs retire with their session
 *  rows through the same run↔session identity cascade the delete paths use. */
const RUN_HISTORY_CAP = 50

/** The AGENT adapter of the mint funnel: the persisted session for one scheduled
 *  run, idempotent by its deterministic id (`srun-…`, contract/ids.ts) so run-now,
 *  the daemon, boot-time materialization, and the feed lookup all converge on the
 *  same row. Minted with the user turn it ran (`runPrompt`); the recap lands when
 *  the run settles (`settleRunSession`), the way a human turn's reply does. On an
 *  EXISTING row the routine's code-owned facts re-stamp (P9 — the run-session
 *  face of `reconcileSeedTenancy`): tenancy and the initiator stamp's name follow
 *  the routine, so a snapshot written before a seed re-tenanted or renamed can't
 *  leave a run thread 404ing behind the wall its routine moved past. The row's
 *  `title` is deliberately NOT re-stamped — it's user-editable (PATCH rename). */
function ensureRunSession(task: ScheduledTask, run: ScheduledRun, opts?: { quiet?: boolean }): Session {
  const id = runSessionId(task.id, run.id)
  const existing = SESSIONS.find((s) => s.id === id)
  if (existing) {
    if (task.tenantId) existing.tenantId = task.tenantId
    else delete existing.tenantId
    if (existing.scheduledRunOf && existing.scheduledRunOf.taskName !== task.name) {
      existing.scheduledRunOf = { taskId: task.id, taskName: task.name }
    }
    return existing
  }
  return mintSession(
    {
      id,
      title: task.name,
      preview: run.summary,
      tenantId: task.tenantId,
      connectors: connectorsFor(task),
      scheduledRunOf: { taskId: task.id, taskName: task.name },
      messages: [{ id: 'm1', role: 'user', content: runPrompt(task) }],
      at: run.at,
    },
    opts,
  )
}

/** Land a settled run's recap in its session — the assistant turn of the run's
 *  conversation, appended through the same message-append rules a human turn
 *  persists through. Idempotent (the recap is the thread's one assistant turn
 *  until a user follows up — a session that already carries one is left alone);
 *  a still-running run has no recap yet. Quiet path (boot healing — e.g. a run
 *  swept to 'failed' after a restart) stamps the run's own time, not now. */
function settleRunSession(task: ScheduledTask, run: ScheduledRun, opts?: { quiet?: boolean }): void {
  if (run.status === 'running') return
  const session = ensureRunSession(task, run, opts)
  // Idempotency keys on the RECAP itself (its fixed id), not "any assistant
  // turn" — a follow-up exchange that lands while the run is still executing
  // must not swallow the run's primary output.
  if ((session.messages ?? []).some((m) => m.id === RUN_RECAP_MESSAGE_ID)) return
  const message: Message = { id: RUN_RECAP_MESSAGE_ID, role: 'assistant', content: runRecap(task, run) }
  applyMessage(session, message, opts?.quiet ? run.at : Date.now())
  if (!opts?.quiet) {
    emit({ type: 'session.updated', session })
    persist()
  }
}

/** Retire a routine's oldest runs past the retention cap — WITH their session
 *  rows (the run↔session identity cascade). Quiet: the callers broadcast/persist
 *  the mutation that grew the history. */
function retireOldRuns(task: ScheduledTask): void {
  if (task.runs.length <= RUN_HISTORY_CAP) return
  const retired = task.runs.slice(RUN_HISTORY_CAP)
  task.runs = task.runs.slice(0, RUN_HISTORY_CAP)
  const goneIds = new Set(retired.map((r) => runSessionId(task.id, r.id)))
  for (let j = SESSIONS.length - 1; j >= 0; j -= 1) {
    if (goneIds.has(SESSIONS[j].id)) SESSIONS.splice(j, 1)
  }
}

/** Materialize the session row for every run the schedules already carry — the
 *  boot-time pass (module init + rehydrate) that keeps the one-funnel invariant
 *  over SEED runs and over snapshots written before run sessions persisted.
 *  Idempotent by the deterministic run-session id (and existing rows get their
 *  code-owned facts re-stamped — P9). Applies the retention cap first, so an
 *  over-cap snapshot (a long-running daemon's) shrinks to policy on boot —
 *  which also bounds this pass. */
function materializeRunSessions(): void {
  for (const task of schedules) {
    retireOldRuns(task)
    for (const run of task.runs) {
      ensureRunSession(task, run, { quiet: true })
      settleRunSession(task, run, { quiet: true })
    }
  }
}

/** The in-place message append shared by `appendMessage` (the store's public
 *  write) and the quiet boot-time recap healing — one place computes the row's
 *  preview + activity refresh. */
function applyMessage(session: Session, message: Message, at = Date.now()): void {
  session.messages = [...(session.messages ?? []), message]
  session.preview = message.content.slice(0, 120)
  session.updatedAt = at
}

// Materialize the session row for every seeded run — at module init, after the
// funnel's declarations (the `const` policy knobs above are TDZ before this
// line) and after SEED_SESSIONS' pristine capture. Quiet: registers without
// broadcasting, so booting doesn't inflate the event log.
materializeRunSessions()

// The native-runner registry — the broker's live view of connected hosts. In
// native/mock mode we seed the co-located runner (the one-runner registry the
// static capabilities describe); a remote web server seeds none.
const registry = new RunnerRegistry(emit)
if (NATIVE) {
  // The co-located sidecar: always reachable while this process is up, and it has no
  // external heartbeat client, so pin it against liveness reaping (it would otherwise be
  // swept after the TTL and the runner-host fs source would vanish).
  registry.register(LOCAL_RUNNER_SEED)
  registry.pin(LOCAL_RUNNER_SEED.id)
}

// Resolve a served filesystem source id (`?source=`) to its reader + descriptor.
// `cloud` → the web backend's storage; `runner:<id>` → that online runner's host,
// proxied through the broker (the in-process reader stands in for the on-host
// runner reading its own disk). `ui-host` is client-side, so it never resolves
// here; an unknown / offline / unmapped source → undefined (→ 404).
function resolveFsReader(sourceId: string): { reader: FsReader; source: FsSource } | undefined {
  if (sourceId === 'cloud') return { reader: cloudReader, source: CLOUD_SOURCE }
  if (sourceId.startsWith('runner:')) {
    const runnerId = sourceId.slice('runner:'.length)
    const runner = registry.get(runnerId)
    const root = RUNNER_FS_ROOTS[runnerId]
    if (!runner || runner.status !== 'online' || !root) return undefined
    return { reader: fsReader(root), source: { id: sourceId, kind: 'runner', label: runner.label, runnerId } }
  }
  return undefined
}

/** The server-known filesystem sources for the picker's source switcher — the web
 *  backend's cloud storage, plus any online runner advertising fs access that the
 *  broker can actually read (has a mapped root). The client prepends its own
 *  `ui-host` source. */
function fsSourceList(): FsSource[] {
  const runnerSources = registry
    .list()
    .filter(
      (r) =>
        r.status === 'online' &&
        RUNNER_FS_ROOTS[r.id] &&
        r.capabilities.some((c) => c.type === 'fs.read' || c.type === 'fs.list'),
    )
    .map((r): FsSource => ({ id: `runner:${r.id}`, kind: 'runner', label: r.label, runnerId: r.id }))
  return [CLOUD_SOURCE, ...runnerSources]
}

// The effect journal — each runner's authoritative log of its host's effects (D2)
// + the server's projection of it. Emits `runner.effect` as effects project.
const journal = new RunnerJournal(emit)

// The delegated-cognition relay runtime (docs/delegated-cognition-provider.md) —
// the transient half of every `kind:'session'` provider: one-entry slot, parked
// puller, socket-or-in-flight liveness. Durable identity is the provider row
// (its secretHash); like the runner registry, this is deliberately NOT persisted.
// Emits `relay.connected|disconnected` on liveness flips.
const relay = new RelayRuntime(emit)

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

/** Draining latch (F6 graceful shutdown): set on SIGTERM so `/readyz` fails while the
 *  process winds down. Transient — never persisted. */
let draining = false

/** Snapshot the mutable, UI-owned state for the on-disk format. */
function snapshot(): PersistedState {
  const persistedAccounts = accounts.toPersisted()
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
    registryDefaults: [...REGISTRY_DEFAULTS.entries()], // per-tenant default-flag pointers (UI shortcut)
    agents: [...WORKER_AGENTS.entries()],
    commissions: [...COMMISSIONS.entries()],
    // D13 commission caps — only Projects that carry one (the seed Projects are otherwise
    // not persisted); rehydrate re-applies them onto the matching seed Project.
    commissionCaps: PROJECTS.filter((p) => p.commissionCap !== undefined).map(
      (p) => [p.id, p.commissionCap!] as [string, number],
    ),
    // D14 default contributor roles — the same seed-overlay shape as the caps (a
    // created Project's defaultRole rides the graph slice on its own object).
    projectDefaultRoles: PROJECTS.filter((p) => p.defaultRole !== undefined).map(
      (p) => [p.id, p.defaultRole!] as [string, ProjectRole],
    ),
    auditLog, // D15/OQ7 — the cross-user effect trail (append-only)
    dispatch, // P7 — one-off dispatch runs (a live run survives a restart)
    openSubGoals, // D19 — the Project open-work backlog (an un-taken item survives a restart)
    // D24 — watch subscriptions ([tenantId, projectId] pairs) + the notification inbox.
    watches: [...watches.entries()].flatMap(([projectId, tenants]) => [...tenants].map((t) => [t, projectId] as [string, string])),
    notifications,
    agentProposals: [...AGENT_PROPOSALS.entries()], // D25 — the definition review queue
    a2aPeers: [...A2A_PEERS.entries()], // D28 — verified-identity credentials (hashed)
    // The account registry (multi-account P7): onboarded users (scrypt
    // credential included — it must survive a restart), workspaces, memberships.
    accountUsers: persistedAccounts.users,
    accountTenants: persistedAccounts.tenants,
    memberships: persistedAccounts.memberships,
    orgInvites: persistedAccounts.orgInvites, // FWD-6 — the consent-gated org door

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
      audit: auditSeq,
      dispatch: dispatchSeq,
      openSubGoal: openSubGoalSeq,
      notification: notificationSeq,
      user: persistedAccounts.seq.user,
      tenant: persistedAccounts.seq.tenant,
      orgInvite: persistedAccounts.seq.orgInvite,
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
  // Reconcile the SEEDED providers against an older snapshot (the P9 re-stamp
  // rule — seed rows and their catalogs are CODE-owned): a pre-seed snapshot
  // gains a missing seed row (+ its server-only config), and a pre-catalog
  // snapshot regains the seed's model catalog. A snapshot that carries its own
  // catalog (a runtime refresh) or runtime edits wins over the seed; a runtime
  // DELETE of a seed therefore lasts only until the next restart — the same
  // mock semantics as seed sessions.
  for (const seed of SEED_PROVIDERS) {
    const restored = MODEL_PROVIDERS.get(seed.id)
    if (!restored) MODEL_PROVIDERS.set(seed.id, seed)
    else if (!restored.models && seed.models) {
      MODEL_PROVIDERS.set(seed.id, { ...restored, models: seed.models, catalogSource: seed.catalogSource })
    }
  }
  for (const [id, config] of SEED_PROVIDER_CONFIGS) {
    if (!PROVIDER_CONFIGS.has(id) && MODEL_PROVIDERS.has(id)) PROVIDER_CONFIGS.set(id, config)
  }
  replaceMap(SYSTEM_PROMPT_LIB, s.systemPrompts)
  replaceMap(REGISTRY_DEFAULTS, s.registryDefaults)
  replaceMap(WORKER_AGENTS, s.agents)
  replaceMap(COMMISSIONS, s.commissions)
  // D13 commission caps overlay onto the (re-seeded) Projects: clear any seed cap, then
  // re-apply the snapshot's, so a cap that was removed at runtime stays removed.
  for (const p of PROJECTS) p.commissionCap = undefined
  if (s.commissionCaps) {
    for (const [id, cap] of s.commissionCaps) {
      const p = PROJECTS.find((x) => x.id === id)
      if (p) p.commissionCap = cap
    }
  }
  // D14 default contributor roles — the caps' twin overlay (cleared, then re-applied,
  // so a preference cleared at runtime stays cleared).
  for (const p of PROJECTS) p.defaultRole = undefined
  if (s.projectDefaultRoles) {
    for (const [id, role] of s.projectDefaultRoles) {
      const p = PROJECTS.find((x) => x.id === id)
      if (p) p.defaultRole = role
    }
  }
  // D15/OQ7 audit trail — restore the append-only log (empty for a pre-field snapshot).
  auditLog.splice(0, auditLog.length, ...(s.auditLog ?? []))
  // P7 dispatch runs — restore the feed (keep the seed for a pre-field snapshot). Same
  // crash-recovery sweep as the schedule daemon: a LIVE-minted run ('d-new-*') left
  // 'running' when the process died has no completing timer anymore, so it'd be stuck
  // in-flight forever — settle it to 'failed'. Seed runs (d1/d2/d3), 'running' for visual
  // variety, aren't live-minted, so they're left alone.
  if (s.dispatch) dispatch.splice(0, dispatch.length, ...s.dispatch)
  for (const run of dispatch) {
    if (run.status === 'running' && run.id.startsWith('d-new-')) {
      run.status = 'failed'
      run.detail = 'Interrupted by a server restart'
    }
  }
  // Seed reconciliation (the P9 rule — CODE seeds are authoritative): a snapshot
  // written by an older build carries the OLD seed shape — rows without the demo
  // accounts' tenant stamps, or missing rows a newer build added. Re-ensure every
  // code-seed row exists and wears the code's tenant; everything else the
  // snapshot says about a seed row (messages, appended runs, toggles) is kept.
  reconcileSeedTenancy(SESSIONS, SEED_SESSIONS)
  reconcileSeedTenancy(schedules, SCHEDULED_TASKS)
  reconcileSeedTenancy(dispatch, DISPATCH_RUNS)
  // Same P9 rule for the default Agent's explicit provider binding: a snapshot
  // written before the seed carried `providerId` restores it unbound (the card
  // would read "no provider bound"); the code seed is authoritative — backfill.
  const seededAgent = WORKER_AGENTS.get(DEFAULT_AGENT.id)
  if (seededAgent && !seededAgent.providerId) {
    WORKER_AGENTS.set(DEFAULT_AGENT.id, { ...seededAgent, providerId: DEFAULT_AGENT.providerId })
  }
  // The account registry (multi-account P7): restore onboarded accounts (the
  // seeds are re-ensured inside — a snapshot can't lose the switcher directory).
  accounts.rehydrate({
    users: s.accountUsers,
    tenants: s.accountTenants,
    memberships: s.memberships,
    orgInvites: s.orgInvites,
    seq: { user: s.seq.user, tenant: s.seq.tenant, orgInvite: s.seq.orgInvite },
  })
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
  // Restore the audit counter past the persisted ids (fall back to the trail length so a
  // pre-field snapshot's freshly minted ids never collide with restored ones).
  auditSeq = s.seq.audit ?? auditLog.length
  // Dispatch counter (fall back to the seed counter for a pre-field snapshot).
  dispatchSeq = s.seq.dispatch ?? dispatchSeq
  // D19 open work — restore the backlog (empty for a pre-field snapshot); counter falls
  // back to the backlog length so freshly minted ids never collide with restored ones.
  openSubGoals.splice(0, openSubGoals.length, ...(s.openSubGoals ?? []))
  openSubGoalSeq = s.seq.openSubGoal ?? openSubGoals.length
  // D24 — watches + the inbox (empty for a pre-field snapshot); counter falls back
  // to the inbox length so freshly minted ids never collide with restored ones.
  watches.clear()
  for (const [tenantId, projectId] of s.watches ?? []) {
    const set = watches.get(projectId) ?? new Set<string>()
    set.add(tenantId)
    watches.set(projectId, set)
  }
  notifications.splice(0, notifications.length, ...(s.notifications ?? []))
  notificationSeq = s.seq.notification ?? notifications.length
  replaceMap(AGENT_PROPOSALS, s.agentProposals) // D25 (no-op for a pre-field snapshot)
  replaceMap(A2A_PEERS, s.a2aPeers) // D28 (no-op for a pre-field snapshot)
  a2aPeerSeq = A2A_PEERS.size // ids are `peer-N`; size floors the counter safely past restores
  // Run sessions are ordinary persisted rows, but a snapshot written before they
  // were (or one whose 'running' run was just swept to 'failed' above) can miss a
  // row or its recap — re-materialize through the same funnel, idempotently.
  materializeRunSessions()
}

/** Re-ensure the code's seed rows after a snapshot restore: a seed row missing
 *  from the snapshot (added by a newer build) is re-added; a present one gets
 *  the CODE's tenant stamp (tenancy is code-owned — the demo accounts' data
 *  split must not be undone by a pre-split snapshot). Runtime rows and runtime
 *  mutations to seed rows are untouched. Exported for its unit lock
 *  (tests/demo-accounts.test.ts); rehydrate is the one runtime caller. */
export function reconcileSeedTenancy<T extends { id: string; tenantId?: string }>(live: T[], seeds: readonly T[]): void {
  for (const seed of seeds) {
    const got = live.find((r) => r.id === seed.id)
    if (!got) live.push(JSON.parse(JSON.stringify(seed)) as T)
    else if (seed.tenantId) got.tenantId = seed.tenantId
    else delete got.tenantId
  }
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
  // A standing (schedule-driven) effect belongs to the default tenant in this prototype
  // (schedules aren't tenant-scoped yet) — stamped explicitly so the SSE gate is unambiguous.
  emit({ type: 'relation.applied', op, by: 'standing', tenantId: defaultTenantId() })
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
  /** The delegated-cognition relay runtime — Session providers' transient half
   *  (slot / parked puller / liveness). The relay routes and the messages route's
   *  pre-turn gate read it; `relayReply` drives turns through it. */
  relay,

  /** Resolve a presented rendezvous secret to its Session provider — the relay
   *  routes' bearer wall. The presented secret is hashed once and compared
   *  constant-time against each session config's stored hash; no match (or a
   *  non-session provider) ⇒ undefined ⇒ 401. Binding is exactly this lookup:
   *  there is no enrollment protocol to have forgotten after a restart (§7.3). */
  relayProviderForSecret(secret: string): string | undefined {
    const presented = hashRelaySecret(secret)
    for (const [id, config] of PROVIDER_CONFIGS) {
      if (config.kind === 'session' && config.secretHash && sameSecretHash(config.secretHash, presented)) return id
    }
    return undefined
  },

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
        // The account switcher (multi-account §5.6, revised): uniform across
        // backends — every backend honours the identity seam and advertises a
        // directory (web: org principals; desktop: the local user's
        // workspaces). Still a flag, so a deployment can turn it off.
        identitySwitch: true,
        // The production onboarding posture (multi-account §12): require a
        // VERIFIED sign-in before the workspace renders. Read per call (like
        // identityHeadersAllowed) so tests can toggle it without reloads.
        authGate: process.env.AUTH_GATE === 'require',
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

  // ── Graceful shutdown (design F6 ops) ──
  /** Enter draining: on SIGTERM the process flips this so `GET /readyz` starts
   *  failing (503) and the load balancer stops sending new requests to this instance
   *  while in-flight work finishes. A one-way latch (a draining instance is on its way
   *  out). Liveness (`/healthz`) stays up so the orchestrator doesn't hard-kill it mid-drain. */
  beginDraining(): void {
    draining = true
  },
  isDraining(): boolean {
    return draining
  },

  // ── Identity & tenancy (who's talking, which tenant — design F2) ──
  /** The current principal + tenant for a request (`GET /v1/me`). Desktop/mock is
   *  the single local user; the remote web server resolves a tenant-scoped principal
   *  from the auth seam (request headers stand in for verified IdP claims, F2). The
   *  backend is the single source for which deployment this is. */
  identity(headers?: Record<string, string | string[] | undefined>): Identity {
    const ident = resolveIdentity(BACKEND_MODE, headers)
    // The AUTH GATE's identity half (multi-account §12, hardened): when the gate
    // applies, a request that resolved to the backend DEFAULT (no verified
    // session, no dev-seam header assertion) reads as the anonymous principal —
    // a registry-less identity that owns nothing — so pre-sign-in, `/me`, the
    // identity echo, and every visibility wall name and serve NOBODY. The
    // router's 401 wall (routes/index.ts) is the loud half; this is the
    // defense-in-depth beneath it. `defaultTenantId()` deliberately bypasses
    // this (it calls resolveIdentity directly): the default principal still
    // OWNS the untagged seeds — the gate hides them from the wire, it doesn't
    // reassign them.
    if (ident.via === 'default' && this.capabilities().features.authGate) {
      return { ...ANONYMOUS_IDENTITY, via: 'default' }
    }
    return ident
  },
  /** The backend's default tenant — the owner of *shared* infrastructure (seeded registry
   *  entries with no `tenantId`, seed sessions/projects/artifacts). Used by the by-id write
   *  guard so shared infra is READ by all tenants but WRITTEN only by its owner (F2/PD9). */
  defaultTenantId(): string {
    return defaultTenantId()
  },

  // ── Served filesystem sources (Files / Photos / Folder — contract/fs.ts) ──
  /** The picker's source switcher list (cloud + any fs-capable runner). The client
   *  prepends its own `ui-host` source. */
  fsSources(): FsSource[] {
    return fsSourceList()
  },
  /** A source's top-level catalog (files / photos / folders). Undefined for an
   *  unknown / client-only source (→ 404/400 at the route). */
  fsCatalog(sourceId: string): FsCatalog | undefined {
    const r = resolveFsReader(sourceId)
    if (!r) return undefined
    const { files, photos, folders } = r.reader.list()
    return { source: r.source, files, photos, folders }
  },
  /** Scan a folder under a source → its artifacts (what the workspace shows). */
  fsFolder(sourceId: string, path: string): FsFolderContents | undefined {
    return resolveFsReader(sourceId)?.reader.folderContents(path)
  },
  /** A file's textual content under a source (the editable preview). */
  fsText(sourceId: string, path: string): FsFileContent | undefined {
    return resolveFsReader(sourceId)?.reader.readText(path)
  },
  /** A file's raw bytes + content type under a source (image / binary serving). */
  fsBytes(sourceId: string, path: string): { bytes: Uint8Array; contentType: string } | undefined {
    return resolveFsReader(sourceId)?.reader.readBytes(path)
  },

  // ── Native resources (only a native sidecar fulfills these — the arbitrary-path
  //    OS seam, distinct from the served sources above; gated, 409 on remote) ──
  /** OS file/photo/folder picker → the chosen path. */
  fsPick(kind: string): { path: string; kind: string } {
    return { path: kind === 'file' ? '~/Documents/launch-assets/gtm-brief.md' : '~/projects/insights-dashboard', kind }
  },
  /** Scan a local folder → the artifacts it holds. Delegates to the cloud reader so
   *  the dormant native route still returns real data after the fixture removal. */
  scanFolder(id: string): FsFolderContents | undefined {
    return cloudReader.folderContents(id)
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

  /** The account registry changed (a signup, a new workspace — multi-account
   *  P7): persist, so real accounts survive a restart. The registry itself is a
   *  singleton (server/accounts.ts); the store owns WHEN it hits disk. */
  accountsMutated(): void {
    persist()
  },

  // ── Sessions ──
  /** The lightweight list rows (no message bodies) for the sidebar/search. */
  listSessions(tenantId?: string): Session[] {
    // Tenant-scoped enumeration (F2 / PD9): a tenant lists only its own sessions. A
    // seed/legacy session (no tenantId) belongs to the backend's default tenant, so it's
    // visible to the default reader on both backends. No arg ⇒ unscoped (internal use).
    // Agent-initiated (run) sessions are the same rows behind the same by-id routes,
    // but they surface through the Scheduled rail + `/runs/recent` — one row per
    // routine, not per run — so this list (Recents/search) scopes to human-initiated
    // conversations. A pure view rule, not a separate code path.
    const rows = SESSIONS.filter((s) => !s.scheduledRunOf)
    const within = tenantId
      ? rows.filter((s) => rowVisibleTo(s, tenantId))
      : rows
    return within.map((s) => ({
      id: s.id,
      title: s.title,
      caps: s.caps,
      preview: s.preview,
      tenantId: s.tenantId,
      // Sidebar filter/sort backing — cheap scalars, safe to ship in the list rows.
      status: s.status,
      environment: s.environment,
      updatedAt: s.updatedAt,
      createdAt: s.createdAt,
      pinned: s.pinned,
      // The driving Agent (D16 current-driver binding) — the client resolves it to a
      // provider kind for the relay affordances ("Waiting on your session…", §7.8).
      agentId: s.agentId,
      // The session's two-level model pick (the composer selector reads its
      // current value here — provider + concrete catalog model).
      providerId: s.providerId,
      modelId: s.modelId,
    }))
  },
  /** Whether a session is visible to `tenantId` — the route-level guard for reads by id,
   *  so a tenant can't open another tenant's session by guessing its id. A seed/legacy or
   *  synthesized (run) session with no tenantId belongs to the default tenant. */
  sessionVisibleToTenant(session: Session, tenantId: string): boolean {
    return rowVisibleTo(session, tenantId)
  },
  /** Whether an ambient event should be delivered to a subscriber of `tenantId` (F2/PD9 —
   *  the push-side of the tenant boundary). The `/events` SSE fan-out is broadcast to
   *  every open channel, so without this a subscriber would observe *other* tenants'
   *  session pushes. Events that carry tenant-identifiable data are gated to the owning
   *  tenant; the rest (runner registry, dispatch, recents, relations — not yet
   *  tenant-scoped in this prototype) are global. A session that can't be resolved (an
   *  ephemeral/just-removed id) falls back to the default tenant, matching the read side. */
  eventVisibleToTenant(e: ServerEvent, tenantId: string): boolean {
    switch (e.type) {
      case 'session.updated':
        return this.sessionVisibleToTenant(e.session, tenantId)
      case 'session.contexts.changed': {
        const s = SESSIONS.find((x) => x.id === e.sessionId)
        return s ? rowVisibleTo(s, tenantId) : seedVisibleTo(tenantId)
      }
      case 'audit.entry':
        return (e.entry.tenantId ?? defaultTenantId()) === tenantId
      // Targeted (D24): an inbox event reaches its tenant's streams — and, FWD-6
      // O-D5, the streams of that org's members (the inbox is member-readable).
      case 'notification.changed':
        return tenantReadsAs(tenantId, e.tenantId)
      case 'relation.applied': {
        // Gate on the tenant that APPLIED the edit — not the op payload. Keying off
        // op.projectId leaked the unfile/unlink ops (projectId:null but carrying the
        // project *name*), and the projectless ops (handoff / Agent-Commons CRUD) leaked
        // their session/agent labels. A relation edit is the acting tenant's private
        // action, so it's visible only to that tenant (F2/PD9). Unstamped ⇒ default.
        if ((e.tenantId ?? defaultTenantId()) === tenantId) return true
        // FWD-6 O-D5: an edit that TOUCHED an ORG-owned project is the org's
        // business — its seats' caches must invalidate live (UI-12: a member's
        // Projects list would otherwise go stale on another seat's edit). Widened
        // ONLY for org owners (`isNamespace` excludes every person namespace, so
        // the legacy privacy — incl. cross-tenant ops on shared personal
        // projects — is bit-for-bit preserved).
        const pid = (e.op as { projectId?: string | null }).projectId
        if (pid != null) {
          const owner = projectTenant(pid)
          if (!accounts.isNamespace(owner) && accounts.seatIn(tenantId, owner) !== undefined) return true
        }
        return false
      }
      case 'openwork.changed': {
        // The backlog's visibility mirrors the Project's (D19/P8): everyone while it's
        // shared, owner-only while private. The event carries only the project id, so
        // there is nothing else to leak.
        const p = findProject(e.projectId)
        if (!p) return seedVisibleTo(tenantId)
        return p.shared === true || rowVisibleTo(p, tenantId)
      }
      case 'relay.connected':
      case 'relay.disconnected': {
        // A Session provider is forced tenant-scoped (the mint wall), so its liveness
        // flips are that tenant's private signal — another tenant must not observe
        // when someone's delegated session comes and goes. Gate on the provider row.
        const p = MODEL_PROVIDERS.get(e.providerId)
        return (p?.tenantId ?? defaultTenantId()) === tenantId
      }
      case 'run.started':
      case 'run.progress':
      case 'run.finished': {
        // A run event names its routine (taskName / the delivery-target summary) — a
        // tenant's private operational signal, gated like the schedules read itself.
        // These once fell through the global default, leaking every tenant's routine
        // names to every stream. A deleted routine falls back to the flagship rule.
        const t = schedules.find((x) => x.id === e.taskId)
        return t ? rowVisibleTo(t, tenantId) : seedVisibleTo(tenantId)
      }
      case 'schedule.changed':
        // Stamped at emit time (the row may already be deleted) — relation.applied's
        // pattern: the mutation is the owning tenant's private signal.
        return e.tenantId ? e.tenantId === tenantId : seedVisibleTo(tenantId)
      case 'commission.changed': {
        // The Contributor roster's visibility mirrors the Project's (P8/D19), exactly
        // like openwork.changed: everyone while shared, owner-only while private.
        const p = findProject(e.projectId)
        if (!p) return seedVisibleTo(tenantId)
        return p.shared === true || rowVisibleTo(p, tenantId)
      }
      case 'proposal.changed':
        // A proposal is a two-party negotiation (D25) — only proposer + owner streams.
        return e.parties.includes(tenantId)
      default:
        return true
    }
  },
  /** A full session by id — messages + the live, server-owned `workspace` (its
   *  panels). The workspace is materialized from the flat seed fields on first
   *  read, then reflects any attach/detach write-through. */
  getSession(id: string): Session | undefined {
    const session = SESSIONS.find((s) => s.id === id)
    if (!session) return undefined
    return { ...session, workspace: this.sessionWorkspace(id) }
  },
  /** Confirm or decline a proposed connector *action* (P6 §2.1, PD43 — the consent gate
   *  for connector/MCP writes). A read runs at generation time; an action is surfaced as
   *  a `proposed` ToolActivity and only takes effect here, on the user's approval:
   *  `confirm` flips it to `done` (with the mock result) and records an audit entry (the
   *  consent → effect → audit trail); `decline` flips it to `declined`. Idempotent — a
   *  non-proposed / already-resolved activity is returned unchanged. Returns the updated
   *  activity, or undefined if the id isn't on the session. */
  resolveToolActivity(sessionId: string, activityId: string, decision: 'confirm' | 'decline'): ToolActivity | undefined {
    const session = SESSIONS.find((s) => s.id === sessionId)
    if (!session?.messages) return undefined
    for (const m of session.messages) {
      const act = m.toolActivities?.find((a) => a.id === activityId)
      if (!act) continue
      if (act.kind !== 'action' || act.status !== 'proposed') return act // already resolved / not gated
      if (decision === 'decline') {
        act.status = 'declined'
      } else {
        act.status = 'done'
        act.summary = connectorActionResult(act.tool, act.connector)
        this.recordAudit({
          tenantId: session.tenantId ?? defaultTenantId(),
          channel: 'proxy',
          capability: 'connector.write',
          target: act.connector,
          outcome: 'fulfilled',
        })
      }
      persist()
      emit({ type: 'session.updated', session })
      return act
    }
    return undefined
  },

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
   *  The HUMAN adapter of the one mint funnel (`mintSession`); the agent adapter is
   *  `ensureRunSession` — same row shape, same broadcast/persist, differing only in
   *  the initiator stamp. The creating tenant is always stamped so the scoped
   *  list/read see it (F2 / PD9): the route passes the caller's tenant; absent
   *  that it's the backend's default tenant. */
  createSession(firstMessage?: string, tenantId: string = defaultTenantId(), providerId?: string, modelId?: string): Session {
    // A draft's concrete model pick must name an entry in its effective provider's
    // catalog (the picked provider's, else the default Agent's) — refused otherwise.
    if (modelId) assertModelInCatalog(modelId, providerId)
    return mintSession({
      id: `sess-${(sessionSeq += 1)}`,
      title: titleFrom(firstMessage),
      preview: (firstMessage ?? '').slice(0, 120),
      tenantId,
      // The composer's model pick, when the draft made one (route-validated).
      providerId,
      modelId,
    })
  },

  /** The seeded worker Agents (docs/agent-commons.md, D6) — the degenerate N=1 set. */
  listAgents(tenantId?: string): Agent[] {
    // Tenant-scoped (F2/PD9): the shared default agent (no tenantId) is visible to all; a
    // created one only to its tenant. No arg ⇒ all (internal use, e.g. resolveAgent).
    return [...WORKER_AGENTS.values()].filter((a) => registryVisible(a, tenantId))
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
  createAgent(input: Omit<Agent, 'id'>, tenantId?: string): Agent {
    const provider = resolveProvider(input.providerId)
    if (input.authority) mintAuthority(provider.authority, input.authority)
    if (input.budget) mintBudget(provider.plan?.windows ?? usageMeter.planCeilings(), input.budget)
    // Stamp the creating tenant (F2/PD9) so listAgents(tenant) scopes it; unset ⇒ shared.
    const agent: Agent = { ...input, id: `agent-${(workerAgentSeq += 1)}`, tenantId: tenantId ?? input.tenantId }
    WORKER_AGENTS.set(agent.id, agent)
    persist()
    return agent
  },
  /** Create an Agent from a management request: resolve the `systemPrompt` body from the
   *  chosen library entry (D10), default the tool set to the full catalog (the default
   *  Agent's), and run the same D8 funnel via `createAgent`. **Strict**: the provider and
   *  prompt bindings are required and must resolve — a missing/empty/unknown reference is
   *  a `ValidationError`, never an implicit resolution to a default (default-flagged
   *  entries are a UI pre-selection shortcut; the request must arrive concrete). */
  createAgentFromRequest(input: CreateAgentRequest, tenantId?: string): Agent {
    const provider = input.providerId ? MODEL_PROVIDERS.get(input.providerId) : undefined
    if (!provider) throw new ValidationError(`An agent must name a registered model provider — no provider '${input.providerId ?? ''}'.`)
    const entry = input.systemPromptId ? SYSTEM_PROMPT_LIB.get(input.systemPromptId) : undefined
    if (!entry) throw new ValidationError(`An agent must name a library system prompt — no system prompt '${input.systemPromptId ?? ''}'.`)
    return this.createAgent({
      label: input.label,
      systemPrompt: entry.body,
      systemPromptId: entry.id,
      providerId: provider.id,
      // Minimal risk (INV-9 'none' class): an omitted tool grant means NO tools — the
      // API never widens silently. The full catalog is an EXPLICIT, visible grant
      // (the dialog's checkbox; the tool builder stamps it onto the consent card).
      tools: input.tools ?? [],
      instructions: input.instructions ?? '',
      authority: input.authority,
      budget: input.budget,
    }, tenantId)
  },
  /** Patch an Agent. A present field is applied; an absent one is left unchanged.
   *  **Strict like create**: a present provider / prompt id must resolve — empty string
   *  or an unknown id is a `ValidationError` ("clear to default" no longer exists; omit
   *  the field to keep the current binding, including a bespoke merged/forked prompt).
   *  Changing the prompt re-resolves the body; changing the provider (or grants)
   *  re-validates authority / budget against the resulting provider — the D8 funnel
   *  runs again, so a patch can't smuggle an over-grant past it. Undefined when
   *  unknown (→ 404). */
  updateAgentFromRequest(id: string, patch: UpdateAgentRequest): Agent | undefined {
    const current = WORKER_AGENTS.get(id)
    if (!current) return undefined
    let providerId = current.providerId
    if ('providerId' in patch) {
      if (!patch.providerId || !MODEL_PROVIDERS.has(patch.providerId)) {
        throw new ValidationError(`An agent must name a registered model provider — no provider '${patch.providerId ?? ''}'.`)
      }
      providerId = patch.providerId
    }
    let systemPrompt = current.systemPrompt
    let systemPromptId = current.systemPromptId
    if ('systemPromptId' in patch) {
      const entry = patch.systemPromptId ? SYSTEM_PROMPT_LIB.get(patch.systemPromptId) : undefined
      if (!entry) throw new ValidationError(`An agent must name a library system prompt — no system prompt '${patch.systemPromptId ?? ''}'.`)
      systemPromptId = entry.id
      systemPrompt = entry.body
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
      // The D18 publish/unpublish act — an explicit toggle on the patch path only
      // (never a creation side-effect). Normalized: false stores as absent.
      published: 'published' in patch ? (patch.published === true ? true : undefined) : current.published,
      id: current.id,
    }
    // D25 versioning: an owner edit that changes the DEFINITION of a published
    // agent bumps the version and logs authorship (private edits are drafts —
    // they don't version). Compared against `current`, so a no-op patch is silent.
    const definitionChanged =
      next.label !== current.label ||
      next.systemPrompt !== current.systemPrompt ||
      next.instructions !== current.instructions ||
      JSON.stringify(next.tools) !== JSON.stringify(current.tools)
    if (current.published === true && definitionChanged) {
      next.version = (current.version ?? 1) + 1
      next.changelog = [
        ...(current.changelog ?? []),
        { version: next.version, author: tenantName(current.tenantId ?? defaultTenantId()), note: 'Edited by the owner', at: Date.now() },
      ]
    }
    WORKER_AGENTS.set(id, next)
    reclampCommissionsOf(next) // D8 runtime: a narrowed Agent re-clamps its Contributors' grants
    // A re-bound provider changes what sessions INHERITING this Agent's provider
    // resolve to — their held model picks may now name another catalog's entries.
    if (next.providerId !== current.providerId) sweepSessionModelPicks()
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
    // D25 hygiene (review finding): drop the agent's proposal queue with it — an
    // orphaned list would ride the snapshot forever. AFTER the guards: a refused
    // delete (409) must not lose the queue. No id-reuse hazard (agent ids mint
    // from a persisted counter), so this is storage hygiene, not correctness.
    AGENT_PROPOSALS.delete(id)
    WORKER_AGENTS.delete(id)
    // Sessions bound to the deleted Agent resolve to the default Agent now — a
    // held model pick may name a catalog the new resolution doesn't serve.
    sweepSessionModelPicks()
    persist()
    return true
  },

  // ── Model providers (the cognition source — docs/agent-commons.md, D9) ──
  /** The registered Model providers, tenant-scoped (F2/PD9): the shared seeded provider(s)
   *  are visible to all; a created one only to its tenant. No arg ⇒ all (internal use).
   *  A `kind:'session'` row is stamped with its computed `online` flag at read time —
   *  the status dot; the flag is transient relay state, never stored. The viewer's
   *  default flag (`isDefault` — the UI pre-selection shortcut) is stamped the same
   *  way, from the per-tenant pointer, so it can never leak across tenants. */
  listProviders(tenantId?: string): ModelProvider[] {
    const defaultId = defaultsFor(tenantId)?.providerId
    return [...MODEL_PROVIDERS.values()]
      .filter((p) => registryVisible(p, tenantId))
      .map((p) =>
        p.kind === 'session'
          ? { ...p, online: relay.online(p.id) }
          : // What an UNSET pick resolves to — the configured model (serve-time
            // stamp, like `online`), so the client's inherit display matches
            // what a turn actually runs (never `catalog[0]` guesswork).
            { ...p, defaultModelId: resolvedModelId(PROVIDER_CONFIGS.get(p.id)) },
      )
      .map((p) => (p.id === defaultId ? { ...p, isDefault: true } : p))
  },
  /** Move / clear the caller's **default-provider** flag (the UI shortcut — see
   *  REGISTRY_DEFAULTS). `id` must be a provider the caller can see; `undefined`
   *  clears the flag, leaving the registry with no default (a valid state). */
  setDefaultProvider(id: string | undefined, tenantId?: string): void {
    if (id !== undefined && ![...MODEL_PROVIDERS.values()].some((p) => p.id === id && registryVisible(p, tenantId))) {
      throw new ValidationError(`No provider '${id}' to set as the default.`)
    }
    setRegistryDefault('providerId', id, tenantId)
    persist()
  },
  /** Resolve an Agent's Model provider; unset/unknown falls back to the seeded
   *  default. */
  getProvider(id?: string): ModelProvider {
    return resolveProvider(id)
  },
  /** The endpoint + model config a turn on this provider runs against — server-only,
   *  never on the contract. Every field unset (the default provider) = inherit
   *  `generate.ts`'s env defaults, so `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` stay
   *  the one source for them. */
  providerConfig(id?: string): ProviderConfig {
    return PROVIDER_CONFIGS.get(id ?? '') ?? DEFAULT_PROVIDER_CONFIG
  },
  /** Mint a Model provider through the D8 funnel: its plan must attenuate the account
   *  plan (`planCeilings`), so the cascade root can never exceed the subscription it
   *  sits under. The single seam a provider plan is validated — and the single seam a
   *  config that brings its **own endpoint** must arrive already carrying the probed
   *  capability record (`probeProviderEndpoint`, run by the route): an unverified
   *  endpoint is unrepresentable in the registry, same shape as an over-grant. */
  createProvider(input: Omit<ModelProvider, 'id'>, config: ProviderConfig = {}, tenantId?: string): ModelProvider {
    if (input.plan) mintBudget(usageMeter.planCeilings(), input.plan)
    if (config.baseURL && !config.capabilities) {
      throw new ProviderProbeError('A provider endpoint must pass the conformance probe before it is registered.')
    }
    // The credential-exfiltration wall (see validApiKeyEnv): a config may only ever
    // reference a PROVIDER_* env var, so no other server secret can be pointed at a
    // caller-supplied endpoint. The probe checks this too (before any request leaves);
    // this is the belt at the mint seam itself.
    if (!validApiKeyEnv(config.apiKeyEnv)) {
      throw new ProviderProbeError(`A provider credential must reference a 'PROVIDER_*' env var, not '${config.apiKeyEnv}'.`)
    }
    // The session-kind walls (docs/delegated-cognition-provider.md §6.3/§6.4), belt at
    // the mint seam like the two above: a relay has nothing to dial (an endpoint config
    // on it is a confusion, refused loudly), MUST carry `toolUse:false` explicitly (the
    // unset default reads as tools-on — the dangerous inversion), carries the hashed
    // secret it authenticates by, and is forced tenant-scoped (a shared relay would
    // route one tenant's prompts to another tenant's session model).
    if (config.kind === 'session') {
      if (config.baseURL || config.apiKeyEnv) {
        throw new ProviderProbeError('A Session provider has no endpoint to dial — it must not carry a baseURL or credential.')
      }
      if (input.models) {
        throw new ProviderProbeError('A Session provider has no model catalog — its cognition is whatever session drains its mailbox.')
      }
      if (config.capabilities?.toolUse !== false) {
        throw new ProviderProbeError('A Session provider must be minted prose-only (capabilities.toolUse === false).')
      }
      if (!config.secretHash) {
        throw new ProviderProbeError('A Session provider must carry the hash of its rendezvous secret.')
      }
      if (!(tenantId ?? input.tenantId)) {
        throw new ProviderProbeError('A Session provider must be tenant-scoped — it can never be shared.')
      }
    }
    // A declared catalog is validated at the funnel (shape + unique ids); its source
    // stamp is server-derived — a caller-declared list is 'static' unless the route
    // fetched it from the endpoint itself ('listed'), and a provider with no catalog
    // carries no source at all.
    assertCatalogModels(input.models)
    // Stamp the creating tenant (F2/PD9) so listProviders(tenant) scopes it; unset ⇒ shared.
    // `isDefault` and `defaultModelId` are stripped: both are serve-time stamps
    // (the per-tenant pointer; the config-resolved model) — stored on the entity
    // they would leak across tenants / drift from the config they mirror.
    const { isDefault: _default, defaultModelId: _dm, ...fields } = input
    const provider: ModelProvider = { ...fields, id: `provider-${(providerSeq += 1)}`, tenantId: tenantId ?? input.tenantId }
    if (!provider.models) delete provider.catalogSource
    else provider.catalogSource ??= 'static'
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
    // A patched catalog is a *static declaration* — validated before anything
    // mutates, source-stamped server-side ('listed' is earned only by the fetch
    // funnel, never claimable on a request), and refused on a Session provider
    // (nothing to enumerate — same wall as the mint's).
    if (patch.models !== undefined) {
      if (PROVIDER_CONFIGS.get(id)?.kind === 'session') {
        throw new ValidationError('A Session provider has no model catalog — its cognition is whatever session drains its mailbox.')
      }
      assertCatalogModels(patch.models)
    }
    // The transport identity is fixed at mint, and the fingerprint/status are
    // server-stamped: a PATCH may rename/re-plan a provider but never flip its
    // kind or forge relay state. `isDefault` is a serve-time stamp too — the route
    // turns it into a setDefaultProvider call; it never lands on the entity.
    const { kind: _kind, secretHint: _hint, online: _online, isDefault: _default, defaultModelId: _dm, models: patchModels, catalogSource: _src, ...safe } = patch
    const next: ModelProvider = { ...current, ...safe, id: current.id }
    MODEL_PROVIDERS.set(id, next)
    reclampAgentsOf(next) // D8 runtime: a narrowed provider re-clamps its Agents (+ their commissions)
    // The catalog replacement funnel last — it re-persists and sweeps stale session
    // model picks against the new list.
    if (patchModels !== undefined) return replaceProviderModels(id, patchModels, 'static')
    persist()
    return next
  },
  /** Replace a provider's model catalog from its endpoint's list API (the refresh
   *  route) — the 'listed' source stamp is earned only here and at registration. */
  refreshProviderModels(id: string, models: ModelInfo[]): ModelProvider | undefined {
    return replaceProviderModels(id, models, 'listed')
  },
  /** Rotate a Session provider's rendezvous secret — the kill switch (§7.5),
   *  immediate and total: the stored hash is replaced (no old-hash grace), the
   *  relay retires on the spot (parked poll superseded, in-flight turn falls back
   *  now, dot goes grey), and a connector holding the old secret meets 401 on its
   *  next call. Returns the updated row + the NEW secret — shown once, like mint;
   *  undefined for an unknown or non-session provider. */
  rotateProviderSecret(id: string): { provider: ModelProvider; secret: string } | undefined {
    const current = MODEL_PROVIDERS.get(id)
    const config = PROVIDER_CONFIGS.get(id)
    if (!current || config?.kind !== 'session') return undefined
    const secret = mintRelaySecret()
    PROVIDER_CONFIGS.set(id, { ...config, secretHash: hashRelaySecret(secret) })
    const provider: ModelProvider = { ...current, secretHint: relaySecretHint(secret) }
    MODEL_PROVIDERS.set(id, provider)
    relay.retire(id)
    persist()
    return { provider, secret }
  },
  /** Remove a provider. Refuses (ConflictError → 409) the seeded default — sessions
   *  resolve to it — and any provider an Agent still binds, so the user repoints those
   *  Agents first rather than silently orphaning them onto the fallback. False when
   *  unknown (→ 404). The removal is snapshotted to disk (persist.ts). Deleting a
   *  Session provider is rotate-without-a-successor (§7.5): the relay retires and the
   *  secret dies with the config row — a held connector is 401 from here on. */
  deleteProvider(id: string): boolean {
    if (!MODEL_PROVIDERS.has(id)) return false
    if (id === DEFAULT_PROVIDER.id) throw new ConflictError('The default provider can’t be removed.')
    const bound = [...WORKER_AGENTS.values()].filter((a) => a.providerId === id)
    if (bound.length > 0) {
      throw new ConflictError(
        `${bound.length} agent${bound.length === 1 ? '' : 's'} still ${bound.length === 1 ? 'runs' : 'run'} on this provider — repoint ${bound.length === 1 ? 'it' : 'them'} first.`,
      )
    }
    // Retire the relay BEFORE the rows drop: `relay.disconnected` is tenant-gated
    // by looking up the provider row, so emitting after the delete would misroute
    // the event to the default tenant instead of the owner.
    if (PROVIDER_CONFIGS.get(id)?.kind === 'session') relay.retire(id)
    // Clear any session-level model picks of this provider (the composer selector's
    // `session.providerId`): unlike an Agent binding — which blocks the delete above —
    // a pick is a lightweight per-session choice, so it falls back to the Agent's
    // provider rather than wedging the delete. Broadcast so open selectors reconcile.
    for (const s of SESSIONS.filter((s) => s.providerId === id)) {
      delete s.providerId
      delete s.modelId // the model pick named the deleted provider's catalog — same cascade
      emit({ type: 'session.updated', session: s })
    }
    MODEL_PROVIDERS.delete(id)
    PROVIDER_CONFIGS.delete(id)
    // A removed provider must not linger as any tenant's default pointer — the flag
    // simply clears (no protection: the default is a UI shortcut, not an invariant).
    dropRegistryDefault('providerId', id)
    persist()
    return true
  },

  // ── System-prompt library (docs/agent-commons.md, D10) ──
  /** The reusable, target-family-tagged system prompts a user picks for an Agent —
   *  tenant-scoped (F2/PD9): shared seeds visible to all, a created one to its tenant.
   *  The viewer's default flag is stamped at serve time, like `listProviders`. */
  listSystemPrompts(tenantId?: string): SystemPromptEntry[] {
    const defaultId = defaultsFor(tenantId)?.promptId
    return [...SYSTEM_PROMPT_LIB.values()]
      .filter((p) => registryVisible(p, tenantId))
      .map((p) => (p.id === defaultId ? { ...p, isDefault: true } : p))
  },
  /** Move / clear the caller's **default-prompt** flag — `setDefaultProvider`'s twin. */
  setDefaultSystemPrompt(id: string | undefined, tenantId?: string): void {
    if (id !== undefined && ![...SYSTEM_PROMPT_LIB.values()].some((p) => p.id === id && registryVisible(p, tenantId))) {
      throw new ValidationError(`No system prompt '${id}' to set as the default.`)
    }
    setRegistryDefault('promptId', id, tenantId)
    persist()
  },
  /** Resolve one library entry by id (undefined when unknown — unlike provider/agent
   *  there is no "default prompt to fall back to" at this seam; the caller decides). */
  getSystemPrompt(id?: string): SystemPromptEntry | undefined {
    return id ? SYSTEM_PROMPT_LIB.get(id) : undefined
  },
  /** The opt-in prompt-fit probe (docs/agent-commons.md, D10/OQ5) — the deeper, scored
   *  upgrade beside the always-on static tag. Resolves the prompt's authored-for family
   *  and the chosen provider's model family, then scores the pairing. **Mock fulfilment:**
   *  a deterministic `probeScore`; a real probe would run a tool-use conformance check
   *  against the provider's model here (the model seam). Undefined for an unknown prompt
   *  (→ 404). */
  runProbe(systemPromptId: string, providerId?: string): PromptProbeResult | undefined {
    const prompt = SYSTEM_PROMPT_LIB.get(systemPromptId)
    if (!prompt) return undefined
    return probeScore(prompt.targetFamily, resolveProvider(providerId).modelFamily)
  },
  /** Add a prompt to the library. A plain registry add (prompt text is not a
   *  capability, so there is no attenuation funnel here — the fit *warning* is the
   *  selection-time check, `promptFitWarning`, surfaced in the picker). */
  createSystemPrompt(input: Omit<SystemPromptEntry, 'id'>, tenantId?: string): SystemPromptEntry {
    // Stamp the creating tenant (F2/PD9) so listSystemPrompts(tenant) scopes it; unset ⇒ shared.
    // `isDefault` is stripped like createProvider's: a serve-time stamp, never stored.
    const { isDefault: _default, ...fields } = input
    const entry: SystemPromptEntry = { ...fields, id: `sp-new-${(systemPromptSeq += 1)}`, tenantId: tenantId ?? input.tenantId }
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
    // `isDefault` never lands on the entity (see updateProvider) — the route routes
    // it to setDefaultSystemPrompt.
    const { isDefault: _default, ...safe } = patch
    const next: SystemPromptEntry = { ...current, ...safe, id: current.id }
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
    // Clear any default pointer at it (deleteProvider's twin — the flag just clears).
    dropRegistryDefault('promptId', id)
    persist()
    return true
  },

  // ── Commissions (the agent→Project assignment — docs/agent-commons.md, D7/D13) ──
  /** A Project's Contributors (its commissions), or all commissions when no project
   *  is given. The Contributor role is just an Agent that appears here for a Project.
   *  Tenant-scoped (F2/PD9): shared seeds visible to all, a created one to its tenant. */
  listCommissions(projectId?: string, tenantId?: string): Commission[] {
    // A SHARED Project's Contributor list is public across tenants (P8 — GitHub-style public
    // contributors): every commission ON it is visible to any viewer, whichever tenant created
    // it. Otherwise the usual registry scoping (own + shared-seed).
    const onShared = projectId != null && findProject(projectId)?.shared === true
    const scoped = [...COMMISSIONS.values()]
      .filter((c) => onShared || registryVisible(c, tenantId))
      .filter((c) => (projectId ? c.projectId === projectId : true))
    // A FOREIGN Contributor on a shared project is exposed as identity-only (redacted); the
    // caller's own (registryVisible) — and internal callers with no tenant — keep full detail,
    // so the D12 authority/grant posture never crosses the tenant boundary.
    return scoped.map((c) => (registryVisible(c, tenantId) ? c : publicCommission(c)))
  },
  /** Resolve one commission by id (undefined when unknown). Unredacted — internal callers only. */
  getCommission(id: string): Commission | undefined {
    return COMMISSIONS.get(id)
  },
  /** A commission visible to `tenantId` for the by-id route — its own/seed (full), or a
   *  Contributor on a SHARED project (redacted to public identity), else undefined (404).
   *  Keeps `GET /commissions/:id` consistent with the shared-project list rather than 404ing
   *  a Contributor the list shows. */
  commissionVisibleToTenant(id: string, tenantId?: string): Commission | undefined {
    const c = COMMISSIONS.get(id)
    if (!c) return undefined
    if (registryVisible(c, tenantId)) return c
    return findProject(c.projectId)?.shared === true ? publicCommission(c) : undefined
  },
  /** The tenant that PAYS for a commissioned run (D13 owner-pays): the tenant that owns the
   *  commissioned Agent — NOT the Project's tenant. On a cross-tenant Contributor (P8) these
   *  differ, so a commissioned run must meter against this tenant's usage, not the Project
   *  owner's. This is the attribution primitive; wiring it into a live commissioned execution
   *  is a later slice (there's no commissioned-run path yet). Undefined for an unknown id. */
  commissionOwnerTenant(commissionId: string): string | undefined {
    const c = COMMISSIONS.get(commissionId)
    if (!c) return undefined
    return WORKER_AGENTS.get(c.agentId)?.tenantId ?? c.tenantId ?? defaultTenantId()
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
  /** Set (or clear, with `undefined`) a Project's D13 commission cap — the owner raising or
   *  lifting the abuse ceiling. The single setter behind both the hub and the conversational
   *  card (5.5). Undefined for an unknown Project (→ 404); persisted (survives a restart). */
  setCommissionCap(projectId: string, cap?: number): Project | undefined {
    // A created Project lives in the relation graph (`extraProjects`), a seeded one in
    // PROJECTS — resolve from both so the cap works wherever the Project came from. A
    // seed cap persists via the `commissionCaps` overlay; a created one via the `graph` slice.
    const project = findProject(projectId)
    if (!project) return undefined
    project.commissionCap = cap
    persist()
    return project
  },
  /** Set / clear a Project's **default contributor role** (D14) — the commissioning
   *  pickers' pre-selection, a pure UI shortcut (INV-9: `createCommission` still
   *  requires a concrete role; nothing resolves to this). `role` undefined = clear.
   *  Same resolve-from-both-homes + persistence shape as `setCommissionCap` (seed →
   *  the `projectDefaultRoles` overlay; created → the `graph` slice). */
  setProjectDefaultRole(projectId: string, role?: ProjectRole): Project | undefined {
    if (role !== undefined && !PROJECT_ROLES.includes(role)) {
      throw new ValidationError(`No such project role '${role}'.`)
    }
    const project = findProject(projectId)
    if (!project) return undefined
    project.defaultRole = role
    persist()
    return project
  },
  /** How many active Commissions a Project currently holds — the count the D13 cap is
   *  measured against (one Contributor = one Commission). The Coordination/abuse read. */
  activeCommissionCount(projectId: string): number {
    let n = 0
    for (const c of COMMISSIONS.values()) if (c.projectId === projectId) n += 1
    return n
  },
  createCommission(input: Omit<Commission, 'id'>, tenantId?: string): Commission {
    const agent = WORKER_AGENTS.get(input.agentId)
    if (!agent) throw new Error(`createCommission: unknown agent '${input.agentId}'`)
    const project = findProject(input.projectId)
    // D13 per-commissioner abuse cap — fail-closed at the *single* funnel, so the route and
    // the conversational (commission-agent op) path are both bounded. An at-cap Project
    // refuses the new Commission until one is removed or the owner raises the cap.
    const cap = project?.commissionCap
    if (cap !== undefined && this.activeCommissionCount(input.projectId) >= cap) {
      throw new LimitError(
        `Project '${input.projectId}' is at its commission cap (${cap}) — un-commission an Agent or raise the cap first.`,
      )
    }
    const provider = resolveProvider(agent.providerId)
    // Attenuate against the Agent's *effective* grants: an Agent that left a face unset
    // inherits its provider's there, so that inherited ceiling is the parent.
    if (input.authority) mintAuthority(agent.authority ?? provider.authority, input.authority)
    if (input.grant) {
      mintBudget(agent.budget?.windows ?? provider.plan?.windows ?? usageMeter.planCeilings(), input.grant)
    }
    // Role is REQUIRED (INV-9): the funnel never picks one for the caller — the
    // commissioning surface pre-selects the Project's `defaultRole` (else the writer
    // baseline) VISIBLY, and what arrives here must be concrete. Then the P8
    // self-assign clamp (B8) runs, keyed on the commission's OWNING tenant vs the
    // Project owner (single-sourced with the re-grant path, so a cross-tenant joiner
    // can't self-elevate on mint or via PATCH).
    // Stamp the creating tenant (F2/PD9) so listCommissions(…, tenant) scopes it; unset ⇒ shared.
    if (!input.role || !PROJECT_ROLES.includes(input.role)) {
      throw new ValidationError(`A commission must name a project role (${PROJECT_ROLES.join(' / ')}) — got '${input.role ?? ''}'.`)
    }
    const owningTenant = tenantId ?? input.tenantId
    const role = clampContributorRole(input.role, owningTenant, input.projectId)
    // The D19 standing flag is the commission OWNER's consent to unprompted spend
    // (owner-pays) — normalized so anything but `true` stores as absent.
    const standing = input.standing === true ? true : undefined
    const commission: Commission = { ...input, role, standing, id: `commission-${(commissionSeq += 1)}`, tenantId: owningTenant }
    COMMISSIONS.set(commission.id, commission)
    // Ambient push (project-visibility-gated): a cross-tenant Contributor arriving on
    // a shared Project must reach the OWNER's open Contributors panel too — the acting
    // client's local invalidation can't (P8).
    emit({ type: 'commission.changed', projectId: commission.projectId })
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
    // Role (D14) re-assignment: present ⇒ apply, absent ⇒ unchanged — then re-run the P8
    // self-assign clamp (B8) so a cross-tenant Contributor can't PATCH itself above 'writer'
    // (denyForeignEntry lets it edit its OWN commission; the clamp is the wall). Same helper as
    // the mint path, keyed on the commission's owning tenant vs the Project owner.
    const role = clampContributorRole(patch.role ?? commission.role ?? 'writer', commission.tenantId, commission.projectId)
    if (authority) mintAuthority(agent?.authority ?? provider.authority, authority)
    if (grant) {
      mintBudget(agent?.budget?.windows ?? provider.plan?.windows ?? usageMeter.planCeilings(), grant)
    }
    // The D19 standing flag: present ⇒ apply (normalized), absent ⇒ unchanged. A newly
    // standing Contributor is offered the backlog's still-open items right away — the
    // one re-dispatch moment the synchronous model gets for free.
    const standing = 'standing' in patch ? (patch.standing === true ? true : undefined) : commission.standing
    const next: Commission = { ...commission, role, authority, grant, standing, id: commission.id }
    COMMISSIONS.set(id, next)
    if (standing && !commission.standing) {
      let took = false
      for (const item of openSubGoals) {
        if (item.projectId === next.projectId && item.status === 'open') {
          took = this.dispatchOpenSubGoal(item) || took
        }
      }
      if (took) emit({ type: 'openwork.changed', projectId: next.projectId })
    }
    emit({ type: 'commission.changed', projectId: next.projectId })
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
    emit({ type: 'commission.changed', projectId: commission.projectId })
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
    const project = findProject(commission.projectId) // seed + created (P8 shared Projects)
    // The wall: clamp the ceiling to what the Project ADMITS. Read the admitted contexts from
    // the relation graph's authoritative join map (`graph.projectContexts`) — a created Project
    // (P8 shared) carries its contexts only there, and even a seed Project's set is edited there
    // via scope/unscope, so the object's static `.contexts` can go stale. Fail **closed** — a
    // commission whose Project is gone admits no data (a security boundary must not fail open).
    // Fail **closed** at the fallback: if the graph has no recorded admitted set for this project
    // (a created Project not yet scoped, or the rehydrate seam where a snapshot's projectContexts
    // omits a seed id — P8 Phase 2a review), admit NOTHING rather than the object's frozen static
    // `.contexts` (which would fail OPEN). A seed Project's live set is always in the graph
    // (seedGraph copies it in + scope/unscope write the key), so this only bites the un-recorded case.
    const contexts = project ? (graph.projectContexts[commission.projectId] ?? []) : undefined
    const admitted = contexts ? projectAdmittedAuthority(contexts) : { connectors: [], scopes: [] }
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
   *  Persists only for a known session; a draft is materialized via
   *  `createSession` first, and unknown ids aren't persisted here (returns
   *  undefined). Run sessions are ordinary rows (the one mint funnel), so a
   *  follow-up turn in one persists like any other. Refreshes the row's preview +
   *  activity, then broadcasts `session.updated` so every client's list reflects
   *  the new turn. */
  appendMessage(id: string, message: Message): Session | undefined {
    const session = SESSIONS.find((s) => s.id === id)
    if (!session) return undefined
    applyMessage(session, message)
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
    // The hand-off may change the session's effective provider (the new Agent's
    // binding) — a held model pick whose namespace moved must clear with it.
    sweepSessionModelPicks()
    emit({ type: 'session.updated', session })
    persist()
    return session
  },

  /** Edit a session's row-level fields from the sidebar's row menu — rename
   *  (title), pin/unpin, or archive/unarchive. Mutates in place and broadcasts
   *  `session.updated` so every client's list refreshes. */
  patchSession(
    id: string,
    patch: { title?: string; status?: 'active' | 'archived'; pinned?: boolean; providerId?: string; modelId?: string },
  ): Session | undefined {
    const session = SESSIONS.find((s) => s.id === id)
    if (!session) return undefined
    // Validate the model pick BEFORE anything mutates (a refused patch must change
    // nothing): it must name an entry in the catalog of the provider this patch
    // leaves the session on — the incoming providerId when the patch carries one,
    // else the session's current effective provider.
    if (patch.modelId) {
      const nextProviderId = patch.providerId !== undefined ? patch.providerId || undefined : session.providerId
      assertModelInCatalog(patch.modelId, nextProviderId, session.agentId)
    }
    if (patch.title !== undefined) session.title = patch.title
    if (patch.status !== undefined) session.status = patch.status
    if (patch.pinned !== undefined) session.pinned = patch.pinned
    // The composer's model pick. Any falsy value ('' — the registry convention for
    // none/default — or a JSON null, which the route's validation skip lets through)
    // clears back to the Agent's own provider; only a real id is ever stored, so the
    // persisted row can't violate the wire type (`providerId?: string`).
    if (patch.providerId !== undefined) {
      if (patch.providerId) session.providerId = patch.providerId
      else delete session.providerId
      // The provider changed, so the model pick's namespace changed — clear it (the
      // documented cascade); a modelId in this same patch re-picks right below.
      delete session.modelId
    }
    // The concrete-model half of the pick (validated above); falsy clears back to
    // the provider's configured model — the INV-9 inherit state.
    if (patch.modelId !== undefined) {
      if (patch.modelId) session.modelId = patch.modelId
      else delete session.modelId
    }
    emit({ type: 'session.updated', session })
    persist()
    return session
  },
  /** Delete a session (the row menu's "Delete"). Splices it from the seed and
   *  broadcasts a refresh; a server restart reseeds it (mock semantics). A run
   *  session and its run are one entity in two projections, so deleting the
   *  conversation also retires the run from its routine's history — otherwise
   *  the run switcher would reopen a thread that no longer exists (and the boot
   *  materializer would re-mint it). */
  removeSession(id: string): boolean {
    const i = SESSIONS.findIndex((s) => s.id === id)
    if (i === -1) return false
    const [removed] = SESSIONS.splice(i, 1)
    if (removed.scheduledRunOf) {
      const task = schedules.find((t) => t.id === removed.scheduledRunOf!.taskId)
      if (task) {
        const before = task.runs.length
        task.runs = task.runs.filter((r) => runSessionId(task.id, r.id) !== removed.id)
        if (task.runs.length !== before) {
          emit({ type: 'schedule.changed', taskId: task.id, tenantId: task.tenantId })
        }
      }
    }
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
  /** The agent-run feed shown in the Dispatch section — scoped to the caller's
   *  tenant when given (F2/PD9; the six demo accounts each seed their own —
   *  docs/demo-accounts.md). Unscoped for internal callers (metrics). */
  listDispatch(tenantId?: string): DispatchRun[] {
    if (!tenantId) return dispatch
    return dispatch.filter((d) => rowVisibleTo(d, tenantId))
  },
  /** Kick off a one-off dispatch (a single on-demand agent run). It lands
   *  'running', broadcasts, then finishes 'done' a beat later (the mock stand-in
   *  for a real agent run) and broadcasts again. Persisted at both edges (P7), so a
   *  live run survives a restart — and one caught mid-flight by a restart is swept to
   *  'failed' on rehydrate (the completing timer doesn't survive the process). Returns
   *  the run. */
  addDispatch(title: string, detail?: string, tenantId?: string): DispatchRun {
    // Concurrency limit (P7): bound the in-flight one-off runs so unbounded dispatch can't
    // pile up. Opt-in via `DISPATCH_MAX_CONCURRENT` (read per call ⇒ off by default, so the
    // demo + existing tests are unaffected), mirroring the rate-limiter's opt-in shape. Count
    // only LIVE-minted (`d-new-*`) running runs — the seed feed's permanent 'running' fixture
    // (d1) has no completing timer and mustn't consume a slot (else a cap of 1 wedges forever).
    const cap = nonNegativeIntEnv(process.env.DISPATCH_MAX_CONCURRENT, 0)
    if (cap > 0) {
      const inFlight = dispatch.filter((r) => r.status === 'running' && r.id.startsWith('d-new-')).length
      if (inFlight >= cap) {
        throw new LimitError(`dispatch concurrency limit reached (${cap} in flight) — retry once a run finishes`)
      }
    }
    const run: DispatchRun = {
      id: `d-new-${(dispatchSeq += 1)}`,
      ...(tenantId ? { tenantId } : {}), // the creator's tenant (F2/PD9)
      title,
      status: 'running',
      startedAt: Date.now(),
      detail: detail?.trim() || 'Working on it…',
    }
    dispatch.unshift(run)
    emit({ type: 'dispatch.changed' })
    persist()
    setTimeout(() => {
      // startedAt is the start time — it doesn't change as the run settles; the UI
      // re-derives "started 4 minutes ago" → "4 minutes ago" from it live.
      if (run.status !== 'running') return // swept (e.g. after a restart) — don't resurrect it
      run.status = 'done'
      emit({ type: 'dispatch.changed' })
      persist()
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
  /** Save a context to the account's set-up list (the Contexts page's Add). The
   *  registry is the system of record — the page's add once lived in component
   *  state and evaporated on unmount. Idempotent by id (re-adding returns the
   *  existing row); broadcasts so every client's page + composer quick list
   *  reconcile; persists. */
  addSavedContext(ctx: SavedContext): SavedContext {
    const existing = savedCtxs.find((c) => c.id === ctx.id)
    if (existing) return existing
    savedCtxs.unshift(ctx)
    emit({ type: 'savedcontext.changed', id: ctx.id })
    persist()
    return ctx
  },
  /** Remove a context from the set-up list (the page's "Remove from contexts").
   *  False for an unknown id (→ 404). */
  removeSavedContext(id: string): boolean {
    const i = savedCtxs.findIndex((c) => c.id === id)
    if (i < 0) return false
    savedCtxs.splice(i, 1)
    emit({ type: 'savedcontext.changed', id })
    persist()
    return true
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
   *  turn — including ephemeral ones, since they consume real tokens. */
  recordUsage(inputTokens: number, outputTokens: number, tenantId?: string): void {
    meterFor(tenantId).record(inputTokens, outputTokens)
  },
  /** Count one turn's outcome (F6 PD31 observability). Called by the message route after
   *  every turn so a degraded model path shows up in `/metrics` instead of being silent. */
  recordGenerationOutcome(outcome: GenerationOutcome): void {
    generationCounts.set(outcome, (generationCounts.get(outcome) ?? 0) + 1)
  },
  /** The generation-outcome tallies for `/metrics` — every known outcome present (0 until
   *  seen) so the Prometheus series exist from the first scrape. */
  generationOutcomes(): Record<GenerationOutcome, number> {
    return {
      ok: generationCounts.get('ok') ?? 0,
      fallback: generationCounts.get('fallback') ?? 0,
      aborted: generationCounts.get('aborted') ?? 0,
      error: generationCounts.get('error') ?? 0,
    }
  },
  /** Spend-time enforcement (D8): the plan window this Agent's effective budget has
   *  exhausted (consumed ≥ its effective ceiling), or null. The message route refuses a
   *  turn when this is non-null — the per-turn gate the mint-time funnel doesn't provide.
   *  Scoped to the caller's tenant (F2/PD9): one tenant exhausting its window doesn't 429
   *  another. Omitted `tenantId` ⇒ the default tenant (the single-tenant mock, and tests). */
  overSpendLimit(budget?: Budget, tenantId?: string): { label: string; ceiling: number } | null {
    return meterFor(tenantId).overLimit(budget)
  },
  /** The usage snapshot the composer gauge renders: the open session's real
   *  context-window fill (system+tools baseline + an estimate of every message in
   *  the thread) plus the live plan windows. `sessionId` selects which thread the
   *  context figure reflects; omitted = baseline only. */
  /** Compact a session's context (P5 / BROKER-EXP-3): move all but the last `KEEP_RECENT`
   *  messages into the `compactedMessages` archive and leave a single small compaction-
   *  summary marker in `messages`, so the session's token count — and the usage gauge's
   *  context % — drops back, freeing space to keep chatting. Server-owned (the backend does
   *  the token-count change; `GET /v1/usage` reflects it). Non-destructive: the archived
   *  detail stays recoverable. A no-op (returns the session unchanged) when there's too
   *  little to compact. Persists + broadcasts `session.updated` so the gauge drops back. */
  compactSession(sessionId: string): Session | undefined {
    const session = SESSIONS.find((s) => s.id === sessionId)
    if (!session) return undefined
    const msgs = session.messages ?? []
    const KEEP_RECENT = 4
    // Need at least a couple of older messages beyond the recent window to be worth it.
    if (msgs.length <= KEEP_RECENT + 1) return session
    const older = msgs.slice(0, msgs.length - KEEP_RECENT)
    const recent = msgs.slice(msgs.length - KEEP_RECENT)
    // On a RE-compaction the older slice leads with the previous compaction marker (a
    // synthetic summary, not real history): drop it — don't re-archive or count it — so the
    // archive holds only real messages and the count doesn't inflate. The single new marker
    // then carries the CUMULATIVE total archived, so there's always exactly one divider.
    const olderReal = older.filter((m) => m.compactedFrom == null)
    const archive = [...(session.compactedMessages ?? []), ...olderReal]
    const summary: Message = {
      id: this.mintMessageId('assistant'),
      role: 'assistant',
      content: `Compacted ${archive.length} earlier messages so we can keep chatting — the gist is carried forward.`,
      compactedFrom: archive.length,
    }
    session.compactedMessages = archive
    session.messages = [summary, ...recent]
    emit({ type: 'session.updated', session })
    persist()
    return session
  },
  usage(sessionId?: string, tenantId?: string): UsageSnapshot {
    let messageTokens = 0
    const session = sessionId ? SESSIONS.find((s) => s.id === sessionId) : undefined
    for (const m of session?.messages ?? []) messageTokens += estimateTokens(m.content)
    // System tools + system prompt are computed from the *actual* request the
    // backend sends — both injected eagerly — so they're real loaded categories.
    const agent = resolveAgent(session?.agentId)
    const systemPromptTokens = estimateTokens(systemPrompt({ id: sessionId ?? '', title: session?.title ?? '' }, agent))
    // The context figures are measured against the session's RESOLVED cognition —
    // the same chain a turn routes (provider: session pick ?? agent's ?? default;
    // model: session pick ?? the provider's configured model) — so the gauge's
    // capacity comes from the provider's own catalog, never a client constant. A
    // Session provider's model is whatever session drains its mailbox (opaque), and
    // a model the catalog doesn't describe has no known window: both degrade to
    // unknown-capacity (`windowTokens` absent), the honest reading.
    const provider = effectiveProviderOf(session)
    const opaque = provider.kind === 'session'
    const modelId = opaque ? undefined : session?.modelId ?? resolvedModelId(PROVIDER_CONFIGS.get(provider.id))
    const model = modelId ? provider.models?.find((m) => m.id === modelId) : undefined
    return {
      context: contextBreakdown({ messageTokens, systemToolsTokens: SYSTEM_TOOLS_TOKENS, systemPromptTokens }, model?.contextWindow),
      limits: meterFor(tenantId).planLimits(), // per-tenant plan windows (F2/PD9)
      model: {
        providerId: provider.id,
        providerLabel: provider.label,
        ...(modelId ? { modelId } : {}),
        ...(model ? { modelLabel: model.label } : {}),
      },
    }
  },

  // ── Schedule templates (the "New schedule" starters) ──
  scheduleTemplates(): ScheduleTemplate[] {
    return SCHEDULE_TEMPLATES
  },

  // ── Entity graph (Projects / Artifacts / Schedules + the relationship graph) ──
  /** Seed projects, scoped to the caller's tenant when given (F2/PD9 — each of
   *  the six demo accounts holds its own themed set, docs/demo-accounts.md).
   *  Created projects live in `graph.extraProjects` (see relationGraph). */
  listProjects(tenantId?: string): Project[] {
    if (!tenantId) return PROJECTS
    return PROJECTS.filter((p) => rowVisibleTo(p, tenantId))
  },
  /** Resolve a Project across BOTH homes — seeded (`PROJECTS`) + created
   *  (`graph.extraProjects`) — the authoritative existence check. `listProjects()`
   *  returns seed projects only, so routes that must reach a *created* (shared)
   *  Project (commissioning / cooperation) resolve through this instead (P8). Returns
   *  the live object; callers must not send it verbatim cross-tenant (redact first). */
  findProject(id: string): Project | undefined {
    return findProject(id)
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
    const project = findProject(projectId) // seed + created (P8 shared Projects are guardable)
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
    const project = findProject(projectId) // seed + created (P8 shared Projects are guardable)
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
    const project = findProject(projectId) // seed + created (P8 shared Projects are guardable)
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
  /** Append an entry to the detective audit trail (docs/agent-commons.md, D15/OQ7) — the
   *  server-side watch over cross-user effects. The store mints the id + stamps `at` (its
   *  own clock), so callers pass only the effect facts. Best-effort backstop, never a gate:
   *  it records, it never refuses. Persisted. */
  recordAudit(entry: Omit<AuditEntry, 'id' | 'at' | 'tenantId'> & { tenantId?: string }): void {
    // The effect's tenant — defaults to the *current backend's* resolved tenant, so the
    // write and the tenant-scoped read (GET /audit) agree on BOTH deployments: the
    // personal tenant on desktop, the web tenant on remote. (Defaulting to the personal
    // tenant unconditionally would leave the remote Audit hub permanently empty, since
    // its read scopes to the web tenant.) A later slice resolves the commission's owning
    // tenant per effect; until then this keeps the hub populated under the default principal.
    const tenantId = entry.tenantId ?? resolveIdentity(BACKEND_MODE).tenant.id
    const full: AuditEntry = { ...entry, tenantId, id: `audit-${(auditSeq += 1)}`, at: Date.now() }
    auditLog.push(full)
    emit({ type: 'audit.entry', entry: full }) // refresh a watching Audit surface
    persist()
  },
  /** The audit trail, newest first — the Audit surface's read. Scoped to `tenantId`
   *  when given (F2/F5): a tenant sees only its own trail. A pre-tenancy persisted
   *  entry (no `tenantId`) is treated as the local/personal tenant's. */
  listAuditLog(tenantId?: string): AuditEntry[] {
    const within = tenantId
      ? auditLog.filter((e) => (e.tenantId ?? LOCAL_IDENTITY.tenant.id) === tenantId)
      : auditLog
    return [...within].reverse()
  },
  /** Credit a successful **commissioned Project effect** to its Contributor's reputation
   *  (docs/agent-commons.md, D13 / OQ1) — the GitHub-style worker track record. Monotonic:
   *  it only ever increments, and only on success (a thrown guardian conflict never reaches
   *  here). Resolves the commission to its Agent; an unknown commission/Agent is a no-op
   *  (fail-quiet — reputation is a best-effort credit, never a gate). Persisted. */
  recordContribution(commissionId: string): void {
    const agentId = COMMISSIONS.get(commissionId)?.agentId
    if (!agentId) return
    const a = WORKER_AGENTS.get(agentId)
    if (!a) return
    WORKER_AGENTS.set(agentId, { ...a, contributions: (a.contributions ?? 0) + 1 })
    persist()
  },
  runProjectEffect(
    projectId: string,
    commissionId: string,
    subGoal: string,
    type: ProjectEffectType,
    target: string,
  ): ProjectEffectResult {
    const monotonic = isProjectEffectMonotonic(type)
    const project = findProject(projectId) // seed + created (P8 shared Projects are guardable)
    const guarded = !monotonic && !!project?.guardianId
    const fulfil = (): ProjectEffectResult => {
      // Reach here only on a successful effect (the guarded path throws on conflict before
      // calling `fulfil`), so this is the single credit point for the D13 track record.
      this.recordContribution(commissionId)
      // Detective audit (D15/OQ7): the fulfilled Project effect on the cross-user channel. Owner-
      // pays attribution (D13) — stamped with the commission's AGENT owner (commissionOwnerTenant),
      // so a cross-tenant Contributor's effect on a shared Project lands in the agent owner's trail,
      // not the caller/backend tenant's.
      this.recordAudit({ channel: 'project-effect', commissionId, capability: type, target, outcome: 'fulfilled', tenantId: this.commissionOwnerTenant(commissionId) })
      return {
        projectId,
        commissionId,
        type,
        target,
        guarded,
        output: `${monotonic ? 'observed' : 'applied'} ${type} on '${target}'`,
      }
    }
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
      // Detective audit (D15): record the refused proxy too — a denied attempt is exactly
      // what a watcher wants to see (the actor is B, who declined under its own authority).
      this.recordAudit({ channel: 'proxy', actorAgentId: to.id, capability: req.capability, target: req.target, outcome: 'denied' })
      return { status: 'denied', actedBy: to.id, reason: `${to.label} may not reach '${req.target}'` }
    }
    this.recordAudit({ channel: 'proxy', actorAgentId: to.id, capability: req.capability, target: req.target, outcome: 'fulfilled' })
    return { status: 'fulfilled', actedBy: to.id, output: `${to.label} performed ${req.capability} on '${req.target}'` }
  },
  /** The sub-goals currently in flight on a Project — one entry per active Contributor
   *  claim (held or committed), the Coordination panel's read. Enumerates the guardian's
   *  resources under the Project's prefix; holders are resolved to their Agent label. */
  projectSubGoals(projectId: string): ProjectSubGoal[] {
    const project = findProject(projectId) // seed + created (P8 shared Projects are guardable)
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
  // ── Discovery directories (D17) · publishing/forking (D18) · open work (D19) ──
  /** The shared-Project discovery directory (docs/agent-commons.md, D17): every Project
   *  whose owner marked it shared, from ANY tenant, redacted to public metadata plus
   *  aggregates that are themselves public acts (Contributor count, open work). Reuses
   *  the P8 sharing flag as the single visibility source — the directory never widens
   *  what sharing already exposed. `q` is a case-insensitive substring over
   *  name/description; ranking is deliberately absent (D17). */
  projectDirectory(tenantId: string, q?: string): ProjectDirectoryEntry[] {
    const needle = (q ?? '').trim().toLowerCase()
    // Only created Projects are shareable (the reducer's share-project touches
    // extraProjects only — seed Projects no-op), so the directory enumerates there.
    return graph.extraProjects
      .filter((p) => p.shared === true)
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle))
      .map((p) => {
        const owner = p.tenantId ?? defaultTenantId()
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          owner: tenantName(owner),
          own: owner === tenantId,
          guarded: !!p.guardianId,
          contributorCount: this.activeCommissionCount(p.id),
          openWorkCount: openSubGoals.filter((o) => o.projectId === p.id && o.status === 'open').length,
          updatedAt: p.updatedAt,
        }
      })
  },
  /** The published-Agent discovery directory (D17/D18): every Agent whose owner set
   *  `published`, from ANY tenant, exposed as its DEFINITION (label / prompt / tools /
   *  instructions) + public track record. Authority / budget / provider binding are
   *  structurally absent from the entry type — a capability never travels (D18). */
  agentDirectory(tenantId: string, q?: string): AgentDirectoryEntry[] {
    const needle = (q ?? '').trim().toLowerCase()
    return [...WORKER_AGENTS.values()]
      .filter((a) => a.published === true)
      .filter((a) => !needle || a.label.toLowerCase().includes(needle) || a.instructions.toLowerCase().includes(needle))
      .map((a) => ({
        id: a.id,
        label: a.label,
        owner: tenantName(a.tenantId ?? defaultTenantId()),
        own: (a.tenantId ?? defaultTenantId()) === tenantId,
        systemPrompt: a.systemPrompt,
        tools: [...a.tools],
        instructions: a.instructions,
        contributions: a.contributions ?? 0,
        forks: a.forks ?? 0,
        version: a.version ?? 1,
        changelog: a.changelog ?? [],
      }))
  },
  // ── D25 — change proposals against a published definition (the PR analog) ──
  /** Open a proposal. The wall is the DIRECTORY's: published-only (an unpublished
   *  agent has no public face to propose against — the identical 404). Full-field,
   *  trimmed + capped; the open-queue is bounded ('capped' → 409). Only definition
   *  fields are representable (the D18 wall, structurally). Rings the owner's bell.
   *  `principal` (FWD-5 Phase 1, here and on every act mutator): the acting principal —
   *  REQUIRED but undefinable, so every caller decides attribution explicitly
   *  (`undefined` = a foreign A2A actor, attributed by `verifiedPeer`/`via` instead,
   *  or a deliberately unattributed context like the snapshot generator's seeding). */
  proposeAgentChange(agentId: string, req: ProposeAgentChangeRequest, tenantId: string, principal: PrincipalRef | undefined): AgentChangeProposal | 'capped' | undefined {
    const agent = WORKER_AGENTS.get(agentId)
    if (!agent || agent.published !== true) return undefined
    const f = req.fields ?? {}
    const fields: AgentChangeProposal['fields'] = {
      ...(typeof f.label === 'string' && f.label.trim() ? { label: f.label.trim().slice(0, 120) } : {}),
      ...(typeof f.systemPrompt === 'string' && f.systemPrompt.trim()
        ? { systemPrompt: f.systemPrompt.trim().slice(0, MAX_PROPOSAL_PROMPT_CHARS) }
        : {}),
      ...(typeof f.instructions === 'string' ? { instructions: f.instructions.trim().slice(0, MAX_PROPOSAL_NOTE_CHARS) } : {}),
      ...(Array.isArray(f.tools)
        ? { tools: f.tools.filter((t): t is string => typeof t === 'string' && !!t.trim()).map((t) => t.trim().slice(0, 80)).slice(0, 16) }
        : {}),
    }
    if (Object.keys(fields).length === 0) return undefined // route pre-validates; belt-and-braces
    const list = AGENT_PROPOSALS.get(agentId) ?? []
    if (list.filter((p) => p.status === 'open').length >= MAX_OPEN_PROPOSALS) return 'capped'
    const proposal: StoredAgentProposal = {
      id: `${agentId}-p${list.length + 1}`, // append-only list ⇒ stable count ⇒ unique
      proposedBy: tenantName(tenantId),
      proposedByTenant: tenantId,
      ...(principal ? { proposedByPrincipal: principal } : {}),
      fields,
      note: (req.note ?? '').trim().slice(0, MAX_PROPOSAL_NOTE_CHARS),
      baseVersion: agent.version ?? 1,
      at: Date.now(),
      status: 'open',
    }
    list.push(proposal)
    AGENT_PROPOSALS.set(agentId, list)
    notifyTenants([agent.tenantId ?? defaultTenantId()], tenantId, {
      kind: 'proposal.opened',
      actor: proposal.proposedBy,
      agentId,
      agentLabel: agent.label,
      proposalId: proposal.id,
    })
    // The bell refreshes the inbox; THIS refreshes the review queue itself (the
    // owner's card prefetches it), so the door never opens on a stale list.
    emit({ type: 'proposal.changed', agentId, parties: [agent.tenantId ?? defaultTenantId(), tenantId] })
    persist()
    return serveProposal(proposal, agent)
  },
  /** The review queue. The OWNER sees every proposal; anyone else who can see the
   *  agent sees only their OWN (a proposal is a conversation between proposer and
   *  owner, not a public feed — recorded trade-off). Undefined for an agent the
   *  caller can't see at all. */
  listAgentProposals(agentId: string, tenantId: string): AgentChangeProposal[] | undefined {
    const agent = WORKER_AGENTS.get(agentId)
    if (!agent || !(agent.published === true || registryVisible(agent, tenantId))) return undefined
    const list = AGENT_PROPOSALS.get(agentId) ?? []
    const owner = (agent.tenantId ?? defaultTenantId()) === tenantId
    return list.filter((p) => owner || p.proposedByTenant === tenantId).map((p) => serveProposal(p, agent))
  },
  /** D13 — the concrete work an Agent RESOLVED, the acts behind its contribution count
   *  (surface-audit S10: a number that is a lineage). Same existence-hiding gate as the
   *  proposal read (invisible agent ⇒ undefined ⇒ 404). The list is PUBLIC-FACE and
   *  P8-REDACTED, the load-bearing wall: an item is included ONLY if its Project is
   *  SHARED — a resolution on a PRIVATE Project is publicly invisible and must never
   *  leak here (the same `project.shared !== true` skip the profile's resolved-activity
   *  uses). Attribution is the resolving commission's Agent — so it survives the
   *  commission still existing (a deleted commission drops its items, like an
   *  unpublished changelog drops off, rather than inventing an attribution). */
  agentResolvedWork(agentId: string, tenantId: string): AgentResolvedItem[] | undefined {
    const agent = WORKER_AGENTS.get(agentId)
    if (!agent || !(agent.published === true || registryVisible(agent, tenantId))) return undefined
    const out: AgentResolvedItem[] = []
    for (const item of openSubGoals) {
      if (item.status !== 'done' || !item.resolvedBy) continue
      const project = findProject(item.projectId)
      if (!project || project.shared !== true) continue // P8 REDACTION — private resolutions never leak
      if (COMMISSIONS.get(item.resolvedBy)?.agentId !== agentId) continue
      out.push({ projectId: project.id, projectName: project.name, subGoal: item.subGoal, resolvedAt: item.resolvedAt ?? item.postedAt })
    }
    return out.sort((a, b) => b.resolvedAt - a.resolvedAt)
  },
  /** Comment on a proposal's thread (D27) — writable by exactly its TWO parties
   *  (proposer ↔ owner, raw tenant ids), while open (the verdict ends the
   *  conversation; the decline note is the last word). To anyone else the proposal
   *  does not exist (→ 404, matching the list read). Rings the OTHER party's bell. */
  commentOnAgentProposal(agentId: string, proposalId: string, body: string, tenantId: string, principal: PrincipalRef | undefined): AgentChangeProposal | 'closed' | 'capped' | undefined {
    const agent = WORKER_AGENTS.get(agentId)
    if (!agent) return undefined
    const ownerTenant = agent.tenantId ?? defaultTenantId()
    // Visibility BEFORE everything, like the list and verdict siblings (review
    // finding): after an unpublish, the ex-proposer's READ 404s — so their WRITE
    // must too (write-without-read is incoherent, the 200 leaked the thread back,
    // and the still-open bell channel named an entity the walls now hide).
    if (ownerTenant !== tenantId && agent.published !== true) return undefined
    const proposal = (AGENT_PROPOSALS.get(agentId) ?? []).find((p) => p.id === proposalId)
    if (!proposal) return undefined
    const isOwner = ownerTenant === tenantId
    const isProposer = proposal.proposedByTenant === tenantId
    if (!isOwner && !isProposer) return undefined
    if (proposal.status !== 'open') return 'closed'
    const comments = (proposal.comments ??= [])
    if (comments.length >= MAX_WORK_ITEM_COMMENTS) return 'capped'
    const comment: StoredWorkItemComment = {
      id: `${proposal.id}-c${comments.length + 1}`, // append-only ⇒ stable count ⇒ unique
      author: tenantName(tenantId),
      ...(principal ? { principal } : {}),
      body: body.trim().slice(0, MAX_WORK_ITEM_COMMENT_CHARS),
      at: Date.now(),
    }
    comments.push(comment)
    // NB: no `@mention` fan-out here (unlike commentOnOpenSubGoal, D29). A proposal
    // thread is parties-only (proposer ↔ owner) over a definition that need not be
    // public; naming a third party would leak the proposal's existence to a non-party.
    notifyTenants([isOwner ? proposal.proposedByTenant : ownerTenant], tenantId, {
      kind: 'proposal.commented',
      actor: tenantName(tenantId),
      agentId,
      agentLabel: agent.label,
      proposalId: proposal.id,
      commentId: comment.id,
    })
    emit({ type: 'proposal.changed', agentId, parties: [ownerTenant, proposal.proposedByTenant] })
    persist()
    return serveProposal(proposal, agent)
  },
  /** The owner's verdict — merge or decline, open proposals only, owner only (raw
   *  tenant-id comparison — the D23 lesson). Merging applies the proposed fields,
   *  bumps the version, and writes the changelog line crediting the PROPOSER
   *  (authorship is provenance, deliberately not D13 reputation); either outcome
   *  rings the proposer's bell. */
  resolveAgentProposal(
    agentId: string,
    proposalId: string,
    tenantId: string,
    action: 'merge' | 'decline',
    note?: string,
  ): AgentChangeProposal | 'forbidden' | 'closed' | undefined {
    const agent = WORKER_AGENTS.get(agentId)
    if (!agent) return undefined
    const owner = (agent.tenantId ?? defaultTenantId()) === tenantId
    // Visibility BEFORE authorization (review finding): to a caller the agent is
    // invisible to (unpublished + foreign), a guessable proposal id must answer
    // 404 like everything else — a 403 would confirm "alive, with proposals".
    if (!owner && agent.published !== true) return undefined
    const proposal = (AGENT_PROPOSALS.get(agentId) ?? []).find((p) => p.id === proposalId)
    if (!proposal) return undefined
    if (!owner) return 'forbidden'
    if (proposal.status !== 'open') return 'closed'
    proposal.resolvedAt = Date.now()
    if (action === 'merge') {
      const version = (agent.version ?? 1) + 1
      const next: Agent = {
        ...agent,
        ...(proposal.fields.label !== undefined ? { label: proposal.fields.label } : {}),
        ...(proposal.fields.systemPrompt !== undefined
          ? { systemPrompt: proposal.fields.systemPrompt, systemPromptId: undefined }
          : {}),
        ...(proposal.fields.instructions !== undefined ? { instructions: proposal.fields.instructions } : {}),
        ...(proposal.fields.tools !== undefined ? { tools: [...proposal.fields.tools] } : {}),
        version,
        changelog: [
          ...(agent.changelog ?? []),
          { version, author: proposal.proposedBy, note: proposal.note || 'Merged proposal', at: proposal.resolvedAt },
        ],
      }
      WORKER_AGENTS.set(agentId, next)
      proposal.status = 'merged'
    } else {
      proposal.status = 'declined'
      const trimmed = (note ?? '').trim().slice(0, MAX_PROPOSAL_NOTE_CHARS)
      if (trimmed) proposal.responseNote = trimmed
    }
    notifyTenants([proposal.proposedByTenant], tenantId, {
      kind: action === 'merge' ? 'proposal.merged' : 'proposal.declined',
      actor: tenantName(tenantId),
      agentId,
      agentLabel: WORKER_AGENTS.get(agentId)?.label ?? agent.label,
      proposalId: proposal.id,
    })
    emit({ type: 'proposal.changed', agentId, parties: [tenantId, proposal.proposedByTenant] })
    persist()
    return publicProposal(proposal)
  },
  /** The workspace profile — a display name's ONE public face (D21,
   *  `GET /directory/owners/:name`). A pure aggregation of rows that are ALREADY
   *  public, through the same redactions the directories use: shared Projects,
   *  published Agents, stats that are themselves public acts, and a recent-activity
   *  feed of open-work acts on SHARED Projects (an item on a private Project is not
   *  a public act). Viewer-independent except the viewer-relative `own` flags.
   *  Undefined (→ 404) for a name with no public rows: a workspace that shares
   *  nothing is invisible — the directory's existence-hiding, extended to identities. */
  ownerProfile(name: string, tenantId: string): OwnerProfile | undefined {
    const projects = this.projectDirectory(tenantId).filter((p) => p.owner === name)
    const agents = this.agentDirectory(tenantId).filter((a) => a.owner === name)
    // `posted` attributes by `postedBy` (already the display name); `resolved` by the
    // resolving commission's Agent owner (commissionOwnerTenant — the attribution
    // primitive), surfacing credit earned on OTHERS' Projects too.
    const activity: OwnerActivity[] = []
    let workPosted = 0
    let workResolved = 0
    for (const item of openSubGoals) {
      const project = findProject(item.projectId)
      if (!project || project.shared !== true) continue
      if (item.postedBy === name) {
        workPosted += 1
        activity.push({ kind: 'posted', at: item.postedAt, projectId: project.id, projectName: project.name, subGoal: item.subGoal })
      }
      if (item.status === 'done' && item.resolvedBy) {
        const resolverTenant = this.commissionOwnerTenant(item.resolvedBy)
        if (resolverTenant && tenantName(resolverTenant) === name) {
          workResolved += 1
          activity.push({
            kind: 'resolved',
            at: item.resolvedAt ?? item.postedAt,
            projectId: project.id,
            projectName: project.name,
            subGoal: item.subGoal,
            agentLabel: item.resolvedByLabel,
          })
        }
      }
    }
    // D27 — definition authorship: this name's merged proposals into ANOTHER
    // owner's published definition, read from the changelogs the directory already
    // serves (no new stored state; unpublished history drops off with the rest of
    // its public face). Provenance surfaced — deliberately not D13 reputation.
    for (const entry of this.agentDirectory(tenantId)) {
      if (entry.owner === name) continue
      for (const l of entry.changelog) {
        if (l.author !== name) continue
        // S9 — carry the OTHER owner (public display name) + the definition id so the
        // profile's authored line can be a ref link to their profile, like its siblings.
        activity.push({ kind: 'authored', at: l.at, agentLabel: entry.label, version: l.version, subGoal: l.note, owner: entry.owner, agentId: entry.id })
      }
    }
    // FWD-6 O3 — the org door: the VIEWER's seat in an org bearing this name
    // (computed, viewer-relative — the INV-9 read-side class; never stored).
    // It both unlocks the member panel client-side and keeps the page serving
    // for members when the org shares nothing public yet. Names collide, so the
    // seat resolves against org tenants only (namespaces excluded) — first hit.
    const seatOrg = [...accounts.tenants.values()].find(
      (t) => t.name === name && t.kind === 'org' && !accounts.isNamespace(t.id) && accounts.seatIn(tenantId, t.id) !== undefined,
    )
    const org = seatOrg ? { id: seatOrg.id, role: accounts.seatIn(tenantId, seatOrg.id)! } : undefined
    if (projects.length === 0 && agents.length === 0 && activity.length === 0 && !org) return undefined
    activity.sort((a, b) => b.at - a.at)
    return {
      name,
      own: tenantName(tenantId) === name,
      ...(org ? { org } : {}),
      projects,
      agents,
      stats: {
        sharedProjects: projects.length,
        publishedAgents: agents.length,
        contributions: agents.reduce((n, a) => n + a.contributions, 0),
        forks: agents.reduce((n, a) => n + a.forks, 0),
        openWork: projects.reduce((n, p) => n + p.openWorkCount, 0),
        workPosted,
        workResolved,
      },
      activity: activity.slice(0, 20),
    }
  },
  /** Global search (D22, `GET /search?q=`): typed, grouped hits across everything the
   *  caller can see. Every source below is an EXISTING per-tenant read or public
   *  redaction — search composes windows, it never opens a new one (a row absent from
   *  every page is absent from search; tests/search.test.ts locks the walls). Groups
   *  come in a fixed order, capped at SEARCH_GROUP_CAP with a true `total`; the
   *  private/commons split mirrors the pages' own bands (your projects vs shared-with-
   *  you; your registry vs the published directory), so nothing appears twice. */
  searchAll(tenantId: string, q?: string): SearchResponse {
    const needle = (q ?? '').trim().toLowerCase()
    if (!needle) return { query: '', groups: [] }
    const hit = (...fields: (string | undefined)[]) => fields.some((f) => f?.toLowerCase().includes(needle))
    const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
    const group = (type: SearchHit['type'], label: string, hits: SearchHit[]): SearchGroup[] =>
      hits.length ? [{ type, label, total: hits.length, hits: hits.slice(0, SEARCH_GROUP_CAP) }] : []

    // 'Your projects' = seeds + created rows the caller owns; a FOREIGN shared row
    // (the Projects list's "Shared with you" band) surfaces via the directory group
    // below instead, so the two groups partition and nothing appears twice.
    const projection = this.relationGraph(tenantId)
    const ownProjects = [...this.listProjects(tenantId), ...projection.extraProjects.filter((p) => p.own !== false)]
    const projectDir = this.projectDirectory(tenantId)
    const agentDir = this.agentDirectory(tenantId)
    const owners = [...new Set([...projectDir.map((p) => p.owner), ...agentDir.map((a) => a.owner)])]
    // Open work is findable exactly where its backlog is readable: on a project the
    // caller owns, or on any shared project (the project page's own wall).
    const openItems = openSubGoals.filter((o) => {
      const p = findProject(o.projectId)
      return o.status === 'open' && !!p && (p.shared === true || rowVisibleTo(p, tenantId))
    })

    return {
      query: needle,
      groups: [
        ...group('session', 'Sessions', this.listSessions(tenantId)
          .filter((s) => hit(s.title, s.preview))
          .map((s): SearchHit => ({ type: 'session', id: s.id, title: s.title, subtitle: s.preview }))),
        ...group('project', 'Your projects', ownProjects
          .filter((p) => hit(p.name, p.description))
          .map((p): SearchHit => ({ type: 'project', id: p.id, title: p.name, subtitle: p.description }))),
        ...group('artifact', 'Artifacts', this.listArtifacts(tenantId)
          .filter((a) => hit(a.name, a.source))
          .map((a): SearchHit => ({ type: 'artifact', id: a.id, title: a.name, subtitle: `${a.meta} · ${a.source}` }))),
        ...group('schedule', 'Scheduled', this.listSchedules(tenantId)
          .filter((s) => hit(s.name, s.subtitle, s.cadence))
          .map((s): SearchHit => ({ type: 'schedule', id: s.id, title: s.name, subtitle: s.subtitle }))),
        ...group('agent', 'Your agents', this.listAgents(tenantId)
          .filter((a) => hit(a.label, a.instructions))
          .map((a): SearchHit => ({ type: 'agent', id: a.id, title: a.label, subtitle: a.instructions }))),
        ...group('prompt', 'Prompts', this.listSystemPrompts(tenantId)
          .filter((p) => hit(p.label, p.body))
          .map((p): SearchHit => ({ type: 'prompt', id: p.id, title: p.label, subtitle: `Authored for ${p.targetFamily}` }))),
        ...group('model', 'Models', this.listProviders(tenantId)
          .filter((p) => hit(p.label))
          .map((p): SearchHit => ({ type: 'model', id: p.id, title: p.label, subtitle: p.kind === 'session' ? 'Delegated session provider' : 'Model endpoint' }))),
        ...group('context', 'Contexts', this.savedContexts().contexts
          .filter((c) => hit(c.label, c.detail))
          .map((c): SearchHit => ({ type: 'context', id: c.id, title: c.label, subtitle: c.detail }))),
        ...group('owner', 'Workspaces', owners
          .filter((n) => hit(n))
          .map((n): SearchHit => ({
            type: 'owner',
            id: n,
            title: n,
            subtitle: `${count(projectDir.filter((p) => p.owner === n).length, 'shared project')} · ${count(agentDir.filter((a) => a.owner === n).length, 'published agent')}`,
          }))),
        ...group('sharedProject', 'Shared projects', projectDir
          .filter((p) => !p.own && hit(p.name, p.description))
          .map((p): SearchHit => ({ type: 'sharedProject', id: p.id, title: p.name, subtitle: `Shared by ${p.owner} · ${p.description}` }))),
        ...group('publishedAgent', 'Published agents', agentDir
          .filter((a) => !a.own && hit(a.label, a.instructions))
          .map((a): SearchHit => ({ type: 'publishedAgent', id: a.id, title: a.label, subtitle: `Published by ${a.owner} · ${a.instructions}`, ref: a.owner }))),
        ...group('openWork', 'Open work', openItems
          .filter((o) => hit(o.subGoal, o.note, o.target))
          .map((o): SearchHit => ({
            type: 'openWork',
            id: o.id,
            title: o.subGoal,
            subtitle: `${findProject(o.projectId)?.name ?? ''} · needs ${o.type}`,
            ref: o.projectId,
          }))),
      ],
    }
  },
  /** Fork a published Agent's definition into the caller's tenant (D18). The copy is a
   *  new PRIVATE Agent carrying the definition (label / prompt / tools / instructions)
   *  with capability UNBOUND: authority and budget are dropped (the new owner re-grants
   *  through their own D8 funnel), the provider / prompt bindings survive only when the
   *  forker can see them (the shared seeds; a foreign private provider never crosses),
   *  and the track record resets (a fork is a recipe, not a reputation transplant).
   *  Lineage is stamped (`forkedFrom`) and the source's fork counter increments — the
   *  public credit. Undefined (→ 404, no existence leak) for an unknown id or a foreign
   *  Agent that isn't published; the caller's own Agents fork freely (duplicate). */
  forkAgent(sourceId: string, tenantId: string): Agent | undefined {
    const source = WORKER_AGENTS.get(sourceId)
    if (!source || !(source.published === true || registryVisible(source, tenantId))) return undefined
    const provider = source.providerId ? MODEL_PROVIDERS.get(source.providerId) : undefined
    const prompt = source.systemPromptId ? SYSTEM_PROMPT_LIB.get(source.systemPromptId) : undefined
    const fork = this.createAgent(
      {
        label: source.label,
        systemPrompt: source.systemPrompt,
        systemPromptId: prompt && registryVisible(prompt, tenantId) ? prompt.id : undefined,
        tools: [...source.tools],
        instructions: source.instructions,
        providerId: provider && registryVisible(provider, tenantId) ? provider.id : undefined,
        // D25: record WHICH version was taken — the baseline a later proposal
        // (or "am I behind the source?") is measured against.
        forkedFrom: { agentId: source.id, label: source.label, version: source.version ?? 1 },
      },
      tenantId,
    )
    WORKER_AGENTS.set(source.id, { ...source, forks: (source.forks ?? 0) + 1 })
    // D24: a fork is public credit — tell the definition's owner.
    notifyTenants([source.tenantId ?? defaultTenantId()], tenantId, {
      kind: 'agent.forked',
      actor: tenantName(tenantId),
      agentId: source.id,
      agentLabel: source.label,
    })
    persist()
    return fork
  },
  /** Mint a private Agent from a fetched remote A2A **Agent Card** (D20,
   *  docs/a2a-integration.md) — the cross-INSTANCE sibling of `forkAgent`, with the
   *  same capability posture: the card's definition (name / description / advertised
   *  skills) becomes a definition STUB (default prompt body, no local tools — a
   *  remote skill name maps to no catalog entry), `importedFrom` stamps the lineage,
   *  and authority / budget / provider are NOT created — the importing owner binds
   *  their own through the D8 funnel. The route owns the fetch + shape validation. */
  importAgentFromCard(card: { name: string; description?: string; skills?: { id?: string; name?: string }[] }, url: string, tenantId: string): Agent {
    // Untrusted remote input: trim + cap what lands in the registry. The route's
    // body cap bounds the total; these bound what the UI renders and the store
    // persists (a ~250KB "name" inside a within-cap card is still hostile).
    const name = card.name.trim().slice(0, 120)
    const skills = (Array.isArray(card.skills) ? card.skills : [])
      .map((s) => (typeof s?.name === 'string' && s.name) || (typeof s?.id === 'string' && s.id) || '')
      .filter(Boolean)
      .map((s) => s.slice(0, 80))
      .slice(0, 12)
    const description = (typeof card.description === 'string' ? card.description.trim() : '').slice(0, 2000)
    return this.createAgent(
      {
        label: name,
        systemPrompt: DEFAULT_SYSTEM_PROMPT_BODY,
        tools: [],
        instructions: [description, skills.length ? `Advertised skills (remote): ${skills.join(', ')}.` : '']
          .filter(Boolean)
          .join(' '),
        importedFrom: { url, name },
      },
      tenantId,
    )
  },
  /** A Project's open-work backlog (D19) — open items first (newest within each band).
   *  Served through the `publicOpenSubGoal` redaction (the poster's raw tenant id
   *  never crosses; the display name is the public face). */
  listOpenSubGoals(projectId: string): OpenSubGoal[] {
    const items = openSubGoals.filter((o) => o.projectId === projectId)
    const band = (o: OpenSubGoal) => (o.status === 'open' ? 0 : 1)
    return [...items].sort((a, b) => band(a) - band(b) || b.postedAt - a.postedAt).map(publicOpenSubGoal)
  },
  /** Post a work item onto a Project's backlog (D19) — the issues-tray act — then
   *  dispatch it to the Project's standing Contributors synchronously. Returns the item
   *  in its post-dispatch state: `done` when a standing Commission took it, `open` when
   *  none could (it stays visible in the backlog). The route validates visibility. */
  postOpenSubGoal(projectId: string, req: PostOpenSubGoalRequest, tenantId: string, principal: PrincipalRef | undefined, via?: 'a2a', verifiedPeer?: string): OpenSubGoal {
    const item: StoredOpenSubGoal = {
      id: `work-${(openSubGoalSeq += 1)}`,
      projectId,
      subGoal: req.subGoal,
      type: req.type,
      target: req.target,
      note: req.note ?? '',
      // D28: a verified peer's REGISTERED name is the attribution (never the
      // caller-supplied dev-seam headers); the stamp marks it verified.
      postedBy: verifiedPeer ?? tenantName(tenantId),
      ...(verifiedPeer ? { verifiedPeer } : {}),
      // The strict retract-authorization anchor — server-private (redacted on read).
      postedByTenant: tenantId,
      ...(principal ? { postedByPrincipal: principal } : {}),
      postedAt: Date.now(),
      status: 'open',
      // Provenance only (D20): an A2A-posted item passes the identical walls.
      ...(via ? { via } : {}),
    }
    openSubGoals.push(item)
    // The posted-notification fans out BEFORE dispatch so the two acts read in
    // order in every inbox (posted, then — when a standing taker fired — resolved).
    notifyTenants(workItemAudience(item), tenantId, {
      kind: 'work.posted',
      actor: item.postedBy,
      projectId,
      projectName: findProject(projectId)?.name ?? '',
      subGoal: item.subGoal,
      workItemId: item.id,
    })
    this.dispatchOpenSubGoal(item)
    emit({ type: 'openwork.changed', projectId })
    persist()
    return publicOpenSubGoal(item)
  },
  /** Standing dispatch (D19): offer an open item to the Project's `standing`
   *  Commissions, in role-rank order (ties first-come by id), and let the FIRST one
   *  that passes every wall take it. The walls are exactly the prompted path's — role
   *  (D14, checked here as the route does), reach (D12), and the Guardian (D11) inside
   *  `runProjectEffect`, which also credits (D13) and audits (D15). Dispatch adds a
   *  trigger, zero authority. An item nothing can take stays `open` — the seam where a
   *  real job queue would go. Synchronous and in-process by design (the trade-off D19
   *  accepts); a `GuardianError` (someone already holds the sub-goal) skips to the next
   *  candidate rather than failing the post. */
  dispatchOpenSubGoal(item: OpenSubGoal): boolean {
    if (item.status !== 'open') return false
    const monotonic = isProjectEffectMonotonic(item.type)
    const reaches = item.type.startsWith('connector.') || item.type.startsWith('mcp.')
    const candidates = [...COMMISSIONS.values()]
      .filter((c) => c.projectId === item.projectId && c.standing === true)
      .sort((a, b) => roleRank(b.role ?? 'writer') - roleRank(a.role ?? 'writer') || a.id.localeCompare(b.id))
    for (const c of candidates) {
      if (!this.commissionRolePermits(c.id, 'reserve')) continue
      if (!monotonic && !this.commissionRolePermits(c.id, 'fire')) continue
      if (reaches && !this.commissionCanReach(c.id, 'connectors', item.target)) continue
      try {
        this.runProjectEffect(item.projectId, c.id, item.subGoal, item.type, item.target)
      } catch (err) {
        if (err instanceof GuardianError) continue // held by someone else — next volunteer
        throw err
      }
      item.status = 'done'
      item.resolvedBy = c.id
      item.resolvedByLabel = WORKER_AGENTS.get(c.agentId)?.label ?? c.agentId
      item.resolvedAt = Date.now()
      // D24: unprompted work is exactly what a bell exists for — tell the item's
      // audience, attributed to the resolving agent's OWNER workspace (D13).
      {
        const resolverTenant = this.commissionOwnerTenant(c.id) ?? defaultTenantId()
        // FWD-5 Phase 3 — the attribution chain's owner leg, captured at act time
        // (like resolvedByLabel: the record survives a later commission delete).
        item.resolvedByOwner = tenantName(resolverTenant)
        notifyTenants(workItemAudience(item), resolverTenant, {
          kind: 'work.resolved',
          actor: tenantName(resolverTenant),
          projectId: item.projectId,
          projectName: findProject(item.projectId)?.name ?? '',
          subGoal: item.subGoal,
          workItemId: item.id,
        })
      }
      return true
    }
    return false
  },
  /** Append a comment to a work item's flat discussion thread (D23): anyone who can
   *  see the Project may comment (the route enforces visibility with the same wall
   *  the backlog read uses); attribution is the display name, like `postedBy`.
   *  Append-only, trimmed + capped (per comment and per item — a bound, not a forum).
   *  Returns the updated item; `'capped'` when the thread is full; undefined for an
   *  unknown item (→ 404). */
  commentOnOpenSubGoal(projectId: string, itemId: string, body: string, tenantId: string, principal: PrincipalRef | undefined, verifiedPeer?: string): OpenSubGoal | 'capped' | undefined {
    const item = openSubGoals.find((o) => o.id === itemId && o.projectId === projectId)
    if (!item) return undefined
    const comments = (item.comments ??= [])
    if (comments.length >= MAX_WORK_ITEM_COMMENTS) return 'capped'
    // Parse mentions from the STORED text (trimmed + sliced) so a mention past the
    // char cap — not visible in the comment — never notifies.
    const storedBody = body.trim().slice(0, MAX_WORK_ITEM_COMMENT_CHARS)
    const comment: StoredWorkItemComment = {
      // Deterministic per-item id: comments are append-only (no delete act), so the
      // running count is stable — no new persisted sequence needed.
      id: `${item.id}-c${comments.length + 1}`,
      // D28: a verified peer's registered name attributes the comment.
      author: verifiedPeer ?? tenantName(tenantId),
      ...(principal ? { principal } : {}),
      body: storedBody,
      at: Date.now(),
    }
    comments.push(comment)
    const project = findProject(projectId)
    const projectName = project?.name ?? ''
    // D29 — `@mention` fan-out, but ONLY on a shared Project: its backlog is already
    // world-visible (D17), so naming any workspace on it leaks nothing; on a private
    // Project (audience = owner alone) naming an outsider would leak its existence,
    // so mentions there resolve to no one (the D24 stale-audience wall).
    const mentioned = project?.shared === true ? resolveMentions(storedBody) : new Set<string>()
    // A mentioned party gets the more-specific `mentioned` bell, not ALSO a generic
    // `work.commented` — fan the comment audience MINUS the mention set.
    const commentAudience = new Set([...workItemAudience(item)].filter((t) => !mentioned.has(t)))
    notifyTenants(commentAudience, tenantId, {
      kind: 'work.commented',
      actor: verifiedPeer ?? tenantName(tenantId),
      projectId,
      projectName,
      subGoal: item.subGoal,
      workItemId: item.id,
      commentId: comment.id,
    })
    if (mentioned.size > 0) {
      notifyTenants(mentioned, tenantId, {
        kind: 'mentioned',
        actor: verifiedPeer ?? tenantName(tenantId),
        projectId,
        projectName,
        subGoal: item.subGoal,
        workItemId: item.id,
        commentId: comment.id,
      })
    }
    emit({ type: 'openwork.changed', projectId })
    persist()
    return publicOpenSubGoal(item)
  },
  /** Retract a work item (D23) — the honest close: permitted only to the item's
   *  POSTER (name-compared, the platform's public identity) or the Project's OWNER
   *  tenant, and only while the item is still `open` — a `done` item is immutable
   *  history (the D13 credit cannot be un-happened). Returns the updated item;
   *  `'forbidden'` / `'closed'` for the two refusals; undefined for an unknown
   *  item (→ 404). Also the store method behind A2A `tasks/cancel` (D20). */
  retractOpenSubGoal(projectId: string, itemId: string, tenantId: string, principal: PrincipalRef | undefined): OpenSubGoal | 'forbidden' | 'closed' | undefined {
    const item = openSubGoals.find((o) => o.id === itemId && o.projectId === projectId)
    if (!item) return undefined
    const ownerTenant = findProject(projectId)?.tenantId ?? defaultTenantId()
    // BOTH branches compare raw tenant ids (review finding: display names are
    // attacker-controlled — createWorkspace has no uniqueness guard — so a name
    // comparison would let a colliding-name tenant close a victim's items). A
    // legacy item persisted without `postedByTenant` is poster-unretractable
    // (fail-closed); its Project owner still can.
    const isPoster = item.postedByTenant !== undefined && item.postedByTenant === tenantId
    // FWD-6: "the Project owner" on an org-owned project means the org's OWNER
    // seat (write-grade union) — same raw-id comparison discipline underneath.
    if (!isPoster && !tenantWritesAs(tenantId, ownerTenant)) return 'forbidden'
    if (item.status !== 'open') return 'closed'
    item.status = 'retracted'
    item.retractedAt = Date.now()
    item.retractedBy = tenantName(tenantId)
    if (principal) item.retractedByPrincipal = principal
    notifyTenants(workItemAudience(item), tenantId, {
      kind: 'work.retracted',
      actor: item.retractedBy,
      projectId,
      projectName: findProject(projectId)?.name ?? '',
      subGoal: item.subGoal,
      workItemId: item.id,
    })
    emit({ type: 'openwork.changed', projectId })
    persist()
    return publicOpenSubGoal(item)
  },

  // ── D28 — peer credentials (verified identity at the A2A edge) ──
  /** Mint a peer credential: the token is returned ONCE; only its SHA-256 persists
   *  (the relay-secret pattern). The registered NAME — chosen by the owner, not
   *  self-declared by the remote — is what verified acts are stamped with. */
  createA2aPeer(name: string): { peer: A2aPeer; token: string } {
    const token = mintRelaySecret()
    const peer: StoredA2aPeer = {
      id: `peer-${(a2aPeerSeq += 1)}`,
      name: name.trim().slice(0, 120),
      createdAt: Date.now(),
      secretHint: relaySecretHint(token),
      tokenHash: hashRelaySecret(token),
    }
    A2A_PEERS.set(peer.id, peer)
    persist()
    return { peer: publicPeer(peer), token }
  },
  listA2aPeers(): A2aPeer[] {
    return [...A2A_PEERS.values()].map(publicPeer)
  },
  /** Revocation IS deletion — the hash dies with the peer. */
  deleteA2aPeer(id: string): boolean {
    const had = A2A_PEERS.delete(id)
    if (had) persist()
    return had
  },
  /** Resolve an `Authorization: Bearer …` header to a registered peer (constant-
   *  time hash compare). Undefined for absent/unknown credentials — the caller
   *  decides whether that's fatal (`A2A_REQUIRE_AUTH`) or just unverified. */
  resolveA2aPeer(authorization: string | undefined): A2aPeer | undefined {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
    if (!token) return undefined
    const hash = hashRelaySecret(token)
    for (const p of A2A_PEERS.values()) {
      if (sameSecretHash(p.tokenHash, hash)) return publicPeer(p)
    }
    return undefined
  },

  // ── D24 — watching + the notification inbox ──
  /** Set the caller's watch on a Project (the route validates visibility with the
   *  same wall as reading it — watching needs only visibility, COMMONS-13). */
  setWatch(projectId: string, tenantId: string, watching: boolean): WatchState {
    const set = watches.get(projectId) ?? new Set<string>()
    if (watching) set.add(tenantId)
    else set.delete(tenantId)
    if (set.size > 0) watches.set(projectId, set)
    else watches.delete(projectId)
    persist()
    return { watching }
  },
  watchState(projectId: string, tenantId: string): WatchState {
    return { watching: watches.get(projectId)?.has(tenantId) ?? false }
  },
  /** The caller's inbox, newest first — ONLY its own rows, served without the
   *  recipient field (the wire shape is `AppNotification`). */
  /** The caller's inbox — their namespace's rows plus every org's they hold a
   *  seat in (FWD-6 O-D5: an org's bell is member-readable). */
  listNotifications(tenantId: string): AppNotification[] {
    return notifications
      .filter((x) => tenantReadsAs(tenantId, x.tenantId))
      .map(({ tenantId: _recipient, ...pub }) => pub)
      .reverse()
  },
  /** Mark the caller's rows read — the named ids, or all. Idempotent; emits (and
   *  persists) only when something actually flipped. The same union as the read:
   *  a member may settle the org's bell (a disposable, derived row — not an act). */
  markNotificationsRead(tenantId: string, ids?: string[]): AppNotification[] {
    const named = ids ? new Set(ids) : null
    // Invalidate per RECIPIENT tenant, not per caller: a member settling an org
    // row must reach the org's other member streams (which gate on the row's
    // tenant through the same union), not just their own.
    const touched = new Set<string>()
    for (const x of notifications) {
      if (!tenantReadsAs(tenantId, x.tenantId) || x.read) continue
      if (named && !named.has(x.id)) continue
      x.read = true
      touched.add(x.tenantId)
    }
    if (touched.size > 0) {
      for (const t of touched) emit({ type: 'notification.changed', tenantId: t })
      persist()
    }
    return this.listNotifications(tenantId)
  },

  /** The base artifacts (the relation graph carries any saved-out extras),
   *  scoped to the caller's tenant when given (F2/PD9). */
  listArtifacts(tenantId?: string): ArtifactItem[] {
    if (!tenantId) return ALL_ARTIFACTS
    return ALL_ARTIFACTS.filter((a) => rowVisibleTo(a, tenantId))
  },
  /** Routines, scoped to the caller's tenant when given (F2/PD9 — each demo
   *  account seeds its own themed set). Unscoped for internal callers (the
   *  daemon, run lookups by id). */
  listSchedules(tenantId?: string): ScheduledTask[] {
    if (!tenantId) return schedules
    return schedules.filter((t) => rowVisibleTo(t, tenantId))
  },
  /** Whether a routine is visible to `tenantId` — the route-level guard for the
   *  by-id reads/mutations, mirroring sessionVisibleToTenant. */
  scheduleVisibleToTenant(task: ScheduledTask, tenantId: string): boolean {
    return rowVisibleTo(task, tenantId)
  },

  // ── Scheduled runs (a single live feed; runs are server-owned) ──
  /** The left rail's recent runs (newest-first, capped) — the caller's tenant's
   *  routines only when given (a run session belongs to its routine's tenant).
   *  Each entry carries the run's PERSISTED session row (the same row the by-id
   *  session routes serve — one source, so a rename shows here too); the quiet
   *  ensure only covers a row a pre-feature snapshot didn't carry. */
  recentRuns(tenantId?: string): RunSessionEntry[] {
    return recentEntries(tenantId ? this.listSchedules(tenantId) : schedules).map(({ task, run }) => ({
      task,
      run,
      session: ensureRunSession(task, run, { quiet: true }),
    }))
  },
  /** Run a routine now: append a 'running' run, broadcast it, relight its rail one
   *  step at a time (`run.progress`), then finish it (`run.finished`). On finish any
   *  standing-approved effect the routine carries is applied unprompted
   *  (`relation.applied` by:'standing'). The daemon uses this same path on a cadence. */
  runSchedule(id: string): ScheduledRun | undefined {
    const task = schedules.find((t) => t.id === id)
    if (!task) return undefined
    // No overlapping runs of the same routine (P7): the daemon can tick again before a
    // run finishes, so if one is already in flight, return it instead of starting a
    // second. (A stale 'running' run from before a restart is swept to 'failed' on
    // rehydrate, so it can't wedge the routine.)
    const inFlight = task.runs.find((r) => r.status === 'running')
    if (inFlight) return inFlight
    const run: ScheduledRun = {
      id: `run-live-${(runSeq += 1)}`,
      status: 'running',
      duration: '—',
      reachedStep: 0,
      summary: 'Running on demand…',
      at: Date.now(),
    }
    task.runs = [run, ...task.runs]
    // Bounded history (the daemon runs forever): past the cap the oldest run
    // retires together with its session row.
    retireOldRuns(task)
    // The run's conversation opens the moment the run does — a real row through
    // the one mint funnel (initiator: this routine), so the thread is live while
    // the rail still steps. Broadcasts session.updated + persists.
    const session = ensureRunSession(task, run)
    const sessionId = session.id
    emit({ type: 'run.started', taskId: task.id, taskName: task.name, sessionId, run })
    persist()
    const steps = task.steps.length
    // The timers close over `task`/`run`; if either was deleted mid-run
    // (removeSchedule, or removeSession's run cascade), a late beat must do
    // NOTHING — settling a detached run would re-mint a zombie session row for
    // a routine that no longer exists.
    const gone = () => !schedules.includes(task) || !task.runs.includes(run)
    // Advance the rail one step per beat so a connected client sees the run progress
    // (`run.progress`) rather than jump from 0 → done.
    for (let i = 1; i <= steps; i += 1) {
      setTimeout(() => {
        if (run.status !== 'running' || gone()) return // superseded (swept after a restart) / deleted
        run.reachedStep = i
        emit({ type: 'run.progress', taskId: task.id, runId: run.id, reachedStep: i, status: 'running' })
        persist()
      }, i * RUN_STEP_MS)
    }
    // A final beat after the last step: mark done, apply standing effects, finish.
    setTimeout(() => {
      if (run.status !== 'running' || gone()) return
      run.status = 'ok'
      run.reachedStep = steps
      run.duration = `${8 + steps * 3}s`
      run.summary = `Ran on demand — delivered to ${task.delivery.target}`
      task.lastStatus = 'ok'
      // The recap lands in the run's session the way any reply lands in a thread.
      settleRunSession(task, run)
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
    emit({ type: 'schedule.changed', taskId: task.id, tenantId: task.tenantId })
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
    if (patch.name !== undefined) {
      task.name = patch.name
      // The runs' sessions carry the routine's name (title + initiator stamp) —
      // sync them so the run threads can't drift from a renamed routine (UI-12:
      // no stale mirror of a live source). Quietly: one rename must not emit a
      // full-payload session.updated per run (a routine can hold RUN_HISTORY_CAP
      // of them — that would flood the event-log ring and fan out N refetches);
      // the schedule.changed below is the one broadcast, and the run rows aren't
      // in the sessions list, so nothing reads them except a by-id open — which
      // re-reads on select.
      for (const s of SESSIONS) {
        if (s.scheduledRunOf?.taskId !== task.id) continue
        s.title = patch.name
        s.scheduledRunOf = { ...s.scheduledRunOf, taskName: patch.name }
      }
    }
    if (patch.prompt !== undefined) task.prompt = patch.prompt
    if (patch.cadence !== undefined) task.cadence = patch.cadence
    if (patch.trigger !== undefined) task.trigger = patch.trigger
    if (patch.next !== undefined) task.next = patch.next
    if (patch.timezone !== undefined) task.timezone = patch.timezone
    if (patch.model !== undefined) task.model = patch.model
    if (patch.notifyOnFailure !== undefined) task.notifyOnFailure = patch.notifyOnFailure
    if (patch.delivery !== undefined) task.delivery = patch.delivery
    if (patch.steps !== undefined) task.steps = patch.steps
    emit({ type: 'schedule.changed', taskId: task.id, tenantId: task.tenantId })
    persist()
    return task
  },
  /** Add a routine from a template (lands paused), return it. */
  addSchedule(seed: Omit<ScheduledTask, 'id'>): ScheduledTask {
    const task: ScheduledTask = { ...seed, id: `s-new-${(scheduleSeq += 1)}` }
    schedules.unshift(task)
    // A seed can carry run history — capped, and every run gets its session row
    // through the same funnel (the one-funnel invariant holds wherever runs
    // enter the store).
    retireOldRuns(task)
    for (const run of task.runs) {
      ensureRunSession(task, run, { quiet: true })
      settleRunSession(task, run, { quiet: true })
    }
    emit({ type: 'schedule.changed', taskId: task.id, tenantId: task.tenantId })
    persist()
    return task
  },
  /** Remove a routine — and its runs' sessions with it (they are the routine's
   *  conversations; `schedule.changed` already tells clients the whole history is
   *  gone, so the rows go without per-row broadcasts). */
  removeSchedule(id: string): void {
    const i = schedules.findIndex((t) => t.id === id)
    if (i < 0) return
    const [gone] = schedules.splice(i, 1)
    for (let j = SESSIONS.length - 1; j >= 0; j -= 1) {
      if (SESSIONS[j].scheduledRunOf?.taskId === gone.id) SESSIONS.splice(j, 1)
    }
    // Stamped from the removed row — the gate can no longer resolve it by id.
    emit({ type: 'schedule.changed', taskId: gone.id, tenantId: gone.tenantId })
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
  relationGraph(tenantId?: string): RelationGraph {
    // No tenant ⇒ the full graph (internal callers, tests). A tenant ⇒ its projected view
    // (F2/PD9). The default tenant's projection equals the full graph (all seed rows are
    // the default tenant's), so the route can always pass the caller's tenant safely.
    return tenantId ? projectGraphForTenant(graph, tenantId) : graph
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
  applyRelationOp(op: RelationOp, tenantId?: string): RelationGraph {
    switch (op.kind) {
      case 'create-provider':
        // A user-confirmed provider is a proper cascade root: grant everything (the
        // account plan still bounds it), matching the seeded default's explicit '*'.
        this.createProvider({
          label: op.label,
          modelFamily: op.modelFamily,
          effortLevels: ['Low', 'Medium', 'High'],
          authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] },
        }, {}, tenantId)
        break
      case 'create-prompt':
        this.createSystemPrompt({ label: op.label, body: op.body, targetFamily: op.targetFamily }, tenantId)
        break
      case 'create-agent':
        // The tool builder stamps concrete bindings on every proposal (default-else-
        // first when the model named none), so the consent card the user confirmed
        // already NAMED the provider + prompt. A proposal without them (a stale
        // pre-strictness one) is refused like any other invalid create — never
        // silently resolved to a default.
        if (!op.providerId || !op.systemPromptId) {
          throw new ValidationError('This proposal predates the required provider/prompt bindings — ask for it again.')
        }
        this.createAgentFromRequest({
          label: op.label,
          providerId: op.providerId,
          systemPromptId: op.systemPromptId,
          instructions: op.instructions,
          // Absent on a stale proposal ⇒ the empty set (minimal risk) — unlike the
          // bindings above, absence here has an honest meaning, so no refusal.
          tools: op.tools,
        }, tenantId)
        break
      case 'commission-agent':
        if (!WORKER_AGENTS.has(op.agentId)) {
          throw new ConflictError(`No agent '${op.agentId}' to commission — it may have been removed.`)
        }
        this.createCommission({ agentId: op.agentId, projectId: op.projectId, role: op.role }, tenantId)
        break
      case 'uncommission-agent':
        // Idempotent: a commission already gone (e.g. removed in the hub first) is a
        // benign no-op, not an error — the Contributor is absent either way.
        this.deleteCommission(op.commissionId)
        break
      case 'handoff-agent':
        this.setSessionAgent(op.sessionId, op.agentId) // D16: re-bind the Conversation's driver
        break
      case 'set-commission-cap':
        this.setCommissionCap(op.projectId, op.cap) // D13: the owner's abuse ceiling, via the same card
        break
      case 'set-project-default-role':
        this.setProjectDefaultRole(op.projectId, op.role) // D14: the pickers' pre-selection, via the same card
        break
      case 'attach-context':
        break // a live-session effect, applied by the caller
      default:
        graph = applyGraphOp(graph, op, mintArtifactId, Date.now())
        // Stamp the creating tenant on a newly-created project so the graph projection
        // (relationGraph(tenantId)) scopes it (F2/PD9). The shared reducer stays tenant-
        // agnostic; the server (which knows the caller) owns the stamp.
        if (op.kind === 'create-project') {
          const created = graph.extraProjects.find((p) => p.id === op.projectId)
          // FWD-6 O-D4: an explicit ownerTenantId (validated in opDeniedForTenant —
          // a held seat) stamps the org; ABSENT means the caller's own namespace,
          // the fixed minimal-risk absence class (INV-9), never a mutable default.
          if (created && created.tenantId === undefined) created.tenantId = op.ownerTenantId ?? tenantId ?? defaultTenantId()
        } else if (op.kind === 'save-artifact') {
          // The reducer unshifts the new artifact to extraArtifacts[0] (its id is minted
          // internally). Stamp the creating tenant so the projection scopes it (F2/PD9).
          const created = graph.extraArtifacts[0]
          if (created && created.tenantId === undefined) created.tenantId = tenantId ?? defaultTenantId()
        }
    }
    // Stamp the acting tenant so the SSE fan-out delivers this only to that tenant (F2/PD9).
    emit({ type: 'relation.applied', op, by: 'user', tenantId: tenantId ?? defaultTenantId() })
    persist()
    // Return the caller's projected view (F2/PD9) so the client's optimistic graph matches
    // what a subsequent GET /relations would return; no tenant ⇒ the full graph.
    return tenantId ? projectGraphForTenant(graph, tenantId) : graph
  },
  /** Whether a relation op must be REFUSED for `tenantId` (F2/PD9). The route rejects it
   *  404 (existence-hiding) BEFORE the shared reducer applies it. Two independent checks —
   *  a violation of EITHER denies:
   *    • **Destination project** — an op whose (non-null) `projectId` names a project the
   *      caller doesn't own. `create-project` is *not* exempt: a brand-new id resolves to no
   *      project (allowed), but a create-project COLLIDING with a foreign id takes the
   *      reducer's re-file path (contract/graph.ts) and would inject the caller's session
   *      into the victim's project — so it must be refused like any other foreign target.
   *    • **Subject session** — an op that moves a SESSION (`sessionId`) it doesn't own, e.g.
   *      unfiling (`projectId:null`) another tenant's session. Sessions are tenant-scoped
   *      (sessionVisibleToTenant); an unknown session has no owner to protect (allowed).
   *  Seed projects/sessions are the default tenant's, so the default caller passes. (The
   *  artifact/schedule SUBJECT axes await slice 3b, when those entities gain a tenant.) */
  opDeniedForTenant(op: RelationOp, tenantId: string): boolean {
    const pid = (op as { projectId?: string | null }).projectId
    // `!= null`, not truthiness: an EMPTY-STRING projectId is still a real key on the write
    // side and buckets to the default tenant on read (projectTenant('') ⇒ default), so it
    // must run the ownership check too — a truthy `if (pid)` would skip '' and let a
    // non-default tenant inject a ''-keyed row into the default view. The genuine unfile is
    // `projectId: null`, which stays exempt here (handled by the subject-session check).
    if (pid != null) {
      // An UNKNOWN project id is not un-owned: `projectGraphForTenant` buckets any row
      // keyed by an id with no Project object to the DEFAULT tenant (projectTenant ⇒
      // defaultTenantId()). So a non-default caller keying a project row (scope-context,
      // set-project-instructions, file-session, …) under a guessed/ghost id would inject
      // it into the default tenant's projection — refuse it. `create-project` is the sole
      // exception: an unknown id there MINTS a fresh Project stamped with the caller, so a
      // brand-new id is legitimately the caller's; only a COLLISION with an existing
      // foreign project must be refused (findProject resolves it).
      const owner = projectTenant(pid) // defaultTenantId() for an unknown id
      if (op.kind === 'create-project') {
        if (findProject(pid) && !tenantWritesAs(tenantId, owner)) return true
        // FWD-6 O-D4 — the owner picker: a present ownerTenantId must be a tenant
        // the caller holds a SEAT in (their own namespace included); anything else
        // is refused with the same existence-hiding 404 as any foreign target —
        // never normalized to a namespace it didn't say (INV-9).
        if (op.ownerTenantId && accounts.seatIn(tenantId, op.ownerTenantId) === undefined) return true
      } else if (!tenantWritesAs(tenantId, owner)) {
        // P8 carve-out — the ONE cross-tenant project op allowed: commissioning your OWN
        // agent onto a SHARED Project (the cooperation primitive, D13 owner-pays). The
        // agent-subject axis below still requires the agent be the caller's own, so this
        // admits a Contributor without letting anyone conscript a foreign agent or write
        // other content into a foreign Project (file-session/scope/share-project stay owner-only).
        if (!(op.kind === 'commission-agent' && findProject(pid)?.shared === true)) return true
        // Close the ghost-vs-foreign existence oracle (P8 review): on THIS cross-tenant path an
        // UNKNOWN agent is denied here (uniform 404), matching the KNOWN-foreign denial the
        // general agent-subject axis gives below — else a foreign caller could distinguish a real
        // private agent (foreign ⇒ 404) from a ghost (would fall through to the 409 the
        // same-tenant "agent removed" case gives). The same-tenant path (owner === tenantId) is
        // untouched, so that helpful 409 is preserved for a caller's own removed agent.
        if (!WORKER_AGENTS.get(op.agentId)) return true
      }
    }
    // Subject ARTIFACT: an op that moves/edits an existing artifact (refile-artifact,
    // set-artifact-source) it doesn't own. Like the project axis, an unknown/empty id
    // buckets to the default tenant on read (artifactTenant), so `!= null` (not truthiness)
    // — a non-default caller keying a ghost/'' artifact row is refused. (save-artifact
    // MINTS a new id internally, carries no `artifactId`, so it's naturally exempt here.)
    const aid = (op as { artifactId?: string }).artifactId
    if (aid != null && artifactTenant(aid) !== tenantId) return true
    const sid = (op as { sessionId?: string }).sessionId
    if (sid) {
      const session = SESSIONS.find((s) => s.id === sid)
      if (session && !this.sessionVisibleToTenant(session, tenantId)) return true
    }
    // Subject AGENT / COMMISSION (Agent-Commons registry axes, F2/PD9): a relation op that
    // names an existing agent/commission the caller can't see (commission-agent, handoff-agent
    // → agentId; uncommission-agent → commissionId) is refused — a tenant can't commission,
    // hand a session off to, or uncommission another tenant's PRIVATE registry entry. A shared
    // (seeded) entry is visible to all (registryVisible); an unknown id isn't a leak (registries
    // have no read-projection), so only a KNOWN foreign entry is denied.
    const opAgentId = (op as { agentId?: string }).agentId
    if (opAgentId != null) {
      const agent = WORKER_AGENTS.get(opAgentId)
      if (agent && !registryVisible(agent, tenantId)) return true
    }
    const opCommissionId = (op as { commissionId?: string }).commissionId
    if (opCommissionId != null) {
      const commission = COMMISSIONS.get(opCommissionId)
      if (commission && !registryVisible(commission, tenantId)) return true
    }
    return false
  },
}

/** The scheduled-run daemon: on a cadence, fire a run for a random enabled
 *  routine and broadcast it — so a connected UI sees runs appear with no request
 *  (the ambient-push showcase). Returns a stop handle. In the real product this
 *  is a server-side cron executing the workflow against the Anthropic API. */
/** How long a runner may go without a heartbeat before the control plane reaps it
 *  (F4 liveness). The pinned co-located seed is exempt; external runners must heartbeat.
 *  ~Two missed heartbeats at the daemon cadence by default. */
const RUNNER_TTL_MS = positiveNumberEnv(process.env.RUNNER_TTL_MS, 120_000)

export function startRunDaemon(intervalMs = 45_000): () => void {
  const tick = () => {
    store.registry.reapStale(RUNNER_TTL_MS) // drop external runners that stopped heartbeating
    const active = schedules.filter((t) => t.enabled)
    if (active.length === 0) return
    // Vary by the run counter rather than Math.random for reproducibility.
    const task = active[runSeq % active.length]
    store.runSchedule(task.id)
  }
  const handle = setInterval(tick, intervalMs)
  return () => clearInterval(handle)
}
