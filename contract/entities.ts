/** ── Contract: core entity types ───────────────────────────────────────────
 *  The shared vocabulary the UI and the backend both speak. These are the *wire*
 *  shapes — what `GET /v1/sessions` returns, what a `Message` looks like over
 *  SSE, what the composer ships back. They contain NO React and NO data, so the
 *  same file is imported verbatim by the client (Vite) and the server (Node 26's
 *  native TypeScript). That single import is what makes the UI portable: it can
 *  talk to the local mock backend or a remote web server without changing a line,
 *  because both implement these exact types. */

/** The three capabilities that, in today's app, are three separate top-level
 *  tabs (Chat / Cowork / Code). In this prototype they are attributes that a
 *  single conversation can hold, all at once. */
export type Capability = 'chat' | 'workspace' | 'repo'

/** A cross-cutting tool in the sidebar nav — not a conversation, but a global
 *  surface (your projects, every artifact, scheduled runs, …). Opening one
 *  takes over the main area in place of the active thread. */
export type SectionId =
  | 'commons'
  | 'projects'
  | 'artifacts'
  | 'contexts'
  | 'models'
  | 'agents'
  | 'scheduled'
  | 'discussions'
  | 'messages'
  | 'notifications'
  | 'dispatch'
  | 'customize'
  | 'admin'

/** A connector / MCP attached to the conversation (GitHub, Drive, …). */
export interface Connector {
  id: string
  label: string
  /** Drives the chip icon. Defaults to a GitHub mark when unset. */
  kind?: 'github' | 'connector' | 'mcp'
}

/** A file or photo attached to the conversation (shown as a composer chip). */
export interface Attachment {
  id: string
  label: string
  kind: 'file' | 'photo'
  /** Which filesystem source it came from — UI host, a runner, or cloud storage
   *  (contract/fs.ts). Drives where its content is read from. Absent on legacy /
   *  seeded attachments (treated as the default served source). */
  source?: import('./fs.ts').FsSource
  /** Client-held preview for a `ui-host` attachment whose bytes live in the browser
   *  (never round-tripped to the server unless an effect uploads them): an object
   *  URL for an image, or the text body for a text file. Absent for server-backed
   *  sources (cloud / runner), whose content is fetched from `/fs/*`. */
  previewUrl?: string
  previewText?: string
}

/** A workspace (a folder attached as a Cowork-style surface). A conversation
 *  can hold several — each carries its own set of artifacts. */
export interface Workspace {
  id: string
  /** Display name shown on the chip / panel header, e.g. `insights/`. */
  label: string
  artifacts: Artifact[]
}

/** A repo attached to the conversation. A conversation can hold several — each
 *  carries its own branch, file tree, diff, and terminal output. */
export interface Repo {
  id: string
  /** The repo's display name on the chip — the folder name for a local repo,
   *  the `owner/name` remote for a GitHub one. */
  label: string
  /** How the repo was attached, and what its panel header shows. */
  origin: 'local' | 'github'
  /** Local working-tree path (present for local repos). */
  path?: string
  /** GitHub remote `owner/name`. Always set for a GitHub repo; optional for a
   *  local repo that tracks one. Its presence is what makes the repo *depend on*
   *  the GitHub connector (drives the link/cascade prompts). */
  remote?: string
  branch: string
  files: FileNode[]
  diff: DiffLine[]
  terminal: string[]
}

/** The payload produced by the "Add context" flow. Every attachable thing is
 *  just context the conversation gains — so one entry point covers them all. */
export type AddedContext =
  | { kind: 'folder'; label: string; artifacts: Artifact[]; source?: import('./fs.ts').FsSource }
  | {
      kind: 'repo'
      label: string
      origin: 'local' | 'github'
      path?: string
      remote?: string
      branch: string
      files: FileNode[]
      diff: DiffLine[]
      terminal: string[]
    }
  | { kind: 'connector'; connector: Connector }
  | { kind: 'mcp'; connector: Connector }
  | { kind: 'files'; attachments: Attachment[] }
  | { kind: 'photos'; attachments: Attachment[] }

/** Which attached context the right-hand sidebar is currently showing. Every
 *  chip maps to one of these; clicking a chip focuses it. Workspaces and repos
 *  carry an id because a conversation can hold more than one of each. */
export type PanelFocus =
  | { kind: 'workspace'; id: string }
  | { kind: 'repo'; id: string }
  | { kind: 'connector'; id: string }
  | { kind: 'file'; id: string }
  | { kind: 'photo'; id: string }

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** The worker Agent (D6/D16) that drove this turn — per-turn provenance, so authorship
   *  and metering attribution survive a mid-thread hand-off (the Session↔Agent binding is
   *  *current-driver*, not immutable). Absent on user turns and legacy messages. */
  agentId?: string
  /** The Model provider (D9) that supplied this turn's cognition — per-turn provenance,
   *  resolved the way the turn actually routed (`session.providerId ?? agent's`). The
   *  relayed-reply badge reads THIS, not the agent's current provider, so a later model
   *  switch can't relabel old turns. Absent on user turns and legacy messages. */
  providerId?: string
  /** The concrete model that answered this turn — per-turn provenance beside
   *  `providerId`, resolved the way the turn actually routed (`session.modelId ??
   *  the provider's configured model`). Absent on user turns and on Session-provider
   *  (relay) turns, whose model is whatever the delegated session runs. */
  modelId?: string
  /** An escalation Claude proposes for this turn — open a workspace, connect a
   *  repo, or create a project. It is the *result of a model tool call* (the
   *  backend executes `open_workspace` / `connect_repo` / `create_project` and
   *  surfaces the proposal here), gated by an inline consent prompt: the panels
   *  attach (or the project is created) only on the user's approval. This is the
   *  heart of the "one fluid continuum" demo. */
  escalation?: EscalationProposal
  /** Relation edits Claude proposes inline — rendered as a confirmation card
   *  under the message, applied to the relationship graph only on the user's OK.
   *  Like `escalation`, these are the result of the backend executing the model's
   *  relation-op tool calls (server/model/tools.ts). Typed as `RelationOp[]`
   *  (contract/relations.ts); kept loose here to avoid a type-import cycle. */
  relationActions?: import('./relations.ts').RelationOp[]
  /** The user's verdict on each proposed relation edit, keyed by `opKey` — the
   *  consent card's resolution, SERVER-OWNED so it survives reloads and later
   *  superseding ops (a graph-derived "applied" flips back to pending the moment
   *  another op moves the relation on — the verdict is history, the graph is
   *  now). Written by POST /sessions/:id/messages/:messageId/relations when the
   *  user confirms or skips; absent = still pending (or resolved before this
   *  field existed, where the graph derivation still covers the common case). */
  relationsResolved?: Record<string, 'confirmed' | 'skipped'>
  /** Connector / MCP tools the model called this turn, with the (mock) result fed
   *  back to it (P6 — an attached connector/MCP contributes callable tools). Unlike
   *  `escalation` / `relationActions`, a *read* result only surfaced data, so it needs
   *  no consent — it's shown as activity under the message, not a proposal. */
  toolActivities?: ToolActivity[]
  /** When set, this is a **compaction summary** that replaced `compactedFrom` earlier
   *  messages to free context space (P5 / BROKER-EXP-3). The UI renders it as a warm
   *  divider ("Compacted N earlier messages so we can keep chatting"), and the usage
   *  gauge drops back once it lands. Server-owned: the backend performs the compaction
   *  and the token-count change (see `GET /v1/usage`). */
  compactedFrom?: number
}

/** One connector/MCP tool call the model made this turn + its (mock) result — the
 *  observable end of P6's "a connected server's tools are added to the model's tool
 *  list": the backend derives tools from the attached connector/MCP contexts, the
 *  model calls one, the backend executes it (fixture result) and feeds the summary
 *  back. Surfaced as a compact card under the message. A `read` runs immediately
 *  (`status:'done'`); an `action` (a write — post, create, delete) is consent-gated
 *  (`status:'proposed'`) and only runs when the user confirms (P6 §2.1, PD43). */
export interface ToolActivity {
  /** Stable id for the activity within its message — the handle the confirm/decline
   *  action addresses (an action's status transition targets this). */
  id: string
  /** The tool's wire name as declared to the model, e.g. `mcp__filesystem__read_file`
   *  or `connector__slack__list`. */
  tool: string
  /** The attached connector/MCP this tool came from — its label + id, for the card. */
  connector: string
  connectorId: string
  /** Whether the call read data or took an action (a write). A read needs no consent;
   *  an action is gated. */
  kind: 'read' | 'action'
  /** Lifecycle: `done` = executed (every read; an action after confirm); `proposed` =
   *  an action awaiting the user's consent; `declined` = the user said no. Absent is
   *  treated as `done` (back-compat with the read-only slice). */
  status?: 'done' | 'proposed' | 'declined'
  /** The one-line result (a done read/action) or proposed effect (a pending action),
   *  shown on the card and — when done — fed back to the model. */
  summary: string
  /** For a generated API tool (access-parity INV-11, the in-app leg): the HTTP
   *  operation this activity reads or proposes. Present on API activities only;
   *  a connector/MCP activity has none. On a proposed action, this is what the
   *  server EXECUTES — through the same route table and walls as every door —
   *  when the user confirms, acting as the confirmer. */
  op?: ApiActivityOp
  /** The consent-card family the UI renders a proposed API action with — derived
   *  from the operation's shape (PATCH → edit, DELETE → danger, posts of prose →
   *  post, everything else → action; creates → create). Absent on reads and on
   *  connector activities. */
  family?: ToolCardFamily
}

/** The operation an API tool activity carries (method + concrete path + body). */
export interface ApiActivityOp {
  method: 'POST' | 'PATCH' | 'DELETE'
  /** The resolved path under the API root, e.g. `/schedules/sched-3`. */
  path: string
  /** The JSON body the operation will send, shown on the card verbatim. */
  body?: unknown
}

/** The consent-card families for generated API proposals (INV-11 in-app leg):
 *  chosen mechanically from the operation's shape so every mutation renders a
 *  legible card without a bespoke design per route. */
export type ToolCardFamily = 'create' | 'edit' | 'danger' | 'action' | 'post'

/** A consent-gated escalation Claude proposes mid-turn — the structured result of
 *  a panel-producing tool call. The backend builds it (the panel content comes
 *  from a real tool execution, not a client fixture) and streams it as a
 *  `message.escalation` event; the UI shows the matching permission prompt and
 *  applies it only on approval (EscalationPrompt). Three kinds, one per
 *  panel-escalation tool. */
export type EscalationProposal =
  | {
      kind: 'workspace'
      /** Display label for the workspace panel (derived from the chosen root). */
      label?: string
      /** Candidate cowork roots for the folder picker (first = suggested). */
      rootChoices: string[]
      /** The artifacts the workspace opens with, grouped by source. */
      artifacts: Artifact[]
    }
  | {
      kind: 'repo'
      /** The connector the repo rides in on (GitHub) — what the prompt names. */
      connectorLabel: string
      remote: string
      branch: string
      files: FileNode[]
      diff: DiffLine[]
      terminal: string[]
      /** Connectors attached alongside the repo (the GitHub connector). */
      connectors: Connector[]
    }
  | {
      kind: 'project'
      project: { id: string; name: string; description: string }
      /** Whether approving also files the current session into the new project
       *  (vs. creating it empty, to be filed by a later step). */
      fileSession?: boolean
    }

export type ArtifactKind = 'doc' | 'email' | 'image' | 'slide' | 'sheet'

/** Which attached folder an artifact came from. Lets the one shared workspace
 *  group its artifacts by source. Absent for a conversation's own (seeded/demo)
 *  artifacts, which fall under a single default group. */
export interface ArtifactSource {
  id: string
  label: string
}

export interface Artifact {
  id: string
  name: string
  kind: ArtifactKind
  meta: string
  source?: ArtifactSource
}

export type FileStatus = 'added' | 'modified' | 'unchanged'

export interface FileNode {
  path: string
  status: FileStatus
}

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk'
  text: string
}

/** The live, server-owned workspace of a session — the panels its conversation
 *  has grown. Arrays because a session can hold several of each. The flat seed
 *  fields on `Session` below are the *seed input*; this is the live view the
 *  server materializes from them and then mutates as context is attached/detached
 *  (docs/shared-resource-coordination.md — the panels are the session's contexts).
 *  Carried on `Session.workspace` so one `GET /sessions/:id` returns the whole
 *  live state; the client projects it into its `Live` shape. */
export interface SessionWorkspace {
  workspaces: Workspace[]
  repos: Repo[]
  connectors: Connector[]
  attachments: Attachment[]
}

export interface Session {
  id: string
  title: string
  caps: Capability[]
  preview: string
  /** The worker Agent (docs/agent-commons.md, D6) driving this Conversation. Unset =
   *  the seeded default Agent — the degenerate N=1 case. */
  agentId?: string
  /** The Model provider (D9) this conversation's turns run on — written by the
   *  composer's model selector, so picking a model is a session-level act. When set
   *  it overrides the driver Agent's provider for turns on THIS session (the Agent
   *  keeps its prompt/authority/budget identity); unset = the Agent's own provider,
   *  which defaults to the seeded Anthropic one. Validated against the caller's
   *  visible providers at create/patch time. */
  providerId?: string
  /** The concrete model picked *within* the session's effective provider (its
   *  catalog `ModelInfo.id`) — the second half of the composer's two-level pick.
   *  Unset = **inherit**: the provider's own configured model decides (INV-9's
   *  inherit class — the server-only config / env default, exactly what a turn
   *  ran against before this field existed). When set it must name an entry in
   *  the effective provider's catalog — an unknown id is refused (400), never
   *  normalized. Changing/clearing `providerId` clears this pick (the id's
   *  namespace changed), the same documented cascade as a provider delete. */
  modelId?: string
  /** The tenant this conversation belongs to — the isolation boundary on the web
   *  (F2 / PD9): a tenant only ever lists/opens its own sessions. Unset on a seed
   *  session (or a run session of an unstamped seed routine) ⇒ the backend's
   *  default tenant (personal on desktop). */
  tenantId?: string
  /** VIEWER-RELATIVE: does the reader own this conversation? Computed at serve
   *  time (the `mine` pattern — never a stored field), because a social grant
   *  widens READS without widening ownership: a granted visitor can open a
   *  shared conversation but must not see its share configuration. Absent on
   *  payloads served without a reader in hand; treat absent as NOT owned. */
  own?: boolean
  /** Provenance for a session CONTINUED from someone else's (social S3): which
   *  conversation it was taken from, and the turn it was taken at.
   *
   *  A fork is deliberately NOT a Proposal, though the design doc once filed it
   *  as one: a proposal is a change offered TO a resource and landed by its
   *  owner's consent, and a fork changes nothing about the source — it mints a
   *  new conversation in the FORKER's namespace. There is nothing for the owner
   *  to consent to, so this follows `forkAgent`'s shape instead: a direct act
   *  gated on the `propose` tier, recording where it came from and ringing the
   *  source's owner as public credit. The display face is REDACTED like every
   *  cross-tenant row — a title, never a tenant id. */
  forkedFrom?: { sessionId: string; title: string; atMessageId: string }
  /** A generation turn currently running for this session (contract/turns.ts —
   *  server-owned turns, invariant I1). Projected at read time from the transient
   *  turn registry, never persisted: presence means "Claude is still writing",
   *  even to a client that just arrived (reattach via
   *  `GET /sessions/:id/turns/:turnId/stream?after=<seq>`). */
  activeTurnId?: string
  /** Canned content shown when a non-demo conversation is opened. */
  messages?: Message[]
  /** Messages archived by context compaction (P5 / BROKER-EXP-3): compaction moves the
   *  older messages HERE (out of `messages`, so they no longer count toward the context
   *  window) and leaves a compaction-summary marker in `messages`. Non-destructive — the
   *  detail stays recoverable (the copy promises continuity) — and not shipped in the
   *  lightweight list rows. */
  compactedMessages?: Message[]
  /** The live, server-owned workspace (runtime attaches persist here). Populated
   *  by the backend on read; the flat seed fields below seed it. */
  workspace?: SessionWorkspace
  artifacts?: Artifact[]
  files?: FileNode[]
  diff?: DiffLine[]
  terminal?: string[]
  connectors?: Connector[]
  /** The INITIATOR stamp — the one field on which a human-created and an
   *  agent-created session differ. Present ⇒ an agent opened this conversation
   *  (a scheduled routine's run; `srun-*` ids), naming the routine so the title
   *  bar shows its breadcrumb and the run switcher keys off it. Absent ⇒ a person
   *  did. Both kinds are persisted rows minted through the server's one session
   *  funnel (store.mintSession) with the same property set and route surface;
   *  agent sessions surface through the Scheduled rail / `/runs/recent` instead
   *  of the sessions list — a view rule, not a separate code path. */
  scheduledRunOf?: { taskId: string; taskName: string }
  /** ── Sidebar filter / sort backing (the Recents "Filter & sort" menu) ──
   *  All optional so a client-only draft need not set them; the filter treats a
   *  missing value as the neutral default (active, local, epoch 0). */
  /** Archival status. The Recents filter defaults to showing only `active`;
   *  `archived` sessions are hidden until the Status filter is widened. */
  status?: 'active' | 'archived'
  /** Pinned to the top of the Recents list (the row menu's "Pin"). Sorts ahead
   *  of everything else regardless of the active sort; unset = not pinned. */
  pinned?: boolean
  /** Where the session's compute runs. Only `local` is wired today; `cloud` and
   *  `remote` are reserved for when those backends exist.
   *  TODO(env): populate `cloud` / `remote` once those environments ship. */
  environment?: 'local' | 'cloud' | 'remote'
  /** Sortable activity timestamps (epoch ms). `updatedAt` backs recency sort, the
   *  "Last activity" filter, AND the human-facing "time ago" label (rendered live
   *  via src/lib/relativeTime); `createdAt` backs the "Created time" sort. */
  updatedAt?: number
  createdAt?: number
}
