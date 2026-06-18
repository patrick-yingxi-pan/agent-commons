import type { Artifact, DiffLine, FileNode } from '../types'

/** Mock options + sample payloads for the "Add context" flows. Picking an
 *  option attaches representative content so the panel actually populates. */

export const FOLDER_OPTIONS = [
  { id: 'f1', label: '~/projects/insights-dashboard', meta: '42 files · edited 2h ago' },
  { id: 'f2', label: '~/Documents/launch-assets', meta: '9 files · edited yesterday' },
  { id: 'f3', label: '~/projects/marketing-site', meta: '120 files · edited 3d ago' },
]

export const FOLDER_ARTIFACTS: Artifact[] = [
  { id: 'wa1', name: 'launch-onepager.md', kind: 'doc', meta: 'Markdown · 1.2 KB' },
  { id: 'wa2', name: 'launch-email.md', kind: 'email', meta: 'Draft · 0.8 KB' },
  { id: 'wa3', name: 'insights-hero.png', kind: 'image', meta: 'PNG · 1440×900' },
]

export const REPO_OPTIONS = [
  { id: 'r1', label: 'patrick-yingxi-pan/web-app', branch: 'main', meta: 'TypeScript · 1h ago' },
  { id: 'r2', label: 'patrick-yingxi-pan/claude-ui-proposal', branch: 'main', meta: 'TypeScript · just now' },
  { id: 'r3', label: 'acme/dashboard', branch: 'develop', meta: 'TypeScript · 2d ago' },
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

export const CONNECTOR_OPTIONS = [
  { id: 'gdrive', label: 'Google Drive' },
  { id: 'slack', label: 'Slack' },
  { id: 'notion', label: 'Notion' },
  { id: 'linear', label: 'Linear' },
  { id: 'github', label: 'GitHub' },
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
