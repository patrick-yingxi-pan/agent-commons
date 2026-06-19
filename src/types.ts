/** The three capabilities that, in today's app, are three separate top-level
 *  tabs (Chat / Cowork / Code). In this prototype they are attributes that a
 *  single conversation can hold, all at once. */
export type Capability = 'chat' | 'workspace' | 'repo'

/** A cross-cutting tool in the sidebar nav — not a conversation, but a global
 *  surface (your projects, every artifact, scheduled runs, …). Opening one
 *  takes over the main area in place of the active thread. */
export type SectionId = 'projects' | 'artifacts' | 'scheduled' | 'dispatch' | 'customize'

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
  /** When set, replaying this message escalates the conversation: it attaches
   *  a workspace or a repo and morphs the side panel. This is the heart of the
   *  "one fluid continuum" demo. */
  escalate?: 'workspace' | 'repo'
}

export type ArtifactKind = 'doc' | 'email' | 'image' | 'slide' | 'sheet'

export interface Artifact {
  id: string
  name: string
  kind: ArtifactKind
  meta: string
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

export interface Conversation {
  id: string
  title: string
  caps: Capability[]
  updatedLabel: string
  preview: string
  /** Whether this conversation is the scripted, step-through demo. */
  isDemo?: boolean
  /** Canned content shown when a non-demo conversation is opened. */
  messages?: Message[]
  artifacts?: Artifact[]
  files?: FileNode[]
  diff?: DiffLine[]
  terminal?: string[]
  connectors?: Connector[]
}
