import type { Conversation } from '../types'

/** The unified history. Note every item is the *same* kind of thing — a
 *  conversation — distinguished only by the capabilities it carries, shown as
 *  small badges. Today these would be scattered across three separate tabs. */
export const CONVERSATIONS: Conversation[] = [
  {
    id: 'insights-launch',
    title: 'Insights dashboard launch',
    caps: ['chat', 'workspace', 'repo'],
    updatedLabel: 'now',
    preview: 'Strategy → one-pager & email → feature flag and route. Guided demo.',
    isDemo: true,
  },
  {
    id: 'auth-refactor',
    title: 'Refactor auth middleware',
    caps: ['chat', 'repo'],
    updatedLabel: '2h ago',
    preview: 'Collapse the two token-refresh paths into one.',
    connectors: [{ id: 'gh', label: 'GitHub' }],
    messages: [
      {
        id: 'm1',
        role: 'user',
        content:
          'The token refresh logic is duplicated in middleware.ts and session.ts. Can we unify it?',
      },
      {
        id: 'm2',
        role: 'assistant',
        content:
          'Yes — both call the same `/oauth/refresh` endpoint with slightly different retry logic. I pulled it into a single `refreshSession()` helper and pointed both call sites at it. Diff and test run are on the right.',
      },
    ],
    files: [
      { path: 'server/src/auth/refreshSession.ts', status: 'added' },
      { path: 'server/src/auth/middleware.ts', status: 'modified' },
      { path: 'server/src/auth/session.ts', status: 'modified' },
    ],
    diff: [
      { kind: 'hunk', text: 'server/src/auth/middleware.ts' },
      { kind: 'ctx', text: 'export async function requireAuth(req, res, next) {' },
      { kind: 'del', text: '  const token = await rawRefresh(req.cookies.rt, { retries: 2 })' },
      { kind: 'add', text: '  const token = await refreshSession(req.cookies.rt)' },
      { kind: 'ctx', text: '  if (!token) return res.status(401).end()' },
      { kind: 'ctx', text: '  req.user = decode(token)' },
      { kind: 'ctx', text: '  next()' },
      { kind: 'ctx', text: '}' },
    ],
    terminal: [
      '$ npm test -- auth',
      'PASS  server/src/auth/refreshSession.test.ts (1.8s)',
      'Tests: 12 passed, 12 total',
    ],
  },
  {
    id: 'board-deck',
    title: 'Q3 board deck',
    caps: ['chat', 'workspace'],
    updatedLabel: 'Yesterday',
    preview: 'Narrative + 14 slides from the metrics review.',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Draft the Q3 board deck from the metrics review doc. Lead with retention.',
      },
      {
        id: 'm2',
        role: 'assistant',
        content:
          'Drafted a 14-slide deck — opens on net retention (up 6 pts QoQ), then expansion, then the roadmap ask. Speaker notes are in the doc. Everything’s in the workspace.',
      },
    ],
    artifacts: [
      { id: 'd1', name: 'q3-board-deck.slides', kind: 'slide', meta: '14 slides · draft' },
      { id: 'd2', name: 'talk-track.md', kind: 'doc', meta: 'speaker notes' },
      { id: 'd3', name: 'retention-chart.png', kind: 'image', meta: '1200×700' },
    ],
  },
  {
    id: 'churn-analysis',
    title: 'Churn analysis · June',
    caps: ['chat', 'workspace'],
    updatedLabel: 'Mon',
    preview: 'Cohort export + the three drivers behind the spike.',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Why did churn tick up in June? Pull the cohorts and find the drivers.',
      },
      {
        id: 'm2',
        role: 'assistant',
        content:
          'Three drivers explain ~80% of it: a billing email that bounced for annual plans, a mobile sign-in regression, and one large account offboarding. The cohort sheet and a summary are in the workspace.',
      },
    ],
    artifacts: [
      { id: 'c1', name: 'june-churn-cohorts.sheet', kind: 'sheet', meta: '2,481 rows' },
      { id: 'c2', name: 'churn-drivers.md', kind: 'doc', meta: 'summary' },
    ],
  },
  {
    id: 'vector-db',
    title: 'Vector databases, explained',
    caps: ['chat'],
    updatedLabel: 'Mon',
    preview: 'Plain chat — no workspace, no repo.',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Explain vector databases like I have a backend background but no ML.',
      },
      {
        id: 'm2',
        role: 'assistant',
        content:
          'Think of it as an index, but instead of matching exact keys it matches *meaning*. You convert text to a vector (a list of numbers that captures meaning), then the database finds the nearest vectors — “closest meaning” instead of “equals”. The hard part it solves for you is doing that nearest-neighbour search fast over millions of vectors.',
      },
    ],
  },
]

export const DEMO_CONVERSATION_ID = 'insights-launch'
