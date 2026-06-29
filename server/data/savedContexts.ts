import type { SavedContext } from '../../contract/contexts.ts'

/** The reusable context the workspace already knows about — the things that take
 *  auth or manual setup (connectors, MCP servers) plus the repos you've attached
 *  before. In today's app this setup is stranded inside whichever chat first did
 *  it; here it lives in one place (the "Contexts" page) and any session can reuse
 *  it from Add-context without re-authenticating or re-cloning.
 *
 *  Ids/labels mirror the Add-context catalogs (data/contextOptions.ts) so the
 *  page and the picker stay in sync: the connector/MCP ids match CONNECTOR_OPTIONS
 *  / MCP_OPTIONS, and the repo ids match the repo catalogs.
 *
 *  The row's *shape* — `SavedContext` (and its `SavedContextKind` / `ContextStatus`
 *  members) — is the contract's, imported above and never re-declared here, so this
 *  seed cannot drift from the wire type it has to satisfy. (`contract/contexts.ts`
 *  is the single source of truth; see AGENTS.md "the contract is load-bearing".) */

/** Seed "last used" stamps are authored as an AGE before module load and resolved
 *  to an absolute epoch-ms, so the Contexts page shows live, advancing "Last used
 *  …" labels instead of frozen strings. `null` = never attached. */
const BOOT = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const ago = (age: number) => BOOT - age

export const SAVED_CONTEXTS: SavedContext[] = [
  // ── Connectors (cover every CONNECTOR_OPTIONS id) ──
  {
    id: 'gh-mcp',
    label: 'GitHub',
    kind: 'connector',
    connectorKind: 'github',
    status: 'connected',
    detail: 'patrick-yingxi-pan · all repos',
    lastUsedAt: ago(0),
    sessions: 8,
  },
  {
    id: 'gdrive',
    label: 'Google Drive',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'patrick@acme.com',
    lastUsedAt: ago(2 * HOUR),
    sessions: 6,
  },
  {
    id: 'slack',
    label: 'Slack',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'acme.slack.com · 3 channels',
    lastUsedAt: ago(28 * HOUR),
    sessions: 4,
  },
  {
    id: 'notion',
    label: 'Notion',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'Acme workspace',
    lastUsedAt: ago(3 * DAY),
    sessions: 5,
  },
  {
    id: 'gcal',
    label: 'Google Calendar',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'patrick@acme.com',
    lastUsedAt: ago(WEEK),
    sessions: 1,
  },
  {
    id: 'linear',
    label: 'Linear',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'needs-auth',
    detail: 'Token expired · reconnect to resume',
    lastUsedAt: ago(2 * WEEK),
    sessions: 2,
  },
  {
    id: 'jira',
    label: 'Jira',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'needs-auth',
    detail: 'acme.atlassian.net · finish setup',
    lastUsedAt: null,
    sessions: 0,
  },
  {
    id: 'figma',
    label: 'Figma',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'Acme · Product team',
    lastUsedAt: ago(5 * HOUR),
    sessions: 3,
  },
  {
    id: 'sentry',
    label: 'Sentry',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'acme · 4 projects',
    lastUsedAt: ago(6 * HOUR),
    sessions: 4,
  },
  {
    id: 'asana',
    label: 'Asana',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'Acme workspace · 6 projects',
    lastUsedAt: ago(28 * HOUR),
    sessions: 2,
  },
  {
    id: 'intercom',
    label: 'Intercom',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'acme.intercom.com',
    lastUsedAt: ago(3 * DAY),
    sessions: 2,
  },
  {
    id: 'hubspot',
    label: 'HubSpot',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'Acme · Marketing hub',
    lastUsedAt: ago(4 * DAY),
    sessions: 1,
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'patrick@acme.com',
    lastUsedAt: ago(WEEK),
    sessions: 1,
  },
  {
    id: 'zoom',
    label: 'Zoom',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'patrick@acme.com',
    lastUsedAt: ago(WEEK),
    sessions: 1,
  },

  // ── MCP servers (cover every MCP_OPTIONS id) ──
  {
    id: 'filesystem',
    label: 'filesystem',
    kind: 'mcp',
    status: 'connected',
    detail: 'Local files & directories',
    lastUsedAt: ago(1 * HOUR),
    sessions: 5,
  },
  {
    id: 'github',
    label: 'github',
    kind: 'mcp',
    status: 'connected',
    detail: 'Issues, PRs, code search',
    lastUsedAt: ago(6 * HOUR),
    sessions: 3,
  },
  {
    id: 'puppeteer',
    label: 'puppeteer',
    kind: 'mcp',
    status: 'connected',
    detail: 'Headless browser automation',
    lastUsedAt: ago(5 * DAY),
    sessions: 1,
  },
  {
    id: 'sqlite',
    label: 'sqlite',
    kind: 'mcp',
    status: 'connected',
    detail: 'Local SQLite file',
    lastUsedAt: ago(WEEK),
    sessions: 2,
  },
  {
    id: 'postgres',
    label: 'postgres',
    kind: 'mcp',
    status: 'needs-auth',
    detail: 'Set DATABASE_URL to connect',
    lastUsedAt: null,
    sessions: 0,
  },
  {
    id: 'fetch',
    label: 'fetch',
    kind: 'mcp',
    status: 'connected',
    detail: 'HTTP fetch & web requests',
    lastUsedAt: ago(6 * HOUR),
    sessions: 3,
  },
  {
    id: 'brave-search',
    label: 'brave-search',
    kind: 'mcp',
    status: 'connected',
    detail: 'Web search via Brave',
    lastUsedAt: ago(6 * HOUR),
    sessions: 2,
  },
  {
    id: 'memory',
    label: 'memory',
    kind: 'mcp',
    status: 'connected',
    detail: 'Persistent knowledge graph',
    lastUsedAt: ago(2 * DAY),
    sessions: 1,
  },
  {
    id: 'time',
    label: 'time',
    kind: 'mcp',
    status: 'connected',
    detail: 'Time & timezone conversions',
    lastUsedAt: ago(WEEK),
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
    lastUsedAt: ago(0),
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
    lastUsedAt: ago(1 * HOUR),
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
    lastUsedAt: ago(2 * DAY),
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
    lastUsedAt: ago(2 * HOUR),
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
    lastUsedAt: ago(3 * DAY),
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
    lastUsedAt: ago(28 * HOUR),
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
