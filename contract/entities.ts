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
  | 'projects'
  | 'artifacts'
  | 'contexts'
  | 'agents'
  | 'scheduled'
  | 'dispatch'
  | 'customize'

/** The guided tour's lifecycle: idle (not started), running (stepping through),
 *  or done (finished, showing Replay). */
export type TourPhase = 'idle' | 'running' | 'done'

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
  | { kind: 'folder'; label: string; artifacts: Artifact[] }
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
}

/** A consent-gated escalation Claude proposes mid-turn — the structured result of
 *  a panel-producing tool call. The backend builds it (the panel content comes
 *  from a real tool execution, not a client fixture) and streams it as a
 *  `message.escalation` event; the UI shows the matching permission prompt and
 *  applies it only on approval (TourPermissionPrompt). Three kinds, one per
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
      /** Caption shown once the tour lands on the new project's page. */
      visitCaption?: string
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
  /** Whether this conversation is the scripted, step-through demo. */
  isDemo?: boolean
  /** The worker Agent (docs/agent-commons.md, D6) driving this Conversation. Unset =
   *  the seeded default Agent — the degenerate N=1 case. */
  agentId?: string
  /** Canned content shown when a non-demo conversation is opened. */
  messages?: Message[]
  /** The live, server-owned workspace (runtime attaches persist here). Populated
   *  by the backend on read; the flat seed fields below seed it. */
  workspace?: SessionWorkspace
  artifacts?: Artifact[]
  files?: FileNode[]
  diff?: DiffLine[]
  terminal?: string[]
  connectors?: Connector[]
  /** When this session is a scheduled routine's run, the routine it belongs to —
   *  lets the title bar show a "Scheduled run of ‹routine›" breadcrumb without the
   *  client needing the run-synthesis logic. Set by the backend for `srun-*` ids. */
  scheduledRunOf?: { taskId: string; taskName: string }
  /** ── Sidebar filter / sort backing (the Recents "Filter & sort" menu) ──
   *  All optional so draft / synthesized sessions need not set them; the filter
   *  treats a missing value as the neutral default (active, local, epoch 0). */
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
