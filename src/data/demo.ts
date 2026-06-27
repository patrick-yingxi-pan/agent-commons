/** ── The guided tour, as narration + the messages it sends ──────────────────
 *  The tour is no longer a client-side script of canned replies. Each beat is a
 *  caption (narration shown in the caption bar) plus the *user message it sends*
 *  — and that message really travels through the system: the controller posts it
 *  to the backend, which calls the model (the mock Anthropic server) with the
 *  tool interface, executes whatever tools it calls, and streams the reply +
 *  proposals back. So every escalation and relation edit you see in the tour is a
 *  real round-trip, not a fixture.
 *
 *  `userText` must match the mock's tour table verbatim (server/model/intents.ts
 *  → `TOUR_TURNS`); a contract-boundary test locks the two together so they can't
 *  drift. The arc: chat → workspace → repo → project, then an "organize" act with
 *  one beat per remaining relation op — every resource manipulation, on the wire. */
export interface DemoStep {
  id: string
  /** Narrative shown in the caption bar while this beat is on screen. */
  caption: string
  /** The user message this beat sends through the system to the model. */
  userText: string
}

export const DEMO_STEPS: DemoStep[] = [
  {
    id: 'step-chat',
    caption:
      'It opens as an ordinary chat — no mode to choose. This message is really sent: it travels to the backend, through the tool interface, to the model, and streams back.',
    userText: 'We ship the new Insights dashboard next week. Help me think through the launch.',
  },
  {
    id: 'step-workspace',
    caption:
      'The same thread grows a workspace. Claude calls an `open_workspace` tool; the backend runs it and proposes the drafts + folders it pulled in. It opens only once you pick a folder — in today’s app you’d switch to the Cowork tab and re-explain from scratch.',
    userText:
      'Yes — turn that into a one-pager and a launch email, plus a hero image. Pull from our brand kit and the last launch’s assets so it stays on-brand.',
  },
  {
    id: 'step-repo',
    caption:
      'Now it becomes a coding session — branch, diff, terminal — without leaving the conversation. A `connect_repo` tool call; approve to attach it. This is the Code tab, inline.',
    userText: 'Now put it behind a feature flag and add the dashboard route in our web app.',
  },
  {
    id: 'step-project',
    caption:
      'This has grown into a whole effort — so give it a home. Claude calls `create_project`; approve, and a brand-new (empty) project is created and you’re walked to its page. Nothing is created until you confirm.',
    userText: 'This is becoming a real effort. Can you give it a home of its own?',
  },
  {
    id: 'step-file-session',
    caption:
      'The project exists but is empty. Now Claude proposes filing *this very session* into it — the session ↔ project relation, edited with one confirm in the thread.',
    userText: 'Now file this session into that new project.',
  },
  {
    id: 'step-save-artifact',
    caption:
      'Save the recap as an artifact and file it under the project — the session ↔ artifact relation, proposed as a card, applied on your OK.',
    userText: 'Save the recap of this as launch-recap.md and file it under the project.',
  },
  {
    id: 'step-schedule-artifact',
    caption:
      'A standing approval: have a recurring schedule save a digest every run. Approved once, then it runs unprompted — the artifact ↔ schedule relation.',
    userText: 'Have the “Triage new GitHub issues” schedule save a triage-digest.md every run.',
  },
  {
    id: 'step-schedule-session',
    caption: 'Another standing approval — have a schedule open a fresh session each run (the session ↔ schedule relation).',
    userText: 'And have the “Daily AI news briefing” open a fresh session each run.',
  },
  {
    id: 'step-schedule-tool',
    caption: 'Add a tool a schedule reaches for each run — the context ↔ schedule relation.',
    userText: 'Let that briefing use Slack each run too.',
  },
  {
    id: 'step-link-schedule',
    caption: 'Link that schedule to the project, so its cadence lives with it — the project ↔ schedule relation.',
    userText: 'Link the “Triage new GitHub issues” schedule to the Insights dashboard launch project.',
  },
  {
    id: 'step-attach-context',
    caption: 'Attach a connector to this session — the same consent card, now for a context (the session ↔ context relation).',
    userText: 'Attach Linear to this session.',
  },
  {
    id: 'step-scope-context',
    caption: 'Scope a context to the whole project, so every session in it inherits the connector — the project ↔ context relation.',
    userText: 'Scope Figma to the Insights dashboard launch project.',
  },
  {
    id: 'step-unscope-context',
    caption: '…and take it back off again, just as easily. Every edit has its inverse.',
    userText: 'Actually, drop Figma from the project again.',
  },
  {
    id: 'step-artifact-source',
    caption: 'Record where an artifact came from — the artifact ↔ context relation.',
    userText: 'Note that insights-onepager.md derives from the brand-kit/ folder.',
  },
  {
    id: 'step-refile-artifact',
    caption: 'Move an existing artifact into the project — the project ↔ artifact relation.',
    userText: 'Move query-perf.sheet into the Insights dashboard launch project.',
  },
  {
    id: 'step-project-instructions',
    caption: 'Set the project’s standing instructions — the guidance every session in it follows.',
    userText: 'Set the project instructions: lead with the metric, then the mechanism; keep launch copy to one screen.',
  },
  {
    id: 'step-wrap',
    caption:
      'Every relationship between your sessions, projects, artifacts, contexts, and schedules — each one Claude proposed by calling a tool, each one you confirmed, all in one thread. One surface. One history.',
    userText: 'Perfect — that’s the whole thing organized. Thanks!',
  },
]
