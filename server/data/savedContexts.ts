import type { Connector } from '../../contract/entities.ts'

/** The reusable context the workspace already knows about — the things that take
 *  auth or manual setup (connectors, MCP servers) plus the repos you've attached
 *  before. In today's app this setup is stranded inside whichever chat first did
 *  it; here it lives in one place (the "Contexts" page) and any session can reuse
 *  it from Add-context without re-authenticating or re-cloning.
 *
 *  Ids/labels mirror the Add-context catalogs (data/contextOptions.ts) so the
 *  page and the picker stay in sync: the connector/MCP ids match CONNECTOR_OPTIONS
 *  / MCP_OPTIONS, and the repo ids match the repo catalogs. */

export type SavedContextKind = 'connector' | 'mcp' | 'repo'

/** Setup/auth state. Connectors & MCP servers toggle between the two on the page;
 *  repos are always 'connected' — a GitHub repo's real dependency is the GitHub
 *  connector, surfaced separately via `dependsOnGitHub`. */
export type ContextStatus = 'connected' | 'needs-auth'

export interface SavedContext {
  id: string
  label: string
  kind: SavedContextKind
  status: ContextStatus
  /** Account, scope, or path · branch — the row's one-line subtitle. */
  detail: string
  /** Human "last used" stamp; '—' when it's never been attached. */
  lastUsed: string
  /** How many sessions have attached this. */
  sessions: number
  /** Connectors only — drives the row icon (GitHub mark vs generic plug). */
  connectorKind?: Connector['kind']
  /** Repos only — how it's attached, and whether it leans on the GitHub connector. */
  origin?: 'local' | 'github'
  dependsOnGitHub?: boolean
}

export const SAVED_CONTEXTS: SavedContext[] = [
  // ── Connectors (cover every CONNECTOR_OPTIONS id) ──
  {
    id: 'gh-mcp',
    label: 'GitHub',
    kind: 'connector',
    connectorKind: 'github',
    status: 'connected',
    detail: 'patrick-yingxi-pan · all repos',
    lastUsed: 'just now',
    sessions: 8,
  },
  {
    id: 'gdrive',
    label: 'Google Drive',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'patrick@acme.com',
    lastUsed: '2h ago',
    sessions: 6,
  },
  {
    id: 'slack',
    label: 'Slack',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'acme.slack.com · 3 channels',
    lastUsed: 'yesterday',
    sessions: 4,
  },
  {
    id: 'notion',
    label: 'Notion',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'Acme workspace',
    lastUsed: '3d ago',
    sessions: 5,
  },
  {
    id: 'gcal',
    label: 'Google Calendar',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'patrick@acme.com',
    lastUsed: '1w ago',
    sessions: 1,
  },
  {
    id: 'linear',
    label: 'Linear',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'needs-auth',
    detail: 'Token expired · reconnect to resume',
    lastUsed: '2w ago',
    sessions: 2,
  },
  {
    id: 'jira',
    label: 'Jira',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'needs-auth',
    detail: 'acme.atlassian.net · finish setup',
    lastUsed: '—',
    sessions: 0,
  },
  {
    id: 'figma',
    label: 'Figma',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'Acme · Product team',
    lastUsed: '5h ago',
    sessions: 3,
  },
  {
    id: 'sentry',
    label: 'Sentry',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'acme · 4 projects',
    lastUsed: 'today',
    sessions: 4,
  },
  {
    id: 'asana',
    label: 'Asana',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'Acme workspace · 6 projects',
    lastUsed: 'yesterday',
    sessions: 2,
  },
  {
    id: 'intercom',
    label: 'Intercom',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'acme.intercom.com',
    lastUsed: '3d ago',
    sessions: 2,
  },
  {
    id: 'hubspot',
    label: 'HubSpot',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'Acme · Marketing hub',
    lastUsed: '4d ago',
    sessions: 1,
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'patrick@acme.com',
    lastUsed: '1w ago',
    sessions: 1,
  },
  {
    id: 'zoom',
    label: 'Zoom',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'patrick@acme.com',
    lastUsed: '1w ago',
    sessions: 1,
  },

  // ── MCP servers (cover every MCP_OPTIONS id) ──
  {
    id: 'filesystem',
    label: 'filesystem',
    kind: 'mcp',
    status: 'connected',
    detail: 'Local files & directories',
    lastUsed: '1h ago',
    sessions: 5,
  },
  {
    id: 'github',
    label: 'github',
    kind: 'mcp',
    status: 'connected',
    detail: 'Issues, PRs, code search',
    lastUsed: 'today',
    sessions: 3,
  },
  {
    id: 'puppeteer',
    label: 'puppeteer',
    kind: 'mcp',
    status: 'connected',
    detail: 'Headless browser automation',
    lastUsed: '5d ago',
    sessions: 1,
  },
  {
    id: 'sqlite',
    label: 'sqlite',
    kind: 'mcp',
    status: 'connected',
    detail: 'Local SQLite file',
    lastUsed: '1w ago',
    sessions: 2,
  },
  {
    id: 'postgres',
    label: 'postgres',
    kind: 'mcp',
    status: 'needs-auth',
    detail: 'Set DATABASE_URL to connect',
    lastUsed: '—',
    sessions: 0,
  },
  {
    id: 'fetch',
    label: 'fetch',
    kind: 'mcp',
    status: 'connected',
    detail: 'HTTP fetch & web requests',
    lastUsed: 'today',
    sessions: 3,
  },
  {
    id: 'brave-search',
    label: 'brave-search',
    kind: 'mcp',
    status: 'connected',
    detail: 'Web search via Brave',
    lastUsed: '6h ago',
    sessions: 2,
  },
  {
    id: 'memory',
    label: 'memory',
    kind: 'mcp',
    status: 'connected',
    detail: 'Persistent knowledge graph',
    lastUsed: '2d ago',
    sessions: 1,
  },
  {
    id: 'time',
    label: 'time',
    kind: 'mcp',
    status: 'connected',
    detail: 'Time & timezone conversions',
    lastUsed: '1w ago',
    sessions: 1,
  },

  // ── Repositories (ids match the repo catalogs) ──
  {
    id: 'gh-proposal',
    label: 'patrick-yingxi-pan/claude-ui-proposal',
    kind: 'repo',
    status: 'connected',
    origin: 'github',
    dependsOnGitHub: true,
    detail: 'github · main',
    lastUsed: 'just now',
    sessions: 6,
  },
  {
    id: 'gh-web',
    label: 'patrick-yingxi-pan/web-app',
    kind: 'repo',
    status: 'connected',
    origin: 'github',
    dependsOnGitHub: true,
    detail: 'github · main',
    lastUsed: '1h ago',
    sessions: 4,
  },
  {
    id: 'gh-dash',
    label: 'acme/dashboard',
    kind: 'repo',
    status: 'connected',
    origin: 'github',
    dependsOnGitHub: true,
    detail: 'github · develop',
    lastUsed: '2d ago',
    sessions: 2,
  },
  {
    id: 'lr-insights',
    label: 'insights-dashboard',
    kind: 'repo',
    status: 'connected',
    origin: 'local',
    dependsOnGitHub: true,
    detail: '~/projects/insights-dashboard · feat/insights',
    lastUsed: '2h ago',
    sessions: 3,
  },
  {
    id: 'lr-site',
    label: 'marketing-site',
    kind: 'repo',
    status: 'connected',
    origin: 'local',
    dependsOnGitHub: true,
    detail: '~/projects/marketing-site · main',
    lastUsed: '3d ago',
    sessions: 2,
  },
  {
    id: 'lr-scripts',
    label: 'data-scripts',
    kind: 'repo',
    status: 'connected',
    origin: 'local',
    dependsOnGitHub: false,
    detail: '~/code/data-scripts · main · local only',
    lastUsed: 'yesterday',
    sessions: 1,
  },
]

/** Ids of the connectors/MCP servers already set up — the Add-context picker
 *  shows these as an instant-attach "Connected" quick list (no re-auth), with
 *  the rest reachable via Browse to set up a new one. Derived from the seed, so
 *  it reflects the initial connected set (the page's own toggles are local). */
export const CONNECTED_CONNECTOR_IDS = SAVED_CONTEXTS.filter(
  (c) => c.kind === 'connector' && c.status === 'connected',
).map((c) => c.id)

export const CONNECTED_MCP_IDS = SAVED_CONTEXTS.filter(
  (c) => c.kind === 'mcp' && c.status === 'connected',
).map((c) => c.id)
