/** ── Reply generation — the Anthropic Messages API + tool-use seam ──────────
 *  The backend no longer writes the assistant's words *or* keyword-matches its
 *  side-effects. It calls an Anthropic Messages endpoint through the official SDK
 *  with a real **tool interface** (server/model/tools.ts) and runs the tool-use
 *  loop: the model answers with `tool_use` blocks, the backend *executes* each
 *  call (turning it into a consent-gated proposal — a relation-edit card or an
 *  escalation), feeds the `tool_result`s back, and streams the model's final
 *  prose. Exactly the call a production backend makes; the only mock is the model
 *  endpoint (dev: server/model on :8788). To go live, repoint `ANTHROPIC_BASE_URL`
 *  at `api.anthropic.com` and set `ANTHROPIC_API_KEY` — no code change. */
import Anthropic from '@anthropic-ai/sdk'
import type { Agent, EscalationProposal, Message, RelationOp, SessionContext, ToolActivity } from '../contract/index.ts'
import { TOOL_DEFINITIONS, executeTool, type ToolContext } from './model/tools.ts'
import { deriveConnectorTools, runConnectorTool } from './model/connectorTools.ts'
import { chunkText } from './model/replies.ts'
import { positiveNumberEnv, nonNegativeIntEnv } from './env.ts'

/** The default provider's model (docs/agent-commons.md, D9): used when a turn's
 *  Agent resolves to a provider that declares no concrete model of its own — so the
 *  env override stays the single source for the default model. Other providers carry
 *  their own model id (server-only config), passed in as `generateReply`'s `model`. */
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8'

/** SDK transient-error retries (network blips / 429 / 5xx) — fail fast by default to
 *  reach the graceful fallback. Override with `ANTHROPIC_MAX_RETRIES` (non-negative int). */
const MODEL_MAX_RETRIES = nonNegativeIntEnv(process.env.ANTHROPIC_MAX_RETRIES, 1)

/** Combine the caller's abort (the client closed the connection) with a per-call
 *  wall-clock timeout, so a stalled/hung model call can't wedge the turn — on expiry
 *  the stream aborts and the turn degrades to the local fallback. The timeout trips the
 *  combined signal but NOT the caller's, so the catch distinguishes them (timeout →
 *  fallback, client-close → rethrow). `MODEL_TIMEOUT_MS` is read per call so it's
 *  configurable at runtime (and in tests). */
function withDeadline(signal?: AbortSignal): AbortSignal {
  // `MODEL_TIMEOUT_MS` is read per call (runtime/test-configurable) and validate-and-floored
  // so an empty/garbage value can't collapse the budget to 0/NaN — which would abort
  // instantly and silently degrade EVERY turn to the fallback.
  const timeoutMs = positiveNumberEnv(process.env.MODEL_TIMEOUT_MS, 60_000)
  const deadline = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, deadline]) : deadline
}

/** One door to the model — built lazily from the env so the endpoint can be set
 *  at runtime (the dev boot, or a test pointing at its own mock instance), and
 *  memoized per base URL. Points at the mock model server by default; set
 *  `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` to talk to the real API instead. */
let cached: { base: string; client: Anthropic } | undefined
function client(): Anthropic {
  const base = process.env.ANTHROPIC_BASE_URL ?? `http://127.0.0.1:${process.env.MODEL_PORT ?? 8788}`
  if (!cached || cached.base !== base) {
    cached = {
      base,
      client: new Anthropic({
        baseURL: base,
        apiKey: process.env.ANTHROPIC_API_KEY ?? 'mock-no-key-needed',
        maxRetries: MODEL_MAX_RETRIES, // fail fast to the graceful fallback if the endpoint is down
      }),
    }
  }
  return cached.client
}

/** The bit of a session the reply depends on (resolved by the route). */
export interface ReplySession {
  id: string
  title: string
  isDemo?: boolean
}

/** Streamed-reply callbacks the route wires to its SSE channel. */
export interface ReplyHandlers {
  /** The assistant message id, as soon as the model's `message_start` arrives. */
  onStart: (messageId: string) => void
  /** A chunk of assistant text to append. */
  onDelta: (text: string) => void
}

/** A turn's real token usage, summed across the tool-use loop's model calls — fed
 *  to the usage meter so the composer gauge reflects actual consumption. */
export interface TurnUsage {
  inputTokens: number
  outputTokens: number
}

/** The result of a turn: the assistant message plus the tokens it consumed. */
export interface ReplyResult {
  message: Message
  usage: TurnUsage
}

/** The system prompt the backend sends — the worker Agent's prompt + its custom
 *  instructions, with the demo clause layered on for the scripted session. The
 *  Agent (docs/agent-commons.md, D6) carries the framing that used to be hard-coded
 *  here; for the default Agent this reproduces the original prompt verbatim. */
export function systemPrompt(session: ReplySession, agent: Agent): string {
  return [
    agent.systemPrompt,
    agent.instructions,
    session.isDemo ? 'This is the scripted demo session — keep replies brief.' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Stream an assistant reply through the Messages API tool-use loop. Fires the
 *  handlers as the model streams, executes any tool calls, and resolves with the
 *  complete message — its prose plus the consent-gated proposals (relation edits
 *  and/or an escalation) the tool calls produced. Degrades to a local fallback
 *  message if the endpoint is unreachable, so the UI never hangs. */
export async function generateReply(
  session: ReplySession,
  agent: Agent,
  text: string,
  handlers: ReplyHandlers,
  signal?: AbortSignal,
  model: string = MODEL,
  commons?: ToolContext['commons'],
  connectorContexts: SessionContext[] = [],
): Promise<ReplyResult> {
  // The live Agent Commons registries (supplied by the route) let the Agent Commons
  // CRUD tools resolve the model's named provider / prompt / agent against what
  // currently exists — so "commission the agent I just made" resolves.
  const ctx: ToolContext = { session: { id: session.id, title: session.title }, commons }
  const system = systemPrompt(session, agent)
  // The Agent's tool allowlist — a subset of the catalog (the default carries all).
  const agentTools = TOOL_DEFINITIONS.filter((t) => agent.tools.includes(t.name))
  // P6: an attached connector/MCP contributes callable tools too — derived from the
  // session's context bindings (server/model/connectorTools.ts) and appended to the
  // request. Only *attached* contexts yield tools, so the model can't reach one the
  // user didn't add (authority is structural).
  const { definitions: connectorDefs, bindings: connectorBindings } = deriveConnectorTools(connectorContexts)
  const tools = [...agentTools, ...connectorDefs]
  const userContent = text.trim() || '(the user sent an empty message)'

  let assistantId = ''
  let fullText = ''
  const usage: TurnUsage = { inputTokens: 0, outputTokens: 0 }
  const addUsage = (u?: { input_tokens?: number; output_tokens?: number }) => {
    usage.inputTokens += u?.input_tokens ?? 0
    usage.outputTokens += u?.output_tokens ?? 0
  }
  const onStartOnce = (id: string) => {
    if (assistantId) return
    assistantId = id
    handlers.onStart(id)
  }

  try {
    // ── Turn 1: the model may answer with tool calls ─────────────────────────
    const stream1 = client().messages.stream(
      { model, max_tokens: 1024, system, tools, messages: [{ role: 'user', content: userContent }] },
      { signal: withDeadline(signal) },
    )
    stream1.on('streamEvent', (event) => {
      if (event.type === 'message_start') onStartOnce(event.message.id)
    })
    stream1.on('text', (delta) => {
      fullText += delta
      handlers.onDelta(delta)
    })
    const first = await stream1.finalMessage()
    onStartOnce(first.id) // safety net if message_start was missed
    addUsage(first.usage)

    const toolUses = first.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (toolUses.length === 0) {
      return { message: { id: assistantId, role: 'assistant', content: fullText }, usage }
    }

    // ── Execute the tool calls — build the consent-gated proposals ───────────
    const relationOps: RelationOp[] = []
    const toolActivities: ToolActivity[] = []
    let escalation: EscalationProposal | undefined
    const toolResults = toolUses.map((tu) => {
      // A connector/MCP tool (P6) executes into a ToolActivity (mock result); anything
      // else is a built-in resource / relation / escalation tool.
      const activity = runConnectorTool(tu.name, connectorBindings, tu.id)
      if (activity) {
        toolActivities.push(activity)
        // A read already ran → feed its result back. An action is only PROPOSED (consent-
        // gated), so tell the model it's pending, not done, so its prose doesn't claim the
        // write happened.
        const content =
          activity.status === 'proposed'
            ? 'Proposed to the user — awaiting their confirmation; not executed yet.'
            : activity.summary
        return { type: 'tool_result' as const, tool_use_id: tu.id, content }
      }
      const effect = executeTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, ctx)
      if (effect.relationOps) relationOps.push(...effect.relationOps)
      if (effect.escalation) escalation = effect.escalation
      return { type: 'tool_result' as const, tool_use_id: tu.id, content: effect.summary }
    })

    // ── Turn 2: feed the results back, stream the final prose ────────────────
    const stream2 = client().messages.stream(
      {
        model,
        max_tokens: 1024,
        system,
        tools,
        messages: [
          { role: 'user', content: userContent },
          { role: 'assistant', content: first.content },
          { role: 'user', content: toolResults },
        ],
      },
      { signal: withDeadline(signal) },
    )
    stream2.on('text', (delta) => {
      fullText += delta
      handlers.onDelta(delta)
    })
    const second = await stream2.finalMessage()
    addUsage(second.usage)

    return {
      message: {
        id: assistantId,
        role: 'assistant',
        content: fullText,
        relationActions: relationOps.length ? relationOps : undefined,
        escalation,
        toolActivities: toolActivities.length ? toolActivities : undefined,
      },
      usage,
    }
  } catch (err) {
    if (signal?.aborted) throw err // the client went away — let the route stop quietly
    return fallbackReply(assistantId, handlers)
  }
}

/** Streamed locally when the model endpoint can't be reached. No real tokens were
 *  consumed, so the usage is zero. */
function fallbackReply(existingId: string, handlers: ReplyHandlers): ReplyResult {
  const id = existingId || `msg_fallback_${Date.now().toString(36)}`
  if (!existingId) handlers.onStart(id)
  const content =
    'I couldn’t reach the model endpoint just now — in this prototype the backend streams replies from a local Anthropic-compatible mock server. Please try again in a moment.'
  for (const c of chunkText(content)) handlers.onDelta(c)
  return { message: { id, role: 'assistant', content }, usage: { inputTokens: 0, outputTokens: 0 } }
}
