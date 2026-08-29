import type { ArtifactKind } from '../../contract/entities.ts'

/** Types are the contract's; this file only holds the seed *data* that fills
 *  them. We import them so the consts below type-check, and re-export them so
 *  existing importers of `../data/cowork` keep resolving (the src shim does
 *  `export *`). */
import type {
  ProjectSchedule,
  ProjectContext,
  Project,
  StepToolTone,
  StepTool,
  WorkflowStep,
  ScheduledDelivery,
  ScheduledRun,
  ScheduledTask,
  ScheduleTemplate,
  ArtifactItem,
  DispatchRun,
} from '../../contract/cowork.ts'
export type {
  ProjectSchedule,
  ProjectContext,
  Project,
  StepToolTone,
  StepTool,
  WorkflowStep,
  ScheduledDelivery,
  ScheduledRun,
  ScheduledTask,
  ScheduleTemplate,
  ArtifactItem,
  DispatchRun,
} from '../../contract/cowork.ts'

/** The backend's seed data behind the sidebar's cross-cutting tools (Projects,
 *  Artifacts, Scheduled, Dispatch). In the real product this comes from a
 *  database; here the mock server holds it in memory and serves it over the API.
 *  The entity types are the shared wire shapes in contract/cowork.ts. */

/** Seed timestamps are authored as an AGE (how long before now) and resolved to
 *  an absolute epoch-ms at module load, so the mock always looks freshly aged on
 *  boot and the UI's live relative-time labels (src/lib/relativeTime) advance
 *  from there — instead of a frozen "4 hours ago" string that's wrong by tomorrow.
 *  `BOOT` is captured once so every seed stamp shares one consistent "now". */
const BOOT = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/** An absolute epoch-ms timestamp `age` ms before module load. */
const ago = (age: number) => BOOT - age

export const PROJECTS: Project[] = [
  {
    id: 'p-insights',
    // D11: one seeded *guarded* Project (docs/agent-commons.md) so the guardian path
    // is exercised end to end — its non-monotonic effects serialize at this key.
    guardianId: 'p-insights',
    name: 'Insights dashboard',
    description: 'The self-serve Insights dashboard — launch plan, assets, and the feature-flagged rollout.',
    updatedAt: ago(0),
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
    sessionIds: ['insights-empty-states', 'dashboard-perf'],
  },
  {
    id: 'p-growth',
    tenantId: 'tenant-growthworks', // Maya — growth & experimentation
    name: 'Growth experiments',
    description: 'Activation A/Bs, the onboarding funnel, churn work, and the weekly growth readout.',
    updatedAt: ago(2 * HOUR),
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
    tenantId: 'tenant-northlight', // Noor — brand & marketing
    name: 'Brand refresh',
    description: 'The 2026 brand refresh — voice guide, the new logo lockups, and a marketing-site pass.',
    updatedAt: ago(28 * HOUR),
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
    updatedAt: ago(3 * DAY),
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
  {
    id: 'p-beta',
    tenantId: 'tenant-beta', // Grace — platform & reliability
    name: 'Deploy pipeline',
    description: 'Beta Platform’s deploy pipeline — canary stage, rollback gates, and incident follow-ups.',
    updatedAt: ago(3 * HOUR),
    instructions:
      'Every pipeline change ships behind a dry run. Canary gates are defined in code, never hand-edited in the console. A postmortem lands within 48 hours of any SEV — blameless, five whys, one owner per action item.',
    scheduled: [{ name: 'On-call error watch', cadence: 'Every 30 min', enabled: true }],
    contexts: [
      { kind: 'repo', label: 'beta-platform/deploy-tools', meta: 'main' },
      { kind: 'connector', label: 'Sentry', meta: 'edge · prod' },
      { kind: 'connector', label: 'PagerDuty', meta: 'Platform rotation' },
    ],
    sessionIds: ['deploy-canary', 'incident-cache'],
  },
  {
    id: 'p-support',
    tenantId: 'tenant-harbor', // Omar — support operations
    name: 'Support operations',
    description: 'Harbor Support’s queue — ticket themes, reply macros, and escalation follow-ups.',
    updatedAt: ago(4 * HOUR),
    instructions:
      'Answer the customer’s actual question in the first sentence. Escalate anything reproducible as a bug with steps + workspace id. Credits follow the published policy — never improvise one in a reply.',
    scheduled: [{ name: 'Support ticket themes', cadence: 'Daily · 6:00 PM', enabled: true }],
    contexts: [
      { kind: 'connector', label: 'Notion', meta: 'Support database' },
      { kind: 'connector', label: 'Slack', meta: '#support-digest' },
      { kind: 'doc', label: 'reply-macros.md', meta: '8 macros' },
    ],
    sessionIds: ['ticket-themes', 'macro-refresh'],
  },
  {
    id: 'p-research',
    tenantId: 'tenant-reislab', // Rei — research & learning
    name: 'Reading log',
    description: 'Papers, notes, and learning plans — a personal research trail.',
    updatedAt: ago(7 * HOUR),
    instructions:
      'Notes over summaries: what surprised me, what I’d test, and the one figure worth keeping. Link the arXiv id. If a claim matters, find the ablation that supports it before citing it.',
    scheduled: [{ name: 'Daily AI news briefing', cadence: 'Weekdays · 8:00 AM', enabled: true }],
    contexts: [
      { kind: 'folder', label: '~/papers', meta: '18 files' },
      { kind: 'connector', label: 'Notion', meta: 'Reading log' },
    ],
    sessionIds: ['paper-notes'],
  },
]

/** A session's home project, if any. Sessions live in a single project (or
 *  none); we derive the back-link from `sessionIds` so there's one source of
 *  truth and no `projectId` on the session to keep in sync. Returns the first
 *  match, which — under the single-home rule — is the only one. */
export function projectForSession(sessionId: string): Project | undefined {
  return PROJECTS.find((p) => p.sessionIds.includes(sessionId))
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
    tenantId: 'tenant-reislab', // Rei — research & learning
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
    startedLabel: 'Started Feb 2026',
    runs: [
      {
        id: 'r1', status: 'ok', duration: '18s', reachedStep: 3, at: ago(360 * MIN),
        summary: 'Briefed 6 stories into a new session',
        detail:
          'Lead — Anthropic’s export-control standoff drags on: Fable 5 / Mythos 5 still offline globally after the Jun 12 Commerce order.\n• OpenAI’s IPO filing + Astral acquisition remain the #2 thread.\n• Google pushes Gemini 3.5 Flash / Omni; 3.5 Pro still delayed.\n• Nvidia’s Vera Rubin + RTX Spark anchor the hardware roundup.\n• OpenAI expands ChatGPT health features (rare-disease triage).\n• Reuters: chatbot news use up to 10% weekly, ~4% click through.\nSix items, newest first.',
      },
      {
        id: 'r2', status: 'ok', duration: '21s', reachedStep: 3, at: ago(1800 * MIN),
        summary: 'Briefed 5 stories into a new session',
        detail:
          'Lead — OpenAI’s IPO filing + Astral acquisition dominate the cycle.\n• Google’s Gemini 3.5 Pro launch slips a week; Flash / Omni stay on track.\n• Anthropic export standoff unchanged — Fable 5 / Mythos 5 still dark abroad.\n• Nvidia opens RTX Spark pre-orders.\n• A new eval paper claims agentic-coding parity across the top three labs.',
      },
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
    startedLabel: 'Started Mar 2026',
    projectId: 'p-infra',
    runs: [
      {
        id: 'r1', status: 'failed', duration: '3s', reachedStep: 0, at: ago(240 * MIN),
        summary: 'Stopped at step 1 — Linear auth expired',
        detail:
          'The Linear token came back expired (401), so I couldn’t read the board — and posted nothing to #eng-standup rather than send a half-built digest.\nFix: re-auth the Linear connector from Contexts, then Run now.',
      },
      {
        id: 'r2', status: 'ok', duration: '12s', reachedStep: 3, at: ago(1740 * MIN),
        summary: 'Posted a 9-item digest to #eng-standup',
        detail:
          'Posted to #eng-standup — 9 items across 3 teams:\n• Platform — 4 shipped (auth refactor, rate-limit RFC merged); 1 blocked on review.\n• Web — 3 shipped (empty states, homepage hero).\n• Data — 1 shipped (cohort export).',
      },
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
    startedLabel: 'Started May 2026',
    projectId: 'p-insights',
    runs: [
      {
        id: 'r1', status: 'ok', duration: '42s', reachedStep: 3, at: ago(38 * MIN),
        summary: 'Labeled 11 issues, drafted 6 replies',
        detail:
          'Triaged 11 new issues on web-app:\n• 4 → bug, 3 → enhancement, 2 → docs, 2 → question.\n• Flagged 2 likely-urgent: a login 500 and a data-export timeout.\nDrafted first replies on 6 and left them as comments for your review.',
      },
      {
        id: 'r2', status: 'ok', duration: '38s', reachedStep: 3, at: ago(120 * MIN),
        summary: 'Labeled 7 issues, drafted 3 replies',
        detail:
          'Triaged 7 issues:\n• 3 → bug, 2 → enhancement, 2 → question.\n• None urgent this batch.\nDrafted 3 replies (the reproducible bugs).',
      },
    ],
  },
  {
    id: 's-support',
    tenantId: 'tenant-harbor', // Omar — support operations
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
    startedLabel: 'Started Apr 2026',
    projectId: 'p-support',
    runs: [
      {
        id: 'r1', status: 'ok', duration: '26s', reachedStep: 4, at: ago(1200 * MIN),
        summary: '5 themes from 38 tickets → #support-digest',
        detail:
          'Top 5 themes from 38 tickets → #support-digest:\n1. CSV import failures — 11\n2. Seat-billing confusion — 8\n3. Mobile login loops — 7\n4. Export timeouts — 7\n5. SSO setup questions — 5',
      },
      {
        id: 'r2', status: 'failed', duration: '9s', reachedStep: 0, at: ago(2640 * MIN),
        summary: 'Stopped at step 1 — Notion rate limit',
        detail:
          'Notion’s API rate-limited the ticket pull (429, Retry-After 60s), so I couldn’t read the full set — and didn’t post a partial digest.\nIt usually clears within the minute; Run now to retry.',
      },
    ],
  },
  {
    id: 's-oncall',
    tenantId: 'tenant-beta', // Grace — platform & reliability
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
    delivery: { tool: TOOL.gmail, target: 'oncall@beta-platform.example', note: 'Only emails when there’s a spike' },
    model: 'Claude Haiku 4.5 · Low',
    timezone: 'America/Los_Angeles',
    startedLabel: 'Started May 2026',
    projectId: 'p-beta',
    runs: [
      {
        id: 'r1', status: 'skipped', duration: '4s', reachedStep: 1, at: ago(12 * MIN),
        summary: 'No spike — stayed quiet',
        detail: 'Error rate 0.4%/min, inside the 7-day baseline band. No spike, so I sent no email.',
      },
      {
        id: 'r2', status: 'ok', duration: '16s', reachedStep: 3, at: ago(60 * MIN),
        summary: 'Spike caught — emailed on-call (cache errors +160%)',
        detail:
          'Origin errors spiked +160% over baseline — the cache-stampede pattern again (hot key expiry at the top of the hour). I summarized the top 3 new Sentry groups and emailed oncall@beta-platform.example.',
      },
    ],
  },
  {
    id: 's-metrics',
    tenantId: 'tenant-growthworks', // Maya — growth & experimentation
    name: 'Weekly metrics roll-up',
    cadence: 'Mondays · 7:00 AM',
    next: 'Mon, 7:00 AM',
    enabled: true,
    lastStatus: 'ok',
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
    startedLabel: 'Started Apr 2026',
    projectId: 'p-growth',
    runs: [
      {
        id: 'r1', status: 'ok', duration: '34s', reachedStep: 4, at: ago(7200 * MIN),
        summary: 'Saved metrics-rollup.md · WAT +4.2%',
        detail:
          'Saved metrics-rollup.md. Biggest movers vs the prior week:\n• Weekly-active-teams +4.2%\n• Activation +1.8%\n• Day-7 retention flat (−0.1%)\nLead number: WAT, on the back of the onboarding-B rollout.',
      },
      {
        id: 'r2', status: 'ok', duration: '31s', reachedStep: 4, at: ago(17280 * MIN),
        summary: 'Saved metrics-rollup.md · WAT +1.1%',
        detail:
          'Saved metrics-rollup.md. Movers vs the prior week:\n• Weekly-active-teams +1.1%\n• Activation +0.4%\n• Retention +0.3%\nA quieter week — no single number moved much.',
      },
    ],
  },
  {
    id: 's-site-copy',
    tenantId: 'tenant-northlight', // Noor — brand & marketing
    name: 'Weekly site-copy review',
    cadence: 'Fridays · 3:00 PM',
    next: 'Fri, 3:00 PM',
    enabled: true,
    lastStatus: 'ok',
    subtitle: 'Every Friday at 3:00 PM · saves copy-review.md',
    trigger: 'every Friday at 3:00 PM',
    prompt:
      'Every Friday afternoon, crawl the marketing site, flag copy that drifts from the brand voice guide (hype words, exclamation marks, retired logotype mentions), and save a short review with suggested rewrites.',
    steps: [
      { id: 'st1', action: 'Crawl the marketing site’s public pages', tool: TOOL.web },
      { id: 'st2', action: 'Flag copy that drifts from the brand voice guide', tool: TOOL.claude },
      { id: 'st3', action: 'Save copy-review.md with suggested rewrites', tool: TOOL.gdrive },
    ],
    delivery: { tool: TOOL.gdrive, target: 'copy-review.md', note: 'Overwrites last week’s review' },
    model: 'Claude Sonnet 4.6 · Medium',
    timezone: 'America/Los_Angeles',
    startedLabel: 'Started Jun 2026',
    projectId: 'p-brand',
    runs: [
      {
        id: 'r1', status: 'ok', duration: '48s', reachedStep: 3, at: ago(2880 * MIN),
        summary: '6 drift flags across 4 pages → copy-review.md',
        detail:
          'Saved copy-review.md — 6 flags across 4 pages:\n• Pricing page: two hype words (“revolutionary”, “blazing”).\n• Careers page: exclamation marks in three headings.\n• Old logotype still referenced in the press kit footer.\nEach flag comes with a voice-guide-conformant rewrite.',
      },
      {
        id: 'r2', status: 'ok', duration: '51s', reachedStep: 3, at: ago(12960 * MIN),
        summary: '2 drift flags → copy-review.md',
        detail: 'A clean week — only 2 flags (both on the new integrations page). Saved copy-review.md with rewrites.',
      },
    ],
  },
]

export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  {
    category: 'Start from scratch',
    name: 'Blank recipe',
    preview: 'One step · pick a cadence',
    seed: {
      name: 'New scheduled task',
      cadence: 'Daily · 9:00 AM',
      next: 'Tomorrow, 9:00 AM',
      enabled: false,
      lastStatus: 'pending',
      subtitle: 'New workflow · paused',
      trigger: 'every day at 9:00 AM',
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
    editedAt: ago(4 * HOUR),
  },
  {
    id: 'a2',
    name: 'insights-spec.md',
    kind: 'doc',
    meta: 'functional spec',
    source: 'Insights dashboard launch',
    projectId: 'p-insights',
    excerpt: 'Filters, saved views, sharing, and the empty/error states.',
    editedAt: ago(28 * HOUR),
  },
  {
    id: 'a3',
    name: 'launch-email.md',
    kind: 'email',
    meta: 'to: workspace admins',
    source: 'Insights dashboard launch',
    projectId: 'p-insights',
    excerpt: 'Insights is live behind a flag — here’s how to switch it on.',
    editedAt: ago(4 * HOUR),
  },
  {
    id: 'a4',
    name: 'insights-hero.png',
    kind: 'image',
    meta: '1600×900',
    source: 'Insights dashboard launch',
    projectId: 'p-insights',
    excerpt: 'Marketing hero — the dashboard with the cohort chart in front.',
    editedAt: ago(28 * HOUR),
  },
  {
    id: 'a5',
    name: 'query-perf.sheet',
    kind: 'sheet',
    meta: '12 widgets',
    source: 'Dashboard query performance',
    projectId: 'p-insights',
    excerpt: 'p95 widget latency before/after the composite index (1.8s → 240ms).',
    editedAt: ago(2 * DAY),
  },
  // ── Growth experiments ───────────────────────────────────────────────────
  {
    id: 'a6',
    tenantId: 'tenant-growthworks',
    name: 'onboarding-ab-readout.md',
    kind: 'doc',
    meta: 'summary',
    source: 'Onboarding A/B readout',
    projectId: 'p-growth',
    excerpt: 'Variant B lifted activation +6.2% (95% CI +2.1–10.3). Ship it.',
    editedAt: ago(2 * HOUR),
  },
  {
    id: 'a7',
    tenantId: 'tenant-growthworks',
    name: 'activation-funnel.png',
    kind: 'image',
    meta: '1200×700',
    source: 'Onboarding A/B readout',
    projectId: 'p-growth',
    excerpt: 'Signup → first-query → invite funnel, control vs. variant B.',
    editedAt: ago(2 * HOUR),
  },
  {
    id: 'a8',
    tenantId: 'tenant-growthworks',
    name: 'june-churn-cohorts.sheet',
    kind: 'sheet',
    meta: '2,481 rows',
    source: 'Churn analysis · June',
    projectId: 'p-growth',
    excerpt: 'Monthly cohorts with churn %, expansion, and contraction.',
    editedAt: ago(3 * DAY),
  },
  {
    id: 'a9',
    tenantId: 'tenant-growthworks',
    name: 'churn-drivers.md',
    kind: 'doc',
    meta: 'summary',
    source: 'Churn analysis · June',
    projectId: 'p-growth',
    excerpt: 'Three drivers explain ~80% of June’s spike.',
    editedAt: ago(3 * DAY),
  },
  {
    id: 'a10',
    tenantId: 'tenant-growthworks',
    name: 'q3-board-deck.slides',
    kind: 'slide',
    meta: '14 slides',
    source: 'Q3 board deck',
    projectId: 'p-growth',
    excerpt: 'Opens on net retention, then expansion, then the roadmap ask.',
    editedAt: ago(28 * HOUR),
  },
  // ── Brand refresh ────────────────────────────────────────────────────────
  {
    id: 'a11',
    tenantId: 'tenant-northlight',
    name: 'brand-voice-guide.md',
    kind: 'doc',
    meta: 'guide',
    source: 'Brand voice guidelines',
    projectId: 'p-brand',
    excerpt: 'Warm, plain, confident — with do/don’t pairs and a banned-words list.',
    editedAt: ago(28 * HOUR),
  },
  {
    id: 'a12',
    tenantId: 'tenant-northlight',
    name: 'homepage-copy.md',
    kind: 'doc',
    meta: 'hero + 3 sections',
    source: 'Homepage rewrite',
    projectId: 'p-brand',
    excerpt: '“See what your product is actually doing” — hero, proof points, one CTA.',
    editedAt: ago(28 * HOUR),
  },
  {
    id: 'a13',
    tenantId: 'tenant-northlight',
    name: 'logo-lockups.png',
    kind: 'image',
    meta: '1600×900',
    source: 'Logo lockup feedback',
    projectId: 'p-brand',
    excerpt: 'The three wordmark lockups at display, body, and favicon sizes.',
    editedAt: ago(2 * DAY),
  },
  {
    id: 'a14',
    tenantId: 'tenant-northlight',
    name: 'color-tokens.sheet',
    kind: 'sheet',
    meta: '38 tokens',
    source: 'Brand voice guidelines',
    projectId: 'p-brand',
    excerpt: 'The 2026 palette mapped to semantic tokens (surface, ink, accent…).',
    editedAt: ago(3 * DAY),
  },
  {
    id: 'a15',
    tenantId: 'tenant-northlight',
    name: 'tone-dos-donts.md',
    kind: 'doc',
    meta: 'reference',
    source: 'Brand voice guidelines',
    projectId: 'p-brand',
    excerpt: 'Side-by-side do/don’t rewrites for support and marketing copy.',
    editedAt: ago(3 * DAY),
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
    editedAt: ago(3 * DAY),
  },
  {
    id: 'a17',
    name: 'rate-limit-rfc.md',
    kind: 'doc',
    meta: 'RFC · draft',
    source: 'Rate limiting RFC',
    projectId: 'p-infra',
    excerpt: 'Token-bucket per API key; 429 with Retry-After and budget headers.',
    editedAt: ago(4 * DAY),
  },
  {
    id: 'a18',
    name: 'refresh-session-notes.md',
    kind: 'doc',
    meta: 'notes',
    source: 'Refactor auth middleware',
    projectId: 'p-infra',
    excerpt: 'Collapsed two token-refresh paths into one `refreshSession()`.',
    editedAt: ago(3 * DAY),
  },
  {
    id: 'a19',
    name: 'auth-test-plan.md',
    kind: 'doc',
    meta: 'test plan',
    source: 'Refactor auth middleware',
    projectId: 'p-infra',
    excerpt: 'Cases for the unified refresh path: expiry, reuse, and revocation.',
    editedAt: ago(3 * DAY),
  },
  {
    id: 'a20',
    name: 'error-budget.sheet',
    kind: 'sheet',
    meta: '4 services',
    source: 'On-call runbook',
    projectId: 'p-infra',
    excerpt: 'SLOs and 30-day error-budget burn across auth, api, ingest, and web — ingest is over budget.',
    editedAt: ago(4 * DAY),
  },
  // ── Beta Platform (Grace) ──────────────────────────────────────────────────
  {
    id: 'a21',
    tenantId: 'tenant-beta',
    name: 'cache-stampede-postmortem.md',
    kind: 'doc',
    meta: 'postmortem · draft',
    source: 'Postmortem: cache stampede',
    projectId: 'p-beta',
    excerpt: 'Timeline, five whys, and the two fixes: TTL jitter and edge request coalescing.',
    editedAt: ago(26 * HOUR),
  },
  {
    id: 'a22',
    tenantId: 'tenant-beta',
    name: 'canary-gates.sheet',
    kind: 'sheet',
    meta: '3 gates',
    source: 'Canary deploy pipeline',
    projectId: 'p-beta',
    excerpt: 'The rollback gates per stage — error rate, p95 latency, and saturations — with thresholds.',
    editedAt: ago(3 * HOUR),
  },
  // ── Harbor Support (Omar) ──────────────────────────────────────────────────
  {
    id: 'a23',
    tenantId: 'tenant-harbor',
    name: 'ticket-themes.md',
    kind: 'doc',
    meta: '5 themes · wk 26',
    source: 'Weekly ticket themes',
    projectId: 'p-support',
    excerpt: 'CSV import failures lead again (61); the mobile login loop is escalated as a bug.',
    editedAt: ago(4 * HOUR),
  },
  {
    id: 'a24',
    tenantId: 'tenant-harbor',
    name: 'reply-macros.md',
    kind: 'doc',
    meta: '8 macros · by queue',
    source: 'Refresh reply macros',
    projectId: 'p-support',
    excerpt: 'The refreshed macro set — current pricing, import docs, and the two flagged for screenshots.',
    editedAt: ago(25 * HOUR),
  },
  // ── Rei’s Lab (Rei) ────────────────────────────────────────────────────────
  {
    id: 'a25',
    tenantId: 'tenant-reislab',
    name: 'linear-attention-notes.md',
    kind: 'doc',
    meta: 'notes · apdx C',
    source: 'Linear-attention paper notes',
    projectId: 'p-research',
    excerpt: 'Where the O(n) approximation bites: sharp local attention. The two ablations that matter.',
    editedAt: ago(7 * HOUR),
  },
  {
    id: 'a26',
    tenantId: 'tenant-reislab',
    name: 'rust-weekends.md',
    kind: 'doc',
    meta: '3-weekend plan',
    source: 'Rust in three weekends',
    projectId: 'p-research',
    excerpt: 'Ownership by porting scripts, then a real CLI, then async — the borrow checker is the course.',
    editedAt: ago(2 * DAY),
  },
]

// One-off runs, one per demo account (docs/demo-accounts.md) — the Dispatch
// tab has something themed to show whoever is signed in.
export const DISPATCH_RUNS: DispatchRun[] = [
  {
    id: 'd1',
    title: 'Triage new GitHub issues',
    status: 'running',
    startedAt: ago(4 * MIN),
    detail: 'Labeling 17 open issues and drafting first replies.',
  },
  {
    id: 'd1b',
    title: 'Draft release notes from merged PRs',
    status: 'done',
    startedAt: ago(6 * HOUR),
    detail: '21 PRs since v2.4 → grouped notes, breaking changes flagged.',
  },
  {
    id: 'd2',
    tenantId: 'tenant-harbor',
    title: 'Summarize yesterday’s support tickets',
    status: 'done',
    startedAt: ago(1 * HOUR),
    detail: '38 tickets → 5 themes, posted to #support-digest.',
  },
  {
    id: 'd3',
    tenantId: 'tenant-growthworks',
    title: 'Refresh competitor pricing table',
    status: 'failed',
    startedAt: ago(3 * HOUR),
    detail: 'A source page changed layout — needs a selector update.',
  },
  {
    id: 'd4',
    tenantId: 'tenant-northlight',
    title: 'Regenerate social share cards',
    status: 'done',
    startedAt: ago(2 * HOUR),
    detail: '12 cards re-rendered with the new wordmark.',
  },
  {
    id: 'd5',
    tenantId: 'tenant-beta',
    title: 'Rotate stale deploy keys',
    status: 'done',
    startedAt: ago(5 * HOUR),
    detail: '3 keys rotated; the CI secret updated in place.',
  },
  {
    id: 'd6',
    tenantId: 'tenant-reislab',
    title: 'Fetch this week’s arXiv batch',
    status: 'done',
    startedAt: ago(9 * HOUR),
    detail: '14 new papers matched the attention/efficiency filter → reading list.',
  },
]
