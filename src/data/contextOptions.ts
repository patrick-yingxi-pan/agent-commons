import type { Artifact, Connector, DiffLine, FileNode } from '../types'

/** Mock options + sample payloads for the "Add context" flows. Picking an
 *  option attaches representative content so the panel actually populates. */

export const FOLDER_OPTIONS: {
  id: string
  label: string
  meta: string
  /** Present when the folder is a git working tree — lets the folder flow offer
   *  to also attach it as a repository (and chain the connector prompt if the
   *  repo has a GitHub remote). */
  repo?: { branch: string; remote?: string }
}[] = [
  {
    id: 'f1',
    label: '~/projects/insights-dashboard',
    meta: '42 files · edited 2h ago',
    repo: { branch: 'feat/insights', remote: 'patrick-yingxi-pan/web-app' },
  },
  { id: 'f2', label: '~/Documents/launch-assets', meta: '9 files · edited yesterday' },
  {
    id: 'f3',
    label: '~/projects/marketing-site',
    meta: '120 files · edited 3d ago',
    repo: { branch: 'main', remote: 'acme/marketing-site' },
  },
]

export const FOLDER_ARTIFACTS: Artifact[] = [
  { id: 'wa1', name: 'launch-onepager.md', kind: 'doc', meta: 'Markdown · 1.2 KB' },
  { id: 'wa2', name: 'launch-email.md', kind: 'email', meta: 'Draft · 0.8 KB' },
  { id: 'wa3', name: 'insights-hero.png', kind: 'image', meta: 'PNG · 1440×900' },
]

/** GitHub repos — attached by their remote `owner/name`. These always have a
 *  remote, so they depend on the GitHub connector to push & open PRs. */
export const GITHUB_REPO_OPTIONS = [
  { id: 'gh-web', remote: 'patrick-yingxi-pan/web-app', branch: 'main', meta: 'TypeScript · 1h ago' },
  { id: 'gh-proposal', remote: 'patrick-yingxi-pan/claude-ui-proposal', branch: 'main', meta: 'TypeScript · just now' },
  { id: 'gh-dash', remote: 'acme/dashboard', branch: 'develop', meta: 'TypeScript · 2d ago' },
]

/** Local repos — a folder + git working tree on disk. `remote` is optional: a
 *  local clone may track a GitHub remote (then it also depends on the connector)
 *  or be purely local (then it doesn't). */
export const LOCAL_REPO_OPTIONS: {
  id: string
  path: string
  branch: string
  remote?: string
  meta: string
}[] = [
  {
    id: 'lr-insights',
    path: '~/projects/insights-dashboard',
    branch: 'feat/insights',
    remote: 'patrick-yingxi-pan/web-app',
    meta: 'TypeScript · edited 2h ago',
  },
  { id: 'lr-scripts', path: '~/code/data-scripts', branch: 'main', meta: 'Python · edited yesterday' },
  {
    id: 'lr-site',
    path: '~/projects/marketing-site',
    branch: 'main',
    remote: 'acme/marketing-site',
    meta: 'Astro · edited 3d ago',
  },
]

export const REPO_FILES: FileNode[] = [
  { path: 'src/routes/insights.tsx', status: 'added' },
  { path: 'src/flags.ts', status: 'modified' },
  { path: 'src/nav/Sidebar.tsx', status: 'modified' },
]

export const REPO_DIFF: DiffLine[] = [
  { kind: 'hunk', text: '@@ src/flags.ts @@' },
  { kind: 'ctx', text: 'export const flags = {' },
  { kind: 'ctx', text: '  betaSearch: true,' },
  { kind: 'add', text: '  insightsDashboard: true,' },
  { kind: 'ctx', text: '}' },
]

export const REPO_TERMINAL: string[] = [
  '$ npm run test -- insights',
  '✓ routes/insights.test.tsx (6)',
  '✓ flags.test.ts (3)',
  'Test Files  2 passed (2)',
  '     Tests  9 passed (9)',
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
