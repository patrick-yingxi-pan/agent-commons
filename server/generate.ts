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
import type { Agent, EscalationProposal, Message, ModelInfo, RelationOp, SessionContext, ToolActivity } from '../contract/index.ts'
import { ProviderProbeError, validApiKeyEnv, PROVIDER_KEY_ENV_PREFIX, type ProviderCapabilities, type ProviderConfig } from './data/providers.ts'
import { TOOL_DEFINITIONS, executeTool, type ToolContext } from './model/tools.ts'
import { deriveConnectorTools, runConnectorTool } from './model/connectorTools.ts'
import { chunkText } from './model/replies.ts'
import { positiveNumberEnv, nonNegativeIntEnv } from './env.ts'

/** The default provider's model (docs/agent-commons.md, D9): used when a turn's
 *  Agent resolves to a provider that declares no concrete model of its own — so the
 *  env override stays the single source for the default model. Other providers carry
 *  their own model id in the server-only `ProviderConfig` `generateReply` receives. */
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8'

/** The concrete model a turn on `config` runs against — the same resolution
 *  `generateReply` applies (`config.model ?? env default`), exported so the route
 *  can stamp per-turn model provenance (`Message.modelId`) and the usage snapshot
 *  can name the model its context figures are measured against. */
export function resolvedModelId(config: ProviderConfig = {}): string {
  return config.model ?? MODEL
}

/** SDK transient-error retries (network blips / 429 / 5xx) — fail fast by default to
 *  reach the graceful fallback. Override with `ANTHROPIC_MAX_RETRIES` (non-negative int). */
const MODEL_MAX_RETRIES = nonNegativeIntEnv(process.env.ANTHROPIC_MAX_RETRIES, 1)

/** Combine the caller's abort (an explicit turn cancel — the route's cancel route;
 *  a viewer disconnect no longer aborts, see server/turns.ts) with a per-call
 *  wall-clock timeout, so a stalled/hung model call can't wedge the turn — on expiry
 *  the stream aborts and the turn degrades to the local fallback. The timeout trips the
 *  combined signal but NOT the caller's, so the catch distinguishes them (timeout →
 *  fallback, cancel → rethrow). `MODEL_TIMEOUT_MS` is read per call so it's
 *  configurable at runtime (and in tests). */
function withDeadline(signal?: AbortSignal): AbortSignal {
  // `MODEL_TIMEOUT_MS` is read per call (runtime/test-configurable) and validate-and-floored
  // so an empty/garbage value can't collapse the budget to 0/NaN — which would abort
  // instantly and silently degrade EVERY turn to the fallback.
  const timeoutMs = positiveNumberEnv(process.env.MODEL_TIMEOUT_MS, 60_000)
  const deadline = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, deadline]) : deadline
}

/** One door to the model — a provider resolves to `{ endpoint, credential, model }`
 *  *data*, never provider-specific code: the backend speaks exactly one protocol (the
 *  Messages API this SDK client carries) and any endpoint that answers it plugs in
 *  (docs/agent-commons.md, D9). Built lazily from the config + env so the endpoint
 *  can be set at runtime (the dev boot, or a test pointing at its own mock instance),
 *  and memoized per `(baseURL, key)` pair — one client per distinct endpoint, so
 *  providers on different endpoints coexist within a process. The map only ever holds
 *  a handful of entries (one per registered endpoint / env variant), so it is not
 *  evicted. A config with no endpoint of its own inherits the ambient default: the
 *  mock model server, or `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` for the real API. */
const clients = new Map<string, Anthropic>()
function clientFor(config: ProviderConfig = {}): Anthropic {
  const base = config.baseURL ?? process.env.ANTHROPIC_BASE_URL ?? `http://127.0.0.1:${process.env.MODEL_PORT ?? 8788}`
  // The credential is resolved from the config's env-var *reference* (never a stored
  // raw key). The ambient `ANTHROPIC_API_KEY` is the credential for the AMBIENT
  // endpoint ONLY: a config that supplies its OWN `baseURL` must never inherit it,
  // or the platform's real key would be sent (as `x-api-key`) to a caller-supplied
  // URL — the exact exfiltration the `validApiKeyEnv` prefix wall exists to prevent
  // (`server/data/providers.ts`). Such a config gets its declared `PROVIDER_*` value
  // or the no-key sentinel, nothing else. Only the default (ambient-endpoint) config
  // falls back to the ambient key.
  const declared = config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined
  const ambientKey = config.baseURL ? undefined : process.env.ANTHROPIC_API_KEY
  const key = declared ?? ambientKey ?? 'mock-no-key-needed'
  const cacheKey = `${base}\u0000${key}`
  let client = clients.get(cacheKey)
  if (!client) {
    // Crude growth cap: probes of many distinct (possibly dead) endpoints would
    // otherwise accumulate clients forever. Registered configs are few, so a rare
    // full reset only costs re-construction, never correctness.
    if (clients.size >= 64) clients.clear()
    client = new Anthropic({
      baseURL: base,
      apiKey: key,
      maxRetries: MODEL_MAX_RETRIES, // fail fast to the graceful fallback if the endpoint is down
    })
    clients.set(cacheKey, client)
  }
  return client
}

/** Registration-time conformance probe (docs/agent-commons.md, D9): one tiny real
 *  Messages call against the config's endpoint, `tools` declared, to verify it speaks
 *  the protocol and to learn its capability record. An endpoint that rejects the
 *  `tools` param but answers a plain call is conformant-without-tool-use; one that
 *  answers neither fails the probe (`ProviderProbeError`) — the route turns that into
 *  a 400, so a non-conformant provider never reaches the mint funnel. */
export async function probeProviderEndpoint(config: ProviderConfig): Promise<ProviderCapabilities> {
  // The credential-reference wall, checked BEFORE any request leaves: the reference
  // and the endpoint are both caller-supplied, so an unconstrained reference would
  // exfiltrate any server env secret to an arbitrary URL (see `validApiKeyEnv`).
  if (!validApiKeyEnv(config.apiKeyEnv)) {
    throw new ProviderProbeError(`A provider credential must reference a '${PROVIDER_KEY_ENV_PREFIX}*' env var, not '${config.apiKeyEnv}'.`)
  }
  const probe = (withTools: boolean) =>
    clientFor(config).messages.create(
      {
        model: config.model ?? MODEL,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Conformance check. Reply with one word.' }],
        ...(withTools
          ? { tools: [{ name: 'probe_noop', description: 'Conformance probe — never called.', input_schema: { type: 'object' as const, properties: {} } }] }
          : {}),
      },
      { signal: AbortSignal.timeout(positiveNumberEnv(process.env.PROVIDER_PROBE_TIMEOUT_MS, 10_000)) },
    )
  try {
    await probe(true)
    return { toolUse: true }
  } catch (err) {
    // Only an endpoint that ANSWERED (an error carrying an HTTP status — e.g. it
    // rejected the `tools` param) falls through to the no-tools probe. An
    // unreachable / timed-out endpoint (connection error, abort — no status) fails
    // outright: retrying it without tools could only misclassify a transient blip
    // as a permanent "no tool use" capability.
    if (!(err instanceof Anthropic.APIError) || typeof err.status !== 'number') {
      const detail = err instanceof Error ? err.message : String(err)
      throw new ProviderProbeError(`The endpoint could not be reached: ${detail}`)
    }
    try {
      await probe(false)
      return { toolUse: false }
    } catch (err2) {
      const detail = err2 instanceof Error ? err2.message : String(err2)
      throw new ProviderProbeError(`The endpoint didn't answer the Messages protocol: ${detail}`)
    }
  }
}

/** The loose wire shape of one `GET /v1/models` entry. Providers disagree about
 *  everything past `id` (Anthropic ships capabilities + token limits; OpenAI ships
 *  nothing; the SDK's own type lags the live API), so the normalizer reads each
 *  field defensively and simply omits what an endpoint doesn't expose — absence
 *  *is* the contract's unknown state (`ModelInfo`). */
interface WireModel {
  id?: string
  display_name?: string
  max_input_tokens?: number
  max_tokens?: number
  capabilities?: {
    effort?: { supported?: boolean } & Record<string, { supported?: boolean } | boolean | undefined>
    thinking?: { supported?: boolean }
    image_input?: { supported?: boolean }
  }
}

/** The canonical effort ladder (the Anthropic capability keys, low→max) and its
 *  display labels — the order the normalized `effortLevels` list preserves. */
const WIRE_EFFORTS: Array<[key: string, label: string]> = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['xhigh', 'xHigh'],
  ['max', 'Max'],
]

/** Normalize one wire model into the contract's flexible `ModelInfo` — every
 *  metadata field optional, filled only when the endpoint exposed it. */
function normalizeWireModel(m: WireModel): ModelInfo | undefined {
  if (typeof m.id !== 'string' || !m.id) return undefined
  const caps = m.capabilities
  const efforts =
    caps?.effort?.supported === true
      ? WIRE_EFFORTS.filter(([k]) => {
          const level = caps.effort?.[k]
          return typeof level === 'object' && level?.supported === true
        }).map(([, label]) => label)
      : []
  const flags = {
    ...(caps?.thinking?.supported !== undefined ? { thinking: caps.thinking.supported } : {}),
    ...(caps?.image_input?.supported !== undefined ? { vision: caps.image_input.supported } : {}),
  }
  return {
    id: m.id,
    label: typeof m.display_name === 'string' && m.display_name ? m.display_name : m.id,
    ...(typeof m.max_input_tokens === 'number' && m.max_input_tokens > 0 ? { contextWindow: m.max_input_tokens } : {}),
    ...(typeof m.max_tokens === 'number' && m.max_tokens > 0 ? { maxOutputTokens: m.max_tokens } : {}),
    ...(Object.keys(flags).length ? { capabilities: flags } : {}),
    ...(efforts.length ? { effortLevels: efforts } : {}),
  }
}

/** Fetch a provider endpoint's model catalog (`GET /v1/models`) through the same
 *  SDK/base-URL seam turns generate through, normalized into the contract's
 *  `ModelInfo[]`. Absence-tolerant by design: an endpoint with no list API (404),
 *  an unreachable one, or an empty list all yield `undefined` — the provider's
 *  catalog simply stays absent (the picker shows that honestly) rather than the
 *  registration failing. Against the dev mock this returns the seeded trio; against
 *  `api.anthropic.com` it returns the live catalog — no code change (MODEL-5). */
export async function fetchProviderModels(config: ProviderConfig = {}): Promise<ModelInfo[] | undefined> {
  try {
    const page = await clientFor(config).models.list(
      { limit: 100 },
      { signal: AbortSignal.timeout(positiveNumberEnv(process.env.PROVIDER_PROBE_TIMEOUT_MS, 10_000)) },
    )
    const models = (page.data as WireModel[]).map(normalizeWireModel).filter((m): m is ModelInfo => !!m)
    return models.length ? models : undefined
  } catch {
    return undefined
  }
}

/** The bit of a session the reply depends on (resolved by the route). */
export interface ReplySession {
  id: string
  title: string
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
  /** How the turn resolved — `'ok'` when the model answered, `'fallback'` when the endpoint
   *  was unreachable/slow and the local degraded reply was streamed instead. The route feeds
   *  this to the generation-outcome metric (F6 PD31 observability) so a degraded model path is
   *  visible in `/metrics`, not silent. (Client-abort / fatal outcomes are observed by the
   *  route — generateReply rethrows those — so they're not represented here.) */
  outcome: 'ok' | 'fallback'
}

/** The system prompt the backend sends — the worker Agent's prompt + its custom
 *  instructions. The Agent (docs/agent-commons.md, D6) carries the framing that
 *  used to be hard-coded here; for the default Agent this reproduces the
 *  original prompt verbatim. */
export function systemPrompt(_session: ReplySession, agent: Agent): string {
  return [agent.systemPrompt, agent.instructions].filter(Boolean).join(' ')
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
  provider: ProviderConfig = {},
  commons?: ToolContext['commons'],
  connectorContexts: SessionContext[] = [],
): Promise<ReplyResult> {
  // The turn's provider resolves to data — endpoint, credential reference, model id —
  // through one protocol (see `clientFor`). An empty config is the default provider:
  // ambient endpoint, env-default model.
  const model = provider.model ?? MODEL
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
  // Capability-gated, never identity-gated: a probed non-tool-use provider gets no
  // `tools` param at all (a strict endpoint would reject it), so the tool-use loop —
  // and with it the consent-gated proposals — degrades away for turns on it. An
  // unprobed config (the default provider) is the ambient trusted endpoint: full tools.
  const supportsTools = provider.capabilities?.toolUse !== false
  const tools = supportsTools ? [...agentTools, ...connectorDefs] : []
  const toolsParam = supportsTools ? { tools } : {}
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
    const stream1 = clientFor(provider).messages.stream(
      { model, max_tokens: 1024, system, ...toolsParam, messages: [{ role: 'user', content: userContent }] },
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
      return { message: { id: assistantId, role: 'assistant', content: fullText }, usage, outcome: 'ok' }
    }

    // ── Execute the tool calls — build the consent-gated proposals ───────────
    const relationOps: RelationOp[] = []
    const toolActivities: ToolActivity[] = []
    let escalation: EscalationProposal | undefined
    // Same-turn chaining: later tools see (and may consume) the proposals built
    // by earlier calls of this turn — e.g. create_agent bundling a just-proposed
    // system prompt into one card.
    ctx.pending = relationOps
    // Defense in depth against a non-conformant endpoint: only EXECUTE a tool the
    // turn actually declared. A real endpoint never emits an undeclared `tool_use`,
    // but a buggy/hostile one could — and executing it would bypass the agent's
    // tool-grant allowlist (the wall `agentTools` builds above). An undeclared name
    // is refused back to the model, never run.
    const declaredNames = new Set(tools.map((t) => t.name))
    const toolResults = toolUses.map((tu) => {
      if (!declaredNames.has(tu.name)) {
        return { type: 'tool_result' as const, tool_use_id: tu.id, content: `Tool '${tu.name}' was not offered this turn and was not executed.`, is_error: true }
      }
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
    const stream2 = clientFor(provider).messages.stream(
      {
        model,
        max_tokens: 1024,
        system,
        ...toolsParam,
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
      outcome: 'ok',
    }
  } catch (err) {
    if (signal?.aborted) throw err // the turn was cancelled — let the route persist the partial
    // If prose ALREADY streamed to the live viewer (a turn-1 answer, or a partial
    // turn-2) before the failure, the persisted message must CONTINUE it, not
    // replace it with the bare apology — otherwise the live view (streamed prose +
    // apology) and the system of record (apology only) diverge on reload. Append a
    // short failure note to what streamed and keep the accumulated tool effects.
    if (fullText) {
      const note = '\n\n_(I couldn’t finish that turn — the model endpoint became unreachable. Please try again.)_'
      for (const c of chunkText(note)) handlers.onDelta(c)
      return {
        message: {
          id: assistantId,
          role: 'assistant',
          content: fullText + note,
          relationActions: relationOps.length ? relationOps : undefined,
          escalation,
          toolActivities: toolActivities.length ? toolActivities : undefined,
        },
        usage,
        outcome: 'fallback',
      }
    }
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
  return { message: { id, role: 'assistant', content }, usage: { inputTokens: 0, outputTokens: 0 }, outcome: 'fallback' }
}
