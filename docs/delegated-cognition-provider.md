# Delegated-cognition providers ("Session providers") — a D9 extension

> **Status: forward-looking design, NOT built.** This is a design log entry (like
> [`capability-broker-architecture.md`](capability-broker-architecture.md)), not
> shipped behaviour. It extends **D9 — Model providers** in
> [`agent-commons.md`](agent-commons.md) and builds directly on **slice 18**
> (provider endpoints as data: `server/generate.ts` `clientFor`, the server-only
> `ProviderConfig`, `probeProviderEndpoint`, the `capabilities.toolUse` gate).
> Nothing here is implemented; the "decisions" are settled *within this exploration*.
> Continued in a second pass: **§7** rules the edge cases the first pass left open
> (and §6.5 records the correction that pass surfaced); **§10** is what remains — the
> v2 checklist.

## 1. What it is

A **delegated-cognition provider** (surfaced to the user as a **"Session provider"**)
is a `ModelProvider` whose cognition is performed by an **AI agent session the user
already runs** — Claude Desktop/Code, an SDK agent, any tool-use loop — rather than by
an endpoint our backend dials. Our backend cannot reach the model directly (it's
firewalled, key-less, or has no API); instead the user's session **drains a mailbox we
host** at a one-time **rendezvous secret**: we enqueue a turn's prompt, the session's
own model generates the reply, and it submits the completion back.

It is the **cognition-plane mirror of a Runner**: a Runner is a host-bound thing that
*pulls* capability requests and *pushes* effect reports (hands: fs/terminal/process); a
Session provider is a session-bound thing that *pulls* prompts and *pushes* completions
(mind: Messages cognition). The broker doc already reserves the phrase "the model relay"
for exactly this ([`capability-broker-architecture.md`](capability-broker-architecture.md),
State-plane elements).

## 2. Why — and the honest boundary

Slice 18 made a provider *data we dial*. This serves the case slice 18 structurally
**cannot**: a cognition source that is un-dialable (private/firewalled), has no shareable
credential, or has no API at all — you only have a *running session* that can think.

Be clear-eyed: **slice 18 dominates on every axis whenever a dialable endpoint exists**
(loud mint-time conformance, fast liveness, token-by-token streaming, full tool-use, and
horizontal scale). A Session provider is quieter to diagnose, human/agent-paced,
prose-only in v1, and serialises behind one worker. It wins in exactly one scenario —
un-dialable cognition — and that is the only reason to build it.

The generalisation worth keeping: **any running agent session that can pull-and-answer is
a cognition source.** Provenance is opaque past the rendezvous boundary — the backend
cannot tell Claude-in-a-loop from a small local model from a human typing. That is both
the portability feature and the security note.

## 3. The invariant: preserved and inverted

Slice 18's invariant is two invariants fused:

- **Preserved — "the backend speaks one protocol and knows zero providers."** Cognition
  is still Messages-shaped; the backend still has no provider-specific code. `generateReply`,
  the two-turn tool-use loop, `clientFor`, and `fallbackReply` stay **byte-for-byte
  unchanged**; `withDeadline` bends in exactly one recorded place (§6.5) — it accepts the
  turn deadline as an *argument*, so a provider's patience becomes provider **data**, still
  zero provider-specific code.
- **Inverted — the actor direction.** Every provider today is something the backend
  *dials out* to. This one is *dialed into*: cognition arrives by the source draining a
  queue we host. So this is a new provider **transport** (dial-out request/response vs.
  rendezvous dial-in/long-poll), orthogonal to the Messages invariant — which is why it
  can be added without touching the hot loop.

## 4. User-visible workflows (the design is workflow-first)

### 4.1 Create a Session provider
Agents hub → Providers sub-tab → New provider → **kind toggle: "API endpoint" (today) vs
"My AI session" (new)**. The session form asks for nothing we'd dial (no base URL, no
key) — just a label ("My laptop's Claude") and effort levels (marked *advisory*). On
Create, a **one-time panel** shows: the **rendezvous secret** (shown once, Copy), the
command to start the user-side connector, and a prominent **"Prose only"** badge. Dismiss
is gated behind an "I've saved it" checkbox, with the plain warning: *this is a password —
anyone who has it can put words in your assistant's mouth.* The provider then appears with
a grey **offline** dot and a `Session · prose-only` subtitle; re-opening it shows only a
masked `rv_live_••••3f9a` fingerprint + a **Rotate** action, never the secret again.

### 4.2 Wire the user side — the drain mechanism
The user-side integration is **one MCP server** the user runs next to their session; MCP is
the convenience interface (the standard way to enlist a session), and the connection to our
rendezvous URL lives inside that MCP server (it is an ordinary process; it can hold an
outbound long-poll). What *drives the session's model to keep generating* has three forms,
in preference order:

- **Case B — a blocking `respond_and_wait` tool (the default).** The user asks their
  session to start draining; the session's model calls one tool that **blocks** (long-polls)
  until a prompt arrives, returns it, the model generates, and the model's answer is the
  argument to the *next* call — one atomic submit-and-re-block:
  ```
  prompt = start()                    # block until first prompt
  # model generates answer
  prompt = respond_and_wait(answer)   # submit last answer, block for next
  # model generates answer …
  ```
  The loop is just the model repeatedly calling one tool. It is robust precisely *because
  the block keeps the model captive* — parked inside the tool call, it never reaches a turn
  boundary where it might decide it's done.
- **Case A — MCP sampling.** If the user's host implements MCP `sampling/createMessage`
  (server→client "run a completion on your model"), the MCP server itself drives cognition:
  hold our connection, on each pulled prompt issue a sampling request, submit the result. No
  standing instruction. Caveat: sampling is an *optional* capability with uneven host
  support, and is often per-call user-approved.
- **Case C — an external driver (fallback).** Only needed for a passive chat host with no
  sampling that won't sustain a loop: a small wrapper process keeps re-prompting the session.
  Demoted to a documented alternate; not the baseline.

**Three caveats the drain loop must be built around** (they hold for Case B especially):
1. **The context window is the real lifetime bound.** Each iteration appends (tool call,
   returned prompt, generated answer) to the session's own conversation, so a long-running
   loop fills context and eventually compacts/dies. The loop is *not* eternal — which is why
   the liveness model (§5) still earns its place: "the session went away" is normal.
2. **The held connection *is* the liveness signal.** While the model is parked in
   `respond_and_wait`, a long-poll socket is held open against our mailbox. So **online = a
   puller is currently blocked waiting on this relay's mailbox; offline = no holder for the
   TTL** — no separate heartbeat cadence needed.
3. **"Block forever" is really a bounded long-poll + a re-call sentinel.** Many MCP hosts
   cap single-tool-call duration, so the tool long-polls ~30–45s and, if empty, returns a
   `{status:"idle, call me again"}` sentinel. An empty return hands the model a turn boundary
   — the one moment it could stop — so the standing instruction must be firm ("whenever
   `respond_and_wait` returns idle, immediately call it again"). This seam is where the loop
   can stall; make the sentinel + instruction explicit.

### 4.3 Assign an Agent and run a turn
Agents sub-tab → edit an Agent → Provider picker → the Session provider (the picker carries
the "prose-only" badge inline, so the trade-off is visible at bind time). A turn then runs
*normally* — the composer streams the reply — with one difference: **no relation-edit cards,
no escalations** (there is no tool-use on this provider). If the session is offline when the
user sends, the turn **fails fast** with a distinct message — *"Your session isn't answering
— start its drain loop and retry"* — never the generic "couldn't reach the endpoint", and
never a 60-second hang.

### 4.4 Offline / reconnect / restart
Laptop sleeps or the loop exhausts context → the held connection drops → the dot greys
everywhere over SSE. Restart the session/loop → the connector re-presents *the same secret* →
re-binds the **same provider id** → green again, no re-create. This must survive a **backend
restart** too (see §6.1).

### 4.5 Rotate / revoke
**Rotate** mints a fresh secret and invalidates the old immediately (re-run the connector with
the new one). **Delete** refuses with 409 if an Agent still binds it (existing `deleteProvider`
guard), else removes the provider **and permanently kills the secret** — the *opposite* of
runner deregister, which preserves identity to re-bind. A connector holding the old secret gets
a 401 on its next pull.

### 4.6 The prose-only limitation, declared not discovered
The same "Prose only" badge rides every surface — create panel, list subtitle, the Agent
provider picker, and an inline note on the first reply from a Session-provider Agent — with a
tooltip: *turns on your session converse only; they can't propose relation edits, escalations,
or run tools, because the relay carries plain text, not tool calls.*

## 5. Enabling design (our side)

- **A new `RelayRegistry`, mirroring `RunnerRegistry`** (`server/registry.ts`): durable id,
  `online|offline`, `lastSeen`, `reapStale(ttl)`, plus new `relay.connected|disconnected`
  events **added to the `ServerEvent` union** in `contract/events.ts` (they do not exist yet —
  net-new, not "reuse verbatim"). **Not a new `CapabilityType`:** a `'cognition'` member on
  `contract/agents.ts`'s union would leak into `isMonotonic`, the fs-source picker, the invoke
  path, and `commissionAdmitsTarget` — a non-host concept in every host-capability switch. A
  distinct registry keeps the cognition/host axes orthogonal (D9). Liveness refines to "**is a
  puller parked on the mailbox?**" (§4.2 caveat 2), not a separate heartbeat.
- **Explicit `kind` discriminant on the server-only `ProviderConfig`** (`kind: 'endpoint' |
  'session'`). Relay-ness must be explicit: `store.providerConfig` never returns `undefined`
  (it falls back to `DEFAULT_PROVIDER_CONFIG`, which is itself base-URL-less), so a shape
  heuristic would misfire. The public `ModelProvider` read gains only `kind` + a masked
  fingerprint — never the secret (the slice-18 write-only/server-only split).
- **The loopback Messages shim — the only new turn-path primitive** (`server/relay/` sibling of
  `server/model/`). A Session provider resolves to a `ProviderConfig` whose `baseURL` points at
  this in-process endpoint; `clientFor` already keys on `baseURL` and speaks only Messages, so
  the whole generation loop is untouched. The shim carries the request over as a structured
  **prompt document** (§7.4), enqueues it, long-polls the completion (resolving by the provider's
  `turnTimeoutMs` minus a guard margin, so it always answers before the SDK-side deadline —
  §6.5, §7.2), and streams it back as synthetic SSE via `chunkText`. The mailbox is thus
  **long-polled symmetrically** — our shim waits for the completion; the user's `respond_and_wait`
  waits for the prompt.
- **A journal-shaped mailbox** (modeled on `server/journal.ts`: append/pending/reconcile +
  `commandId` idempotency), keyed by relay id, with a **single-binder lease** on pull (many
  Agents on one single-threaded session serialise rather than double-deliver) and **lease
  expiry/requeue** for the pulled-but-unanswered case.
- **A pre-turn liveness gate** in the messages route, keyed on `kind:'session'` + the
  `RelayRegistry` status, consulted *before* `generateReply` — offline → a structured
  `relay_offline` refusal (503) **before the user turn persists**, the same pre-persist shape
  as the spend gate's 429, so a dead relay never wedges a turn to the deadline and nothing
  half-written needs cleanup. A session provider's mid-turn patience is its `turnTimeoutMs`
  (§7.2), not the shared 60s default.
- **Security walls** (§6.4): bearer secret compared constant-time (`timingSafeEqual`, the
  `RUNNER_ENROLL_TOKEN` pattern) on every pull/submit; one-time-show; **only a hash persisted**
  (§6.1); masked-on-read; never-logged; tenant-scoped enqueue re-asserted at the shim; single
  binder; DELETE/rotate invalidates.
- **Provenance:** relayed completions are tagged **external/untrusted** in the D3 audit trail and
  carry a "via your delegated session" chip on the rendered reply.

## 6. The five corrections that shaped this (the hardening residue)

1. **Restart recovery via a hashed secret — not restart amnesia.** The naive design bricks on
   the first backend restart: the provider row persists but the in-memory liveness record and
   secret don't, so the connector heartbeats an id the fresh process never heard of and the
   one-time URL is gone. Fix, folding two problems into one: **persist only a *hash* of the
   secret** on the provider row (`timingSafeEqual` against it), never plaintext. The liveness
   record stays transient (like the runner registry); the connector re-binds after a restart by
   re-presenting the secret it already holds. The secret is simultaneously the bearer credential,
   the durable re-bind identity, and the restart-recovery key — and plaintext never touches
   `.data/store.json`.
2. **The drain loop is model-driven, not passive.** MCP tools are invoked *by the model*, so the
   MCP server can hold our connection but cannot make an idle session generate. The connection was
   never the constraint; the *clock* is. Resolved by §4.2: Case B's blocking tool (default), Case
   A's sampling, or Case C's external driver — with the UI copy honest that keeping the provider
   green means a session actively looping, not merely open.
3. **The mint funnel would throw as-is.** `store.createProvider` rejects a `baseURL` without a
   probed capability record and enforces the `PROVIDER_*` credential wall (`validApiKeyEnv`). A
   Session provider has a (loopback) `baseURL` but can't be probed and has no `apiKeyEnv`, so the
   mint path needs an explicit **`kind:'session'` branch** that skips the probe, skips the
   credential wall, and **stamps `capabilities:{toolUse:false}` directly** — which also *inverts
   the dangerous default* (today unset reads as `toolUse:true`, i.e. the full tool catalog handed
   to an untrusted external session).
4. **Tenant-scoping and untrusted prose are hard walls.** Session providers are **forced
   tenant-scoped** (never the shared/unset-tenant registry default) — a shared relay would route
   one tenant's prompts to another tenant's session model, a cross-tenant cognition leak. And
   `toolUse:false` blocks forged *tool calls* but not malicious *prose*: the far session is
   adversarial by the same threat model that makes the URL a secret, so its output is untrusted
   content — rendered without elevated-authority affordance, audit-tagged, injection surface
   acknowledged.
5. **The "longer shim deadline" was dead code — the clock was ours all along.** The first
   pass gave the loopback shim "its own longer keepalive-aware deadline, not the 60s
   `MODEL_TIMEOUT_MS`" — but `generateReply` wraps every SDK call in `withDeadline`
   (`server/generate.ts`), and `AbortSignal.timeout` is wall-clock over the *whole stream*:
   keepalives feed it nothing, so the loopback call dies at `MODEL_TIMEOUT_MS` no matter how
   alive the shim believes the turn to be. Any shim deadline past that point could never fire
   usefully. Fix in the slice-18 spirit — patience becomes provider **data**: a `turnTimeoutMs`
   on the server-only `ProviderConfig`, stamped by the `kind:'session'` mint branch (default
   120s, env-overridable), and accepted by `withDeadline` as an optional argument defaulting
   to the env value. This is the one recorded bend in §3's "byte-for-byte unchanged"; the
   shim's own mailbox deadline then *derives from the same number minus a guard margin*, so
   the shim always resolves first — cleanly, through the Messages protocol — rather than the
   SDK aborting mid-stream in a race with it (§7.2).

## 7. Second pass — the edge-case rulings

The first pass ended with a checklist of "unresolved edge cases to specify
before/while building". This pass rules each one, with the same discipline as §6:
the decision **and** the rejected alternative, recorded. (What was resolved here has
been removed from §10; only genuine v2 work remains there.)

### 7.1 The mailbox is a state machine, and completions are keyed to entries

`queued → leased → completed | tombstoned(cause)`. Everything else falls out of two
moves:

- **A completion names its entry.** A pull hands the connector `(entryId, prompt)`;
  `respond_and_wait(answer)` carries the `entryId` back (the connector holds it across
  the model's generation). A submit is only ever judged against *its own* entry — so
  "the orphaned completion poisons the next pull" is structurally unrepresentable,
  not policed. Rejected: implicit "current turn" addressing, which is exactly what
  poisons.
- **Submits are answered by state.** `leased` → accepted (completes the entry);
  `completed` → the recorded ack replays (the journal's `commandId` dedupe pattern);
  `tombstoned` → **410 Gone** — acknowledged and discarded, the connector drops the
  answer and pulls on; unknown id → 404; bad secret → 401. A late answer to a turn
  that already degraded to fallback is a 410, never a wrong-turn reply.
- **Tombstone causes**, each terminal (capped FIFO, the turn registry's
  completed-key pattern): `deadline` (the turn fell back), `cancelled` (the user
  cancelled — `generateReply`'s abort closes the loopback request, the shim sees the
  socket drop and tombstones), `offline` (the relay reaped mid-turn), `rotated`
  (§7.5).
- **Silence redelivers; an explicit error doesn't.** Lease expiry while the relay is
  *online* means the puller went quiet mid-generation (crashed loop, killed
  session): requeue the entry so a re-bound loop can pick it up, bounded by the turn
  deadline — the one outer clock. An explicit error submit (§7.6) is an *answer*:
  fail to fallback now, no redelivery.
- **The turn slot cannot wedge — and needs no new release mechanism.** The messages
  route already frees the one-live-turn slot in its `finally`; the only wedge risk
  was `generateReply` not resolving. Every path above ends with the shim resolving —
  a completion, or a Messages-protocol error the SDK throws into the existing
  catch → `fallbackReply` — at latest by the turn deadline. And `relay.disconnected`
  mid-turn **rejects the relay's queued + leased entries immediately**, so the
  offline case resolves in milliseconds, not at the deadline.

### 7.2 One clock, owned by us — the turn deadline is provider data

The design restated from §6.5: a session provider's patience is `turnTimeoutMs` on
the server-only `ProviderConfig` — stamped by the `kind:'session'` mint branch
(default 120s, `positiveNumberEnv`-overridable like `MODEL_TIMEOUT_MS`), read by
`withDeadline` as an argument defaulting to the env value. The mailbox entry's
deadline is stamped at **enqueue** as `turnTimeoutMs − guard` (~1s), so the shim
always resolves first, cleanly, and the SDK-side abort is the backstop that never
fires in practice.

**Fallback copy: distinct at the gate, standard in the catch.** The pre-turn gate
refuses an offline relay *before the user turn persists* — the structured
`relay_offline` (503) carrying §4.3's copy ("Your session isn't answering — start
its drain loop and retry"), so nothing is half-written and a retry is free. Mid-turn
degradations (deadline, offline-mid-turn) fall into the shared `fallbackReply`.
Rejected: streaming the distinct copy as an assistant message (persists a canned
turn into the thread for what is an infrastructure state), and threading provider
kind into `fallbackReply` (more surface for one string covering the rarer case).

### 7.3 Liveness bridges the generation gap; the newest binder wins

While the far model *generates*, no socket is parked — the model left
`respond_and_wait` holding a prompt and hasn't called back — so connection-as-liveness
alone would reap the relay precisely when it's working hardest. Ruling: **online = a
parked puller OR an unexpired lease**; the lease doubles as proof-of-life across the
generation gap. The TTL only bridges the *idle re-poll* gap (the sub-second hop
between an idle-sentinel return and the model's next call). Defaults, all
env-overridable: poll window ~30s (`RELAY_POLL_MS`), `RELAY_TTL_MS` 90s,
`RELAY_LEASE_MS` 60s (the generation allowance), session `turnTimeoutMs` 120s.
Coherence (TTL > poll window; turn deadline ≥ lease, leaving room for one
redelivery) is asserted at boot, not documented-only.

**One parked puller; newest wins.** v1 admits a single parked long-poll per relay. A
new pull presenting the valid secret **preempts** a parked one — the old poll
returns a `superseded` sentinel and closes. The common case is a zombie socket from
a slept laptop, and the secret holder is one principal, so the newcomer *is* the
live loop. Rejected: 409-ing the newcomer, which lets a half-open TCP socket deny
service until the OS notices. (This resolves the first pass's "two connectors on one
URL is a race"; true *concurrent* multi-puller stays v2.)

### 7.4 The prompt survives as a document, not a string

The shim does not flatten the request to one string. The mailbox carries a **prompt
document** — `{system, messages:[{role, text}]}`, the Messages request with each
turn's content blocks flattened to text — and the connector renders it into the far
session with explicit delimiters plus the standing instruction ("answer the prompt
as given, then `respond_and_wait(answer)`"). v1's request shape makes this
near-lossless: a prose-only turn is exactly `system` + one user turn (`toolUse:false`
means no tool blocks exist to mangle, and `generateReply` sends single-turn requests
today). The honest residue: **the far session double-wraps** — our `system` arrives
as *content inside* a session that has its own system prompt, so it is framing by
courtesy, not a real system turn. Named in §8 as an accepted trade-off; not fixable
from our side of the rendezvous.

### 7.5 Rotate is a kill switch

You rotate because the secret may be loose; a grace window is exactly what a
compromised holder would use. So rotate is **immediate and total**: the stored hash
is replaced (constant-time compare against the new hash only — no old-hash grace),
a parked puller's poll returns 401 on the spot, queued and leased entries tombstone
(`rotated`), and any in-flight turn degrades through §7.1 in milliseconds, not at
the deadline. Rejected: graceful rotate (drain in-flight work first). **Delete =
rotate without a successor**, plus the registry removal and the existing
agent-binding 409.

### 7.6 A refusal is a reply; silence and errors are not

- The far model **refuses**: the connector submits the refusal *as the completion*.
  The user sees their own session's actual behaviour — the provenance chip ("via
  your delegated session") explains whose words these are. A refusal is not an
  error.
- The connector hits a **hard error** (host failure, sampling denied): it submits an
  explicit tagged error — `{error}` instead of `{completion}` — and the shim fails
  the turn to fallback immediately. A deliberate answer doesn't redeliver (§7.1).
- The completion is **empty/whitespace**: the shim normalises it to an error submit.
  An empty assistant bubble helps no one; the fallback copy at least says what
  happened.
- **Silence** is the lease machinery's job: redeliver while online, deadline
  otherwise.

### 7.7 The tour: forbid the playback, not the binding

The guided tour is scripted around tool-call escalations; on a prose-only provider
its beats cannot land (the far session free-answers — the mock's fixed-string
intents never fire). Ruling: binding the default Agent to a Session provider stays
**allowed** — it's the user's registry — and the picker carries a specific warning
line beside the prose-only badge ("the guided tour depends on this Agent's tool
calls"); but the **tour launcher refuses to start** when the demo session's Agent
resolves to a `kind:'session'` provider, with the remedy in the message (repoint the
default Agent to a tool-capable provider). Rejected: silently pinning the tour's
turns to the default provider (hides the misconfiguration and breaks "one provider
resolution rule for every turn"), and playing the script knowingly gutted — the demo
is the argument, and a gutted demo argues the opposite.

### 7.8 No token streaming in v1 is structural — so the UI says who it's waiting on

A tool call's argument is complete when the call is made: `respond_and_wait(answer)`
cannot stream `answer`. So v1's whole-reply arrival is not a connector shortcut to
fix later — it is the shape of the MCP loop; true streaming needs a v2 chunked
submit (`entryId` + seq, relayed as deltas), now listed in §10. The v1 mitigation is
honesty in the composer: a turn on a `kind:'session'` provider shows a distinct
waiting state ("Waiting on your session…") instead of the token-streaming shimmer,
driven by the public `kind` field — the same declared-not-discovered rule as the
prose-only badge (§4.6).

## 8. Accepted trade-offs

- **Effort is advisory.** The far session picks its own model, so `effortLevels` are a label, not
  an enforced authority grant (the D9 attenuation half degrades at this boundary).
- **Token accounting is an estimate** (~4 chars/token), not a metered ceiling — the backend never
  sees the far session's real usage. A plan ceiling on a Session provider is therefore best-effort,
  and the UI must not imply a hard cost bound.
- **MCP is user-side convenience only.** The connection and our-side integration are any protocol;
  MCP is just how v1 enlists an existing session.
- **Double-wrapped framing.** Our system prompt arrives as *content inside* a session that has
  its own system prompt (§7.4) — framing by courtesy, not a real system turn.
- **Whole-reply latency.** The reply lands all at once, however long the far session took
  (§7.8) — the "Waiting on your session…" state, not token streaming, is the v1 experience.

## 9. v1 scope (prose-only, `toolUse:false`)

Thinnest shippable end-to-end: (1) the `kind` discriminant on `ProviderConfig` + the create-route
branch; (2) `RelayRegistry` (durable id, online/offline, reapStale, lease-bridged
connection-as-liveness — §7.3); (3) the journal-shaped mailbox as the §7.1 state machine
(single parked puller with newest-wins preemption, entry-keyed submits, lease expiry/requeue,
tombstones + 410); (4) the loopback Messages shim carrying the §7.4 prompt document, with
`turnTimeoutMs` as provider data (§7.2); (5) the pre-turn liveness gate (`relay_offline` 503,
refused before the user turn persists); (6) the security walls (bearer, hashed-secret
persistence, one-time-show, masked-on-read, tenant-scoped enqueue, kill-switch DELETE/rotate —
§7.5); (7) the UI (kind toggle, one-time connect panel, offline dot, prose-only badge
everywhere, provenance chip, the "Waiting on your session…" state, the tour-launch gate —
§7.7/§7.8); (8) the shipped user-side MCP connector exposing `start` / `respond_and_wait`
(entry-keyed, refusal-is-a-reply, tagged-error submit — §7.6). No consent-gated proposals on a
relay turn — that is the whole reason v1 is prose-only.

## 10. Open items (what remains — the v2 checklist)

The first pass's "unresolved edge cases" block is gone: every item in it is now ruled
in §7 (lease/abort/slot-release → §7.1; stale submits → §7.1; degenerate completions
→ §7.6; flattening fidelity → §7.4; rotate-mid-turn → §7.5; TTL-vs-deadline → §6.5 +
§7.2/§7.3; the tour → §7.7; streaming → §7.8, deferred below). What remains is
genuine v2 work, each a real feature, not polish:

- **Structured tool-use over the mailbox** → `toolUse:true`. Needs a framed mailbox carrying
  `tool_use`/`tool_result` blocks end-to-end **and** enforced *relay-not-execute* discipline (the
  far session must relay our tool calls unexecuted, not fulfill `create_project`/`connect_repo`
  itself and claim success). This is the whole reason v1 is prose-only; it also collides with D3
  ("the co-located agent is not a model proxy") and must be reconciled.
- **True token streaming** — a chunked `submit` (`entryId` + seq, relayed as SSE deltas as they
  land). Structurally unavailable over the v1 MCP tool loop (§7.8), so it needs a connector-side
  side-channel, not just a flag.
- **Metered token ceilings** instead of the estimate (needs the far session to report real usage).
- **Real effort→model binding** (today advisory).
- **Multi-puller concurrency** — several connectors draining one relay *concurrently*. v1's rule
  is one parked puller, newest-wins preemption (§7.3); concurrent pullers need lease-aware
  fan-out and per-entry affinity.
- **Horizontal scale.** The in-process shim + in-memory mailbox assume the drain long-poll and the
  turn's shim call hit the *same* process. A scaled web tier needs the mailbox in shared storage.
- **Kind-aware fallback copy in the catch** — §7.2 keeps mid-turn degradations on the shared
  `fallbackReply` string; if session providers prove common, revisit threading `kind` through for
  a distinct mid-turn message.

## 11. Locking tests to write when built (ship-tests-with-every-feature)

Relay-registry lifecycle + reapStale (incl. connection-as-liveness); mailbox lease / idempotency /
expiry-requeue; the loopback-shim round-trip (enqueue → pull → submit → streamed reply); the turn-path
**offline fast-fail** (returns fallback well under `MODEL_TIMEOUT_MS`); the **bearer wall** constant-time
+ rotate/delete invalidation; the **`toolUse:false` default-inversion** regression lock (a relay is never
handed a `tools` param); **tenant-scoped enqueue** (a completion never reaches another tenant's turn); and
**hashed-secret restart recovery** (the connector re-binds after a simulated reboot from the held secret,
and no plaintext secret is in the persisted snapshot).

From the §7 rulings, additionally: **entry-keyed anti-poisoning** (a stale submit can never complete a
*different* entry; a tombstoned entry answers 410 and the next pull is clean); **offline-mid-turn
promptness** (relay reaped mid-turn → the turn falls back in milliseconds and a follow-up send is *not*
409 — the slot freed); **newest-wins preemption** (a second pull supersedes the parked one, which
receives the `superseded` sentinel; no 409 to the newcomer); **lease-bridged liveness** (a relay with a
leased entry and no parked socket is not reaped); **rotate-as-kill-switch** (parked poll 401s
immediately; in-flight entries tombstone `rotated`; a subsequent old-secret submit is 401, not 410);
**`turnTimeoutMs` as data** (stamped at session mint, honored by `withDeadline`, and the mailbox
deadline lands before the SDK deadline); **degenerate completions** (a refusal streams as the reply; an
explicit error submit and an empty completion both fall back without redelivery); the **pre-persist
gate** (a `relay_offline` refusal leaves no user turn behind); and the **tour-launch gate** (playback
refuses on a `kind:'session'` resolution with the repoint remedy in the message).

## 12. References

- **D9 — Model providers**, and slice 18 (endpoints as data): [`agent-commons.md`](agent-commons.md);
  `contract/providers.ts`, `server/data/providers.ts`, `server/generate.ts` (`clientFor`,
  `probeProviderEndpoint`, the `capabilities.toolUse` gate), `server/store.ts` (`createProvider`,
  `providerConfig`).
- **The runner broker** this mirrors: [`capability-broker-architecture.md`](capability-broker-architecture.md)
  (D1 relay-default, D2 agent-as-system-of-record / pull-sync, D3 content audit, "the model relay");
  `server/registry.ts`, `server/journal.ts`, the `RUNNER_ENROLL_TOKEN` + `timingSafeEqual` bearer wall in
  `server/routes/index.ts`.
