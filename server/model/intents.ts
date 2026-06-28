/** ── The mock model's decision logic ────────────────────────────────────────
 *  This is the part of the "fake Anthropic server" that decides which resource
 *  manipulations a turn calls for. A real Claude reasons over the message; the
 *  mock matches it — by **fixed string** for the guided tour's scripted beats
 *  (deterministic and exact), and by **keyword pattern** for anything free-typed.
 *  The output is a list of tool calls `{ name, input }`, which the model server
 *  then emits as Anthropic `tool_use` blocks. Tool *execution* (turning a call
 *  into a real proposal) is the backend's job (server/model/tools.ts) — this only
 *  picks the calls, exactly as the model does.
 *
 *  The TOUR table is the source of truth for the guided tour's traffic; the client
 *  script (src/data/demo.ts) sends these exact strings, and a contract-boundary
 *  test locks the two together so they can't drift. */
import { TOOL_NAMES } from './tools.ts'

export interface ToolCall {
  name: string
  input: Record<string, unknown>
}

/** One scripted tour turn: the exact user message and the tool calls it elicits
 *  (empty for the plain-chat and wrap beats, which exercise the no-tool path). */
export interface TourTurn {
  text: string
  calls: ToolCall[]
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ')

/** The guided tour, as request → tool-calls. Every tool in the catalog appears
 *  here, so the tour's traffic exercises all possible case manipulation. The
 *  arc: chat → workspace → repo → project, then an "organize" act with one beat
 *  per remaining relation op. */
export const TOUR_TURNS: TourTurn[] = [
  {
    text: 'We ship the new Insights dashboard next week. Help me think through the launch.',
    calls: [],
  },
  {
    text: 'Yes — turn that into a one-pager and a launch email, plus a hero image. Pull from our brand kit and the last launch’s assets so it stays on-brand.',
    calls: [{ name: 'open_workspace', input: { sources: ['brand-kit/', 'launch-assets/'] } }],
  },
  {
    text: 'Now put it behind a feature flag and add the dashboard route in our web app.',
    calls: [{ name: 'connect_repo', input: { branch: 'feat/insights-dashboard', remote: 'patrick-yingxi-pan/web-app' } }],
  },
  {
    text: 'This is becoming a real effort. Can you give it a home of its own?',
    calls: [
      {
        name: 'create_project',
        input: {
          name: 'Insights dashboard launch',
          description:
            'Everything for the Insights dashboard launch — the strategy thread, the one-pager and email, and the feature-flagged rollout.',
          file_session: 'false',
        },
      },
    ],
  },
  {
    text: 'Now file this session into that new project.',
    calls: [{ name: 'file_session', input: { project: 'Insights dashboard launch' } }],
  },
  {
    text: 'Save the recap of this as launch-recap.md and file it under the project.',
    calls: [
      {
        name: 'save_artifact',
        input: { name: 'launch-recap.md', kind: 'doc', meta: '1 page', excerpt: 'What shipped, the flag, and the rollout plan — in one place.', project: 'Insights dashboard launch' },
      },
    ],
  },
  {
    text: 'Have the “Triage new GitHub issues” schedule save a triage-digest.md every run.',
    calls: [{ name: 'set_schedule_artifact', input: { schedule: 'Triage new GitHub issues', artifact: 'triage-digest.md' } }],
  },
  {
    text: 'And have the “Daily AI news briefing” open a fresh session each run.',
    calls: [{ name: 'set_schedule_session', input: { schedule: 'Daily AI news briefing', session_label: 'AI news' } }],
  },
  {
    text: 'Let that briefing use Slack each run too.',
    calls: [{ name: 'schedule_add_tool', input: { schedule: 'Daily AI news briefing', tool: 'Slack' } }],
  },
  {
    text: 'Link the “Triage new GitHub issues” schedule to the Insights dashboard launch project.',
    calls: [{ name: 'link_schedule_project', input: { schedule: 'Triage new GitHub issues', project: 'Insights dashboard launch' } }],
  },
  {
    text: 'Attach Linear to this session.',
    calls: [{ name: 'attach_context', input: { connector: 'Linear' } }],
  },
  {
    text: 'Scope Figma to the Insights dashboard launch project.',
    calls: [{ name: 'scope_context', input: { connector: 'Figma', project: 'Insights dashboard launch' } }],
  },
  {
    text: 'Actually, drop Figma from the project again.',
    calls: [{ name: 'unscope_context', input: { context: 'Figma', project: 'Insights dashboard launch' } }],
  },
  {
    text: 'Note that insights-onepager.md derives from the brand-kit/ folder.',
    calls: [{ name: 'set_artifact_source', input: { artifact: 'insights-onepager.md', context: 'brand-kit/' } }],
  },
  {
    text: 'Move query-perf.sheet into the Insights dashboard launch project.',
    calls: [{ name: 'refile_artifact', input: { artifact: 'query-perf.sheet', project: 'Insights dashboard launch' } }],
  },
  {
    text: 'Set the project instructions: lead with the metric, then the mechanism; keep launch copy to one screen.',
    calls: [
      {
        name: 'set_project_instructions',
        input: { project: 'Insights dashboard launch', instructions: 'Lead with the metric, then the mechanism. Keep launch copy to one screen.' },
      },
    ],
  },
  {
    text: 'Perfect — that’s the whole thing organized. Thanks!',
    calls: [],
  },
]

const TOUR_BY_TEXT = new Map(TOUR_TURNS.map((t) => [norm(t.text), t.calls]))

/** Keyword fallback for free-typed messages (the non-tour composer path). A
 *  faithful pattern match — honest, no fake intelligence — that picks the same
 *  tool calls a model would for the common organizing requests. */
function matchKeywords(text: string): ToolCall[] {
  const t = text.toLowerCase()
  const calls: ToolCall[] = []
  const grab = (re: RegExp): string | undefined => text.match(re)?.[1]?.trim()

  const project = grab(/\b(?:project|under|into)\s+(?:the\s+)?["“]?([A-Za-z0-9 ][A-Za-z0-9 -]*?)["”]?(?:\s+project)?(?:[.,!]|$)/i)
  const hasSchedule = /\bschedul/.test(t)

  // ── Agent Commons CRUD (D6/D9/D10/D7) ──────────────────────────────────────
  // A faithful pattern match for the management requests Claude turns into the Agent
  // Commons tools. Specific nouns (commission / worker agent / system prompt / model
  // provider) keep these from colliding with the relation patterns below.
  const wantsCreate = /\b(add|create|register|new|set up|make)\b/.test(t)
  // The project name ends at a trailing "as <role>" clause (so "… to Insights as a reader"
  // captures just "Insights"), as well as the prior "project" word / punctuation / end.
  const toProject = grab(/\b(?:to|onto|from|off)\s+(?:the\s+)?["“]?([A-Za-z0-9][A-Za-z0-9 -]*?)["”]?(?:\s+project)?(?:\s+as\s+|[.,!]|$)/i)
  const asRole = grab(/\bas\s+(?:an?\s+)?(owner|maintainer|writer|reader)\b/i)
  const uncommissionAgent = grab(/\b(?:uncommission|un-commission)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9 -]*?)\s+(?:from|off)\b/i)
  const commissionAgent = grab(/\b(?:commission|assign)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9 -]*?)\s+(?:to|onto)\b/i)
  if (uncommissionAgent && toProject) {
    calls.push({ name: 'uncommission_agent', input: { agent: uncommissionAgent, project: toProject } })
  } else if (commissionAgent && toProject) {
    calls.push({
      name: 'commission_agent',
      input: { agent: commissionAgent, project: toProject, ...(asRole ? { role: asRole.toLowerCase() } : {}) },
    })
  }
  // Create a worker agent: "create a (worker) agent called X (on PROVIDER) (with the PROMPT prompt)".
  if (!calls.length && wantsCreate && /\bagent\b/.test(t)) {
    const label = grab(/\bagent\s+(?:called\s+|named\s+)?["“]?([A-Za-z0-9][A-Za-z0-9 -]*?)["”]?(?:\s+(?:on|with|that|using)\b|[.,!]|$)/i) ?? 'New agent'
    const provider = grab(/\bon\s+(?:the\s+)?["“]?([A-Za-z0-9][A-Za-z0-9 -]*?)["”]?(?:\s+(?:with|provider|that|using)\b|[.,!]|$)/i)
    const systemPrompt = grab(/\bwith\s+(?:the\s+)?["“]?([A-Za-z0-9][A-Za-z0-9 -]*?)["”]?\s+(?:system\s+)?prompt\b/i)
    calls.push({ name: 'create_agent', input: { label, ...(provider ? { provider } : {}), ...(systemPrompt ? { system_prompt: systemPrompt } : {}) } })
  }
  // Add a system prompt: "add a system prompt called X (saying \"…\")".
  if (!calls.length && wantsCreate && /\bprompt\b/.test(t)) {
    const label = grab(/\bprompt\s+(?:called\s+|named\s+)?["“]?([A-Za-z0-9][A-Za-z0-9 -]*?)["”]?(?:\s+(?:for|that|saying|[.,!])|$)/i) ?? 'New prompt'
    const body = grab(/(?:saying|that says|body)\s+["“]([^"”]+)["”]/i) ?? grab(/["“]([^"”]{8,})["”]/)
    calls.push({ name: 'create_system_prompt', input: { label, ...(body ? { body } : {}) } })
  }
  // Register a model provider: "add a (model) provider called X (on the Y family)".
  if (!calls.length && wantsCreate && /\bprovider\b/.test(t)) {
    const label = grab(/\bprovider\s+(?:called\s+|named\s+)?["“]?([A-Za-z0-9][A-Za-z0-9 .-]*?)["”]?(?:\s+(?:on|for|that|using|[.,!])|$)/i) ?? 'New provider'
    const family = grab(/\b(?:family|on the)\s+([A-Za-z][A-Za-z0-9 -]*?)(?:\s+family)?(?:[.,!]|$)/i)
    calls.push({ name: 'create_provider', input: { label, ...(family ? { model_family: family } : {}) } })
  }

  // ── Save a draft out of this session ──────────────────────────────────────
  if (/\bsave\b/.test(t) && /\b(artifact|draft|doc|note|recap|summary)\b/.test(t)) {
    const name = grab(/\bsave\b.*?\bas\s+([\w.-]+)/i) ?? 'session-recap.md'
    calls.push({ name: 'save_artifact', input: { name, kind: 'doc', meta: '1 page', excerpt: 'Saved from this session.', ...(project ? { project } : {}) } })
  }

  // ── Schedule-centric ──────────────────────────────────────────────────────
  if (hasSchedule) {
    const schedule = grab(/["“]([^"”]+)["”]/) ?? grab(/\bthe\s+([A-Za-z0-9 ][A-Za-z0-9 -]*?)\s+schedule/i) ?? 'Daily AI news briefing'
    if (project && /\blink\b/.test(t)) {
      calls.push({ name: 'link_schedule_project', input: { schedule, project } })
    } else if (/\bsession\b/.test(t)) {
      calls.push({ name: 'set_schedule_session', input: { schedule } })
    } else if (/\buse\b/.test(t)) {
      const tool = grab(/\buse\s+([A-Za-z][A-Za-z ]*?)(?:\s+each|\s+every|[.,!]|$)/i) ?? 'Slack'
      calls.push({ name: 'schedule_add_tool', input: { schedule, tool } })
    } else if (/\b(save|digest|artifact|report|output|write)\b/.test(t)) {
      const artifact = grab(/\bsave\s+(?:a\s+)?([\w.-]+)/i) ?? 'digest.md'
      calls.push({ name: 'set_schedule_artifact', input: { schedule, artifact } })
    }
  }

  // ── Attach / scope a connector ────────────────────────────────────────────
  const connector = grab(/\b(?:attach|connect|scope)\s+([A-Za-z][A-Za-z ]*?)(?:\s+to\b|[.,!]|$)/i)
  if (connector && !hasSchedule) {
    if (project && /\bscope\b/.test(t)) {
      calls.push({ name: 'scope_context', input: { connector, project } })
    } else if (/\b(attach|connect)\b/.test(t)) {
      calls.push({ name: 'attach_context', input: { connector } })
    }
  }

  // ── File the session into a project ───────────────────────────────────────
  if (!calls.length && project && /\b(file|move|organi[sz]e|put|belongs?|tidy)\b/.test(t)) {
    calls.push({ name: 'file_session', input: { project } })
  }

  // ── Create a project ──────────────────────────────────────────────────────
  if (!calls.length && /\bcreate\b/.test(t) && /\bproject\b/.test(t)) {
    const name = grab(/\bproject\s+(?:called\s+)?["“]?([A-Za-z0-9 ][A-Za-z0-9 -]*?)["”]?(?:[.,!]|$)/i) ?? 'New project'
    calls.push({ name: 'create_project', input: { name, file_session: 'true' } })
  }

  return calls.filter((c) => (TOOL_NAMES as string[]).includes(c.name))
}

/** Decide a turn's tool calls: an exact tour match first, else keyword patterns.
 *  Returns [] when nothing matches (a plain-chat turn). */
export function matchIntents(userText: string): ToolCall[] {
  const tour = TOUR_BY_TEXT.get(norm(userText))
  if (tour) return tour
  return matchKeywords(userText)
}
