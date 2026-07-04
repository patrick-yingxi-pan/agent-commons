# Delegated-cognition providers ("Session providers") — a D9 extension

> **Status: forward-looking design, NOT built.** This is a design log entry (like
> [`capability-broker-architecture.md`](capability-broker-architecture.md)), not
> shipped behaviour. It extends **D9 — Model providers** in
> [`agent-commons.md`](agent-commons.md) and builds directly on **slice 18**
> (provider endpoints as data: `server/generate.ts` `clientFor`, the server-only
> `ProviderConfig`, `probeProviderEndpoint`, the `capabilities.toolUse` gate).
> Nothing here is implemented; the "decisions" are settled *within this exploration*.
> Written to continue later — §9 is the open-items checklist.

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
  the two-turn tool-use loop, `clientFor`, `withDeadline`, and `fallbackReply` stay
  **byte-for-byte unchanged**.
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
  the whole generation loop is untouched. The shim flattens the request to a prompt, enqueues it,
  long-polls the completion (its **own** longer keepalive-aware deadline, not the 60s
  `MODEL_TIMEOUT_MS`), and streams it back as synthetic SSE via `chunkText`. The mailbox is thus
  **long-polled symmetrically** — our shim waits for the completion; the user's `respond_and_wait`
  waits for the prompt.
- **A journal-shaped mailbox** (modeled on `server/journal.ts`: append/pending/reconcile +
  `commandId` idempotency), keyed by relay id, with a **single-binder lease** on pull (many
  Agents on one single-threaded session serialise rather than double-deliver) and **lease
  expiry/requeue** for the pulled-but-unanswered case.
- **A pre-turn liveness gate** in the messages route, keyed on `kind:'session'` + the
  `RelayRegistry` status, consulted *before* `generateReply` — offline → the fast distinct
  fallback, so a dead relay never wedges a turn to the deadline. Session providers get a
  relay-specific longer timeout and a distinct fallback message.
- **Security walls** (§6.4): bearer secret compared constant-time (`timingSafeEqual`, the
  `RUNNER_ENROLL_TOKEN` pattern) on every pull/submit; one-time-show; **only a hash persisted**
  (§6.1); masked-on-read; never-logged; tenant-scoped enqueue re-asserted at the shim; single
  binder; DELETE/rotate invalidates.
- **Provenance:** relayed completions are tagged **external/untrusted** in the D3 audit trail and
  carry a "via your delegated session" chip on the rendered reply.

## 6. The four corrections that shaped this (the hardening residue)

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

## 7. Accepted trade-offs

- **Effort is advisory.** The far session picks its own model, so `effortLevels` are a label, not
  an enforced authority grant (the D9 attenuation half degrades at this boundary).
- **Token accounting is an estimate** (~4 chars/token), not a metered ceiling — the backend never
  sees the far session's real usage. A plan ceiling on a Session provider is therefore best-effort,
  and the UI must not imply a hard cost bound.
- **MCP is user-side convenience only.** The connection and our-side integration are any protocol;
  MCP is just how v1 enlists an existing session.

## 8. v1 scope (prose-only, `toolUse:false`)

Thinnest shippable end-to-end: (1) the `kind` discriminant on `ProviderConfig` + the create-route
branch; (2) `RelayRegistry` (durable id, online/offline, reapStale, connection-as-liveness); (3)
the journal-shaped mailbox with single-binder lease + expiry/requeue; (4) the loopback Messages
shim + relay-specific timeout; (5) the pre-turn liveness gate + distinct fallback; (6) the security
walls (bearer, hashed-secret persistence, one-time-show, masked-on-read, tenant-scoped enqueue,
invalidating DELETE/rotate); (7) the UI (kind toggle, one-time connect panel, offline dot,
prose-only badge everywhere, provenance chip); (8) the shipped user-side MCP connector exposing
`start` / `respond_and_wait`. No consent-gated proposals on a relay turn — that is the whole reason
v1 is prose-only.

## 9. Open items / unresolved (the "continue later" checklist)

**Deferred to v2 (each a real feature, not polish):**
- **Structured tool-use over the mailbox** → `toolUse:true`. Needs a framed mailbox carrying
  `tool_use`/`tool_result` blocks end-to-end **and** enforced *relay-not-execute* discipline (the
  far session must relay our tool calls unexecuted, not fulfill `create_project`/`connect_repo`
  itself and claim success). This is the whole reason v1 is prose-only; it also collides with D3
  ("the co-located agent is not a model proxy") and must be reconciled.
- **Metered token ceilings** instead of the estimate (needs the far session to report real usage).
- **Real effort→model binding** (today advisory).
- **Multi-puller concurrency** beyond the single-binder lease when several connectors drain one
  relay (also: forbid a second binder at connect time — two connectors on one URL is currently a
  race).
- **Horizontal scale.** The in-process shim + in-memory mailbox assume the drain long-poll and the
  turn's shim call hit the *same* process. A scaled web tier needs the mailbox in shared storage.

**Unresolved edge cases to specify before/while building:**
- **Lease expiry + requeue** exact semantics; **in-flight-turn abort + one-live-turn-lock release**
  when the relay reaps offline mid-turn (else the session's turn slot wedges — the "409 forever"
  failure the messages route already warns about).
- **Duplicate/stale `submit`** after the turn already timed out to fallback: `commandId` idempotency
  makes the write a no-op, but the orphaned completion — dropped, or does it poison the next pull?
- **Degenerate completions** — the far model refuses / returns empty / errors: stream an empty reply,
  retry, or fallback?
- **Message-flattening fidelity** — a real turn is system prompt + history + attached-context
  `tool_result`s; flattening to one string can mangle what the far session sees. Specify how much
  structure survives.
- **Rotate-mid-turn** sequencing (old secret invalidates while a turn is enqueued/being drained).
- **Heartbeat-TTL vs. relay-deadline** reconciliation so a slow-but-alive session isn't reaped
  offline mid-generation (the connection-as-liveness model in §4.2 mostly resolves this — an actively
  draining session holds the socket — but the interaction with a slow *single* turn needs a rule).
- **Guided-tour dependency on tool-use** — the scripted tour relies on tool-call escalations/relation
  edits; a Session provider on the default Agent would silently gut the demo. Forbid, or warn.
- **Streaming fidelity** — synthesised SSE deltas from a single completion vs. true token streaming
  (would need a streaming `submit`).

## 10. Locking tests to write when built (ship-tests-with-every-feature)

Relay-registry lifecycle + reapStale (incl. connection-as-liveness); mailbox lease / idempotency /
expiry-requeue; the loopback-shim round-trip (enqueue → pull → submit → streamed reply); the turn-path
**offline fast-fail** (returns fallback well under `MODEL_TIMEOUT_MS`); the **bearer wall** constant-time
+ rotate/delete invalidation; the **`toolUse:false` default-inversion** regression lock (a relay is never
handed a `tools` param); **tenant-scoped enqueue** (a completion never reaches another tenant's turn); and
**hashed-secret restart recovery** (the connector re-binds after a simulated reboot from the held secret,
and no plaintext secret is in the persisted snapshot).

## 11. References

- **D9 — Model providers**, and slice 18 (endpoints as data): [`agent-commons.md`](agent-commons.md);
  `contract/providers.ts`, `server/data/providers.ts`, `server/generate.ts` (`clientFor`,
  `probeProviderEndpoint`, the `capabilities.toolUse` gate), `server/store.ts` (`createProvider`,
  `providerConfig`).
- **The runner broker** this mirrors: [`capability-broker-architecture.md`](capability-broker-architecture.md)
  (D1 relay-default, D2 agent-as-system-of-record / pull-sync, D3 content audit, "the model relay");
  `server/registry.ts`, `server/journal.ts`, the `RUNNER_ENROLL_TOKEN` + `timingSafeEqual` bearer wall in
  `server/routes/index.ts`.
