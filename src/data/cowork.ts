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

/** The hue of a workflow step's tool chip. Connector/MCP/repo/workspace map onto
 *  the shared CHIP_TONES palette; 'web' and 'claude' are rendered neutral (a
 *  built-in tool / a pure-reasoning step) so the rail never has a colorless hole. */
export type StepToolTone = 'connector' | 'mcp' | 'repo' | 'workspace' | 'web' | 'claude'

/** The tool a single workflow step leans on — drives the step chip's icon, label,
 *  and tone, and (via `needsAuth`) the amber marker that explains a failed run. */
export interface StepTool {
  id: string
  label: string
  tone: StepToolTone
  needsAuth?: boolean
}

/** One ordered step in a scheduled task's workflow — an imperative action and the
 *  tool it uses. Renders as a single node on the detail page's vertical rail. */
export interface WorkflowStep {
  id: string
  action: string
  tool: StepTool
}

/** Where a task's output lands — the rail's terminal node and the "Delivers to"
 *  side panel. */
export interface ScheduledDelivery {
  tool: StepTool
  target: string
  note?: string
}

/** One past execution of a scheduled task. `reachedStep` is how far the run got
 *  (drives the detail rail's relight: steps 0..reachedStep-1 turn green; a failed
 *  run stops red at `reachedStep`). `summary` is the one line of what it produced. */
export interface ScheduledRun {
  id: string
  status: 'ok' | 'failed' | 'running' | 'skipped'
  when: string
  absolute: string
  duration: string
  reachedStep: number
  summary: string
}

/** A scheduled task isn't a cron toggle — it's a recurring agentic workflow: on a
 *  cadence Claude runs an ordered sequence of steps (each using a tool) and
 *  delivers the result somewhere. The first six fields are the original shape the
 *  Projects "Scheduled" panel still reads; everything below is the workflow. */
export interface ScheduledTask {
  id: string
  name: string
  cadence: string
  next: string
  enabled: boolean
  lastStatus: 'ok' | 'failed' | 'pending'
  /** Plain-language one-liner for the row + detail header sub-line. */
  subtitle: string
  /** The human "when" sentence for the workflow's WHEN band (no cron syntax). */
  trigger: string
  /** The verbatim instruction every run executes against. */
  prompt: string
  /** The ordered workflow — the detail page's centerpiece. */
  steps: WorkflowStep[]
  /** The terminal: where each run's output goes. */
  delivery: ScheduledDelivery
  /** Recent executions, newest first. */
  runs: ScheduledRun[]
  /** Model + effort the task runs on, e.g. "Claude Opus 4.8 · High". */
  model: string
  timezone?: string
  /** Faint "Started … · N runs" stamp for the Schedule panel. */
  startedLabel?: string
  /** Home project, if any — cross-links into the Projects section. */
  projectId?: string
}

/** The tools the mock workflows reference. Kept in one place so a tool reads the
 *  same (icon, tone, auth state) everywhere it appears. Linear is `needsAuth` to
 *  match its expired state in the Contexts page — it's why a standup run fails. */
const TOOL = {
  web: { id: 'web', label: 'Web search', tone: 'web' },
  claude: { id: 'claude', label: 'Claude', tone: 'claude' },
  session: { id: 'session', label: 'New session', tone: 'workspace' },
  linear: { id: 'linear', label: 'Linear', tone: 'connector', needsAuth: true },
  slack: { id: 'slack', label: 'Slack', tone: 'connector' },
  github: { id: 'github', label: 'GitHub', tone: 'connector' },
  gmail: { id: 'gmail', label: 'Gmail', tone: 'connector' },
  gdrive: { id: 'gdrive', label: 'Google Drive', tone: 'connector' },
  notion: { id: 'notion', label: 'Notion', tone: 'connector' },
  amplitude: { id: 'amplitude', label: 'Amplitude', tone: 'connector' },
  sentry: { id: 'sentry', label: 'Sentry', tone: 'connector' },
} satisfies Record<string, StepTool>

export const SCHEDULED_TASKS: ScheduledTask[] = [
  {
    id: 's-ai-news',
    name: 'Daily AI news briefing',
    cadence: 'Weekdays · 8:00 AM',
    next: 'Tomorrow, 8:00 AM',
    enabled: true,
    lastStatus: 'ok',
    subtitle: 'Every weekday at 8:00 AM · opens a new session',
    trigger: 'every weekday at 8:00 AM',
    prompt:
      'Each weekday morning, scan the top AI research and product news from the last 24 hours, keep only what touches our roadmap, and write a briefing I can read in two minutes — headline, why it matters, and a link.',
    steps: [
      { id: 'st1', action: 'Search the last 24h of AI research, model releases, and product news', tool: TOOL.web },
      { id: 'st2', action: 'Filter to what’s relevant to our roadmap and drop near-duplicate stories', tool: TOOL.claude },
      { id: 'st3', action: 'Write a two-minute briefing: headline, why it matters, source link', tool: TOOL.claude },
    ],
    delivery: { tool: TOOL.session, target: 'New session', note: 'A fresh briefing thread each morning' },
    model: 'Claude Opus 4.8 · High',
    timezone: 'America/Los_Angeles',
    startedLabel: 'Started Feb 2026 · 96 runs',
    runs: [
      { id: 'r1', status: 'ok', when: 'Today, 8:00 AM', absolute: '6h ago', duration: '18s', reachedStep: 3, summary: 'Briefed 6 stories into a new session' },
      { id: 'r2', status: 'ok', when: 'Yesterday, 8:00 AM', absolute: 'Jun 18', duration: '21s', reachedStep: 3, summary: 'Briefed 5 stories into a new session' },
      { id: 'r3', status: 'ok', when: 'Wed, 8:00 AM', absolute: 'Jun 17', duration: '17s', reachedStep: 3, summary: 'Briefed 7 stories into a new session' },
      { id: 'r4', status: 'ok', when: 'Tue, 8:00 AM', absolute: 'Jun 16', duration: '19s', reachedStep: 3, summary: 'Briefed 4 stories into a new session' },
    ],
  },
  {
    id: 's-standup',
    name: 'Standup digest from Linear',
    cadence: 'Weekdays · 9:30 AM',
    next: 'Tomorrow, 9:30 AM',
    enabled: true,
    lastStatus: 'failed',
    subtitle: 'Every weekday at 9:30 AM · posts to #eng-standup',
    trigger: 'every weekday at 9:30 AM',
    prompt:
      'Each weekday before 9:30, pull what shipped and what’s blocked from Linear, group it by team into a tight standup digest, and post it to #eng-standup.',
    steps: [
      { id: 'st1', action: 'Pull issues moved to Done or Blocked since yesterday', tool: TOOL.linear },
      { id: 'st2', action: 'Group by team and write a scannable standup digest', tool: TOOL.claude },
      { id: 'st3', action: 'Post the digest to #eng-standup', tool: TOOL.slack },
    ],
    delivery: { tool: TOOL.slack, target: '#eng-standup', note: 'A fresh digest each morning' },
    model: 'Claude Opus 4.8 · High',
    timezone: 'America/Los_Angeles',
    startedLabel: 'Started Mar 2026 · 71 runs',
    projectId: 'p-infra',
    runs: [
      { id: 'r1', status: 'failed', when: 'Today, 9:30 AM', absolute: '4h ago', duration: '3s', reachedStep: 0, summary: 'Stopped at step 1 — Linear auth expired' },
      { id: 'r2', status: 'ok', when: 'Yesterday, 9:30 AM', absolute: 'Jun 18', duration: '12s', reachedStep: 3, summary: 'Posted a 9-item digest to #eng-standup' },
      { id: 'r3', status: 'ok', when: 'Wed, 9:30 AM', absolute: 'Jun 17', duration: '11s', reachedStep: 3, summary: 'Posted a 7-item digest to #eng-standup' },
      { id: 'r4', status: 'ok', when: 'Tue, 9:30 AM', absolute: 'Jun 16', duration: '13s', reachedStep: 3, summary: 'Posted a 12-item digest to #eng-standup' },
    ],
  },
  {
    id: 's-issue-triage',
    name: 'Triage new GitHub issues',
    cadence: 'Every 2 hours',
    next: 'in 1h 22m',
    enabled: true,
    lastStatus: 'ok',
    subtitle: 'Every 2 hours · triages web-app issues',
    trigger: 'every 2 hours, 8 AM–6 PM',
    prompt:
      'Every couple of hours, look at new unlabeled issues on patrick-yingxi-pan/web-app, apply the right labels, flag anything urgent, and draft a first reply for me to review.',
    steps: [
      { id: 'st1', action: 'Fetch new unlabeled issues on web-app', tool: TOOL.github },
      { id: 'st2', action: 'Classify each issue, choose labels, and flag likely-urgent ones', tool: TOOL.claude },
      { id: 'st3', action: 'Apply labels and leave draft replies as comments', tool: TOOL.github },
    ],
    delivery: { tool: TOOL.github, target: 'web-app · issues', note: 'Labels applied, replies left as drafts' },
    model: 'Claude Opus 4.8 · High',
    timezone: 'America/Los_Angeles',
    startedLabel: 'Started May 2026 · 218 runs',
    projectId: 'p-insights',
    runs: [
      { id: 'r1', status: 'ok', when: 'Today, 2:00 PM', absolute: '38m ago', duration: '42s', reachedStep: 3, summary: 'Labeled 11 issues, drafted 6 replies' },
      { id: 'r2', status: 'ok', when: 'Today, 12:00 PM', absolute: '2h ago', duration: '38s', reachedStep: 3, summary: 'Labeled 7 issues, drafted 3 replies' },
      { id: 'r3', status: 'ok', when: 'Today, 10:00 AM', absolute: '4h ago', duration: '29s', reachedStep: 3, summary: 'Labeled 4 issues, drafted 2 replies' },
      { id: 'r4', status: 'ok', when: 'Today, 8:00 AM', absolute: '6h ago', duration: '40s', reachedStep: 3, summary: 'Labeled 9 issues, drafted 5 replies' },
    ],
  },
  {
    id: 's-support',
    name: 'Support ticket themes',
    cadence: 'Daily · 6:00 PM',
    next: 'Today, 6:00 PM',
    enabled: true,
    lastStatus: 'ok',
    subtitle: 'Every day at 6:00 PM · posts to #support-digest',
    trigger: 'every day at 6:00 PM',
    prompt:
      'At the end of each day, read the day’s support tickets, cluster them into themes, count each, and post the top five themes with example tickets to #support-digest.',
    steps: [
      { id: 'st1', action: 'Pull today’s tickets from the Support database', tool: TOOL.notion },
      { id: 'st2', action: 'Cluster tickets into themes and count each', tool: TOOL.claude },
      { id: 'st3', action: 'Write the top five themes with example tickets', tool: TOOL.claude },
      { id: 'st4', action: 'Post the summary to #support-digest', tool: TOOL.slack },
    ],
    delivery: { tool: TOOL.slack, target: '#support-digest' },
    model: 'Claude Sonnet 4.6 · Medium',
    timezone: 'America/Los_Angeles',
    startedLabel: 'Started Apr 2026 · 73 runs',
    runs: [
      { id: 'r1', status: 'ok', when: 'Yesterday, 6:00 PM', absolute: 'Jun 18', duration: '26s', reachedStep: 4, summary: '5 themes from 38 tickets → #support-digest' },
      { id: 'r2', status: 'ok', when: 'Wed, 6:00 PM', absolute: 'Jun 17', duration: '24s', reachedStep: 4, summary: '5 themes from 31 tickets → #support-digest' },
      { id: 'r3', status: 'failed', when: 'Tue, 6:00 PM', absolute: 'Jun 16', duration: '9s', reachedStep: 0, summary: 'Stopped at step 1 — Notion rate limit' },
      { id: 'r4', status: 'ok', when: 'Mon, 6:00 PM', absolute: 'Jun 15', duration: '27s', reachedStep: 4, summary: '4 themes from 22 tickets → #support-digest' },
    ],
  },
  {
    id: 's-oncall',
    name: 'On-call error watch',
    cadence: 'Every 30 min',
    next: 'in 18 min',
    enabled: true,
    lastStatus: 'ok',
    subtitle: 'Every 30 minutes · emails on-call on a spike',
    trigger: 'every 30 minutes',
    prompt:
      'Every half hour, check the production error rate in Sentry. If it’s spiking above baseline, summarize the top new errors and email the on-call engineer; otherwise stay quiet.',
    steps: [
      { id: 'st1', action: 'Check the production error rate against the 7-day baseline', tool: TOOL.sentry },
      { id: 'st2', action: 'If spiking, summarize the top new error groups', tool: TOOL.claude },
      { id: 'st3', action: 'Email the on-call engineer — only when spiking', tool: TOOL.gmail },
    ],
    delivery: { tool: TOOL.gmail, target: 'on-call@acme.com', note: 'Only emails when there’s a spike' },
    model: 'Claude Haiku 4.5 · Low',
    timezone: 'America/Los_Angeles',
    startedLabel: 'Started May 2026 · 1,440 runs',
    projectId: 'p-infra',
    runs: [
      { id: 'r1', status: 'skipped', when: 'Today, 1:30 PM', absolute: '12m ago', duration: '4s', reachedStep: 1, summary: 'No spike — stayed quiet' },
      { id: 'r2', status: 'skipped', when: 'Today, 1:00 PM', absolute: '42m ago', duration: '4s', reachedStep: 1, summary: 'No spike — stayed quiet' },
      { id: 'r3', status: 'ok', when: 'Today, 12:30 PM', absolute: '1h ago', duration: '16s', reachedStep: 3, summary: 'Spike caught — emailed on-call (auth errors +180%)' },
      { id: 'r4', status: 'skipped', when: 'Today, 12:00 PM', absolute: '2h ago', duration: '3s', reachedStep: 1, summary: 'No spike — stayed quiet' },
    ],
  },
  {
    id: 's-metrics',
    name: 'Weekly metrics roll-up',
    cadence: 'Mondays · 7:00 AM',
    next: 'Mon, 7:00 AM',
    enabled: false,
    lastStatus: 'pending',
    subtitle: 'Every Monday at 7:00 AM · saves metrics-rollup.md',
    trigger: 'every Monday at 7:00 AM',
    prompt:
      'Every Monday at 7, pull last week’s activation, retention, and weekly-active-teams from Amplitude, compare against the prior week, and write a one-screen roll-up with the three numbers that moved most.',
    steps: [
      { id: 'st1', action: 'Pull activation, retention, and weekly-active-teams for last week', tool: TOOL.amplitude },
      { id: 'st2', action: 'Compare against the prior week and surface the biggest movers', tool: TOOL.claude },
      { id: 'st3', action: 'Write a one-screen roll-up — the three numbers that moved most', tool: TOOL.claude },
      { id: 'st4', action: 'Save it as metrics-rollup.md in the Growth folder', tool: TOOL.gdrive },
    ],
    delivery: { tool: TOOL.gdrive, target: 'metrics-rollup.md', note: 'Overwrites last week’s file' },
    model: 'Claude Opus 4.8 · High',
    timezone: 'America/Los_Angeles',
    startedLabel: 'Paused · 14 runs',
    projectId: 'p-growth',
    runs: [
      { id: 'r1', status: 'ok', when: 'Mon, 7:00 AM', absolute: 'Jun 16', duration: '34s', reachedStep: 4, summary: 'Saved metrics-rollup.md · WAT +4.2%' },
      { id: 'r2', status: 'ok', when: 'Mon, 7:00 AM', absolute: 'Jun 9', duration: '31s', reachedStep: 4, summary: 'Saved metrics-rollup.md · WAT +1.1%' },
      { id: 'r3', status: 'skipped', when: 'Mon, 7:00 AM', absolute: 'Jun 2', duration: '—', reachedStep: 0, summary: 'Skipped — paused for the holiday' },
    ],
  },
]

/** A starter a user can spin up from "New schedule" — a fully-formed workflow
 *  (steps, cadence, delivery, prompt) that's seeded into local state as a new,
 *  paused task and opened straight into its detail. `preview` is the plain-language
 *  pipeline shape shown in the popover row. */
export interface ScheduleTemplate {
  category: string
  name: string
  preview: string
  /** Everything but the id — the id is minted when the user adds it. */
  seed: Omit<ScheduledTask, 'id'>
}

export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  {
    category: 'Start from scratch',
    name: 'Blank recipe',
    preview: 'One step · pick a cadence',
    seed: {
      name: 'New scheduled task',
      cadence: 'Not scheduled',
      next: '—',
      enabled: false,
      lastStatus: 'pending',
      subtitle: 'New workflow · not scheduled yet',
      trigger: 'no schedule yet',
      prompt: 'Describe what this task should do each time it runs.',
      steps: [{ id: 'st1', action: 'Add the first step', tool: TOOL.claude }],
      delivery: { tool: TOOL.session, target: 'New session' },
      model: 'Claude Opus 4.8 · High',
      timezone: 'America/Los_Angeles',
      startedLabel: 'Draft · not run yet',
      runs: [],
    },
  },
  {
    category: 'Briefings',
    name: 'Daily news briefing',
    preview: 'Web → Claude → New session · weekdays 8:00',
    seed: {
      name: 'Daily news briefing',
      cadence: 'Weekdays · 8:00 AM',
      next: 'Tomorrow, 8:00 AM',
      enabled: false,
      lastStatus: 'pending',
      subtitle: 'Every weekday at 8:00 AM · opens a new session',
      trigger: 'every weekday at 8:00 AM',
      prompt: 'Each weekday morning, scan the news that matters to us and write a two-minute briefing.',
      steps: [
        { id: 'st1', action: 'Search the last 24h of relevant news', tool: TOOL.web },
        { id: 'st2', action: 'Filter and dedupe to what matters', tool: TOOL.claude },
        { id: 'st3', action: 'Write a two-minute briefing', tool: TOOL.claude },
      ],
      delivery: { tool: TOOL.session, target: 'New session' },
      model: 'Claude Opus 4.8 · High',
      timezone: 'America/Los_Angeles',
      startedLabel: 'Draft · not run yet',
      runs: [],
    },
  },
  {
    category: 'Briefings',
    name: 'Standup digest',
    preview: 'Linear → Claude → Slack · weekdays 9:30',
    seed: {
      name: 'Standup digest',
      cadence: 'Weekdays · 9:30 AM',
      next: 'Tomorrow, 9:30 AM',
      enabled: false,
      lastStatus: 'pending',
      subtitle: 'Every weekday at 9:30 AM · posts to a channel',
      trigger: 'every weekday at 9:30 AM',
      prompt: 'Pull what shipped and what’s blocked, group by team, and post a standup digest.',
      steps: [
        { id: 'st1', action: 'Pull issues moved since yesterday', tool: TOOL.linear },
        { id: 'st2', action: 'Group by team into a digest', tool: TOOL.claude },
        { id: 'st3', action: 'Post the digest to a channel', tool: TOOL.slack },
      ],
      delivery: { tool: TOOL.slack, target: '#eng-standup' },
      model: 'Claude Opus 4.8 · High',
      timezone: 'America/Los_Angeles',
      startedLabel: 'Draft · not run yet',
      runs: [],
    },
  },
  {
    category: 'Roll-ups',
    name: 'Weekly metrics roll-up',
    preview: 'Amplitude → Claude → Drive · Mondays 7:00',
    seed: {
      name: 'Weekly metrics roll-up',
      cadence: 'Mondays · 7:00 AM',
      next: 'Mon, 7:00 AM',
      enabled: false,
      lastStatus: 'pending',
      subtitle: 'Every Monday at 7:00 AM · saves a roll-up',
      trigger: 'every Monday at 7:00 AM',
      prompt: 'Pull last week’s metrics, compare to the prior week, and write a one-screen roll-up.',
      steps: [
        { id: 'st1', action: 'Pull last week’s metrics', tool: TOOL.amplitude },
        { id: 'st2', action: 'Compare to the prior week', tool: TOOL.claude },
        { id: 'st3', action: 'Write a one-screen roll-up', tool: TOOL.claude },
        { id: 'st4', action: 'Save it as a doc', tool: TOOL.gdrive },
      ],
      delivery: { tool: TOOL.gdrive, target: 'metrics-rollup.md' },
      model: 'Claude Opus 4.8 · High',
      timezone: 'America/Los_Angeles',
      startedLabel: 'Draft · not run yet',
      runs: [],
    },
  },
  {
    category: 'Watchers',
    name: 'Repo issue triage',
    preview: 'GitHub → Claude → GitHub · every 2 hours',
    seed: {
      name: 'Repo issue triage',
      cadence: 'Every 2 hours',
      next: 'in 2 hours',
      enabled: false,
      lastStatus: 'pending',
      subtitle: 'Every 2 hours · triages new issues',
      trigger: 'every 2 hours, 9 AM–6 PM',
      prompt: 'Triage new unlabeled issues: apply labels, flag urgent ones, and draft replies.',
      steps: [
        { id: 'st1', action: 'Fetch new unlabeled issues', tool: TOOL.github },
        { id: 'st2', action: 'Classify and choose labels', tool: TOOL.claude },
        { id: 'st3', action: 'Apply labels and draft replies', tool: TOOL.github },
      ],
      delivery: { tool: TOOL.github, target: 'repo · issues' },
      model: 'Claude Opus 4.8 · High',
      timezone: 'America/Los_Angeles',
      startedLabel: 'Draft · not run yet',
      runs: [],
    },
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
    excerpt: 'SLOs and 30-day error-budget burn across auth, api, ingest, and web — ingest is over budget.',
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
