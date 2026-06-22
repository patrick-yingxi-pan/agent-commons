import type { Artifact, Connector, DiffLine, FileNode, Message } from '../types'

/** One beat of the guided demo: a user turn, Claude's reply, and whatever the
 *  reply reveals in the adaptive side panel. Playing these in order walks a
 *  single conversation from plain Chat → Cowork → Code, then Organize. */
export interface DemoStep {
  id: string
  /** Narrative shown in the caption bar while this step is on screen. */
  caption: string
  user: Message
  assistant: Message
  artifacts?: Artifact[]
  files?: FileNode[]
  diff?: DiffLine[]
  terminal?: string[]
  connectors?: Connector[]
  /** For an escalating beat (`assistant.escalate` set), config for the inline
   *  consent prompt shown before the escalation applies. A workspace beat lets
   *  the user pick a cowork root from `rootChoices` (first = suggested default);
   *  a repo beat asks to connect the service named in `connectors`. */
  approval?: { rootChoices: string[] }
}

export const DEMO_STEPS: DemoStep[] = [
  {
    id: 'step-chat',
    caption:
      'It opens as an ordinary chat — no mode to choose, no tab to commit to before you know where the work goes.',
    user: {
      id: 'u1',
      role: 'user',
      content: 'We ship the new Insights dashboard next week. Help me think through the launch.',
    },
    assistant: {
      id: 'a1',
      role: 'assistant',
      content:
        "Let's anchor on three things first:\n\n• **Audience** — workspace admins on Team & Enterprise.\n• **Value prop** — “See what your team actually does with Claude, in one view.”\n• **Channels** — in-app banner, changelog, a short email to admins.\n\nWant me to draft the announcement assets next?",
    },
  },
  {
    id: 'step-workspace',
    caption:
      'The same thread grows a workspace — drafts plus the folders it pulled in, grouped by source; resize or close it like any panel. In today’s app you’d stop, switch to the Cowork tab, and re-explain from scratch.',
    user: {
      id: 'u2',
      role: 'user',
      content:
        'Yes — turn that into a one-pager and a launch email, plus a hero image. Pull from our brand kit and the last launch’s assets so it stays on-brand.',
    },
    assistant: {
      id: 'a2',
      role: 'assistant',
      escalate: 'workspace',
      content:
        "Opening a workspace and pulling in `brand-kit/` and `launch-assets/` for reference. First pass is on the right, grouped by source — the one-pager reuses the value prop above, the email is written for admins, and the hero picks up the brand-kit palette.",
    },
    artifacts: [
      { id: 'art-onepager', name: 'insights-onepager.md', kind: 'doc', meta: 'draft · 1 page' },
      { id: 'art-email', name: 'launch-email.md', kind: 'email', meta: 'draft · to: admins' },
      { id: 'art-hero', name: 'insights-hero.png', kind: 'image', meta: '1600×900 · generated' },
      {
        id: 'art-voice-guide',
        name: 'voice-guide.md',
        kind: 'doc',
        meta: 'reference',
        source: { id: 'src-brand-kit', label: 'brand-kit/' },
      },
      {
        id: 'art-wordmark',
        name: 'wordmark-lockups.png',
        kind: 'image',
        meta: 'reference',
        source: { id: 'src-brand-kit', label: 'brand-kit/' },
      },
      {
        id: 'art-q1-email',
        name: 'q1-launch-email.md',
        kind: 'email',
        meta: 'reused',
        source: { id: 'src-launch-assets', label: 'launch-assets/' },
      },
    ],
    approval: {
      rootChoices: ['~/work/insights-dashboard-launch/', '~/projects/insights/', '~/Desktop/'],
    },
  },
  {
    id: 'step-repo',
    caption:
      'Now it becomes a coding session — branch, diff, terminal — without ever leaving the conversation. This is the Code tab, inline.',
    user: {
      id: 'u3',
      role: 'user',
      content: 'Now put it behind a feature flag and add the dashboard route in our web app.',
    },
    assistant: {
      id: 'a3',
      role: 'assistant',
      escalate: 'repo',
      content:
        "Connecting your repo and the GitHub connector. I branched `feat/insights-dashboard`, added the flag, and wired the route. Tests pass — diff’s on the right.",
    },
    connectors: [{ id: 'gh-mcp', label: 'GitHub', kind: 'github' }],
    files: [
      { path: 'web/src/routes/insights.tsx', status: 'added' },
      { path: 'web/src/lib/flags.ts', status: 'modified' },
      { path: 'web/src/nav/Sidebar.tsx', status: 'modified' },
    ],
    diff: [
      { kind: 'hunk', text: 'web/src/lib/flags.ts' },
      { kind: 'ctx', text: 'export const flags = {' },
      { kind: 'ctx', text: '  billingV2: true,' },
      { kind: 'add', text: '  insightsDashboard: true,' },
      { kind: 'ctx', text: '  exportCsv: true,' },
      { kind: 'ctx', text: '}' },
    ],
    terminal: [
      '$ git checkout -b feat/insights-dashboard',
      "Switched to a new branch 'feat/insights-dashboard'",
      '$ npm test -- insights',
      'PASS  web/src/routes/insights.test.tsx (3.1s)',
      'Tests: 7 passed, 7 total',
    ],
  },
  {
    id: 'step-wrap',
    caption:
      'One surface. One history. Chat → Cowork → Code becomes a single continuum the work flows through — not three tabs you copy context between.',
    user: { id: 'u4', role: 'user', content: 'Nice. Ship it.' },
    assistant: {
      id: 'a4',
      role: 'assistant',
      content:
        'Done — PR opened and the launch assets are saved in the workspace, all linked to this thread. The strategy, the docs, and the code now live in one place.',
    },
  },
  {
    id: 'step-organize',
    caption:
      'The last move: Claude proposes how to file what you just made — and you approve it, right here in the thread. One-off edits confirm each time; a recurring schedule is approved once, then runs unprompted.',
    user: { id: 'u5', role: 'user', content: 'Perfect. Tidy this up — file it where it belongs and keep me posted.' },
    assistant: {
      id: 'a5',
      role: 'assistant',
      content:
        "Here's how I'd organize it. Confirm whatever you want — nothing changes until you do:",
      relationActions: [
        {
          kind: 'file-session',
          sessionId: 'insights-launch',
          sessionTitle: 'Insights dashboard launch',
          projectId: 'p-insights',
          projectName: 'Insights dashboard',
        },
        {
          kind: 'save-artifact',
          artifact: {
            name: 'launch-recap.md',
            kind: 'doc',
            meta: '1 page',
            excerpt: 'What shipped, the flag, and the rollout plan — in one place.',
          },
          sessionId: 'insights-launch',
          sessionTitle: 'Insights dashboard launch',
          projectId: 'p-insights',
          projectName: 'Insights dashboard',
        },
        {
          kind: 'set-schedule-artifact',
          scheduleId: 's-issue-triage',
          scheduleName: 'Triage new GitHub issues',
          cadence: 'every 2 hours',
          artifactName: 'triage-digest.md',
        },
      ],
    },
  },
]
