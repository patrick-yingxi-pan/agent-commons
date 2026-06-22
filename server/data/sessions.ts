import type { Session } from '../../contract/entities.ts'

/** Concrete timestamps backing the sidebar's sort + "Last activity" filter.
 *  Anchored to process start so the seed's relative `updatedLabel`s ("2h ago",
 *  "Yesterday", …) stay roughly truthful while the server runs. `ago(ms)` is a
 *  point in the past; HOUR/DAY keep the call sites readable. */
const NOW = Date.now()
const HOUR = 3_600_000
const DAY = 24 * HOUR
const ago = (ms: number) => NOW - ms

/** The unified history. Note every item is the *same* kind of thing — a
 *  conversation — distinguished only by the capabilities it carries. Today these
 *  would be scattered across three separate tabs.
 *
 *  This is the backend's seed data: in the real product it would come from a
 *  database; here the mock server holds it in memory and serves it over the API. */
export const SESSIONS: Session[] = [
  {
    id: 'insights-launch',
    title: 'Insights dashboard launch',
    caps: ['chat', 'workspace', 'repo'],
    updatedLabel: 'now',
    preview: 'Strategy → one-pager & email → feature flag and route. Guided demo.',
    status: 'active',
    environment: 'local',
    updatedAt: ago(5 * 60_000),
    createdAt: ago(3 * DAY),
    isDemo: true,
  },
  {
    id: 'auth-refactor',
    title: 'Refactor auth middleware',
    caps: ['chat', 'repo'],
    updatedLabel: '2h ago',
    preview: 'Collapse the two token-refresh paths into one.',
    status: 'active',
    environment: 'local',
    updatedAt: ago(2 * HOUR),
    createdAt: ago(5 * DAY),
    connectors: [{ id: 'gh-mcp', label: 'GitHub', kind: 'github' }],
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
    id: 'onboarding-ab',
    title: 'Onboarding A/B readout',
    caps: ['chat', 'workspace'],
    updatedLabel: '2h ago',
    preview: 'Variant B lifted activation +6.2% — ship it.',
    status: 'active',
    environment: 'local',
    updatedAt: ago(2 * HOUR + 40 * 60_000),
    createdAt: ago(4 * DAY),
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Read out the onboarding A/B. Did variant B beat control on activation?',
      },
      {
        id: 'm2',
        role: 'assistant',
        content:
          'Yes — variant B lifted activation +6.2% (95% CI: +2.1–10.3%), with no hit to the day-7 retention guardrail. Recommendation: ship B to 100%. The readout and the funnel chart are in the workspace.',
      },
    ],
    artifacts: [
      { id: 'ob1', name: 'onboarding-ab-readout.md', kind: 'doc', meta: 'summary' },
      { id: 'ob2', name: 'activation-funnel.png', kind: 'image', meta: '1200×700' },
    ],
  },
  {
    id: 'board-deck',
    title: 'Q3 board deck',
    caps: ['chat', 'workspace'],
    updatedLabel: 'Yesterday',
    preview: 'Narrative + 14 slides from the metrics review.',
    status: 'active',
    environment: 'local',
    updatedAt: ago(DAY + 2 * HOUR),
    createdAt: ago(8 * DAY),
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
    status: 'active',
    environment: 'local',
    updatedAt: ago(2 * DAY),
    createdAt: ago(9 * DAY),
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
    id: 'brand-voice',
    title: 'Brand voice guidelines',
    caps: ['chat', 'workspace'],
    updatedLabel: 'Yesterday',
    preview: 'Warm, plain, confident — with do/don’t examples.',
    status: 'active',
    environment: 'local',
    updatedAt: ago(DAY + 5 * HOUR),
    createdAt: ago(6 * DAY),
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Draft brand voice guidelines from the site copy and the launch deck.',
      },
      {
        id: 'm2',
        role: 'assistant',
        content:
          'Drafted a one-page guide: the voice is warm, plain, and confident, with do/don’t pairs and a banned-words list. The new wordmark lockups are alongside it in the workspace.',
      },
    ],
    artifacts: [
      { id: 'bv1', name: 'brand-voice-guide.md', kind: 'doc', meta: 'guide' },
      { id: 'bv2', name: 'logo-lockups.png', kind: 'image', meta: '1600×900' },
    ],
  },
  {
    id: 'insights-empty-states',
    title: 'Insights empty & error states',
    caps: ['chat', 'workspace'],
    updatedLabel: '5h ago',
    preview: 'Zero-data, loading, and error states for the dashboard.',
    status: 'active',
    environment: 'local',
    updatedAt: ago(5 * HOUR),
    createdAt: ago(2 * DAY),
    messages: [
      {
        id: 'm1',
        role: 'user',
        content:
          'We need empty and error states for the Insights dashboard. What should each one say?',
      },
      {
        id: 'm2',
        role: 'assistant',
        content:
          'I drafted four: first-run (no data yet), filtered-to-empty, partial-load, and query-failed. Each leads with what happened, then the single action to fix it — never a dead end. Copy and a spec are in the workspace.',
      },
    ],
    artifacts: [
      { id: 'is1', name: 'empty-states-spec.md', kind: 'doc', meta: '4 states' },
      { id: 'is2', name: 'empty-states.png', kind: 'image', meta: '1600×900' },
    ],
  },
  {
    id: 'dashboard-perf',
    title: 'Dashboard query performance',
    caps: ['chat', 'workspace'],
    updatedLabel: 'Tue',
    preview: 'p95 widget latency 1.8s → 240ms with one index.',
    status: 'active',
    environment: 'local',
    updatedAt: ago(2 * DAY + 3 * HOUR),
    createdAt: ago(7 * DAY),
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'The Insights widgets feel slow on big workspaces. Where’s the time going?',
      },
      {
        id: 'm2',
        role: 'assistant',
        content:
          'p95 was 1.8s, almost all in the cohort rollup scan. A composite index on (workspace_id, event_date) drops it to ~240ms with no query changes. Before/after numbers per widget are in the sheet.',
      },
    ],
    artifacts: [{ id: 'dp1', name: 'query-perf.sheet', kind: 'sheet', meta: '12 widgets' }],
  },
  {
    id: 'homepage-rewrite',
    title: 'Homepage rewrite',
    caps: ['chat', 'workspace'],
    updatedLabel: 'Yesterday',
    preview: 'New hero, three proof points, one CTA.',
    status: 'active',
    environment: 'local',
    updatedAt: ago(DAY + 8 * HOUR),
    createdAt: ago(5 * DAY),
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Rewrite the homepage hero — it’s too clever and nobody knows what we do.',
      },
      {
        id: 'm2',
        role: 'assistant',
        content:
          'New hero: “See what your product is actually doing.” Then three proof points — set up in minutes, no SQL, alerts that matter — and a single “Start free” CTA. Full copy’s in the workspace.',
      },
    ],
    artifacts: [{ id: 'hr1', name: 'homepage-copy.md', kind: 'doc', meta: 'hero + 3 sections' }],
  },
  {
    id: 'logo-feedback',
    title: 'Logo lockup feedback',
    caps: ['chat'],
    updatedLabel: '2d ago',
    preview: 'Which wordmark lockup holds up at favicon size?',
    status: 'archived',
    environment: 'local',
    updatedAt: ago(2 * DAY),
    createdAt: ago(15 * DAY),
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Three logo lockups attached. Which survives at 16px and on a dark header?',
      },
      {
        id: 'm2',
        role: 'assistant',
        content:
          'Lockup B. A’s ascender fills in below ~20px and C loses the gap in the mark on dark. B keeps its counters at favicon size — I’d ship B and drop the descriptor under 24px.',
      },
    ],
  },
  {
    id: 'rate-limits',
    title: 'Rate limiting RFC',
    caps: ['chat', 'workspace'],
    updatedLabel: 'Wed',
    preview: 'Token-bucket per API key; 429 with Retry-After.',
    status: 'active',
    environment: 'local',
    updatedAt: ago(5 * DAY),
    createdAt: ago(12 * DAY),
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Draft an RFC for API rate limits — one integration is hammering us.',
      },
      {
        id: 'm2',
        role: 'assistant',
        content:
          'Proposed a token-bucket per API key (600 req/min, burst 60), returning 429 with a Retry-After header and the remaining budget in the response headers, with tiered limits by plan. The RFC’s in the workspace.',
      },
    ],
    artifacts: [{ id: 'rl1', name: 'rate-limit-rfc.md', kind: 'doc', meta: 'RFC · draft' }],
  },
  {
    id: 'oncall-runbook',
    title: 'On-call runbook',
    caps: ['chat', 'workspace'],
    updatedLabel: '3d ago',
    preview: 'First five minutes, escalation, and the rollback.',
    status: 'active',
    environment: 'local',
    updatedAt: ago(3 * DAY + 4 * HOUR),
    createdAt: ago(20 * DAY),
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Write the on-call runbook for the auth service.',
      },
      {
        id: 'm2',
        role: 'assistant',
        content:
          'Drafted it: the first-five-minutes checklist, how to read the Sentry and PagerDuty signals, the escalation path to the platform lead, and the one-command rollback. It’s in the workspace alongside the error-budget sheet.',
      },
    ],
    artifacts: [
      { id: 'or1', name: 'oncall-runbook.md', kind: 'doc', meta: 'runbook' },
      { id: 'or2', name: 'error-budget.sheet', kind: 'sheet', meta: '4 services' },
    ],
  },
  {
    id: 'vector-db',
    title: 'Vector databases, explained',
    caps: ['chat'],
    updatedLabel: 'Mon',
    preview: 'Plain chat — no workspace, no repo.',
    status: 'archived',
    environment: 'local',
    updatedAt: ago(2 * DAY + 6 * HOUR),
    createdAt: ago(40 * DAY),
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

export const DEMO_SESSION_ID = 'insights-launch'
