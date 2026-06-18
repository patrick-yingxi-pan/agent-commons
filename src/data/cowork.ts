import type { ArtifactKind } from '../types'

/** Mock data behind the sidebar's cross-cutting tools (Projects, Artifacts,
 *  Scheduled, Dispatch). All fabricated — the prototype has no backend. */

export interface Project {
  id: string
  name: string
  description: string
  items: number
  updated: string
}

export const PROJECTS: Project[] = [
  {
    id: 'p-insights',
    name: 'Insights dashboard',
    description: 'Launch strategy, assets, and the feature-flagged route.',
    items: 12,
    updated: 'now',
  },
  {
    id: 'p-growth',
    name: 'Growth experiments',
    description: 'Onboarding A/Bs, activation funnels, and weekly readouts.',
    items: 8,
    updated: '2h ago',
  },
  {
    id: 'p-brand',
    name: 'Brand refresh',
    description: 'Voice guidelines, the new logo lockups, and a site pass.',
    items: 21,
    updated: 'Yesterday',
  },
  {
    id: 'p-infra',
    name: 'Platform hardening',
    description: 'Auth refactor, rate limits, and the on-call runbook.',
    items: 5,
    updated: '3d ago',
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
  source: string
}

export const ALL_ARTIFACTS: ArtifactItem[] = [
  { id: 'a1', name: 'insights-onepager.md', kind: 'doc', meta: '1 page', source: 'Insights dashboard launch' },
  { id: 'a2', name: 'launch-email.md', kind: 'email', meta: 'to: admins', source: 'Insights dashboard launch' },
  { id: 'a3', name: 'insights-hero.png', kind: 'image', meta: '1600×900', source: 'Insights dashboard launch' },
  { id: 'a4', name: 'q3-board-deck.slides', kind: 'slide', meta: '14 slides', source: 'Q3 board deck' },
  { id: 'a5', name: 'talk-track.md', kind: 'doc', meta: 'speaker notes', source: 'Q3 board deck' },
  { id: 'a6', name: 'june-churn-cohorts.sheet', kind: 'sheet', meta: '2,481 rows', source: 'Churn analysis · June' },
  { id: 'a7', name: 'retention-chart.png', kind: 'image', meta: '1200×700', source: 'Q3 board deck' },
  { id: 'a8', name: 'churn-drivers.md', kind: 'doc', meta: 'summary', source: 'Churn analysis · June' },
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
