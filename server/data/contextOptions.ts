import type { Connector, DiffLine, FileNode } from '../../contract/entities.ts'

/** Catalogs for the "Add context" flows. Files / photos / folders are no longer
 *  here — those three types are served from a real filesystem (the UI host, a
 *  runner, or the web backend's cloud storage; see contract/fs.ts + server/fs.ts).
 *  What remains are the repo / connector / MCP catalogs, still fixtures. */

/** Per-repo code payloads (files / diff / terminal). Keyed so the *same* repo
 *  identity reuses one payload across entry points (the insights repo whether
 *  attached from GitHub or as a local clone), while *different* repos render
 *  visibly different code. */
interface RepoCode {
  files: FileNode[]
  diff: DiffLine[]
  terminal: string[]
}

const insightsRepoCode: RepoCode = {
  files: [
    { path: 'src/routes/insights.tsx', status: 'added' },
    { path: 'src/flags.ts', status: 'modified' },
    { path: 'src/nav/Sidebar.tsx', status: 'modified' },
  ],
  diff: [
    { kind: 'hunk', text: '@@ src/flags.ts @@' },
    { kind: 'ctx', text: 'export const flags = {' },
    { kind: 'ctx', text: '  betaSearch: true,' },
    { kind: 'add', text: '  insightsDashboard: true,' },
    { kind: 'ctx', text: '}' },
  ],
  terminal: [
    '$ npm run test -- insights',
    '✓ routes/insights.test.tsx (6)',
    '✓ flags.test.ts (3)',
    'Test Files  2 passed (2)',
    '     Tests  9 passed (9)',
  ],
}

const proposalRepoCode: RepoCode = {
  files: [
    { path: 'src/components/Composer.tsx', status: 'modified' },
    { path: 'src/App.tsx', status: 'modified' },
    { path: 'src/types.ts', status: 'modified' },
  ],
  diff: [
    { kind: 'hunk', text: '@@ src/components/Composer.tsx @@' },
    { kind: 'ctx', text: 'const remoteRepos = repos.filter((r) => r.remote)' },
    { kind: 'add', text: 'const hasGitHubConnector = connectors.some((c) => c.id === GH_ID)' },
    { kind: 'ctx', text: 'const groups: ChipGroupModel[] = []' },
  ],
  terminal: [
    '$ npm run build',
    'vite v6.4.3 building for production...',
    '✓ 1967 modules transformed.',
    '✓ built in 0.94s',
  ],
}

const dashboardRepoCode: RepoCode = {
  files: [
    { path: 'src/widgets/RevenueChart.tsx', status: 'added' },
    { path: 'src/widgets/index.ts', status: 'modified' },
    { path: 'src/pages/Overview.tsx', status: 'modified' },
  ],
  diff: [
    { kind: 'hunk', text: '@@ src/widgets/index.ts @@' },
    { kind: 'ctx', text: "export { UsersWidget } from './UsersWidget'" },
    { kind: 'add', text: "export { RevenueChart } from './RevenueChart'" },
    { kind: 'ctx', text: "export { Funnel } from './Funnel'" },
  ],
  terminal: [
    '$ npm test -- dashboard',
    'PASS  src/widgets/RevenueChart.test.tsx',
    'Tests: 5 passed, 5 total',
  ],
}

const scriptsRepoCode: RepoCode = {
  files: [
    { path: 'etl/transform.py', status: 'modified' },
    { path: 'tests/test_transform.py', status: 'added' },
    { path: 'requirements.txt', status: 'modified' },
  ],
  diff: [
    { kind: 'hunk', text: '@@ etl/transform.py @@' },
    { kind: 'ctx', text: 'def aggregate(df):' },
    { kind: 'del', text: '    return df.groupby("cohort").sum()' },
    { kind: 'add', text: '    return df.groupby("cohort").agg({"users": "sum", "churn": "mean"})' },
  ],
  terminal: [
    '$ pytest -q',
    '....                                         [100%]',
    '4 passed in 0.62s',
  ],
}

const marketingRepoCode: RepoCode = {
  files: [
    { path: 'src/pages/index.astro', status: 'modified' },
    { path: 'src/components/Hero.astro', status: 'modified' },
    { path: 'astro.config.mjs', status: 'modified' },
  ],
  diff: [
    { kind: 'hunk', text: '@@ src/pages/index.astro @@' },
    { kind: 'ctx', text: '---' },
    { kind: 'del', text: 'const title = "Marketing site"' },
    { kind: 'add', text: 'const title = "Insights, now in one place"' },
    { kind: 'ctx', text: 'import Hero from "../components/Hero.astro"' },
  ],
  terminal: [
    '$ npm run build',
    'astro v4.5.0 building...',
    '▶ 14 page(s) built',
    '✓ Completed in 1.21s.',
  ],
}

/** GitHub repos — attached by their remote `owner/name`. These always have a
 *  remote, so they depend on the GitHub connector to push & open PRs. */
export const GITHUB_REPO_OPTIONS: ({
  id: string
  remote: string
  branch: string
  meta: string
} & RepoCode)[] = [
  {
    id: 'gh-web',
    remote: 'patrick-yingxi-pan/web-app',
    branch: 'main',
    meta: 'TypeScript · 1h ago',
    ...insightsRepoCode,
  },
  {
    id: 'gh-proposal',
    remote: 'patrick-yingxi-pan/claude-ui-proposal',
    branch: 'main',
    meta: 'TypeScript · just now',
    ...proposalRepoCode,
  },
  {
    id: 'gh-dash',
    remote: 'acme/dashboard',
    branch: 'develop',
    meta: 'TypeScript · 2d ago',
    ...dashboardRepoCode,
  },
  // Not pre-saved on the Contexts page — so it's something genuinely new to add
  // (here or in a session's Add-context Browse).
  {
    id: 'gh-api',
    remote: 'acme/api-gateway',
    branch: 'main',
    meta: 'Go · 4d ago',
    ...dashboardRepoCode,
  },
]

/** Local repos — a folder + git working tree on disk. `remote` is optional: a
 *  local clone may track a GitHub remote (then it also depends on the connector)
 *  or be purely local (then it doesn't). */
export const LOCAL_REPO_OPTIONS: ({
  id: string
  path: string
  branch: string
  remote?: string
  meta: string
} & RepoCode)[] = [
  {
    id: 'lr-insights',
    path: '~/projects/insights-dashboard',
    branch: 'feat/insights',
    remote: 'patrick-yingxi-pan/web-app',
    meta: 'TypeScript · edited 2h ago',
    ...insightsRepoCode,
  },
  {
    id: 'lr-scripts',
    path: '~/code/data-scripts',
    branch: 'main',
    meta: 'Python · edited yesterday',
    ...scriptsRepoCode,
  },
  {
    id: 'lr-site',
    path: '~/projects/marketing-site',
    branch: 'main',
    remote: 'acme/marketing-site',
    meta: 'Astro · edited 3d ago',
    ...marketingRepoCode,
  },
]

export const CONNECTOR_OPTIONS: { id: string; label: string; kind?: Connector['kind'] }[] = [
  { id: 'gdrive', label: 'Google Drive' },
  { id: 'slack', label: 'Slack' },
  { id: 'notion', label: 'Notion' },
  { id: 'linear', label: 'Linear' },
  { id: 'jira', label: 'Jira' },
  { id: 'gcal', label: 'Google Calendar' },
  // Same identity (id + kind) as the repo's GitHub connector, so attaching a
  // repo and the GitHub connector dedup to a single chip instead of two.
  { id: 'gh-mcp', label: 'GitHub', kind: 'github' },
  { id: 'figma', label: 'Figma' },
  { id: 'sentry', label: 'Sentry' },
  { id: 'asana', label: 'Asana' },
  { id: 'intercom', label: 'Intercom' },
  { id: 'hubspot', label: 'HubSpot' },
  { id: 'dropbox', label: 'Dropbox' },
  { id: 'zoom', label: 'Zoom' },
  // Not pre-saved on the Contexts page — genuinely new connectors to set up.
  { id: 'airtable', label: 'Airtable' },
  { id: 'stripe', label: 'Stripe' },
]

export const MCP_OPTIONS = [
  { id: 'filesystem', label: 'filesystem', meta: 'Local files & directories' },
  { id: 'github', label: 'github', meta: 'Issues, PRs, code search' },
  { id: 'postgres', label: 'postgres', meta: 'Query a Postgres database' },
  { id: 'puppeteer', label: 'puppeteer', meta: 'Headless browser automation' },
  { id: 'sqlite', label: 'sqlite', meta: 'Query a local SQLite file' },
  { id: 'fetch', label: 'fetch', meta: 'HTTP fetch & web requests' },
  { id: 'brave-search', label: 'brave-search', meta: 'Web search via Brave' },
  { id: 'memory', label: 'memory', meta: 'Persistent knowledge graph' },
  { id: 'time', label: 'time', meta: 'Time & timezone conversions' },
  // Not pre-saved on the Contexts page — genuinely new servers to add.
  { id: 'sentry-mcp', label: 'sentry', meta: 'Error tracking & traces' },
  { id: 'gitlab', label: 'gitlab', meta: 'Issues, MRs, pipelines' },
]

/** The "Add context" types (the recents store is keyed by these) — the one home
 *  is the contract; re-exported here so this module's consumers keep resolving. */
export type { ContextTypeId } from '../../contract/contexts.ts'
import type { ContextTypeId } from '../../contract/contexts.ts'

/** What each type's "Recent" list shows before the user has picked anything.
 *  The file-like types (files / photos / folder) seed from the live filesystem
 *  scan instead (server/store.ts), so their entries here are empty — they fill in
 *  from the served catalog and from what the user attaches. Repo mixes local +
 *  GitHub ids; connector / mcp seed from the connected sets in savedContexts
 *  (lib/recents `seedFor`), so the entries below are only a fallback. */
export const DEFAULT_RECENT_IDS: Record<ContextTypeId, string[]> = {
  files: [],
  photos: [],
  folder: [],
  repo: ['lr-insights', 'gh-proposal', 'lr-scripts', 'gh-web', 'gh-dash', 'lr-site', 'gh-api'],
  // connector / mcp seed from the connected sets in savedContexts (see lib/recents
  // `seedFor`), not from these entries.
  connector: ['gdrive', 'slack', 'notion'],
  mcp: ['filesystem', 'github', 'postgres'],
}
