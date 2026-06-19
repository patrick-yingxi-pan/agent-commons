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
  /** Conversations that live in this project (main panel) — ids into
   *  CONVERSATIONS so each row opens the real thread. */
  conversationIds: string[]
}

export const PROJECTS: Project[] = [
  {
    id: 'p-insights',
    name: 'Insights dashboard',
    description: 'Launch strategy, assets, and the feature-flagged route.',
    updated: 'now',
    instructions:
      'Write for PMs and execs: lead with the metric, then the mechanism. Keep launch copy to one screen. Ship behind the `insights_dashboard` flag on the `/insights` route until GA.',
    scheduled: [
      { name: 'Launch readiness check', cadence: 'Weekdays · 9:00 AM', enabled: true },
    ],
    contexts: [
      { kind: 'folder', label: 'insights/', meta: 'workspace · 6 files' },
      { kind: 'repo', label: 'patrick-yingxi-pan/web-app', meta: 'feat/insights-dashboard' },
      { kind: 'connector', label: 'Linear', meta: 'connected' },
    ],
    conversationIds: ['insights-launch', 'board-deck'],
  },
  {
    id: 'p-growth',
    name: 'Growth experiments',
    description: 'Onboarding A/Bs, activation funnels, and weekly readouts.',
    updated: '2h ago',
    instructions:
      'Every experiment needs a hypothesis, a primary metric, and a guardrail metric. Report lift with a 95% confidence interval. No ship call below 95% significance.',
    scheduled: [
      { name: 'Weekly activation readout', cadence: 'Mondays · 7:00 AM', enabled: true },
      { name: 'Experiment health digest', cadence: 'Weekdays · 8:30 AM', enabled: false },
    ],
    contexts: [
      { kind: 'connector', label: 'Amplitude', meta: 'connected' },
      { kind: 'doc', label: 'experiment-log.sheet', meta: '34 rows' },
    ],
    conversationIds: ['onboarding-ab', 'churn-analysis'],
  },
  {
    id: 'p-brand',
    name: 'Brand refresh',
    description: 'Voice guidelines, the new logo lockups, and a site pass.',
    updated: 'Yesterday',
    instructions:
      'Voice is warm, plain, and confident — avoid hype words and exclamation marks. Sentence case for headings. Always use the new wordmark, never the retired logotype.',
    scheduled: [],
    contexts: [
      { kind: 'folder', label: 'brand-kit/', meta: 'workspace · 9 files' },
      { kind: 'connector', label: 'Figma', meta: 'connected' },
    ],
    conversationIds: ['brand-voice'],
  },
  {
    id: 'p-infra',
    name: 'Platform hardening',
    description: 'Auth refactor, rate limits, and the on-call runbook.',
    updated: '3d ago',
    instructions:
      'Prefer the smallest diff that removes the duplication. Every auth change ships with a test. Link the on-call runbook in the PR description.',
    scheduled: [{ name: 'Nightly dependency audit', cadence: 'Daily · 2:00 AM', enabled: true }],
    contexts: [
      { kind: 'repo', label: 'patrick-yingxi-pan/server', meta: 'refactor/auth-middleware' },
      { kind: 'connector', label: 'GitHub', meta: 'connected' },
      { kind: 'connector', label: 'PagerDuty', meta: 'connected' },
    ],
    conversationIds: ['auth-refactor'],
  },
]

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
  // Insights dashboard
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
    name: 'launch-email.md',
    kind: 'email',
    meta: 'to: admins',
    source: 'Insights dashboard launch',
    projectId: 'p-insights',
    excerpt: 'Insights is live behind a flag — here’s how to switch it on.',
    edited: '4 hours ago',
    tag: 'Cowork',
  },
  {
    id: 'a3',
    name: 'insights-hero.png',
    kind: 'image',
    meta: '1600×900',
    source: 'Insights dashboard launch',
    projectId: 'p-insights',
    edited: 'yesterday',
    tag: 'Cowork',
  },
  {
    id: 'a4',
    name: 'q3-board-deck.slides',
    kind: 'slide',
    meta: '14 slides',
    source: 'Q3 board deck',
    projectId: 'p-insights',
    excerpt: 'Opens on net retention, then expansion, then the roadmap ask.',
    edited: 'yesterday',
    tag: 'Cowork',
  },
  // Growth experiments
  {
    id: 'a5',
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
    id: 'a6',
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
    id: 'a7',
    name: 'churn-drivers.md',
    kind: 'doc',
    meta: 'summary',
    source: 'Churn analysis · June',
    projectId: 'p-growth',
    excerpt: 'Three drivers explain ~80% of June’s spike.',
    edited: 'Monday',
    tag: 'Cowork',
  },
  // Brand refresh
  {
    id: 'a8',
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
    id: 'a9',
    name: 'logo-lockups.png',
    kind: 'image',
    meta: '1600×900',
    source: 'Brand voice guidelines',
    projectId: 'p-brand',
    edited: '2 days ago',
    tag: 'Cowork',
  },
  // Platform hardening
  {
    id: 'a10',
    name: 'oncall-runbook.md',
    kind: 'doc',
    meta: 'runbook',
    source: 'Refactor auth middleware',
    projectId: 'p-infra',
    excerpt: 'First five minutes, escalation path, and the rollback command.',
    edited: '3 days ago',
    tag: 'Code',
  },
  {
    id: 'a11',
    name: 'refresh-session-notes.md',
    kind: 'doc',
    meta: 'notes',
    source: 'Refactor auth middleware',
    projectId: 'p-infra',
    excerpt: 'Collapsed two token-refresh paths into one `refreshSession()`.',
    edited: '3 days ago',
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
