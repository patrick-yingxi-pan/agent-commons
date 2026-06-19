import type { Artifact, Connector, DiffLine, FileNode } from '../types'

/** Mock options + sample payloads for the "Add context" flows. Picking an
 *  option attaches representative content so the panel actually populates. */

/** Per-repo code payloads (files / diff / terminal). Keyed so the *same* repo
 *  identity reuses one payload across entry points (the insights repo whether
 *  attached from GitHub, as a local clone, or via its folder), while *different*
 *  repos render visibly different code. */
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

export const FOLDER_OPTIONS: {
  id: string
  label: string
  meta: string
  /** The folder's notable contents, shown as workspace artifacts. Distinct per
   *  folder; tagged with the folder as their source when attached. */
  artifacts: Artifact[]
  /** Present when the folder is a git working tree — lets the folder flow offer
   *  to also attach it as a repository (and chain the connector prompt if the
   *  repo has a GitHub remote). Carries the repo's own code payload. */
  repo?: { branch: string; remote?: string } & RepoCode
}[] = [
  {
    id: 'f1',
    label: '~/projects/insights-dashboard',
    meta: '42 files · edited 2h ago',
    artifacts: [
      { id: 'f1-readme', name: 'README.md', kind: 'doc', meta: 'Markdown · 3.1 KB' },
      { id: 'f1-spec', name: 'design-spec.md', kind: 'doc', meta: 'Markdown · 6.4 KB' },
      { id: 'f1-preview', name: 'dashboard-preview.png', kind: 'image', meta: 'PNG · 1600×1000' },
    ],
    repo: { branch: 'feat/insights', remote: 'patrick-yingxi-pan/web-app', ...insightsRepoCode },
  },
  {
    id: 'f2',
    label: '~/Documents/launch-assets',
    meta: '9 files · edited yesterday',
    artifacts: [
      { id: 'f2-brief', name: 'gtm-brief.md', kind: 'doc', meta: 'Markdown · 2.2 KB' },
      { id: 'f2-email', name: 'admin-announcement.md', kind: 'email', meta: 'Draft · 0.9 KB' },
      { id: 'f2-press', name: 'press-kit.pdf', kind: 'doc', meta: 'PDF · 4.6 MB' },
    ],
  },
  {
    id: 'f3',
    label: '~/projects/marketing-site',
    meta: '120 files · edited 3d ago',
    artifacts: [
      { id: 'f3-index', name: 'index.astro', kind: 'doc', meta: 'Astro · 2.0 KB' },
      { id: 'f3-hero', name: 'hero.webp', kind: 'image', meta: 'WebP · 2400×1260' },
      { id: 'f3-seo', name: 'seo-meta.md', kind: 'doc', meta: 'Markdown · 0.9 KB' },
    ],
    repo: { branch: 'main', remote: 'acme/marketing-site', ...marketingRepoCode },
  },
]

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
  // Same identity (id + kind) as the repo's GitHub connector, so attaching a
  // repo and the GitHub connector dedup to a single chip instead of two.
  { id: 'gh-mcp', label: 'GitHub', kind: 'github' },
]

export const MCP_OPTIONS = [
  { id: 'filesystem', label: 'filesystem', meta: 'Local files & directories' },
  { id: 'github', label: 'github', meta: 'Issues, PRs, code search' },
  { id: 'postgres', label: 'postgres', meta: 'Query a Postgres database' },
  { id: 'puppeteer', label: 'puppeteer', meta: 'Headless browser automation' },
]

export const FILE_OPTIONS = [
  { id: 'doc1', label: 'Q3-roadmap.pdf', meta: 'PDF · 320 KB' },
  { id: 'doc2', label: 'metrics.csv', meta: 'CSV · 18 KB' },
  { id: 'doc3', label: 'notes.md', meta: 'Markdown · 4 KB' },
]

export const PHOTO_OPTIONS = [
  { id: 'p1', label: 'screenshot-1.png' },
  { id: 'p2', label: 'mockup.png' },
  { id: 'p3', label: 'chart.png' },
  { id: 'p4', label: 'logo.png' },
]
