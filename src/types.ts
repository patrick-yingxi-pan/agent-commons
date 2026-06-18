/** The three capabilities that, in today's app, are three separate top-level
 *  tabs (Chat / Cowork / Code). In this prototype they are attributes that a
 *  single conversation can hold, all at once. */
export type Capability = 'chat' | 'workspace' | 'repo'

/** A connector / MCP attached to the conversation (GitHub, Drive, …). */
export interface Connector {
  id: string
  label: string
}

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
