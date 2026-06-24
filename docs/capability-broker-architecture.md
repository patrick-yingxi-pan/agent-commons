# Capability-broker architecture — portability via a registry of native agents

> **Status: forward-looking architecture exploration.** It does **not** describe
> what the prototype does today, and it does **not** change current behavior. What
> it *does* record — carefully, for later reference — is a set of **settled design
> choices** (and the trade-offs each one accepts) reached in a design dialogue, so
> that whoever builds this next inherits the reasoning, not just the conclusion.
>
> "Decision" here means *settled within this exploration's design space* — **not**
> "implemented in the prototype." The prototype's actually-shipped, locked-in
> decisions live separately in [`../AGENTS.md`](../AGENTS.md) → "Design decisions
> (locked in)"; nothing here overrides those.
>
> *(Renamed from `local-access-and-portability.md`: that exploration converged on
> the broker model below, of which "loopback companion" is just the co-located
> special case.)*

## Thesis

One UI, served anywhere, talks to a **web server that is a control plane**, not a
monolithic backend. The user's hosts (laptop, work desktop, cloud box, …) each run
a **native agent** that connects to the server and **advertises the capabilities it
can perform on that host** — filesystem read/write, terminals, process spawning,
etc. The server maintains the **live registry** of connected agents and their
capabilities and **routes** each capability invocation to the right agent. The UI
addresses capabilities by `(agent, capabilityType, scope)`.

**Native and web stop being two architectures.** They are one model that differs
only by a performance optimization: when an agent happens to be **co-located** with
the UI (same host — the Electron case), the UI's lowest transport layer may **bypass
the server round-trip and talk to that agent directly over loopback**, teeing to the
server asynchronously for audit. Above that layer nothing can tell which path was
taken.

```
  ┌────────────┐        relay (API)        ┌──────────────────────────────┐
  │     UI     │ ────────────────────────▶ │          Web server          │      ┌───────────────┐
  │ browser /  │                           │  CONTROL plane: auth ·        │ ◀──▶ │ Anthropic     │
  │  Electron  │ ◀──────  SSE (events) ──── │  agent registry · routing    │ model│ Messages API  │
  └─────┬──────┘                           │  STATE plane: shared system-  │ relay└───────────────┘
        │                                  │  of-record + audit projection │
        │                                  └───────────────┬──────────────┘
        │  co-located FAST PATH                            │  relay (DATA plane)
        │  loopback · same host                            ▼
        │  server off the critical path        ┌───────────────────────────┐  ┌──────────────┐
        │  (teed async for audit)              │  Agent @ host A            │  │ Agent @      │
        └─────────────────────────────────────▶│  caps: fs · terminal ·     │  │ host B, C …  │
                                                │  process — AUTHORITATIVE   │  │              │
                                                │  for host A's own effects  │  └──────────────┘
                                                └───────────────────────────┘
```

## Three planes

Naming the planes keeps it crisp which traffic the fast path touches and which it
never does:

| Plane | What it carries | On the critical path through the server? |
|---|---|---|
| **Control** | auth, the agent registry, the capability catalog, routing/brokering, capability grants | Always. |
| **State** | the *shared* system-of-record (sessions, projects, artifacts, relations) + the model relay + the audit projection | Always — it's the cross-instance convergence point. |
| **Data** | actual capability I/O (file bytes, terminal streams, process control) | Usually — **except** co-located capability I/O, which may take the fast path. |

The fast path is a **data-plane** optimization only. Shared state (which every UI
instance of the user must converge on) and control always go through the server.

## Components and roles

| Component | Role |
|---|---|
| **UI** (`src/`) | A cache of the *shared* state; a client of the capability registry. Feature-detects its *own* runtime; never sniffs the backend. Its lowest transport layer is the only place that knows about the co-located fast path. |
| **Web server** | The control + state plane, and the model's client. Brokers the registry, routes capabilities, owns shared state, holds the audit projection and the API credential. |
| **Native agent** | A process on a host that advertises + performs capabilities on *that host*, enforces its own grants/consent, and is the **system of record for its host's effects**. The in-Electron agent is one of these, co-located. |
| **Model** (`api.anthropic.com`) | The LLM. Its tool calls route through the *same* broker to the *same* agents the UI uses — human and model share one capability registry and one device namespace. |

## Settled design choices (with trade-offs)

### D1 — Relay-default, with a co-located fast path (not a full mesh)

**Decision.** Capability traffic goes through the server by default. The only
"direct" path is **UI ↔ a co-located agent on the same host** (loopback). Two
*different remote* hosts of the same user do **not** talk peer-to-peer; cross-host
traffic relays through the server.

**Why.** The latency-sensitive case is precisely "the UI and the host I'm working on
are the same machine." Restricting "direct" to same-host means the direct path is
always loopback — so we **never solve general peer-to-peer** (no NAT traversal, no
hole-punching, no ICE, no peer identity beyond the server). Locality + a local token
authenticates it.

**Trade-off accepted.** Two remote hosts of one user can't shortcut each other —
every cross-host hop pays the server round-trip. For this product that's a
non-issue.

**Rejected alternative.** A full signaled mesh (Tailscale/WebRTC-style: server
brokers, data goes peer-to-peer everywhere). Strictly more capable, but it buys
almost nothing here for a large jump in complexity (NAT traversal, peer identity,
E2E). Note this also *inverts* the default vs. Tailscale (which is direct-by-default,
relay-as-fallback); we are relay-by-default, direct-as-optimization.

### D2 — Each agent is the system of record for its own host (Option B)

**Decision.** The authoritative record + ordering of a host's native effects lives at
the **agent on that host**, not at the server. Concretely, in the form:

> **Agent-authoritative, server-projected, relay-fresh.** Each agent keeps a durable
> local log and is the source of truth for its host's effects. While connected (the
> common case under D1), effects pass through or tee to the server, which keeps a
> **fresh projection** joined into the server-authoritative *shared* state. On a
> partition the agent works on and logs locally; on reconnect it **replays its outbox**
> from the server's last-seen cursor, deduped by id. Reads come from the projection,
> **refreshed read-through from the live agent** when freshness matters, and marked
> **stale** when the host is offline.

**Why.** "System of record" is *not* "where the file lives" — the file is always on
the host. It is "whose version of *what happened* everyone converges on after a gap."
The choice only bites for one class of effect:

- **Observable / idempotent state** (file contents, `git status`, a dir listing) is
  *re-derivable* — lose the record and the agent just re-observes the host. A and B
  **converge** here; the choice is irrelevant.
- **Ephemeral / streamed effects** (terminal stdout, process logs, a build's output)
  are **not** re-derivable. This is the only place the choice matters.

For ephemeral effects, B is strictly safer: **on a gap, B recovers the truth from the
agent's durable log; the server-authoritative alternative (A) may have already lost
it.** And B composes with D1 so well it nearly erases the downside — because
relay-default keeps the server's projection fresh in the common case anyway, B in
practice behaves like *"A while connected, plus offline-safe."* B is also *better* on
single-host concurrency: authority and serialization are co-located at the agent, so a
host can't split-brain between two of the user's UIs.

**Trade-off accepted.** The server-side audit (D3) is **eventually-complete, not
real-time-complete**, and a *permanently* dead device (destroyed before it ever syncs)
leaves a permanent gap. Acceptable for this product ("see what happened across my
sessions"). **Escape hatch:** mark *specific* operations "must be audited before
acknowledged" and run only those through synchronous server-commit — a surgical,
per-operation fallback to A, not a global switch.

**Rejected alternative.** A — server is the system of record. It gives a complete,
totally-ordered audit for free, but (a) it can *lose* ephemeral output if an agent
crashes after the local effect and before the server write, so it *also* needs a
durable agent outbox to be crash-safe (importing B's main cost anyway), and (b) it
forces every effect to reconcile the server's assigned order against the agent's
execution order. B avoids both.

**Must-not-skip plumbing (standard, not hard):**
- Durable agent-local log + a **retention/GC policy** (cap or summarize ephemeral
  output an offline agent would otherwise replay in bulk).
- **Idempotency keys on the command channel** — client-assigned id; the agent caches
  recently-executed command ids and returns the prior result on a retried
  "spawn process" instead of running it twice. (A general at-least-once-delivery
  requirement — *not* B-specific; A needs it too. Note replay re-sends *reports*, it
  never re-executes effects.)
- Server projection holds **references** to agent-authoritative effect blobs; the UI
  shows a **placeholder** ("output syncing / host offline") until a blob arrives.
- **One agent per host by construction**, enforced via stable identity (D4), so "the
  agent is authoritative for its host" never has two claimants.

### D3 — Server-side content audit (no end-to-end encryption UI↔agent)

**Decision.** The server may read the plaintext of capability I/O it relays, and holds
the content-level audit (the projection from D2).

**Why.** A complete, central, content-level record is wanted; under D2 the agents'
synced logs populate exactly that. Audit *is* the system-of-record projection — D2 and
D3 reinforce each other.

**Trade-off accepted.** This rules out E2E UI↔agent, so the blast-radius defense can no
longer lean on E2E as a backstop. It now rests entirely on: **the agent enforces its
own grants and per-session consent independently** (content-visibility ≠
control-authority — the server *seeing* a request does not make the agent *obey* it
without its own policy check), and **the transport + server are hardened** (TLS, strong
session auth, tightly-scoped tokens).

**Rejected alternative.** E2E-encrypted UI↔agent with the broker blind to content.
Better blast-radius story, but then the server can audit only metadata — incompatible
with the content audit we chose.

### D4 — Stable, ambient agent identity (referenceable, never "attached")

**Decision.** Each agent has a **durable, human-labeled identity** ("Patrick's
MacBook", "work desktop", "cloud box") that persists across reconnect / restart /
IP-change, re-bound each time via a pairing key. Agents are **referenceable both
implicitly and explicitly** but are **not** attached to a thread as contexts.

**Why — the two-orthogonal-layers result (a keeper):**
- *Contexts* (files, repos, connectors) are **thread-scoped**, **attached with
  consent**, and answer *what you're working on* — they shape the panel.
- *Agents/hosts* are **account-scoped**, **ambient**, and answer *where work can
  physically happen*. They are a standing fabric, like your set of devices just being
  *there* — which is why they are not contexts.
- **Implicit reference = automatic target resolution:** "edit this repo" resolves to
  the agent on the host where that repo physically lives, so the server must hold the
  **binding** between a resource and the agent that holds it. (This is the one place
  contexts and agents touch: a repo context may be *bound* to an agent.)
- **Explicit reference = a named, addressable namespace the model shares:** "run it on
  the cloud box" resolves the label → `agentId`, the same way tools/MCP servers are
  nameable. Human and model resolve names against one device namespace.

A capability invocation is therefore **"do `<capability>` for `<resource>` on
`<agent>`"**, where `<agent>` is usually *implicit* (from where the resource lives) and
*explicitly nameable* to override or disambiguate.

**Trade-off accepted.** The registry must persist real identity records
(`{agentId, label, lastSeen, hostFingerprint}`) and an enrollment/pairing flow — more
than tracking live sockets.

**Reinforces D2.** Stable identity is a *prerequisite* for B: on reconnect the server
must trust that *this* agent legitimately owns host X's history before accepting its
replayed log as authoritative. The `agentId` + pairing key is that trust anchor.

## Availability — two critical paths, only one offline-safe

The planes table implies this, but it is worth stating outright because the dialogue's
shorthand — *"the web server is no longer on a critical path"* — overclaims. That phrase
is **plane-specific**. There are **two** independent critical paths, and the co-located
fast path (D1) shortens only one of them:

- **Capability path** (UI → agent). On a co-located host this may take the loopback fast
  path, so it survives a server outage: the agent executes, logs to its durable record,
  and replays its outbox on reconnect (D2). **Offline-safe.**
- **Model path** (UI → server → Anthropic). Always relays through the server, which holds
  the API credential and the content audit (D3). The fast path never touches it, and the
  co-located agent is **not** a model proxy — its capabilities are fs / terminal /
  process, never "reach the model." So even in the Electron case, model messages do **not**
  go through the local agent. **Not offline-safe.**

What survives a server outage, precisely:

| | Server down |
|---|---|
| Human-driven capability on a **co-located** host (run a command, read a file via the fast path) | ✅ executes, logs locally, replays on reconnect |
| Durable record of effects already performed | ✅ never lost — the agent is the system of record (D2) |
| Capability on a **remote** host (cross-host relay) | ❌ needs the server hop |
| A **new model turn** — any agentic / model-driven work | ❌ the model + credential are server-side |

The real boundary is **human-driven local work survives; model-driven work does not.**
Even though a co-located agent *could* run your tests with the server down, nothing tells
it to — the agentic loop (the model deciding to invoke a capability) lives behind the
server. This is the same failure contract as any AI-in-editor tool: with the cloud down
your editor and terminal still work by hand, but the assistant goes quiet. The local
*environment* never depended on the model being reachable.

**Decision (accepted).** Keep the model server-gated and scope the "off the critical
path" claim to the capability/data plane. Model availability *requires* the server — and
that is the same choice that makes the content audit free (D3): the credential and the
relay live in one place on purpose. We do **not** move the credential onto the agent to
win offline model access; that would invert D3 (lose central model-I/O audit, push key
management onto every host) for a narrow gain.

**Open fork (not yet decided).** If graceful model degradation is ever wanted, the cheap
version is **queued model intents**: queue a model-requiring turn locally and replay it
when the server returns, reusing D2's outbox machinery rather than moving the credential.
This nudges the model path toward the capability path's offline behavior without touching
the trust model. Recorded as open question 7.

## Capabilities as a live registry

Capabilities are **not** a static descriptor of "the backend." They are **advertised
per agent**, aggregated by the server, and change as agents connect/disconnect. Each
advertisement carries not just *types* but **scopes/grants** (an agent offers "fs read"
only over the roots the user granted — the per-agent extension of the browser
File System Access permission model). Addressing is `(agent, capabilityType, scope)`.
The same registry is addressed by the UI *and* by the model's tool calls — so "Claude
runs a terminal on my laptop" and "I run a terminal on my laptop" are one mechanism
differing only in caller.

## Invariants (locked principles, not open forks)

- **Transport transparency.** Direct (fast-path) and relay must be **semantically
  identical** — same ordering, idempotency, error model, streaming shape. Only the
  UI's lowest transport layer may differ. (The LSP/DAP lesson.)
- **Feature-detect self; read backend from the backend.** The UI may detect *its own*
  runtime powers (is the File System Access API present? am I a privileged Electron
  renderer?). It must never infer the *backend's* nature from its environment.
- **Ingestion is a write path.** Local resources read by the UI are transient client
  state until *uploaded* via a command; thereafter they are backend-owned and the UI
  caches them. Upload creates a **second replica**, so transfer/sync (source-of-truth +
  conflict) is first-class, not incidental.
- **The agent is the policy-enforcement point.** The broker is untrusted from the
  agent's perspective; the agent independently enforces grants + consent. This is the
  native-scale extension of the prototype's "nothing happens until you confirm" ethos:
  "let *this* session use fs-write on my *work desktop*" is the same consent card as a
  relation edit, for a capability on a host.

## The one irreducible residue

Sending *files* is not access to the *environment*. "Run my repo's tests with my
installed toolchain, my env vars, a real PTY, in place" is device **execution** — only
an agent **on that host** can do it. The cloud can run an *uploaded copy* in *its*
container, but that is the cloud's environment, not the user's. Everything else
(reading/transferring local files) the UI can do from anywhere; this is the sole thing
that genuinely requires an on-host agent.

## How this maps onto today's code (grounding)

The current contract is the **degenerate one-agent case** of this model, and already
leans the right way:

- `Capabilities` ([`../contract/api.ts`](../contract/api.ts), the `Capabilities`
  interface) is a *static, single-backend* descriptor — it would generalize to a
  **dynamic agent registry** (`Agent[]` each `{ id, host, capabilities, scopes }`),
  with the existing SSE bus
  ([`../server/routes/index.ts`](../server/routes/index.ts), the `/events` route)
  carrying `agent.connected` / `agent.disconnected` / `agent.capabilities.changed`.
  It already half-knows capabilities aren't uniformly local: `scheduledExecution` is
  true even for a remote backend.
- The `can(feature)` gate ([`../server/store.ts`](../server/store.ts), `can(...)`) and
  the flat native routes (`/fs/...`, `/git/...`) become **addressed + routed** calls
  (`/agents/:id/fs/read`); `409 capability_unavailable` becomes "no connected agent
  offers this on the requested host."
- The single `API_BASE` ([`../src/api/client.ts`](../src/api/client.ts)) gains a
  **second transport in the lowest layer** + a routing decision (target == local agent
  → direct loopback; else relay). `apiGet/apiPost` and everything above stay identical
  — the point of the transport-transparency invariant.
- The in-Electron agent, run standalone against the server, **is** the loopback
  companion: this model's dev/test path and its browser-deployment path are the same
  artifact. The loopback bind + permissive CORS this needs are already present
  ([`../server/index.ts`](../server/index.ts) binds `127.0.0.1`;
  [`../server/http/respond.ts`](../server/http/respond.ts) sets `CORS_HEADERS`).

## Open questions (not yet decided)

1. **Capability grant/scope model** — concretely, how an agent advertises and the user
   grants scoped capabilities (roots for fs, allowed commands for terminal), and how
   grants are revoked.
2. **Target-selection UX** — the implicit resolution rules (resource→host binding) and
   how an explicit override is surfaced when ambiguous.
3. **Agent enrollment / pairing flow** — how a new host's agent is added to the account
   and bound to its durable identity + key.
4. **Model tool-calls ↔ capability routing** — is the model's access literally MCP over
   the broker, or a parallel routing layer? (Strong pull toward MCP-shaped.)
5. **Agent-log retention/GC policy** — how long an offline agent retains its outbox and
   what it summarizes vs. replays.
6. **Shared-state vs. agent-projection boundary** — the concrete schema of which fields
   are server-authoritative vs. projected from agents, and how references resolve in the
   UI.
7. **Model-availability under partition** — accept the server-gated model (the model path
   is not offline-safe; current choice) vs. **queued model intents** replayed on reconnect
   (graceful degradation reusing D2's outbox, no credential move).

## If/when we build it — smallest first slice

1. Run [`../server/index.ts`](../server/index.ts) as a **standalone agent**, point a
   browser build at it via `VITE_API_BASE`, and add a **presence probe + onboarding
   fallback** in the UI. Validates "Electron = unbundled co-located agent" on the real
   code, smallest change.
2. Add **stable agent identity** (D4) + the registry as a dynamic list with SSE
   connect/disconnect events.
3. Route **one** capability (fs-read) through `(agent, capability, scope)` addressing,
   with the agent enforcing a scoped grant — exercises D2/D3 end to end on one path.
4. Add the **co-located fast path** in the client's lowest layer behind the
   transport-transparency invariant, teeing audit to the server.

## Implementation status (live)

> What of this model is actually built in the repo now, vs. the forward-looking
> design above. Updated as slices land. Each slice ships with tests (`npm test`,
> Node's built-in runner — no new deps) and keeps `npm run typecheck` + `build`
> green.

- **Slice 1 — agent registry, durable identity, test harness. ✅ Built.**
  `contract/agents.ts` (`Agent`, `CapabilityType`, `AgentCapability`, register /
  set-capabilities DTOs); `server/registry.ts` (`AgentRegistry` —
  register / heartbeat / setCapabilities / deregister / find / list, durable
  offline identity per D4, ambient `agent.*` events, injectable clock); a
  co-located agent seeded in native mode (`server/data/agents.ts`); the `/agents`
  routes; and the `useAgents` cache hook + `agent.*` event invalidation (keeping
  the frontend-as-cache invariant). Tests: registry (unit), store spine
  (regression), agent routes (integration). *Caught a real bug:* TS parameter
  properties aren't erasable syntax, which Node's runtime type-stripping rejects —
  would have broken server boot.
- **Slice 2 — capability addressing + routing. ✅ Built.**
  `POST /agents/:id/invoke` with a `(capability, target, args)` body. The broker
  (route) resolves the agent + checks liveness; `server/agent-runtime.ts` — which
  conceptually runs *inside the agent* — enforces the scoped grant (D3:
  `scopeMatches` with path/command boundaries) and fulfils (mock, real-shaped
  output per capability). Error mapping: `not_found` (unknown agent),
  `capability_unavailable` (offline, or capability not advertised), `forbidden`
  (target outside the grant — a new `403` contract error code). Client "one door"
  command `invokeCapability()`. Tests: `tests/capabilities.test.ts` (runtime unit:
  scope matching, grant enforcement, fulfilment) + `tests/routes-invoke.test.ts`
  (integration: every error path). 35 tests total; verified live (in-scope 200,
  out-of-scope 403).
- **Slice 3 — system of record (D2). ✅ Built.**
  `server/journal.ts` — the `AgentJournal`: each agent's authoritative effect log
  with **idempotency** by `commandId` (a retry replays the recorded effect, never
  re-executes), **monotonic per-agent `agentSeq`**, a **projection cursor** +
  `reconcile` (the relay path projects synchronously; emits `agent.effect` as
  effects project so clients converge), and **`merge`** — the outbox replay an
  agent uses to tee fast-path / offline effects, deduped by `commandId`. Routes:
  `invoke` now records + projects idempotently; `GET /agents/:id/effects?since=`
  (read-through log); `POST /agents/:id/sync` (outbox replay → projected delta +
  cursor). UI: `useAgentEffects`, `syncAgentEffects`, `agent.effect` invalidation.
  Tests: `tests/journal.test.ts` (unit: idempotency, ordering, cursor/reconcile,
  merge) + `tests/routes-effects.test.ts` (integration). 47 tests total; verified
  live (idempotent retry replays the original effect; sync projects the delta).
- **Slice 4 — UI surface (the registry, made visible). ✅ Built.**
  `src/components/HostsControl.tsx` — an ambient "Hosts" control in the composer's
  right group (beside the usage gauge), reading `useAgents()`: an online-count
  pill that opens a popover listing each connected host, its online/offline dot,
  origin, and capability chips (fs read / fs write / terminal / process). It is
  deliberately *not* in the Add-context menu — agents are a standing fabric,
  referenced by name, not attached (D4). Verified live in the preview (shows the
  seeded "This Mac" with its four capabilities); typecheck + build green.
- **Still forward (needs a real loopback companion, not a mock): the co-located
  fast-path *transport* (D1).** The registry, addressing, routing, system-of-record,
  and now the UI are all built — but the actual *dual transport* (the client's
  lowest layer talking direct-to-loopback vs. relay) is intentionally **not**
  faked, because in a browser-only mock both paths resolve to the same origin and
  a stubbed "direct" path would be theatre, not a real boundary. The seam is
  identified and ready: a transport resolver keyed on an agent's loopback address,
  wrapping `invokeCapability`, behind the transport-transparency invariant. This is
  the one slice that genuinely requires the companion app to be meaningful.
