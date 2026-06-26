/** ── Contract: the HTTP API surface ────────────────────────────────────────
 *  The request/response DTOs, the capability descriptor, and the error envelope.
 *  Versioned so the UI can target one stable surface whether the backend is the
 *  local mock, a native sidecar, or a remote web server. */
import type { RelationOp } from './relations.ts'
import type { ContextStatus, ContextTypeId } from './contexts.ts'

/** The API version segment. One UI, one contract version, three backends. */
export const API_VERSION = 'v1'
/** The path the UI talks to. Dev: Vite proxies `/api` → the mock server. Native:
 *  the host injects an absolute `http://127.0.0.1:<port>`. Web: same-origin. */
export const API_BASE_PATH = `/api/${API_VERSION}`

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
  }
}

/** Body of `POST /v1/sessions/:id/messages` — send a turn. The response is an
 *  SSE stream of `ReplyStreamEvent`s, not a JSON body. */
export interface SendMessageRequest {
  text: string
}

/** Body of `POST /v1/sessions` — materialize a new persisted session (the desktop
 *  app's "New chat" the moment it's first sent to). `firstMessage`, when given,
 *  seeds the session's title + preview. Returns the created `Session`. */
export interface CreateSessionRequest {
  firstMessage?: string
}

/** Body of `POST /v1/sessions/:id/contexts` — attach a context to a session (the
 *  attachment of record; see docs/shared-resource-coordination.md). The persisted
 *  binding is a `SessionContext`; `scope` defaults to `'*'` (unscoped) when omitted. */
export interface AttachContextRequest {
  id: string
  type: ContextTypeId
  label: string
  scope?: string
}

/** Body of `PATCH /v1/saved-contexts/:id` — set a saved connector / MCP server's
 *  auth status (connect / disconnect on the Contexts page; the seam an OAuth
 *  callback or token-expiry would use). Returns the updated `SavedContextsSnapshot`;
 *  the server also broadcasts `connector.status` so every client reconciles. */
export interface SetConnectorStatusRequest {
  status: ContextStatus
}

/** Body of `POST /v1/relations/ops` — apply a confirmed relation edit. For a
 *  standing op this is the privileged grant that authorizes the daemon. */
export interface ApplyOpRequest {
  op: RelationOp
}

/** Body of `POST /v1/recents/:type` — promote an id to the front (non-evicting). */
export interface PushRecentRequest {
  id: string
}

/** Body of `PATCH /v1/schedules/:id` — toggle enabled, etc. */
export interface UpdateScheduleRequest {
  enabled?: boolean
}

/** A relation-graph snapshot: the editable edges, seeded from the catalog and
 *  then mutated by confirmed ops. The client reads through this instead of
 *  re-deriving from frozen consts. */
export interface RelationGraph {
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

/** The error envelope. Non-2xx responses carry this JSON body. */
export interface ApiError {
  error: {
    code: ApiErrorCode
    message: string
  }
}

export type ApiErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'capability_unavailable'
  | 'internal'
