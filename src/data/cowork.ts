import type { ArtifactKind } from '../types'

/** Mock data behind the sidebar's cross-cutting tools (Projects, Artifacts,
 *  Scheduled, Dispatch). All fabricated — the prototype has no backend. */

/** A scheduled run that belongs to a project (shown in the project's right-hand
 *  panel). Mirrors the shape of the global SCHEDULED_TASKS but scoped to one
 *  project, so a project can list its own cadence without a join. */
export interface ProjectSchedule {
  name: string
  cadence: string
  enabled: boolean
}

/** A piece of context attached to a project — a folder, a repo, a connector, or
 *  a knowledge doc. Drives the icon + label in the project's "Context" panel. */
export interface ProjectContext {
  kind: 'folder' | 'repo' | 'connector' | 'doc'
  label: string
  meta: string
}

export interface Project {
  id: string
  name: string
  description: string
  updated: string
  /** Custom instructions Claude follows inside this project (right panel). */
  instructions: string
  /** Recurring runs scoped to this project (right panel). */
  scheduled: ProjectSchedule[]
  /** Folders, repos, connectors, and docs this project carries (right panel). */
  contexts: ProjectContext[]
  /** Sessions that live in this project (main panel) — ids into
   *  SESSIONS so each row opens the real thread. */
  sessionIds: string[]
}

export const PROJECTS: Project[] = [
  {
    id: 'p-insights',
    name: 'Insights dashboard',
    description: 'The self-serve Insights dashboard — launch plan, assets, and the feature-flagged rollout.',
    updated: 'now',
    instructions:
      'Write for PMs and execs: lead with the metric, then the mechanism. Keep launch copy to one screen. Ship behind the `insights_dashboard` flag on `/insights` until GA. When you make a claim, cite the Amplitude chart that backs it.',
    scheduled: [
      { name: 'Launch readiness check', cadence: 'Weekdays · 9:00 AM', enabled: true },
    ],
    contexts: [
      { kind: 'folder', label: '~/code/insights-web', meta: '24 files' },
      { kind: 'repo', label: 'patrick-yingxi-pan/web-app', meta: 'feat/insights-dashboard' },
      { kind: 'connector', label: 'Linear', meta: 'INS team · 18 issues' },
      { kind: 'connector', label: 'Figma', meta: 'Insights v2' },
    ],
    sessionIds: ['insights-launch', 'insights-empty-states', 'dashboard-perf'],
  },
  {
    id: 'p-growth',
    name: 'Growth experiments',
    description: 'Activation A/Bs, the onboarding funnel, churn work, and the weekly growth readout.',
    updated: '2h ago',
    instructions:
      'Every experiment needs a hypothesis, a primary metric, and a guardrail. Report lift with a 95% confidence interval — no ship call below 95% significance. Our north-star is weekly-active-teams, not MAU; frame results against it.',
    scheduled: [
      { name: 'Weekly activation readout', cadence: 'Mondays · 7:00 AM', enabled: true },
      { name: 'Experiment health digest', cadence: 'Weekdays · 8:30 AM', enabled: false },
    ],
    contexts: [
      { kind: 'connector', label: 'Amplitude', meta: 'Web · prod' },
      { kind: 'connector', label: 'Statsig', meta: '12 experiments' },
      { kind: 'doc', label: 'experiment-log.sheet', meta: '34 experiments' },
    ],
    sessionIds: ['onboarding-ab', 'churn-analysis', 'board-deck'],
  },
  {
    id: 'p-brand',
    name: 'Brand refresh',
    description: 'The 2026 brand refresh — voice guide, the new logo lockups, and a marketing-site pass.',
    updated: 'Yesterday',
    instructions:
      'Voice is warm, plain, and confident — no hype words or exclamation marks. Sentence case for headings. Always use the new wordmark, never the retired logotype. Prefer em dashes over semicolons.',
    scheduled: [{ name: 'Weekly site-copy review', cadence: 'Fridays · 3:00 PM', enabled: false }],
    contexts: [
      { kind: 'folder', label: '~/design/brand-kit', meta: '41 files' },
      { kind: 'connector', label: 'Figma', meta: 'Brand 2026' },
      { kind: 'connector', label: 'Google Drive', meta: 'Brand folder' },
    ],
    sessionIds: ['brand-voice', 'homepage-rewrite', 'logo-feedback'],
  },
  {
    id: 'p-infra',
    name: 'Platform hardening',
    description: 'The platform team — auth refactor, API rate limits, and the on-call runbook.',
    updated: '3d ago',
    instructions:
      'Prefer the smallest diff that removes duplication. Every auth change ships with a test and links the on-call runbook in the PR. Roll out behind a flag and watch the Sentry error rate for 30 minutes before widening.',
    scheduled: [
      { name: 'Nightly dependency audit', cadence: 'Daily · 2:00 AM', enabled: true },
      { name: 'On-call handoff summary', cadence: 'Mondays · 9:00 AM', enabled: true },
    ],
    contexts: [
      { kind: 'repo', label: 'patrick-yingxi-pan/server', meta: 'refactor/auth-middleware' },
      { kind: 'connector', label: 'GitHub', meta: 'patrick-yingxi-pan' },
      { kind: 'connector', label: 'PagerDuty', meta: 'Platform on-call' },
      { kind: 'connector', label: 'Sentry', meta: 'server · prod' },
    ],
    sessionIds: ['auth-refactor', 'rate-limits', 'oncall-runbook'],
  },
]

/** A session's home project, if any. Sessions live in a single project (or
 *  none); we derive the back-link from `sessionIds` so there's one source of
 *  truth and no `projectId` on the session to keep in sync. Returns the first
 *  match, which — under the single-home rule — is the only one. */
export function projectForSession(sessionId: string): Project | undefined {
  return PROJECTS.find((p) => p.sessionIds.includes(sessionId))
}

export interface ScheduledTask {
  id: string
  name: string
  cadence: string
  next: string
  enabled: boolean
  lastStatus: 'ok' | 'failed' | 'pending'
}

export const SCHEDULED_TASKS: ScheduledTask[] = [
  {
    id: 's-ai-news',
    name: 'Daily ai news briefing',
    cadence: 'Weekdays · 8:00 AM',
    next: 'Tomorrow, 8:00 AM',
    enabled: true,
    lastStatus: 'ok',
  },
  {
    id: 's-standup',
    name: 'Standup digest from Linear',
    cadence: 'Weekdays · 9:30 AM',
    next: 'Tomorrow, 9:30 AM',
    enabled: true,
    lastStatus: 'ok',
  },
  {
    id: 's-metrics',
    name: 'Weekly metrics roll-up',
    cadence: 'Mondays · 7:00 AM',
    next: 'Mon, 7:00 AM',
    enabled: false,
    lastStatus: 'pending',
  },
]

export interface ArtifactItem {
  id: string
  name: string
  kind: ArtifactKind
  meta: string
  /** The conversation that produced it. */
  source: string
  /** The project it belongs to (groups the Artifacts gallery). */
  projectId: string
  /** A one-line preview shown on the card and in the viewer. */
  excerpt?: string
  /** Relative last-edited label, e.g. "4 hours ago". */
  edited: string
  /** The surface it came from — Cowork, Code, or Chat. */
  tag: 'Cowork' | 'Code' | 'Chat'
}

export const ALL_ARTIFACTS: ArtifactItem[] = [
  // ── Insights dashboard ───────────────────────────────────────────────────
  {
    id: 'a1',
    name: 'insights-onepager.md',
    kind: 'doc',
    meta: '1 page',
    source: 'Insights dashboard launch',
    projectId: 'p-insights',
    excerpt: 'Why Insights, who it’s for, and the launch plan — on one screen.',
    edited: '4 hours ago',
    tag: 'Cowork',
  },
  {
    id: 'a2',
    name: 'insights-spec.md',
    kind: 'doc',
    meta: 'functional spec',
    source: 'Insights dashboard launch',
    projectId: 'p-insights',
    excerpt: 'Filters, saved views, sharing, and the empty/error states.',
    edited: 'yesterday',
    tag: 'Cowork',
  },
  {
    id: 'a3',
    name: 'launch-email.md',
    kind: 'email',
    meta: 'to: workspace admins',
    source: 'Insights dashboard launch',
    projectId: 'p-insights',
    excerpt: 'Insights is live behind a flag — here’s how to switch it on.',
    edited: '4 hours ago',
    tag: 'Cowork',
  },
  {
    id: 'a4',
    name: 'insights-hero.png',
    kind: 'image',
    meta: '1600×900',
    source: 'Insights dashboard launch',
    projectId: 'p-insights',
    excerpt: 'Marketing hero — the dashboard with the cohort chart in front.',
    edited: 'yesterday',
    tag: 'Cowork',
  },
  {
    id: 'a5',
    name: 'query-perf.sheet',
    kind: 'sheet',
    meta: '12 widgets',
    source: 'Dashboard query performance',
    projectId: 'p-insights',
    excerpt: 'p95 widget latency before/after the composite index (1.8s → 240ms).',
    edited: 'Tue',
    tag: 'Code',
  },
  // ── Growth experiments ───────────────────────────────────────────────────
  {
    id: 'a6',
    name: 'onboarding-ab-readout.md',
    kind: 'doc',
    meta: 'summary',
    source: 'Onboarding A/B readout',
    projectId: 'p-growth',
    excerpt: 'Variant B lifted activation +6.2% (95% CI +2.1–10.3). Ship it.',
    edited: '2 hours ago',
    tag: 'Cowork',
  },
  {
    id: 'a7',
    name: 'activation-funnel.png',
    kind: 'image',
    meta: '1200×700',
    source: 'Onboarding A/B readout',
    projectId: 'p-growth',
    excerpt: 'Signup → first-query → invite funnel, control vs. variant B.',
    edited: '2 hours ago',
    tag: 'Cowork',
  },
  {
    id: 'a8',
    name: 'june-churn-cohorts.sheet',
    kind: 'sheet',
    meta: '2,481 rows',
    source: 'Churn analysis · June',
    projectId: 'p-growth',
    excerpt: 'Monthly cohorts with churn %, expansion, and contraction.',
    edited: 'Monday',
    tag: 'Cowork',
  },
  {
    id: 'a9',
    name: 'churn-drivers.md',
    kind: 'doc',
    meta: 'summary',
    source: 'Churn analysis · June',
    projectId: 'p-growth',
    excerpt: 'Three drivers explain ~80% of June’s spike.',
    edited: 'Monday',
    tag: 'Cowork',
  },
  {
    id: 'a10',
    name: 'q3-board-deck.slides',
    kind: 'slide',
    meta: '14 slides',
    source: 'Q3 board deck',
    projectId: 'p-growth',
    excerpt: 'Opens on net retention, then expansion, then the roadmap ask.',
    edited: 'yesterday',
    tag: 'Cowork',
  },
  // ── Brand refresh ────────────────────────────────────────────────────────
  {
    id: 'a11',
    name: 'brand-voice-guide.md',
    kind: 'doc',
    meta: 'guide',
    source: 'Brand voice guidelines',
    projectId: 'p-brand',
    excerpt: 'Warm, plain, confident — with do/don’t pairs and a banned-words list.',
    edited: 'yesterday',
    tag: 'Cowork',
  },
  {
    id: 'a12',
    name: 'homepage-copy.md',
    kind: 'doc',
    meta: 'hero + 3 sections',
    source: 'Homepage rewrite',
    projectId: 'p-brand',
    excerpt: '“See what your product is actually doing” — hero, proof points, one CTA.',
    edited: 'yesterday',
    tag: 'Cowork',
  },
  {
    id: 'a13',
    name: 'logo-lockups.png',
    kind: 'image',
    meta: '1600×900',
    source: 'Logo lockup feedback',
    projectId: 'p-brand',
    excerpt: 'The three wordmark lockups at display, body, and favicon sizes.',
    edited: '2 days ago',
    tag: 'Cowork',
  },
  {
    id: 'a14',
    name: 'color-tokens.sheet',
    kind: 'sheet',
    meta: '38 tokens',
    source: 'Brand voice guidelines',
    projectId: 'p-brand',
    excerpt: 'The 2026 palette mapped to semantic tokens (surface, ink, accent…).',
    edited: '3 days ago',
    tag: 'Cowork',
  },
  {
    id: 'a15',
    name: 'tone-dos-donts.md',
    kind: 'doc',
    meta: 'reference',
    source: 'Brand voice guidelines',
    projectId: 'p-brand',
    excerpt: 'Side-by-side do/don’t rewrites for support and marketing copy.',
    edited: '3 days ago',
    tag: 'Cowork',
  },
  // ── Platform hardening ───────────────────────────────────────────────────
  {
    id: 'a16',
    name: 'oncall-runbook.md',
    kind: 'doc',
    meta: 'runbook',
    source: 'On-call runbook',
    projectId: 'p-infra',
    excerpt: 'First five minutes, escalation path, and the one-command rollback.',
    edited: '3 days ago',
    tag: 'Code',
  },
  {
    id: 'a17',
    name: 'rate-limit-rfc.md',
    kind: 'doc',
    meta: 'RFC · draft',
    source: 'Rate limiting RFC',
    projectId: 'p-infra',
    excerpt: 'Token-bucket per API key; 429 with Retry-After and budget headers.',
    edited: 'Wed',
    tag: 'Code',
  },
  {
    id: 'a18',
    name: 'refresh-session-notes.md',
    kind: 'doc',
    meta: 'notes',
    source: 'Refactor auth middleware',
    projectId: 'p-infra',
    excerpt: 'Collapsed two token-refresh paths into one `refreshSession()`.',
    edited: '3 days ago',
    tag: 'Code',
  },
  {
    id: 'a19',
    name: 'auth-test-plan.md',
    kind: 'doc',
    meta: 'test plan',
    source: 'Refactor auth middleware',
    projectId: 'p-infra',
    excerpt: 'Cases for the unified refresh path: expiry, reuse, and revocation.',
    edited: '3 days ago',
    tag: 'Code',
  },
  {
    id: 'a20',
    name: 'error-budget.sheet',
    kind: 'sheet',
    meta: '4 services',
    source: 'On-call runbook',
    projectId: 'p-infra',
    excerpt: 'SLOs and 30-day error-budget burn for the auth service.',
    edited: 'Wed',
    tag: 'Code',
  },
]

export interface DispatchRun {
  id: string
  title: string
  status: 'running' | 'done' | 'failed'
  when: string
  detail: string
}

export const DISPATCH_RUNS: DispatchRun[] = [
  {
    id: 'd1',
    title: 'Triage new GitHub issues',
    status: 'running',
    when: 'started 4m ago',
    detail: 'Labeling 17 open issues and drafting first replies.',
  },
  {
    id: 'd2',
    title: 'Summarize yesterday’s support tickets',
    status: 'done',
    when: '1h ago',
    detail: '38 tickets → 5 themes, posted to #support-digest.',
  },
  {
    id: 'd3',
    title: 'Refresh competitor pricing table',
    status: 'failed',
    when: '3h ago',
    detail: 'A source page changed layout — needs a selector update.',
  },
]
