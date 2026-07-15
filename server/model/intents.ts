/** ── The mock model's decision logic ────────────────────────────────────────
 *  This is the part of the "fake Anthropic server" that decides which resource
 *  manipulations a turn calls for. A real Claude reasons over the message; the
 *  mock matches it by **keyword pattern**. The output is a list of tool calls
 *  `{ name, input }`, which the model server then emits as Anthropic `tool_use`
 *  blocks. Tool *execution* (turning a call into a real proposal) is the
 *  backend's job (server/model/tools.ts) — this only picks the calls, exactly
 *  as the model does. */
import { TOOL_NAMES } from './tools.ts'

export interface ToolCall {
  name: string
  input: Record<string, unknown>
}

/** Keyword matching for free-typed messages. A faithful pattern match — honest,
 *  no fake intelligence — that picks the same tool calls a model would for the
 *  common organizing requests. */
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
  // Hand-off (D16) — distinct verbs (hand / switch / pass … to X) from commission, so the
  // two never collide; the agent label follows the (possibly lazy-skipped) "to".
  const handoffAgent = grab(/\b(?:hand|switch|pass)\b.*?\bto\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9 -]*?)(?:\s+agent)?(?:[.,!]|$)/i)
  // Set a commission cap (D13) — anchored on commission/contributor vocabulary + a number,
  // so it never collides with the bare commission/hand-off patterns (which carry no count).
  // Two shapes: noun-first ("commission cap on Insights to 3") and noun-last ("cap Insights
  // at 3 commissions").
  const capMatch =
    text.match(/\b(?:commission|contributor)\s+(?:cap|limit|max(?:imum)?)\s+(?:on|for)\s+(?:the\s+)?["“]?([A-Za-z0-9][A-Za-z0-9 -]*?)["”]?\s+(?:to|at|=)\s+(\d+)/i) ??
    text.match(/\b(?:cap|limit|set)\s+(?:the\s+)?["“]?([A-Za-z0-9][A-Za-z0-9 -]*?)["”]?\s+(?:to|at)\s+(\d+)\s+(?:commission|contributor)/i)
  if (capMatch) {
    calls.push({ name: 'set_commission_cap', input: { project: capMatch[1].trim(), cap: Number(capMatch[2]) } })
  } else if (uncommissionAgent && toProject) {
    calls.push({ name: 'uncommission_agent', input: { agent: uncommissionAgent, project: toProject } })
  } else if (commissionAgent && toProject) {
    calls.push({
      name: 'commission_agent',
      input: { agent: commissionAgent, project: toProject, ...(asRole ? { role: asRole.toLowerCase() } : {}) },
    })
  } else if (handoffAgent) {
    calls.push({ name: 'handoff_agent', input: { agent: handoffAgent } })
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

  // ── Panel escalations (the in-place chat → workspace / repo growth) ────────
  // A drafting ask escalates to a workspace; a code ask connects the repo. Both
  // surface as consent-gated proposals (the EscalationPrompt) — same tools a
  // real model calls on the live API. The verb must sit ON the noun ("open a
  // workspace", "connect the repo"), so a message that merely *mentions* a
  // workspace or the repo ("start a new session in my workspace") never
  // escalates uninvited.
  if (!calls.length && /\b(?:open|set ?up|start|grow)\s+(?:up\s+)?(?:a|the|my|this|another)?\s*(?:new\s+)?workspace\b/.test(t)) {
    calls.push({ name: 'open_workspace', input: {} })
  }
  if (!calls.length && /\b(?:connect|attach|branch)\s+(?:to\s+)?(?:a|the|my|our|this)?\s*(?:git(?:hub)?\s+)?(?:repo|repository|codebase)\b/.test(t)) {
    const remote = grab(/\b(?:repo|repository)\s+["“]?([\w./-]+\/[\w.-]+)["”]?/i)
    const branch = grab(/\bbranch\s+["“]?([\w./-]+)["”]?/i)
    calls.push({ name: 'connect_repo', input: { ...(remote ? { remote } : {}), ...(branch ? { branch } : {}) } })
  }

  // ── Save a draft out of this session ──────────────────────────────────────
  if (/\bsave\b/.test(t) && /\b(artifact|draft|doc|note|recap|summary)\b/.test(t)) {
    const name = grab(/\bsave\b.*?\bas\s+([\w.-]+)/i) ?? 'session-recap.md'
    calls.push({ name: 'save_artifact', input: { name, kind: 'doc', meta: '1 page', excerpt: 'Saved from this session.', ...(project ? { project } : {}) } })
  }

  // ── Schedule-centric ──────────────────────────────────────────────────────
  if (hasSchedule) {
    const schedule = grab(/["“]([^"”]+)["”]/) ?? grab(/\bthe\s+([A-Za-z0-9 ][A-Za-z0-9 -]*?)\s+schedule/i) ?? 'Daily AI news briefing'
    // "link … into/under the X project" AND the natural "link … to the X project"
    // (`toProject` grabs the to/onto phrasings).
    const linkProject = project ?? toProject
    if (linkProject && /\blink\b/.test(t)) {
      calls.push({ name: 'link_schedule_project', input: { schedule, project: linkProject } })
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

  // ── The project README (D26): "write/update the readme for X (saying "…")" ──
  if (!calls.length && /\breadme\b/.test(t)) {
    const readmeProject =
      grab(/\breadme\s+(?:for|on|of)\s+(?:the\s+)?["“]?([A-Za-z0-9][A-Za-z0-9 -]*?)["”]?(?:\s+(?:project|saying|that)\b|[.,!]|$)/i) ?? project
    if (readmeProject) {
      const body =
        grab(/(?:saying|that says|body)\s+["“]([^"”]+)["”]/i) ??
        'What this project is, who it serves, and how to contribute — start with the open work list.'
      calls.push({ name: 'set_project_readme', input: { project: readmeProject, readme: body } })
    }
  }

  // ── Attach / scope / unscope a connector ──────────────────────────────────
  // (A repo ask is the escalation above, not a connector attach — the grabbed
  // LABEL must not itself be "the repo"; a message that merely mentions the
  // repo elsewhere ("attach Linear so it can read the repo") still attaches.)
  const connector = grab(/\b(?:attach|connect|scope)\s+([A-Za-z][A-Za-z ]*?)(?:\s+to\b|[.,!]|$)/i)
  if (connector && !hasSchedule && !/^(?:a |the |my |our )?(?:git(?:hub)? )?(?:repo|repository|codebase)\b/i.test(connector) && !calls.some((c) => c.name === 'connect_repo')) {
    if (project && /\bscope\b/.test(t)) {
      calls.push({ name: 'scope_context', input: { connector, project } })
    } else if (/\b(attach|connect)\b/.test(t)) {
      calls.push({ name: 'attach_context', input: { connector } })
    }
  }
  // ── Unfile the session from its project ───────────────────────────────────
  // "Remove/unfile this session (conversation/thread) from the X project" — the
  // subject is the SESSION, so this must run before the unscope-context pattern
  // below (whose greedy label grab would otherwise capture "this session" as a
  // context label and propose the wrong edit entirely).
  if (!calls.length && /\b(?:remove|unfile|take)\b.*?\b(?:this|the)\s+(?:session|conversation|thread)\b.*?\b(?:from|out of)\b/i.test(text)) {
    // Its own grab (not the shared toProject): the unfile phrasing also says
    // "out of the X project", which the to/onto/from/off grab doesn't cover.
    const unfileProject = grab(/\b(?:from|out of)\s+(?:the\s+)?["“]?([A-Za-z0-9][A-Za-z0-9 -]*?)["”]?(?:\s+project)?(?:[.,!]|$)/i)
    if (unfileProject) calls.push({ name: 'file_session', input: { project: unfileProject, remove: 'true' } })
  }
  // "Drop/remove Figma from the Growth experiments project." Anchored on the
  // project vocabulary, so an innocent edit ("remove the last paragraph from
  // the doc") never becomes a relation proposal.
  if (!calls.length && /\b(drop|remove|unscope)\b/.test(t) && /\bproject\b/.test(t)) {
    const ctx = grab(/\b(?:drop|remove|unscope)\s+([A-Za-z][\w ./-]*?)\s+(?:from|off)\b/i)
    if (ctx && toProject) calls.push({ name: 'unscope_context', input: { context: ctx, project: toProject } })
  }

  // ── Artifact relations ─────────────────────────────────────────────────────
  // "Note that insights-onepager.md derives from the brand-kit/ folder."
  if (!calls.length && /\bderives?\s+from\b/.test(t)) {
    const artifact = grab(/\b([\w-]+\.\w+)\s+derives?\s+from\b/i)
    const context = grab(/\bderives?\s+from\s+(?:the\s+)?["“]?([\w ./-]+?)["”]?(?:\s+folder|\s+connector)?(?:[.,!]|$)/i)
    if (artifact && context) calls.push({ name: 'set_artifact_source', input: { artifact, context } })
  }
  // "Move query-perf.sheet into the Growth experiments project."
  if (!calls.length && project && /\b(move|refile)\b/.test(t)) {
    const artifact = grab(/\b(?:move|refile)\s+([\w-]+\.\w+)\b/i)
    if (artifact) calls.push({ name: 'refile_artifact', input: { artifact, project } })
  }

  // ── Project instructions ───────────────────────────────────────────────────
  // "Set the project instructions for X: lead with the metric, …" — the project
  // must be NAMED (INV-9's shape: an absence is never resolved to some default
  // project on the caller's behalf).
  if (!calls.length && /\b(?:project\s+instructions|instructions\s+for)\b/.test(t)) {
    const target =
      grab(/\binstructions\s+(?:for|on)\s+(?:the\s+)?["“]?([A-Za-z0-9][A-Za-z0-9 -]*?)["”]?\s*[:,]/i) ??
      project ??
      toProject
    const instructions = grab(/\binstructions[^:]*:\s*(.+)$/i)
    if (target && instructions) {
      calls.push({ name: 'set_project_instructions', input: { project: target, instructions } })
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

/** Decide a turn's tool calls from its keyword patterns. Returns [] when
 *  nothing matches (a plain-chat turn). */
export function matchIntents(userText: string): ToolCall[] {
  return matchKeywords(userText)
}

/** Match a free-typed message to one of the connector/MCP tools declared in *this*
 *  request (derived by the backend from the session's attached contexts, P6). Unlike
 *  the built-in catalog, these tools are per-session, so the mock reads them from the
 *  request rather than a fixed table. It only fires when the message *names* the
 *  connector (its slug appears) — never a guess — and among that connector's tools
 *  prefers the one whose action words the message also mentions. Returns [] otherwise. */
export function matchConnectorTools(userText: string, availableToolNames: string[]): ToolCall[] {
  const connectorTools = availableToolNames.filter((n) => n.startsWith('mcp__') || n.startsWith('connector__'))
  if (!connectorTools.length) return []
  const t = userText.toLowerCase()
  // Whole-word set of the message, so a tool-name word is matched on a boundary — e.g.
  // `read_file`'s "file" does NOT spuriously match inside the slug "filesystem".
  const textWords = new Set(t.split(/[^a-z0-9]+/).filter(Boolean))
  let best: { name: string; score: number } | undefined
  for (const name of connectorTools) {
    const parts = name.split('__')
    const slug = (parts[1] ?? '').replace(/_/g, ' ')
    const tool = (parts[2] ?? '').replace(/_/g, ' ')
    if (!slug || !t.includes(slug)) continue // the connector must be named — no guessing
    // Rank by HOW MANY words of the tool name the message actually names (not a flat
    // "some word matched"): a fuller match wins, so `write a file` picks write_file over
    // read_file instead of collapsing to the first-declared tool — which would mislabel a
    // write as a no-consent read. The slug gate is shared by all of a connector's tools,
    // so the matched-word count is the real differentiator.
    const hits = tool.split(' ').filter(Boolean).filter((w) => textWords.has(w)).length
    const score = 2 + hits
    if (!best || score > best.score) best = { name, score }
  }
  return best ? [{ name: best.name, input: {} }] : []
}
