import type { Artifact, Connector, DiffLine, FileNode, Message } from '../types'

/** One beat of the guided demo: a user turn, Claude's reply, and whatever the
 *  reply reveals in the adaptive side panel. Playing these in order walks a
 *  single conversation from plain Chat → Cowork → Code. */
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
      'The same thread grows a workspace. In today’s app this is where you’d stop, switch to the Cowork tab, and re-explain everything from scratch.',
    user: {
      id: 'u2',
      role: 'user',
      content: 'Yes — turn that into a one-pager and a launch email, plus a hero image.',
    },
    assistant: {
      id: 'a2',
      role: 'assistant',
      escalate: 'workspace',
      content:
        "Opening a workspace so the drafts stay together. First pass is on the right — the one-pager reuses the value prop above, and the email is written for admins.",
    },
    artifacts: [
      { id: 'art-onepager', name: 'insights-onepager.md', kind: 'doc', meta: 'draft · 1 page' },
      { id: 'art-email', name: 'launch-email.md', kind: 'email', meta: 'draft · to: admins' },
      { id: 'art-hero', name: 'insights-hero.png', kind: 'image', meta: '1600×900 · generated' },
    ],
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
]
