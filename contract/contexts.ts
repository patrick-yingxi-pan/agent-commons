/** ── Contract: Add-context + saved-context types ───────────────────────────
 *  The six kinds of context a session can attach, plus the set-up contexts the
 *  Contexts page lists and the per-connector sidebar detail. (The Add-context
 *  *catalog* item shapes — CONNECTOR_OPTIONS, FOLDER_OPTIONS, … — are added here
 *  when the picker's reads migrate.) */
import type { Connector } from './entities.ts'
import type { FsSource } from './fs.ts'

export type ContextTypeId = 'files' | 'photos' | 'folder' | 'repo' | 'connector' | 'mcp'

/** A set-up context's kind on the Contexts page. */
export type SavedContextKind = 'connector' | 'mcp' | 'repo'

/** Setup/auth state. Connectors & MCP servers toggle between the two; repos are
 *  always 'connected' (a GitHub repo's real dependency is the GitHub connector,
 *  surfaced via `dependsOnGitHub`). */
export type ContextStatus = 'connected' | 'needs-auth'

/** A reusable context the workspace already knows about — something that took
 *  auth or manual setup (a connector, an MCP server) or a repo attached before.
 *  Lives on the Contexts page; any session can reuse it without re-auth. */
export interface SavedContext {
  id: string
  label: string
  kind: SavedContextKind
  status: ContextStatus
  /** Account, scope, or path · branch — the row's one-line subtitle. */
  detail: string
  /** When it was last attached (epoch ms); `null` when never attached. The UI
   *  renders a live "time ago" label from it (src/lib/relativeTime). */
  lastUsedAt: number | null
  /** How many sessions have attached this. */
  sessions: number
  /** Connectors only — drives the row icon (GitHub mark vs generic plug). */
  connectorKind?: Connector['kind']
  /** Repos only — how it's attached, and whether it leans on the GitHub connector. */
  origin?: 'local' | 'github'
  dependsOnGitHub?: boolean
}

/** The Contexts page payload: the set-up contexts + which connector/MCP ids are
 *  connected (the "Connected" quick lists / recents seed derive from these). */
export interface SavedContextsSnapshot {
  contexts: SavedContext[]
  connectedConnectorIds: string[]
  connectedMcpIds: string[]
}

/** The sidebar detail shown for one connector / MCP server. The mock derives it
 *  from the connector; a real backend would fetch live resources from the
 *  connected service. */
export interface ConnectorDetail {
  blurb: string
  access: string[]
  itemsLabel: string
  items: { label: string; meta?: string }[]
}

/** ── Session ↔ context binding (the attachment of record) ───────────────────
 *  A context element attached to a session, persisted server-side — the durable
 *  replacement for ephemeral client-side attach. This is the object a resource
 *  *guardian* hangs off (see docs/shared-resource-coordination.md): every
 *  session-initiated effect is mediated by *naming* one of these. */
export interface SessionContext {
  /** The context element's id (a repo / folder / connector / mcp / file id). */
  id: string
  type: ContextTypeId
  label: string
  /** The resource boundary this attachment authorizes: a path root for
   *  `folder` / `repo`, an account / scope for `connector` / `mcp`. `'*'` is
   *  unscoped. An effect routed through this context must fall within `scope`. */
  scope: string
  /** Which filesystem source a `files` / `photos` / `folder` context came from —
   *  the UI host, a runner, or the web backend's cloud storage (contract/fs.ts).
   *  Lets effect mediation resolve the right host. Absent for non-fs contexts. */
  source?: FsSource
}
