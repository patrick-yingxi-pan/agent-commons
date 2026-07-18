/** ── The delegated-cognition relay (docs/delegated-cognition-provider.md) ────
 *  The second transport a Model provider can ride: instead of an endpoint the
 *  backend dials OUT to (`generateReply`), a `kind:'session'` provider is dialed
 *  INTO — a connector next to an AI session the user already runs long-polls
 *  `GET /relay/poll` with the rendezvous secret, receives a turn's prompt, lets
 *  its session's model generate, and posts the answer to `POST /relay/reply`.
 *
 *  Deliberately small (the third design pass; widened per-channel by the v4
 *  multi-session pass): per relay there is at most **one in-flight prompt per
 *  CHANNEL** — a channel is a UI session, so distinct conversations run
 *  concurrently (capped by `RELAY_MAX_INFLIGHT`) while a channel's own second
 *  turn still refuses fast as `relay_busy` — and at most **one parked puller**
 *  (newest wins — a fresh poll preempts a zombie socket). Every prompt is
 *  self-contained (it carries its channel's full history), so the far session
 *  needs no per-channel memory. Binding is presenting the secret: there is no
 *  enrollment protocol, so a laptop-sleep or backend-restart reconnect is the same
 *  act as connecting the first time. The durable identity is the provider row
 *  (its `secretHash`); everything here is transient, like the runner registry.
 *
 *  Liveness = a parked puller OR an in-flight turn (§7.3): while the far model
 *  generates, no socket is parked, so the in-flight entry is the proof-of-life
 *  across the generation gap — no lease clock, no heartbeat cadence. The TTL only
 *  bridges the idle re-poll gap. Clocks are env-tunable and read per call:
 *  `RELAY_POLL_MS` (bounded long-poll window), `RELAY_TTL_MS` (idle grace — must
 *  exceed the poll window), `RELAY_TIMEOUT_MS` (relayReply's own turn deadline —
 *  `MODEL_TIMEOUT_MS` never sees a relay turn). */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type {
  Agent,
  EscalationProposal,
  RelationOp,
  RelayPollResult,
  RelayPrompt,
  RelayPromptTurn,
  RelayToolCall,
  RelayToolDefinition,
  ServerEvent,
  SessionContext,
  ToolActivity,
} from '../contract/index.ts'
import { systemPrompt, type ReplyHandlers, type ReplyResult, type ReplySession } from './generate.ts'
import { TOOL_DEFINITIONS, executeTool, type ToolContext } from './model/tools.ts'
import { deriveConnectorTools, runConnectorTool } from './model/connectorTools.ts'
import { chunkText } from './model/replies.ts'
import { positiveNumberEnv } from './env.ts'

/** ── The rendezvous secret ───────────────────────────────────────────────────
 *  High-entropy bearer token, shown exactly once at mint/rotate. Only its SHA-256
 *  persists (on the server-only `ProviderConfig`) — at once the credential, the
 *  durable re-bind identity, and the restart-recovery key (§6.1). SHA-256 (not a
 *  slow KDF) is right here: the secret is 192 random bits, not a human password. */
const SECRET_PREFIX = 'rv_live_'

export function mintRelaySecret(): string {
  return `${SECRET_PREFIX}${randomBytes(24).toString('base64url')}`
}

export function hashRelaySecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/** The tail for the masked `rv_live_••••3f9a` fingerprint — never the secret. */
export function relaySecretHint(secret: string): string {
  return secret.slice(-4)
}

/** Constant-time digest equality (the `timingSafeEqual` bearer-wall pattern). */
export function sameSecretHash(a: string, b: string): boolean {
  const ab = Buffer.from(a) as Uint8Array
  const bb = Buffer.from(b) as Uint8Array
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** ── Framing dedupe (v3) ─────────────────────────────────────────────────────
 *  Content address for the prompt's near-invariant parts (system framing, tool
 *  schemas): SHA-256, truncated — a cache key, not a credential, so 16 hex chars
 *  (64 bits) are plenty against accidental collision. Deterministic across
 *  restarts by construction (pure content hash), which is what makes the
 *  connector's cache survive a backend restart. */
export function hashRelayContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/** Strip the bodies a puller already holds — decided at DELIVERY time (per
 *  puller, against the hashes its poll advertised), never at build time: the
 *  same in-flight prompt must deliver full to a fresh connector and pruned to a
 *  warm one, whichever shows up. */
function deliverPrompt(prompt: RelayPrompt, have: ReadonlySet<string>): RelayPrompt {
  if (!have.size) return prompt
  const pruned = { ...prompt }
  if (prompt.system !== undefined && have.has(prompt.systemHash)) delete pruned.system
  if (prompt.tools !== undefined && prompt.toolsHash && have.has(prompt.toolsHash)) delete pruned.tools
  return pruned
}

/** How a relayed entry resolves: the far session's prose (a refusal is a reply),
 *  its relayed-unexecuted tool calls (v2 — the loop continues with a follow-up
 *  entry carrying the executed results), or the connector's own explicit
 *  failure (§7.6). */
export type RelayOutcome =
  | { kind: 'completion'; text: string }
  | { kind: 'toolCalls'; calls: RelayToolCall[] }
  | { kind: 'error'; reason: string }

interface InflightTurn {
  entryId: string
  /** The platform conversation this turn belongs to (v4 — one in-flight entry
   *  per channel; the prompt's `channel.id`, '' for a channel-less prompt). */
  channelId: string
  prompt: RelayPrompt
  /** Delivered to a puller (the generation gap) vs still waiting for one. */
  taken: boolean
  settle: (o: RelayOutcome) => void
}

interface ParkedPoll {
  resolve: (r: RelayPollResult) => void
  timer: ReturnType<typeof setTimeout>
  /** The framing/tool hashes this puller advertised as cached — bodies it
   *  already holds are stripped from whatever prompt it is handed. */
  have: ReadonlySet<string>
}

let entrySeq = 0

/** The allocation-free empty view `turnsOf` hands back for unknown relays. */
const EMPTY_TURNS: ReadonlyMap<string, InflightTurn> = new Map()

/** The transient half of every relay, keyed by provider id (the relay id IS the
 *  provider id, §7.3). Since v4 a relay admits SEVERAL in-flight entries — one
 *  per **channel** (UI session), capped by `RELAY_MAX_INFLIGHT` — so distinct
 *  conversations run concurrently over one drain loop while a channel still
 *  admits one turn at a time. Constructed by the store with its `emit`, like
 *  `RunnerRegistry`. */
export class RelayRuntime {
  /** providerId → entryId → turn (insertion order = delivery order). */
  private readonly inflight = new Map<string, Map<string, InflightTurn>>()
  private readonly parked = new Map<string, ParkedPoll>()
  private readonly lastSeen = new Map<string, number>()
  /** The v5 serving handshake's far-side half: the concurrent-conversation count
   *  the binding's polls advertise (`?channels=`), re-recorded on EVERY poll
   *  (stateless, like the `have` hashes). Absent advertisement = 1 — a silent
   *  far side is SERIAL (a pre-v4 connector's depth-1 buffer drops a second
   *  undelivered prompt, so fanning out to it would lose turns). Transient,
   *  like everything here. */
  private readonly advertised = new Map<string, number>()
  /** Relays currently announced online (drives edge-triggered relay.* events). */
  private readonly announced = new Set<string>()
  private readonly reapTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly emit: (e: ServerEvent) => void
  private readonly now: () => number

  // Explicit field assignment (not parameter properties) — Node's runtime
  // type-stripping only supports erasable TS syntax.
  constructor(emit: (e: ServerEvent) => void, now: () => number = () => Date.now()) {
    this.emit = emit
    this.now = now
  }

  private ttlMs(): number {
    return positiveNumberEnv(process.env.RELAY_TTL_MS, 90_000)
  }
  private pollWindowMs(): number {
    return positiveNumberEnv(process.env.RELAY_POLL_MS, 25_000)
  }
  /** Concurrent-conversation ceiling per relay (v4): how many channels may hold
   *  an in-flight entry at once. Guards the far session from a pile-up it can
   *  only drain one prompt at a time; beyond it the pre-turn gate refuses busy. */
  private maxInflight(): number {
    return positiveNumberEnv(process.env.RELAY_MAX_INFLIGHT, 4)
  }

  /** Read-only view of a relay's in-flight turns — never allocates (reads for
   *  unknown/retired relays must not seed the map; only `offer` creates). */
  private turnsOf(providerId: string): ReadonlyMap<string, InflightTurn> {
    return this.inflight.get(providerId) ?? EMPTY_TURNS
  }

  /** Online = a parked puller OR an in-flight turn OR a fresh `lastSeen` (§7.3).
   *  The in-flight entry keeps a relay alive across the generation gap, when no
   *  socket is held; the TTL covers only the sub-second idle re-poll hop. */
  online(providerId: string): boolean {
    if (this.parked.has(providerId) || this.turnsOf(providerId).size > 0) return true
    const seen = this.lastSeen.get(providerId)
    return seen !== undefined && this.now() - seen < this.ttlMs()
  }

  /** One turn at a time per CHANNEL (v4) — the `relay_busy` pre-turn gate reads
   *  this for the sending session; other sessions' turns run concurrently. */
  busy(providerId: string, channelId: string): boolean {
    for (const turn of this.turnsOf(providerId).values()) if (turn.channelId === channelId) return true
    return false
  }

  /** The NEGOTIATED concurrent-conversation ceiling (v5 handshake): the server
   *  cap bounded by what the binding's polls advertise. No advertisement ⇒ 1. */
  window(providerId: string): number {
    return Math.min(this.maxInflight(), this.advertised.get(providerId) ?? 1)
  }

  /** How many conversations hold an in-flight turn right now (≤ one entry per
   *  channel — the per-channel wall — so the entry count IS the channel count). */
  activeConversations(providerId: string): number {
    return this.turnsOf(providerId).size
  }

  /** The relay-wide ceiling (v4; negotiated since v5): every admitted slot is
   *  taken — the pre-turn gate refuses a NEW conversation's turn until one
   *  settles. */
  atCapacity(providerId: string): boolean {
    return this.turnsOf(providerId).size >= this.window(providerId)
  }

  /** The observed half of the v5 handshake: an entry was delivered or settled.
   *  Thin by convention (the client re-reads the providers list for the
   *  `activeConversations` / `conversationWindow` stamps). */
  private notifyActivity(providerId: string): void {
    this.emit({ type: 'relay.activity', providerId })
  }

  /** A connector activity (poll / reply) proves liveness: refresh `lastSeen`,
   *  announce the flip to online, and re-arm the offline check. */
  private markSeen(providerId: string): void {
    this.lastSeen.set(providerId, this.now())
    if (!this.announced.has(providerId)) {
      this.announced.add(providerId)
      this.emit({ type: 'relay.connected', providerId })
    }
    this.armReap(providerId)
  }

  /** Re-arm the single offline check. Edge-triggered like `reapStale`, but timer-
   *  driven: when it fires and nothing keeps the relay online, announce offline.
   *  (`unref` so a pending check never holds the process open.) */
  private armReap(providerId: string): void {
    const prev = this.reapTimers.get(providerId)
    if (prev) clearTimeout(prev)
    const timer = setTimeout(() => {
      this.reapTimers.delete(providerId)
      if (this.online(providerId)) this.armReap(providerId)
      else if (this.announced.delete(providerId)) this.emit({ type: 'relay.disconnected', providerId })
    }, this.ttlMs() + 50)
    ;(timer as { unref?: () => void }).unref?.()
    this.reapTimers.set(providerId, timer)
  }

  /** Offer a turn's prompt to the relay's mailbox. Returns the entry + the
   *  completion promise `relayReply` awaits, or `undefined` when the prompt's
   *  channel already has a turn in flight or the relay is at its concurrency
   *  ceiling (the busy races the pre-turn gate usually catches first). A
   *  `continuation` offer (a tool round of a turn already underway — the channel
   *  held a slot until its previous round settled a moment ago) bypasses only
   *  the CEILING, never the per-channel wall: without the bypass, a rival
   *  channel filling the last slot between rounds would fail a mid-flight
   *  conversation, and the transient overshoot is bounded by the number of
   *  turns already admitted. If a puller is parked, the prompt is handed over
   *  on the spot — a parked puller means no undelivered entry exists, so this
   *  one is next. */
  offer(providerId: string, prompt: RelayPrompt, continuation = false): { entryId: string; completion: Promise<RelayOutcome> } | undefined {
    const channelId = prompt.channel?.id ?? ''
    if (this.busy(providerId, channelId) || (!continuation && this.atCapacity(providerId))) return undefined
    const entryId = `rve-${(entrySeq += 1).toString(36)}-${this.now().toString(36)}`
    let settle!: (o: RelayOutcome) => void
    const completion = new Promise<RelayOutcome>((resolve) => {
      settle = resolve
    })
    const turn: InflightTurn = { entryId, channelId, prompt, taken: false, settle }
    let turns = this.inflight.get(providerId)
    if (!turns) {
      turns = new Map()
      this.inflight.set(providerId, turns)
    }
    turns.set(entryId, turn)
    const parked = this.parked.get(providerId)
    if (parked) {
      this.parked.delete(providerId)
      clearTimeout(parked.timer)
      turn.taken = true
      parked.resolve({ entryId, prompt: deliverPrompt(prompt, parked.have) })
    }
    // One signal per offer, delivered-on-the-spot or queued alike — the entry
    // now COUNTS toward `activeConversations`, so the observers must hear it.
    this.notifyActivity(providerId)
    return { entryId, completion }
  }

  /** A connector's long-poll. Resolves with the oldest undelivered prompt (now
   *  or when one arrives), `{idle}` after the bounded window (the §4.2 re-call
   *  sentinel), or `{superseded}` when a newer poll takes the parked slot
   *  (newest wins — a zombie socket must not lock out the restarted loop) or the
   *  relay retires. `abandon` is the socket-close hook: it unparks AND resolves,
   *  so the route handler never dangles. */
  poll(
    providerId: string,
    have: ReadonlySet<string> = new Set(),
    channels?: number,
  ): { result: Promise<RelayPollResult>; abandon: () => void } {
    // Record the advertisement EVERY poll (stateless, like `have`): a malformed
    // or absent value reads as serial — the minimal-risk meaning (INV-9's shape:
    // an absence never widens what the far side is sent).
    this.advertised.set(providerId, Number.isFinite(channels) && channels! >= 1 ? Math.min(Math.floor(channels!), 16) : 1)
    this.markSeen(providerId)
    for (const turn of this.turnsOf(providerId).values()) {
      if (turn.taken) continue
      turn.taken = true
      this.notifyActivity(providerId)
      return { result: Promise.resolve({ entryId: turn.entryId, prompt: deliverPrompt(turn.prompt, have) }), abandon: () => {} }
    }
    const prev = this.parked.get(providerId)
    if (prev) {
      this.parked.delete(providerId)
      clearTimeout(prev.timer)
      prev.resolve({ superseded: true })
    }
    let resolveResult!: (r: RelayPollResult) => void
    const result = new Promise<RelayPollResult>((resolve) => {
      resolveResult = resolve
    })
    const parked: ParkedPoll = {
      resolve: resolveResult,
      timer: setTimeout(() => this.unpark(providerId, parked, { idle: true }), this.pollWindowMs()),
      have,
    }
    ;(parked.timer as { unref?: () => void }).unref?.()
    this.parked.set(providerId, parked)
    return { result, abandon: () => this.unpark(providerId, parked, { idle: true }) }
  }

  /** Remove THIS parked poll (if still the one parked) and settle its promise.
   *  Idempotent — the window timer and the socket-close hook can both fire. */
  private unpark(providerId: string, parked: ParkedPoll, result: RelayPollResult): void {
    if (this.parked.get(providerId) !== parked) return
    this.parked.delete(providerId)
    clearTimeout(parked.timer)
    parked.resolve(result)
    this.armReap(providerId) // the socket just left — start the idle-gap clock
  }

  /** A connector's answer. Settles the entry it names — only the live one; a late
   *  or duplicate submit gets `gone` (410: settled or gone, drop it and poll on).
   *  The one response covers post-deadline, post-cancel, post-rotate AND
   *  network-retry duplicates (§7.1 — no recorded-ack cache to maintain). */
  submit(providerId: string, entryId: string, outcome: RelayOutcome): 'accepted' | 'gone' {
    this.markSeen(providerId)
    const turns = this.inflight.get(providerId)
    const turn = turns?.get(entryId)
    if (!turns || !turn) return 'gone'
    turns.delete(entryId)
    turn.settle(outcome)
    this.notifyActivity(providerId)
    return 'accepted'
  }

  /** Drop an in-flight entry WITHOUT settling — `relayReply`'s own deadline or
   *  cancel path already resolved its race; a late submit now meets 410. */
  clear(providerId: string, entryId: string): void {
    if (this.inflight.get(providerId)?.delete(entryId)) this.notifyActivity(providerId)
  }

  /** The kill switch (rotate / delete — §7.5): the parked poll is superseded on
   *  the spot, every in-flight turn fails to its fallback immediately (not at
   *  the deadline), and the relay announces offline. A later poll re-binds only
   *  by presenting whatever secret the provider row NOW carries. */
  retire(providerId: string): void {
    const parked = this.parked.get(providerId)
    if (parked) this.unpark(providerId, parked, { superseded: true })
    for (const turn of this.turnsOf(providerId).values()) {
      turn.settle({ kind: 'error', reason: 'The relay was rotated or removed.' })
    }
    this.inflight.delete(providerId)
    this.advertised.delete(providerId)
    this.lastSeen.delete(providerId)
    const timer = this.reapTimers.get(providerId)
    if (timer) clearTimeout(timer)
    this.reapTimers.delete(providerId)
    if (this.announced.delete(providerId)) this.emit({ type: 'relay.disconnected', providerId })
  }
}

/** ── relayReply — the relay transport's turn driver ──────────────────────────
 *  The `kind:'session'` sibling of `generateReply`, behind the exact same seam
 *  (`ReplyHandlers` in, `ReplyResult` out) so the messages route around it doesn't
 *  change. No Messages impersonation anywhere (§6.5): it owns its own deadline
 *  (`RELAY_TIMEOUT_MS`, spanning the WHOLE turn — every tool round shares it),
 *  knows its relay as a plain argument, streams the whole completion via
 *  `chunkText` (no token streaming — the reply arrives when the far session
 *  answers), and estimates usage (~4 chars/token — the backend never sees the
 *  far session's real meter). Degrades to the relay-specific fallback copy on
 *  deadline or error — mid-turn included, which the shared `fallbackReply`
 *  couldn't say.
 *
 *  v2 runs the same tool-use loop `generateReply` runs, over the mailbox: the
 *  prompt document declares the turn's tools (the Agent's allowlist + the
 *  session's attached connectors); the far session RELAYS tool calls back
 *  unexecuted (`toolCalls` — the relay-not-execute discipline); the backend
 *  executes each into the identical consent-gated proposal a dial-out turn
 *  produces and offers a follow-up entry carrying the `toolResults`; the loop
 *  ends on prose. One offer/settle per round — the slot protocol is unchanged. */

const FALLBACK_TIMEOUT =
  'Your delegated session didn’t answer in time — make sure its drain loop is still running, then try again.'
const FALLBACK_DEGENERATE =
  'Your delegated session couldn’t produce a reply just now (its connector reported an error or an empty answer). Check the session and try again.'
const FALLBACK_BUSY = 'Your delegated session couldn’t take this turn — another turn claimed its slot first. Try again in a moment.'
const FALLBACK_LOOP =
  'Your delegated session kept relaying tool calls without concluding — the turn was stopped. Try again, or simplify the request.'

/** Tool rounds per turn (matching `generateReply`'s call→results→prose shape,
 *  with headroom) — a runaway far session can't spin the mailbox forever. */
const MAX_TOOL_ROUNDS = 4

/** Stream a local relay-fallback message — the relay mirror of `fallbackReply`. */
function relayFallback(handlers: ReplyHandlers, content: string): ReplyResult {
  const id = `msg_relay_fallback_${Date.now().toString(36)}`
  handlers.onStart(id)
  for (const c of chunkText(content)) handlers.onDelta(c)
  return { message: { id, role: 'assistant', content }, usage: { inputTokens: 0, outputTokens: 0 }, outcome: 'fallback' }
}

const estimateTokens = (s: string): number => Math.ceil(s.length / 4)

/** ~4-chars/token estimate over the whole document — prose turns plus the JSON
 *  weight of relayed calls/results (the far session read those too). */
const turnChars = (t: RelayPromptTurn): number =>
  (t.text?.length ?? 0) + (t.toolCalls ? JSON.stringify(t.toolCalls).length : 0) + (t.toolResults ? JSON.stringify(t.toolResults).length : 0)

export async function relayReply(
  session: ReplySession,
  agent: Agent,
  text: string,
  handlers: ReplyHandlers,
  signal: AbortSignal | undefined,
  relay: RelayRuntime,
  providerId: string,
  commons?: ToolContext['commons'],
  connectorContexts: SessionContext[] = [],
  history: RelayPromptTurn[] = [],
): Promise<ReplyResult> {
  // The turn's callable surface — the exact list `generateReply` declares: the
  // Agent's allowlist plus the session's attached connector/MCP tools (P6;
  // authority stays structural — only what's attached is reachable). Renamed to
  // the wire's `inputSchema` so the contract stays SDK-shape-free.
  const ctx: ToolContext = { session: { id: session.id, title: session.title }, commons }
  const agentTools = TOOL_DEFINITIONS.filter((t) => agent.tools.includes(t.name))
  const { definitions: connectorDefs, bindings: connectorBindings } = deriveConnectorTools(connectorContexts)
  const tools: RelayToolDefinition[] = [...agentTools, ...connectorDefs].map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema as unknown as Record<string, unknown>,
  }))
  const system = systemPrompt(session, agent)
  // Content-address the near-invariant parts once per turn (v3 framing dedupe):
  // delivery strips whichever bodies the pulling connector already holds.
  const systemHash = hashRelayContent(system)
  const toolsHash = tools.length ? hashRelayContent(JSON.stringify(tools)) : undefined
  // The prompt survives as a document, not a string (§7.4): system framing apart
  // from the turns. Since v4 the document opens with the CHANNEL's full prior
  // history (multi-session relays: every entry is self-contained, so the far
  // side needs no per-channel memory — any executor can answer any entry), then
  // the new user turn; the loop appends a relayed-calls turn + an executed-
  // results turn per round, so every follow-up entry carries the WHOLE exchange
  // — the mailbox is stateless across entries by design.
  const channel = { id: session.id, title: session.title }
  const turns: RelayPromptTurn[] = [...history, { role: 'user', text: text.trim() || '(the user sent an empty message)' }]

  // The consent-gated proposals the relayed tool calls accumulate — identical
  // collection to `generateReply`'s (including the same-turn chaining window:
  // ctx.pending lets create_agent bundle a prompt proposed in an earlier round).
  const relationOps: RelationOp[] = []
  ctx.pending = relationOps
  const toolActivities: ToolActivity[] = []
  let escalation: EscalationProposal | undefined

  // ONE deadline spans the whole turn — tool rounds share it, so a chatty far
  // session can't stretch a turn to rounds × timeout.
  const timeoutMs = positiveNumberEnv(process.env.RELAY_TIMEOUT_MS, 120_000)
  const startedAt = Date.now()

  for (let round = 0; ; round += 1) {
    // Rounds past the first are CONTINUATIONS: the channel held a slot until its
    // previous round settled, so they bypass the concurrency ceiling — a rival
    // channel grabbing the last slot between rounds must not fail a conversation
    // already mid-flight (the per-channel wall still applies).
    const offer = relay.offer(providerId, { system, systemHash, channel, messages: turns, ...(tools.length ? { tools, toolsHash } : {}) }, round > 0)
    // The pre-turn gate refused busy before anything persisted; this catches only
    // the enqueue race behind it.
    if (!offer) return relayFallback(handlers, FALLBACK_BUSY)

    const remaining = timeoutMs - (Date.now() - startedAt)
    const raced =
      remaining <= 0
        ? 'timeout'
        : await new Promise<RelayOutcome | 'timeout' | 'cancelled'>((resolve) => {
            const timer = setTimeout(() => resolve('timeout'), remaining)
            ;(timer as { unref?: () => void }).unref?.()
            const onAbort = () => resolve('cancelled')
            signal?.addEventListener('abort', onAbort, { once: true })
            void offer.completion.then((o) => {
              clearTimeout(timer)
              signal?.removeEventListener('abort', onAbort)
              resolve(o)
            })
          })

    if (raced === 'cancelled') {
      relay.clear(providerId, offer.entryId) // a late submit meets 410, never a wrong turn
      throw new Error('relay turn cancelled') // the route's catch reads the signal, persists nothing
    }
    if (raced === 'timeout') {
      relay.clear(providerId, offer.entryId)
      return relayFallback(handlers, FALLBACK_TIMEOUT)
    }
    // An explicit connector error, and an empty/whitespace completion normalised to
    // one, both fall back — final, no redelivery (§7.6). A refusal is a completion.
    if (raced.kind === 'error' || (raced.kind === 'completion' && !raced.text.trim())) {
      return relayFallback(handlers, FALLBACK_DEGENERATE)
    }

    if (raced.kind === 'toolCalls') {
      // Relayed calls against a tool-less prompt, or a far session that never
      // concludes, both stop the turn honestly rather than spinning the slot.
      if (!tools.length || round >= MAX_TOOL_ROUNDS - 1) return relayFallback(handlers, FALLBACK_LOOP)
      const results = raced.calls.map((call) => {
        // A connector/MCP tool (P6) executes into a ToolActivity; anything else is a
        // built-in resource / relation / escalation tool — the same dispatch (and the
        // same honest "proposed, not done" wording) as `generateReply`'s.
        const activity = runConnectorTool(call.name, connectorBindings, call.id)
        if (activity) {
          toolActivities.push(activity)
          const content =
            activity.status === 'proposed' ? 'Proposed to the user — awaiting their confirmation; not executed yet.' : activity.summary
          return { toolCallId: call.id, content }
        }
        // `executeTool` answers an unknown name with a no-effect summary — fed back
        // so the far model can correct itself next round instead of failing the turn.
        const effect = executeTool(call.name, call.input ?? {}, ctx)
        if (effect.relationOps) relationOps.push(...effect.relationOps)
        if (effect.escalation) escalation = effect.escalation
        return { toolCallId: call.id, content: effect.summary }
      })
      turns.push({ role: 'assistant', toolCalls: raced.calls }, { role: 'user', toolResults: results })
      continue
    }

    // Prose — the turn concludes, carrying whatever proposals the rounds built.
    const content = raced.text
    const id = `msg_relay_${Date.now().toString(36)}`
    handlers.onStart(id)
    for (const c of chunkText(content)) handlers.onDelta(c)
    return {
      message: {
        id,
        role: 'assistant',
        content,
        relationActions: relationOps.length ? relationOps : undefined,
        escalation,
        toolActivities: toolActivities.length ? toolActivities : undefined,
      },
      usage: {
        inputTokens: estimateTokens(system) + turns.reduce((sum, t) => sum + Math.ceil(turnChars(t) / 4), 0),
        outputTokens: estimateTokens(content),
      },
      outcome: 'ok',
    }
  }
}
