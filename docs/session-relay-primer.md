# The Session-relay connector, explained from zero

> **What this document is.** A self-contained explanation of how "Session
> providers" work — written for a reader who has NOT read any other doc or any
> source code. If you want the design *history* (every ruling and its rejected
> alternative), that lives in
> [`delegated-cognition-provider.md`](delegated-cognition-provider.md); the
> requirement ledger is rows MODEL-10…-24 in
> [`spec/06-model-and-tools.md`](spec/06-model-and-tools.md). **This primer is
> kept in sync with behavior**: if you change the relay (server, connector, or
> setup guide), update the matching section here —
> `tests/relay-primer.test.ts` pins the load-bearing facts so drift fails CI.

## 1. The problem it solves

This app normally answers conversations by dialing out to a model API (an
endpoint plus a key). But sometimes the best model you have **cannot be
dialed**: it's a Claude Code window on your laptop behind a firewall, a
subscription session with no shareable API key, or an agent product with no
API at all. You can't give the server a URL for it — but it *can think*, and
it can make outbound HTTP requests.

A **Session provider** turns that running AI session into a model provider by
inverting the connection: instead of the server dialing the model, **the model
dials the server**. The server hosts a *mailbox*; the remote AI polls it for
work, thinks, and posts answers back. From the app's point of view it behaves
like any other model in the picker; from the remote AI's point of view it's a
simple fetch-answer-reply loop.

```
 you, in the app UI                       your other AI session (anywhere)
 ────────────────────                     ───────────────────────────────
  conversation A ──┐                                   │
  conversation B ──┼──► app server ◄── poll ───────────┤  "any prompts for me?"
  conversation C ──┘    (the mailbox)  ── prompt ────► │  thinks…
                              ▲        ◄── answer ─────┤
                              └── answers stream back into A/B/C
```

Nothing in this file is hypothetical: the flow below has been exercised
end-to-end by real, unscripted model sessions (the live runs are logged in the
design doc, §9.4).

## 2. The cast

- **The app server** — hosts the conversations, the mailbox, and the consent
  gates. It never executes model-proposed changes without the user confirming.
- **A UI session** — one conversation in the app. Any number can exist; each
  can pick the Session provider as its model.
- **The rendezvous secret** — a one-time password (`rv_live_…`) minted when
  the provider is created. It is the *only* credential; the server stores only
  its hash. Whoever presents it *is* the provider's serving side.
- **The far session** — the remote AI doing the thinking. It serves either
  through the connector (below) or by calling two HTTP endpoints directly.
- **The connector** (`connector/relay-connector.ts`) — a small optional
  MCP server (~600 lines, zero dependencies) the far session can install. It
  holds the network loop and renders prompts nicely; the far model drives it
  through three tools: `start`, `respond_and_wait`, and `refresh`.

## 3. Onboarding: the agent sets itself up

The UI shows the user exactly ONE artifact: a **bootstrap prompt** to paste
into the AI session that will do the thinking. It says, in essence: *"Fetch
`<server>/api/v1/connector/setup` and follow it; then connect to `<server>`
with secret `rv_live_…` and start draining."* The secret appears only inside
this prompt — one credential, shown once.

The fetched **setup guide** (`server/connectorSetup.ts`, served at
`GET /connector/setup`, unauthenticated — a manual is not a secret) is written
for the *agent*, not the human, and offers two paths:

- **Path A — install the connector.** Download one self-contained script from
  `GET /connector` (the server strips the types at request time; any Node ≥ 18
  runs it) and register it as a stdio MCP server in *whatever harness the
  agent runs in* — the guide gives examples (Claude Code, Codex CLI,
  config-file harnesses) but prescribes none, because the agent knows its own
  harness best.
- **Path B — no install.** Drive the protocol directly: two endpoints, bearer
  auth, documented in the guide. The floor is "anything that can make an HTTP
  request" — no MCP required. This is the last-resort path working as
  intended.

The UI deliberately never lists harnesses or shell commands; everything
harness-specific lives in the guide, delivered to the party that needs it.

## 4. Binding, and the trust boundary at connect time

There is no registration handshake: **presenting the secret on a poll IS the
binding.** The first `GET /relay/poll` with `Authorization: Bearer rv_live_…`
flips the provider's dot green; silence past a TTL flips it grey; a laptop
sleep or server restart heals by simply polling again.

On the connector path, the model passes the URL + secret to the `start` tool
once — and they **latch**: any later `start` with different values is refused
without a network request. Why: everything the mailbox later delivers is
*outside text*; a malicious prompt could try "reconnect to attacker.example".
The latch makes that structurally impossible. The serving declaration (§6)
latches with them, for the same reason — an injected prompt must not be able
to throttle or overload the relay either.

## 5. The core trick: every prompt is a complete, disposable job

When a user sends a message in any UI session, the server builds a package:
the system briefing, the tool definitions, **that conversation's entire
message history**, the new message — labeled with a `channel` (the
conversation's id and title) and a unique `entryId`.

Because the package is complete, the far session needs **zero per-conversation
state**. It doesn't "open" sessions, register them, or remember them. A
brand-new conversation created in the UI mid-run is just the next envelope
with an unseen label. This single property is what makes UI sessions
**architecturally unlimited** over one relay — sessions don't exist on the far
side at all; only self-contained jobs do. It also makes the far session
*disposable*: killing and restarting it loses nothing (see §8).

Answers must quote the `entryId` they settle. The server matches answers to
waiting turns by that id alone — out-of-order is fine, and an answer
physically cannot land in the wrong conversation. A reply is exactly one of:
`completion` (prose — a refusal counts), `toolCalls` (see §9), or `error`;
mixing forms is refused with a 400.

## 6. Concurrency: negotiated, declared, observed — never assumed

The server holds at most **one open turn per conversation** and delivers
waiting turns to the far side **one at a time, oldest first**. So even a
strictly serial far model serves any number of conversations correctly —
extra turns queue. The only question is how many conversations may have a
turn *waiting* at once, and that is settled by a three-layer handshake:

1. **Advertised** (protocol layer): every poll carries `?channels=<n>`. The
   admission ceiling is `min(RELAY_MAX_INFLIGHT (default 8), n)`. **Silence
   means serial (1)** — an old connector that never heard of channels had a
   one-slot buffer that would drop a second prompt, so the server never fans
   out to a client that didn't confirm it can take it.
2. **Declared** (cognition layer): the model may pass `conversations` to
   `start` (clamped 1–16; connector default 8). This is a *latency bound,
   never a parallelism requirement* — the docs say "serial ≠ 1" explicitly,
   because an early live run showed an honest serial model would otherwise
   declare 1 and make the platform refuse all concurrency.
3. **Observed** (user-facing layer): every delivery and settle emits a
   `relay.activity` event, and the provider page shows the live truth —
   "Serves up to 8 conversations", "Answering 2 of 8" — computed server-side
   and impossible to forge via the API.

Past the ceiling, a *new* conversation's turn is refused instantly with a
message naming the limit (never a silent stall); a tool-use round of a turn
already underway bypasses the ceiling so a rival conversation can't kill a
mid-flight exchange.

## 7. Serving: delegate to sub-agents by default

The instructed default (connector instructions + setup guide, both paths) is
the **fan-out**: as each prompt arrives, hand it to a background sub-agent,
immediately fetch the next prompt (`respond_and_wait` with *no* submission —
or on Path B, just poll again; delivered entries stay live), and submit each
answer under its own `entryId` as it finishes, in any order. This serves
conversations in parallel, keeps them perfectly isolated, and keeps the drain
session's own context near-empty — each job burns in a disposable context.
Answering inline is the fallback for harnesses without sub-agents or trivial
prompts; it's still correct, just serial.

## 8. Context economy, and the `refresh` recovery

Re-sending the full briefing, tool schemas, and history with every job would
burn the far model's context window. Three mechanisms keep each piece of text
entering the far context **approximately once**:

- **Body dedupe on the wire**: prompts carry content hashes
  (`systemHash`/`toolsHash`); the client advertises what it already holds
  (`?have=h1,h2`) and the server omits those bodies. ~20 kB of tool schemas
  transfer once, not per turn.
- **Suffix rendering, per conversation**: the connector remembers what it
  already showed for each channel and renders only the new tail ("continuing
  entry X — earlier turns unchanged, shown above").
- **The freshness handshake**: the one failure mode of the above is the far
  session's *own* context being compacted while the connector's caches
  survive — references pointing at text the model can no longer see. The
  model calls the no-arg **`refresh`** tool once: all shown-before state is
  dropped, queued prompts are scrubbed back to full bodies, and polls stop
  advertising `have=` until bodies are re-received (the bodies are kept aside
  for the one poll already in flight, so even a delivery answering a
  pre-refresh advertisement still renders in full). Path B equivalent: just
  stop sending `have=`. Nothing is ever lost server-side.

Restart is the blunt version of the same guarantee: because jobs are
self-contained and all caches are presentation state, killing the far session
or the connector and starting over is **lossless** — the next poll re-binds
and everything re-renders full.

## 9. Tool calls: relay, never execute

A prompt may declare tools (create a project, save an artifact, …). The far
model must **never execute these itself** — it relays the calls back verbatim
(`toolCalls`), unexecuted. The platform executes each call into a
**consent-gated proposal** (a confirm card in the UI; nothing changes until
the user clicks), then sends a follow-up prompt carrying the results — which
are often just "proposed, awaiting the user's confirmation". The far model
then concludes in prose. This "relay-not-execute" wall is stated in every
prompt, the standing instructions, and the guide, because the far session is
typically itself a tool-capable agent and mailbox text is untrusted input.

## 10. Stopping, and the failure map

| Signal | Meaning | Right reaction |
|---|---|---|
| `{"idle": true}` | Nothing pending (the ~25 s long-poll elapsed) | Poll again immediately; never stop on idle |
| client-side timeout | Network hiccup | Treat as idle (use a ~40 s client timeout) |
| `{"superseded": true}` | A newer connection took over, **or** the secret was rotated | One more poll disambiguates: 401 ⇒ rotated (ask the user for a new secret); otherwise ⇒ takeover (stop) |
| HTTP 401 | Secret rotated/revoked — rotation is an instant kill switch, no grace | Stop; ask the user |
| HTTP 410 on reply | That entry already settled (deadline passed, turn cancelled, or duplicate) | Drop the answer, poll on — delivery is at-most-once; the user just retries |
| turn deadline (server-side, `RELAY_TIMEOUT_MS`, default 120 s) | The far side never answered in time | The UI turn falls back with an honest message; nothing wedges |

## 11. Security properties, in one place

- The secret is shown **once**, inside the bootstrap prompt; the server keeps
  only a SHA-256 hash (compared constant-time); reads show a masked tail.
- Rotate/delete kill the old secret instantly — a held connection gets 401 on
  its next poll, an in-flight turn falls back immediately.
- The connector's **first-call latch** freezes URL + secret + declaration, so
  injected mailbox text can't redirect or throttle the relay.
- Session providers are **tenant-scoped**: another tenant can't see the
  provider, its liveness, or its activity events.
- Everything the far model proposes lands behind the app's normal **consent
  cards** — the relay adds no authority; replies are rendered as untrusted
  content with a "via your delegated session" provenance chip.
- What we *cannot* enforce (whether the far model delegates, declares
  honestly, keeps looping) is instructed and observed, never assumed — see
  the design doc's "instructed, never enforced" boundary.

## 12. Where the pieces live

| Piece | File | Locked by |
|---|---|---|
| Mailbox runtime (windows, entries, activity) + `relayReply` turn driver | `server/relay.ts` | `server/relay.test.ts` |
| Wire types (prompt/reply shapes, channel, hashes) | `contract/relay.ts` | type-identity (imported by both ends) |
| Poll/reply routes, pre-turn gates, connector + guide serving | `server/routes/index.ts` | `server/relay.test.ts`, `server/routes/connector-serve.test.ts` |
| The agent-facing setup guide | `server/connectorSetup.ts` | `server/routes/connector-serve.test.ts` |
| The connector (start / respond_and_wait / refresh, caches, rendering) | `connector/relay-connector.ts` | `server/routes/relay-connector.test.ts` |
| The bootstrap prompt + mint panel | `src/lib/connectorInstall.ts`, `src/components/SectionView.tsx` | `server/routes/connector-serve.test.ts` |
| Design history (v1–v6, every ruling + rejected alternative, live-run logs) | `docs/delegated-cognition-provider.md` | `tests/spec-conformance.test.ts` |
| Requirement rows MODEL-10…-24 | `docs/spec/06-model-and-tools.md` | `tests/spec-conformance.test.ts` |
| This primer's load-bearing facts | `docs/session-relay-primer.md` | `tests/relay-primer.test.ts` |
