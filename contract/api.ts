/** ── Contract: the HTTP API surface ────────────────────────────────────────
 *  The request/response DTOs, the capability descriptor, and the error envelope.
 *  Versioned so the UI can target one stable surface whether the backend is the
 *  local mock, a native sidecar, or a remote web server. */
import type { RelationOp } from './relations.ts'
import type { ContextStatus, ContextTypeId, SessionContext } from './contexts.ts'
import type { SessionWorkspace } from './entities.ts'
import type { FsSource } from './fs.ts'
import type { Identity } from './identity.ts'
import type { Project, ScheduledTask } from './cowork.ts'

/** The API version segment. One UI, one contract version, three backends. */
export const API_VERSION = 'v1'

/** Opt-in request header for safe retries of durable mutations (design F3 PD15). A
 *  client sets it to a unique value per logical operation. Most routes replay the
 *  first successful (tenant, key) response; creation routes whose key derives the
 *  durable row identity may instead return that row's current representation, so a
 *  retry cannot duplicate, overwrite, or resurrect it. Honoured on non-streaming
 *  create routes (`POST /sessions`, `/sessions/:id/fork`, `/projects`, `/artifacts`, `/dispatch`, `/schedules`,
 *  `/relations/ops`, `/sessions/:id/tool-activities/:activityId`) and revision-checked `PATCH /sessions/:id`,
 *  `PATCH /schedules/:id`, `PATCH /artifacts/:id/content`, and
 *  `DELETE /sessions/:id`. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key'
/** The path the UI talks to. Dev: Vite proxies `/api` → the mock server. Native:
 *  the host injects an absolute `http://127.0.0.1:<port>`. Web: same-origin. */
export const API_BASE_PATH = `/api/${API_VERSION}`

/** Direct human/MCP Project creation. Identity is deliberately absent: the
 * server mints it inside the acknowledged mutation. `ownerTenantId` is an
 * explicit namespace choice; absence means the caller's person namespace. */
export interface CreateProjectRequest {
  name: string
  description?: string
  ownerTenantId?: string
}

/** Creation returns the addressed row for immediate navigation plus the full
 * revisioned graph projection that owns runtime Projects. */
export interface CreateProjectResponse {
  project: Project
  graph: RelationGraph
}

/** What *this* backend can do, advertised so the UI never has to sniff
 *  Electron-vs-web. The load-bearing gate is server-side: a native sidecar reports
 *  the local-* flags true and fulfils the native endpoints; a remote web server
 *  reports them false and returns `capability_unavailable` from those endpoints
 *  (`server/routes` `gate()`). A client may additionally read these flags to
 *  pre-hide a native-only affordance, but the 409 is what keeps the one UI honest
 *  across both backends. */
export interface Capabilities {
  /** Which backend is answering — for display + diagnostics, never for branching
   *  (branch on the feature flags below instead). */
  backend: 'mock' | 'native' | 'remote'
  /** A monotonic id for this server process; a change means state was reseeded. */
  epoch: string
  features: {
    /** Browse/scan an arbitrary local folder (OS picker + filesystem read). */
    localFs: boolean
    /** Clone/diff/checkout a local git working tree and stream a terminal. */
    localGit: boolean
    /** Open a native OS file/photo picker. */
    osPicker: boolean
    /** Read the system clipboard (paste-to-attach). */
    clipboard: boolean
    /** Run scheduled routines on a cadence (the daemon). */
    scheduledExecution: boolean
    /** Stream assistant replies token-by-token (SSE). */
    streaming: boolean
    /** The account switcher (multi-account design §5.6, revised; §13): whether
     *  this backend supports switching the active session between identities —
     *  workspace re-mints and account-stack hops via `POST /v1/auth/session`.
     *  The UI gates the switcher menu on this flag — never on env sniffing; a
     *  deployment may turn it off (the route 409s then). The old seeded
     *  enumeration directory (`GET /v1/identities`) retired in P9: identities
     *  are never enumerable — accounts sign in. */
    identitySwitch: boolean
    /** The production onboarding posture (multi-account §12; `AUTH_GATE=require`):
     *  when true the UI hard-gates the workspace behind the full-screen auth
     *  flow until the identity is VERIFIED (`Identity.via === 'session'`). Off
     *  by default so the demo still boots straight into the workspace on the
     *  backend's default principal; the auth flow itself exists either way. */
    authGate: boolean
  }
}

/** Body of `POST /v1/sessions/:id/messages` — send a turn. The response is an
 *  SSE stream of `ReplyStreamEvent`s, not a JSON body. */
export interface SendMessageRequest {
  text: string
  /** When true, generate the reply (the full model + tool round-trip) but do NOT
   *  persist the turn. Omitted = persist. */
  ephemeral?: boolean
  /** Retry the thread's unresolved final user turn instead of appending that
   *  same input again. The server reuses it only when the persisted tail is a
   *  user message with exactly this `text`; otherwise the request remains an
   *  ordinary send (the original attempt may have failed before persistence).
   *  Omitted = always append a new user turn. */
  retryLastUser?: true
}

/** The exact human verdict on one consent-gated connector or generated API
 * action. A keyed first-party caller binds this body to one durable receipt. */
export interface ResolveToolActivityRequest {
  decision: 'confirm' | 'decline'
}

/** Body of `POST /v1/sessions` — materialize a new persisted session (the desktop
 *  app's "New session" the moment it's first sent to). `firstMessage`, when given,
 *  seeds the session's title + preview. A supplied Idempotency-Key owns one opaque
 *  tenant-scoped Session identity across response loss and restart. */
export interface CreateSessionRequest {
  firstMessage?: string
  /** Atomically persist `firstMessage` as the unresolved first user turn. This is
   *  for handoffs that must survive a process exit between Session creation and
   *  generation; omitted means `firstMessage` remains metadata-only, preserving
   *  the draft materialization contract. Requires a non-blank `firstMessage`. */
  persistFirstMessage?: true
  /** The model picked in the draft's composer before first send — becomes the
   *  session's `providerId`. Validated against the caller's visible providers. */
  providerId?: string
  /** The concrete catalog model picked in the draft — becomes the session's
   *  `modelId`. Must name an entry in the effective provider's catalog (refused
   *  otherwise); unset = inherit the provider's configured model. */
  modelId?: string
}

/** Body of `POST /v1/sessions/:id/fork` — copy a readable conversation through
 * the named turn into the caller's namespace. The turn is required because
 * absence cannot guess a branch point. A supplied Idempotency-Key owns one
 * opaque fork Session identity across response loss, restart, and deletion. */
export interface ForkSessionRequest {
  atMessageId: string
}

/** The shared row fields `PATCH /v1/sessions/:id` can change. Kept separate
 * from the precondition so controllers can retain and rebase one user intent. */
export interface SessionMetadataPatch {
  title?: string
  status?: 'active' | 'archived'
  pinned?: boolean
  providerId?: string
  modelId?: string
}

/** Body of `PATCH /v1/sessions/:id`. A caller that supplies
 * `expectedRevision` gets compare-and-swap semantics: a newer metadata edit is
 * refused with 409 rather than overwritten. Absence preserves the v1 legacy
 * unconditional-write meaning for older clients; first-party clients always
 * send the revision they read. */
export interface UpdateSessionRequest extends SessionMetadataPatch {
  expectedRevision?: number
}

/** Body of `DELETE /v1/sessions/:id`. A supplied revision pins the destructive
 * act to the conversation row the caller actually reviewed; absence preserves
 * the legacy unconditional-delete meaning for older clients. */
export interface DeleteSessionRequest {
  expectedRevision?: number
}

/** Body of `PATCH /v1/sessions/:id/preferences`. The property is required so
 * an empty request cannot accidentally turn "default" into "closed". */
export interface UpdateSessionPreferencesRequest {
  panelFocus: import('./entities.ts').PanelFocus | null
}

/** One binding edit inside the atomic session-context transaction. Detach is
 * deliberately idempotent: a response can be lost after the server commits,
 * and replaying the same transaction must remain safe. */
export type SessionContextOperation =
  | { action: 'attach'; context: AttachContextRequest }
  | { action: 'detach'; contextId: string }

/** Body of `PATCH /v1/sessions/:id/context-state`. The authorization bindings
 * and the visible workspace are one invariant, so they cross the wire and
 * commit together. `operations` is required (an empty list is allowed for an
 * explicit workspace-only repair); `workspace` is always the complete next
 * panel projection, never a partial merge. */
export interface UpdateSessionContextStateRequest {
  operations: SessionContextOperation[]
  workspace: SessionWorkspace
}

/** Canonical acknowledgement of the atomic context transaction. */
export interface SessionContextState {
  contexts: SessionContext[]
  workspace: SessionWorkspace
}

/** The attach half of a session context transaction. The persisted binding is
 * a `SessionContext`; `scope` defaults to `'*'` (unscoped) when omitted. */
export interface AttachContextRequest {
  id: string
  type: ContextTypeId
  label: string
  scope?: string
  /** The filesystem source a `files` / `photos` / `folder` context came from (the
   *  UI host, a runner, or cloud storage — contract/fs.ts), recorded on the binding
   *  so effect mediation can resolve the right host. Absent for non-fs contexts. */
  source?: FsSource
}

/** Body of `PATCH /v1/saved-contexts/:id` — set a saved connector / MCP server's
 *  auth status (connect / disconnect on the Contexts page; the seam an OAuth
 *  callback or token-expiry would use). Returns the updated `SavedContextsSnapshot`;
 *  the server also broadcasts `connector.status` so every client reconciles. */
export interface SetConnectorStatusRequest {
  status: ContextStatus
  /** Compare-and-swap precondition for the connection/auth dimension. Absence
   *  retains the legacy unconditional-write meaning for existing API clients. */
  expectedRevision?: number
}

/** Body of `DELETE /v1/saved-contexts/:id`. A supplied connection revision
 * pins removal to the reusable setup the person reviewed; absence preserves
 * legacy unconditional-delete behavior for existing API clients. */
export interface DeleteSavedContextRequest {
  expectedRevision?: number
}

/** Body of `POST /v1/relations/ops` — apply a confirmed relation edit. For a
 *  standing op this is the privileged grant that authorizes the daemon. */
export interface ApplyOpRequest {
  op: RelationOp
}

/** Resolve one model-proposed relation edit on the message that carried it.
 * Keyed first-party confirmation executes the immutable proposal and records
 * its verdict as one atomic act; unkeyed compatibility callers retain the
 * historical record-only behavior. */
export interface ResolveMessageRelationRequest {
  key: string
  verdict: 'confirmed' | 'skipped'
}

/** Exact public acknowledgement for one relation-proposal decision. */
export interface ResolveMessageRelationResponse extends ResolveMessageRelationRequest {
  decisionId?: string
}

/** Body of `POST /v1/recents/:type` — promote an id to the front (non-evicting). */
export interface PushRecentRequest {
  id: string
}

/** Body of `POST /v1/dispatch` — kick off a one-off agent run (the Dispatch tab). */
export interface CreateDispatchRequest {
  title: string
  detail?: string
}

/** Body of `POST /v1/schedules` — materialize one template seed. Identity is
 * deliberately absent: a keyed first-party caller gets a server-derived opaque
 * id, while an unkeyed compatibility caller keeps the legacy server sequence. */
export interface CreateScheduleRequest {
  seed: Omit<ScheduledTask, 'id'>
}

/** The editable definition fields of a routine. Kept separate from the
 * precondition so a controller can retain and rebase one human intent. */
export interface SchedulePatch {
  enabled?: boolean
  name?: string
  prompt?: string
  cadence?: string
  /** @deprecated Display-only; the server derives it from cadence. */
  trigger?: string
  /** @deprecated Display-only; the server derives it from cadence + timezone. */
  next?: string
  timezone?: string
  missedFirePolicy?: import('./cowork.ts').ScheduledTask['missedFirePolicy']
  model?: string
  agentId?: string
  providerId?: string
  /** `null` clears a concrete model override back to the provider default. */
  modelId?: string | null
  /** `null` clears a stale effort when the new provider/model has no levels. */
  effort?: string | null
  notifyOnFailure?: boolean
  delivery?: import('./cowork.ts').ScheduledDelivery
  steps?: import('./cowork.ts').WorkflowStep[]
}

/** Body of `PATCH /v1/schedules/:id` — a partial patch of a routine's own
 *  (entity-intrinsic) fields. Cross-entity bindings (deliver to an artifact /
 *  session, add a tool) are NOT here — those are standing relation ops applied via
 *  `POST /relations/ops`. The server merges only the fields present; it never
 *  touches a routine's id, runs, or run-derived state. A supplied
 *  `expectedRevision` is compare-and-swap; absence preserves the v1 legacy
 *  unconditional-write meaning, while first-party editors always supply it. */
export interface UpdateScheduleRequest extends SchedulePatch {
  expectedRevision?: number
}

/** Body of `DELETE /v1/schedules/:id`. A supplied definition revision pins
 * destruction to the routine the person reviewed; absence preserves legacy
 * unconditional-delete behavior for existing API clients. */
export interface DeleteScheduleRequest {
  expectedRevision?: number
}

/** One owner's intent to rewrite one addressable prose block. The block index
 * and replacement stay separate from the precondition so the client can hold
 * and rebase the exact edit after a conflict. */
export interface ArtifactContentPatch {
  block: number
  text: string
}

/** Body of `PATCH /v1/artifacts/:id/content`. Supplying the current body
 * revision gives compare-and-swap semantics; absence preserves the v1 legacy
 * unconditional-write meaning used by older clients. New proposal landings
 * carry the server-frozen offer revision through the same mutator. */
export interface UpdateArtifactContentRequest extends ArtifactContentPatch {
  expectedRevision?: number
}

/** A relation-graph snapshot: the editable edges, seeded from the catalog and
 *  then mutated by confirmed ops. The client reads through this instead of
 *  re-deriving from frozen consts. */
export interface RelationGraph {
  /** Monotonic server-owned revision. Clients use it to reject an older full
   * mutation response that arrives after a newer ambient refetch. Optional only
   * for wire compatibility with pre-revision snapshots/backends. */
  revision?: number
  /** session id → project id (or null when explicitly unfiled). */
  sessionProject: Record<string, string | null>
  /** artifact id → project id (overrides the seed). */
  artifactProject: Record<string, string>
  /** schedule id → project id (or null when unlinked). */
  scheduleProject: Record<string, string | null>
  /** project id → its scoped contexts. */
  projectContexts: Record<string, import('./cowork.ts').ProjectContext[]>
  /** project id → its edited custom instructions (overrides the seed). */
  projectInstructions: Record<string, string>
  /** project id → its ABOUT text (D26) — the one public description of a
   *  project, unlike `projectInstructions` (private owner context): the
   *  projection serves it to every viewer of a shared project. */
  projectDescriptions: Record<string, string>
  /** artifact id → the context label it derives from. */
  artifactSource: Record<string, string>
  /** schedule id → the artifact name it now saves each run. */
  scheduleArtifact: Record<string, string>
  /** schedule id → a session label it now opens each run. */
  scheduleSession: Record<string, string>
  /** schedule id → extra tool-contexts it now uses each run. */
  scheduleExtraTools: Record<string, import('./cowork.ts').StepTool[]>
  /** Artifacts saved out of a session by a confirmed proposal. */
  extraArtifacts: import('./cowork.ts').ArtifactItem[]
  /** Projects created by a confirmed proposal (the base list carries the seed). */
  extraProjects: import('./cowork.ts').Project[]
  /** opKey → true for recurring schedule effects approved once, in advance. */
  standingApprovals: Record<string, true>
}

/** Recents — one non-evicting MRU id list per context type. */
export type RecentsSnapshot = Record<ContextTypeId, string[]>

/** A page of a list resource (design F3 PD14). Returned by a list endpoint when the
 *  request opts into pagination with `?limit=N` (optionally `&cursor=C`); without
 *  `limit`, those endpoints still return the full array (back-compat — the UI reads
 *  the array until it virtualizes, P1 PD36). `nextCursor` is an opaque token to pass
 *  back as `?cursor=` for the next page — null when the last page has been returned.
 *  The cursor is **keyed** (anchored to an item id), so appends between pages don't
 *  shift it (no skips/dupes of already-seen items). */
export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

/** The error envelope. Non-2xx responses carry this JSON body. */
export interface ApiError {
  error: {
    code: ApiErrorCode
    message: string
  }
}

export type ApiErrorCode =
  | 'bad_request'
  /** Sign-in failed (P7 onboarding): deliberately one code for "no such email"
   *  and "wrong password" — the response must not leak account existence. */
  | 'unauthorized'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  /** 410 — a relay reply named an entry that is settled or gone (drained after
   *  a deadline/cancel/rotate): acknowledged and discarded, never re-matched. */
  | 'gone'
  | 'capability_unavailable'
  | 'limit_exceeded'
  /** 502 — syntactically valid local intent could not be fulfilled because a
   * remote service failed, refused, or returned an invalid representation. */
  | 'upstream_unavailable'
  /** 503 — a turn on a Session provider refused BEFORE the user turn persists:
   *  no drain loop is bound (`relay_offline`) or another turn is already
   *  in-flight on the relay (`relay_busy`). Retry is free; nothing half-wrote. */
  | 'relay_offline'
  | 'relay_busy'
  /** 503 — durable storage failed while committing a mutation. The process
   *  fails closed until restart so no later request can acknowledge state that
   *  diverges from the last durable snapshot. */
  | 'storage_unavailable'
  | 'internal'

/** Body of `POST /v1/auth/signup` (P7 onboarding) — creates a real, persisted
 *  account (user + their personal workspace) and signs it in (the response sets
 *  the P6 session cookie and carries the resolved `Identity`). */
export interface SignUpRequest {
  name: string
  email: string
  /** Hashed server-side (scrypt); never stored or logged in the clear. */
  password: string
  /** How the minted session credential is delivered (access-parity INV-11).
   *  Absent = `'cookie'` (a fixed meaning, INV-9): the browser flow — HttpOnly
   *  cookie, account-stack join. `'bearer'` is the machine flow (the MCP door,
   *  scripts): the response is a `BearerSession` carrying the SAME signed
   *  token in the body, and NO cookies are set (the account stack is a
   *  browser concept). Any other value is refused (400). */
  transport?: SessionTransport
}

/** Body of `POST /v1/auth/login` (P7) — sign in with a real account's
 *  credential. Failure is a single `unauthorized`, whatever the reason. */
export interface LoginRequest {
  email: string
  password: string
  /** See `SignUpRequest.transport` — absent = `'cookie'`. */
  transport?: SessionTransport
}

/** The two delivery transports for the one session credential (INV-11): the
 *  browser cookie, or the token itself for machine callers that will present
 *  it as `Authorization: Bearer <token>`. Same token, same verification. */
export type SessionTransport = 'cookie' | 'bearer'

/** Response of a `transport: 'bearer'` sign-in: the signed session token plus
 *  the identity it resolves to (the same resolution every later request runs). */
export interface BearerSession {
  token: string
  identity: Identity
  /** The token's REGISTRY row id (`ApiToken.id`) — the handle `DELETE
   *  /auth/tokens/:id` revokes. Present on registry-backed mints (every bearer
   *  mint since the registry landed); absent only on legacy tokens. */
  tokenId?: string
}

/** Body of `POST /v1/auth/token` — mint a bearer credential from the current
 *  verified session (the MCP connect panel). All fields optional (INV-9: an
 *  absent label is simply an unlabeled token). */
export interface TokenMintRequest {
  /** A human name for the token ("laptop MCP", "CI") — shown in the token
   *  list so a revocation can be aimed. */
  label?: string
}

/** Result of the authenticated recovery read for a keyed token mint. The
 * bearer value is returned only while that exact receipt still represents a
 * live registry row; absence and explicit cancellation remain distinct. */
export type TokenMintRecovery =
  | { state: 'active'; session: BearerSession }
  | { state: 'absent' | 'cancelled' }

/** One minted bearer credential's REGISTRY row (`GET /v1/auth/tokens`) —
 *  metadata only, never the token value (that is shown exactly once, at mint).
 *  The registry is the revocation authority: deleting the row kills the token
 *  (`DELETE /v1/auth/tokens/:id`), even though the signature would still verify. */
export interface ApiToken {
  id: string
  label?: string
  /** Epoch ms. */
  createdAt: number
}

// (`CreateWorkspaceRequest` is gone — FWD-5 Phase 2, the workspace collapse:
// an account is minted WITH its one namespace at signup and never grows more;
// orgs would return as namespaces through the deferred phase, not this seam.)
