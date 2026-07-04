/** ── The delegated-cognition relay (docs/delegated-cognition-provider.md) ────
 *  The second transport a Model provider can ride: instead of an endpoint the
 *  backend dials OUT to (`generateReply`), a `kind:'session'` provider is dialed
 *  INTO — a connector next to an AI session the user already runs long-polls
 *  `GET /relay/poll` with the rendezvous secret, receives a turn's prompt, lets
 *  its session's model generate, and posts the answer to `POST /relay/reply`.
 *
 *  Deliberately small (the third design pass): per relay there is at most **one
 *  in-flight prompt** (a slot, not a mailbox — a concurrent second turn refuses
 *  fast as `relay_busy`) and at most **one parked puller** (newest wins — a fresh
 *  poll preempts a zombie socket). Binding is presenting the secret: there is no
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
import type { Agent, RelayPollResult, RelayPrompt, ServerEvent } from '../contract/index.ts'
import { systemPrompt, type ReplyHandlers, type ReplyResult, type ReplySession } from './generate.ts'
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

/** How a relayed turn resolves: the far session's prose (a refusal is a reply),
 *  or the connector's own explicit failure (§7.6). */
export type RelayOutcome = { kind: 'completion'; text: string } | { kind: 'error'; reason: string }

interface InflightTurn {
  entryId: string
  prompt: RelayPrompt
  /** Delivered to a puller (the generation gap) vs still waiting for one. */
  taken: boolean
  settle: (o: RelayOutcome) => void
}

interface ParkedPoll {
  resolve: (r: RelayPollResult) => void
  timer: ReturnType<typeof setTimeout>
}

let entrySeq = 0

/** The transient half of every relay, keyed by provider id (the relay id IS the
 *  provider id — one session per provider, §7.3). Constructed by the store with
 *  its `emit`, like `RunnerRegistry`. */
export class RelayRuntime {
  private readonly inflight = new Map<string, InflightTurn>()
  private readonly parked = new Map<string, ParkedPoll>()
  private readonly lastSeen = new Map<string, number>()
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

  /** Online = a parked puller OR an in-flight turn OR a fresh `lastSeen` (§7.3).
   *  The in-flight entry keeps a relay alive across the generation gap, when no
   *  socket is held; the TTL covers only the sub-second idle re-poll hop. */
  online(providerId: string): boolean {
    if (this.parked.has(providerId) || this.inflight.has(providerId)) return true
    const seen = this.lastSeen.get(providerId)
    return seen !== undefined && this.now() - seen < this.ttlMs()
  }

  /** One turn at a time per relay — the `relay_busy` pre-turn gate reads this. */
  busy(providerId: string): boolean {
    return this.inflight.has(providerId)
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

  /** Offer a turn's prompt to the relay's slot. Returns the entry + the completion
   *  promise `relayReply` awaits, or `undefined` when a turn is already in flight
   *  (the busy race the pre-turn gate usually catches first). If a puller is
   *  parked, the prompt is handed over on the spot — the mailbox's symmetric
   *  long-poll, degenerated to one entry. */
  offer(providerId: string, prompt: RelayPrompt): { entryId: string; completion: Promise<RelayOutcome> } | undefined {
    if (this.inflight.has(providerId)) return undefined
    const entryId = `rve-${(entrySeq += 1).toString(36)}-${this.now().toString(36)}`
    let settle!: (o: RelayOutcome) => void
    const completion = new Promise<RelayOutcome>((resolve) => {
      settle = resolve
    })
    const turn: InflightTurn = { entryId, prompt, taken: false, settle }
    this.inflight.set(providerId, turn)
    const parked = this.parked.get(providerId)
    if (parked) {
      this.parked.delete(providerId)
      clearTimeout(parked.timer)
      turn.taken = true
      parked.resolve({ entryId, prompt })
    }
    return { entryId, completion }
  }

  /** A connector's long-poll. Resolves with the pending prompt (now or when one
   *  arrives), `{idle}` after the bounded window (the §4.2 re-call sentinel), or
   *  `{superseded}` when a newer poll takes the parked slot (newest wins — a
   *  zombie socket must not lock out the restarted loop) or the relay retires.
   *  `abandon` is the socket-close hook: it unparks AND resolves, so the route
   *  handler never dangles. */
  poll(providerId: string): { result: Promise<RelayPollResult>; abandon: () => void } {
    this.markSeen(providerId)
    const turn = this.inflight.get(providerId)
    if (turn && !turn.taken) {
      turn.taken = true
      return { result: Promise.resolve({ entryId: turn.entryId, prompt: turn.prompt }), abandon: () => {} }
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
    const turn = this.inflight.get(providerId)
    if (!turn || turn.entryId !== entryId) return 'gone'
    this.inflight.delete(providerId)
    turn.settle(outcome)
    return 'accepted'
  }

  /** Drop the in-flight entry WITHOUT settling — `relayReply`'s own deadline or
   *  cancel path already resolved its race; a late submit now meets 410. */
  clear(providerId: string, entryId: string): void {
    const turn = this.inflight.get(providerId)
    if (turn && turn.entryId === entryId) this.inflight.delete(providerId)
  }

  /** The kill switch (rotate / delete — §7.5): the parked poll is superseded on
   *  the spot, the in-flight turn fails to its fallback immediately (not at the
   *  deadline), and the relay announces offline. A later poll re-binds only by
   *  presenting whatever secret the provider row NOW carries. */
  retire(providerId: string): void {
    const parked = this.parked.get(providerId)
    if (parked) this.unpark(providerId, parked, { superseded: true })
    const turn = this.inflight.get(providerId)
    if (turn) {
      this.inflight.delete(providerId)
      turn.settle({ kind: 'error', reason: 'The relay was rotated or removed.' })
    }
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
 *  (`RELAY_TIMEOUT_MS`), knows its relay as a plain argument, streams the whole
 *  completion via `chunkText` (v1 has no token streaming — the reply arrives when
 *  the far session answers), and estimates usage (~4 chars/token — the backend
 *  never sees the far session's real meter). Degrades to the relay-specific
 *  fallback copy on deadline or error — mid-turn included, which the shared
 *  `fallbackReply` couldn't say. */

const FALLBACK_TIMEOUT =
  'Your delegated session didn’t answer in time — make sure its drain loop is still running, then try again.'
const FALLBACK_DEGENERATE =
  'Your delegated session couldn’t produce a reply just now (its connector reported an error or an empty answer). Check the session and try again.'
const FALLBACK_BUSY = 'Your delegated session is still answering another turn — try again when it finishes.'

/** Stream a local relay-fallback message — the relay mirror of `fallbackReply`. */
function relayFallback(handlers: ReplyHandlers, content: string): ReplyResult {
  const id = `msg_relay_fallback_${Date.now().toString(36)}`
  handlers.onStart(id)
  for (const c of chunkText(content)) handlers.onDelta(c)
  return { message: { id, role: 'assistant', content }, usage: { inputTokens: 0, outputTokens: 0 }, outcome: 'fallback' }
}

const estimateTokens = (s: string): number => Math.ceil(s.length / 4)

export async function relayReply(
  session: ReplySession,
  agent: Agent,
  text: string,
  handlers: ReplyHandlers,
  signal: AbortSignal | undefined,
  relay: RelayRuntime,
  providerId: string,
): Promise<ReplyResult> {
  // The prompt survives as a document, not a string (§7.4): system framing apart
  // from the turns, built from the same inputs `generateReply` receives. v1 is
  // prose-only, so a turn is exactly `system` + one user turn — near-lossless.
  const prompt: RelayPrompt = {
    system: systemPrompt(session, agent),
    messages: [{ role: 'user', text: text.trim() || '(the user sent an empty message)' }],
  }
  const offer = relay.offer(providerId, prompt)
  // The pre-turn gate refused busy before anything persisted; this catches only
  // the enqueue race behind it.
  if (!offer) return relayFallback(handlers, FALLBACK_BUSY)

  const timeoutMs = positiveNumberEnv(process.env.RELAY_TIMEOUT_MS, 120_000)
  const raced = await new Promise<RelayOutcome | 'timeout' | 'cancelled'>((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), timeoutMs)
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
  if (raced.kind === 'error' || !raced.text.trim()) return relayFallback(handlers, FALLBACK_DEGENERATE)

  const content = raced.text
  const id = `msg_relay_${Date.now().toString(36)}`
  handlers.onStart(id)
  for (const c of chunkText(content)) handlers.onDelta(c)
  return {
    message: { id, role: 'assistant', content },
    usage: {
      inputTokens: estimateTokens(prompt.system) + estimateTokens(prompt.messages.map((m) => m.text).join('\n')),
      outputTokens: estimateTokens(content),
    },
    outcome: 'ok',
  }
}
