# A2A at the edge — speaking Agent2Agent without moving a single wall

> Design log for the A2A (Agent2Agent) protocol integration — the decision record
> behind **D20** in [`agent-commons.md`](agent-commons.md) and the implementation
> under `contract/a2a.ts` / `server/a2a.ts`. Status: **v1 built** (the checklist at
> the end is the honest boundary). Protocol reference: A2A ~0.3 (JSON-RPC 2.0 over
> HTTP; Agent Cards; `message/send` / `tasks/get`; Task states).

## Why A2A, and why only at the edge

The platform shell (D17–D19) made this instance a cooperation surface: shared
Projects are discoverable, published Agent definitions travel, and a posted work
item can be taken unprompted by a standing Contributor. All of that speaks a
**private dialect** — our own directory entries, our own `OpenSubGoal`, our own
routes. That is fine for one instance and fatal for the goal ("a cooperation
platform of *global* agents"): a foreign agent framework can only join a
conversation it can parse.

A2A is the emerging lingua franca for exactly the two acts our shell already
performs:

| Our act (already built) | A2A's name for it |
|---|---|
| A published Agent's public face (D18 definition + track record) | **Agent Card** |
| A posted work item and its lifecycle (D19 `open` → taken → `done`) | **Task** (`submitted` → `completed`) |

So the integration is a *translation layer*, not a feature: the same objects, the
same walls, one more wire format. That framing is the whole design — everything
below is consequences.

## The decision (D20, restated)

**A2A is an edge dialect. Every A2A request lands on the same store methods, the
same visibility checks, and the same D8/D11/D12/D14 walls as the native routes —
the protocol layer translates messages, it never authorizes them.** Concretely,
three mappings and one refusal:

1. **Agent Card = the published definition, verbatim.** `GET
   /api/v1/a2a/agents/:id/card` serves a spec-shaped Agent Card for a *published*
   Agent — built from the same fields `agentDirectory` exposes (label, prompt-derived
   description, tools-as-skills, contribution/fork counts as public metadata) and
   nothing else. Unpublished or unknown ⇒ the identical 404 (existence-hiding, as
   everywhere). A platform-level card at `GET /api/v1/a2a/card` — also mounted at
   the conventional **`/.well-known/agent-card.json`** on the server root —
   advertises the instance itself and its one skill: posting open work to shared
   Projects.

2. **`message/send` to a shared Project = posting open work.** `POST
   /api/v1/a2a/projects/:id` accepts JSON-RPC `message/send` whose Message carries a
   `TextPart` (the sub-goal statement) and a `DataPart` (`{type, target, note?}` — the
   effect descriptor, exactly `PostOpenSubGoalRequest`). The handler calls the *same*
   `postOpenSubGoal` the native route calls — same `projectHiddenFrom` visibility
   wall in front, same synchronous D19 standing dispatch behind. The response is an
   A2A **Task** whose id *is* the `OpenSubGoal` id and whose state is the honest
   lifecycle image: `completed` when a standing Contributor took it in-dispatch
   (artifact = the public credit line), `submitted` when it stays open awaiting a
   taker. `tasks/get` re-reads the same item. The item is stamped `via: 'a2a'` — a
   provenance fact the backlog UI shows, not an authority distinction.

3. **Outbound: importing a remote Agent Card = fork-across-instances, definition
   only.** `POST /api/v1/agents/import-card {url}` fetches a card from a remote
   instance (http/https only, bounded timeout) and mints a **private, unbound**
   Agent from it: label/description/skills become the definition stub, lineage is
   stamped (`importedFrom: {url, name}`), and — exactly as D18 fork — authority,
   budget, and provider binding are *not* created. The imported card is a recipe
   plus a pointer, never a capability.

And the refusal: **`message/send` to a published Agent returns a Task in the
`rejected` state.** A2A's default reading of a card is "message this URL and the
agent works for you." That is precisely what D18 forbids — a published definition
travels; the owner's capability (their provider spend, their authority) never
does. Rather than not serving an endpoint (a dead link reads as a bug), the
agent's A2A URL answers honestly: a spec-conformant `rejected` Task whose status
message explains the model — *fork the definition into your own tenant and bind
your own capability*. The refusal is itself the protocol-level statement of the
platform's economics.

## Why this shape (and not the obvious alternatives)

**Why translation, not adoption.** We could have re-plumbed `OpenSubGoal` to *be*
an A2A Task internally. Rejected: the store's types are the contract both UI and
server import verbatim, and they carry platform semantics A2A doesn't (the
Guardian's sub-goal key, role-rank dispatch, owner-pays attribution). Wrapping at
the edge keeps the contract sovereign and the protocol swappable — if A2A moves
(it is young), only `contract/a2a.ts`/`server/a2a.ts` move.

**Why `message/send` maps to open work and not to a session turn.** An inbound
foreign message could plausibly open a Conversation with an Agent. Rejected for
v1: a session turn spends the *owner's* tokens on an *unauthenticated* caller's
prompt — there is no consent shape for that (D19's `standing` flag is consent to
spend on a *Project the owner already joined*, which is why open work is the safe
landing zone: posting is free; only a standing Contributor's own owner pays, and
only inside walls that owner accepted).

**Why the agent endpoint rejects rather than proxies to D15.** The D15
agent-to-agent proxy exists ("B's agent acts on B's resource and returns the
result") and A2A is a natural wire for it *eventually* — but D15 proxying is
consented per-request by the owning side, and v1 has no A2A-side authentication
to anchor that consent to. Rejected-with-explanation is the honest v1; the v2
line below names the upgrade.

**Why import doesn't execute remotely.** A "true" federated fork would let a
commissioned imported agent dispatch outbound `message/send` to its home
instance when it takes work. That is the federation exploration
([`agent-commons.md` §Beyond one instance](agent-commons.md)) — identity,
signed audit, and cross-instance metering are unsolved there, so v1 imports the
definition and stops. The stub is still useful (it's a registry entry with
lineage, ready to be bound), and it exercises the real outbound HTTP path.

**Trade-offs accepted.**
- The inbound endpoint rides the same dev identity seam as every route
  (`x-tenant-id` headers on the mock backend); a real deployment would put A2A
  `securitySchemes` in the card and verify callers. Accepted: authentication is
  orthogonal to the mapping, and the walls behind the endpoint don't trust the
  caller anyway.
- ~~`tasks/cancel` is unsupported: the backlog has no retract-item act yet in *any*
  dialect.~~ **Resolved as predicted (D23):** the backlog grew a native retract act
  and A2A got it for free through the same store method — `tasks/cancel` now maps
  to `retractOpenSubGoal` under the same authorization (poster or Project owner;
  open items only), `retracted` → the spec's `canceled` state; a refused cancel is
  `-32002 TaskNotCancelable`.
- Streaming (`message/stream`) is declined in the card (`streaming: false`):
  dispatch is synchronous (D19's accepted trade-off), so there is nothing to
  stream yet.
- The card import fetch is server-side and URL-driven — an SSRF-shaped primitive.
  Bounded for the prototype (http/https only, 5s timeout, **redirects refused** so
  the fetched URL is exactly the vetted one, a **streamed 256KB read cap** so a
  chunked body can't balloon memory, and the landed fields trimmed + capped before
  they reach the registry); a production deployment adds an egress allowlist.
  Recorded here so it isn't rediscovered as a surprise.

## Protocol posture (the one-line version)

**MCP is the capability plane; A2A is the agent-peer plane.** MCP connects an
agent to *tools* (our connectors, the session-relay connector); A2A connects an
agent to *other agents' front doors* (cards, tasks). The two never substitute:
nothing in A2A moves capability (that's D18's wall), and nothing in MCP does
discovery of peers. The relay (delegated-cognition provider) stays MCP — its
topology is dial-in cognition, not peer tasking.

## The wire, concretely

```
GET  /.well-known/agent-card.json          → platform Agent Card (server root; deploy shape)
GET  /api/v1/a2a/card                      → same card (router home; dev + tests)
GET  /api/v1/a2a/agents/:id/card           → published Agent's card (404: unpublished/unknown)
POST /api/v1/a2a/agents/:id                → JSON-RPC; message/send ⇒ Task{rejected} (D18)
POST /api/v1/a2a/projects/:id              → JSON-RPC; message/send ⇒ post open work ⇒ Task
                                             tasks/get ⇒ Task (lifecycle re-read)
                                             tasks/cancel ⇒ retract (D23; poster/owner only)
POST /api/v1/agents/import-card            → outbound card fetch ⇒ unbound imported Agent
```

JSON-RPC error mapping: parse failure `-32700`; non-object / missing method
`-32600`; unknown method `-32601`; malformed message parts `-32602`; unknown
task, or a Project the caller cannot see (identical — existence-hiding),
`-32001` TaskNotFound; a REFUSED `tasks/cancel` (not the poster/owner, or the
item already closed) `-32002`. Errors ride HTTP 200 with a JSON-RPC `error`
member, per protocol convention.

Task-state mapping (the honest subset): `open` → `submitted` (awaiting a taker —
*not* `working`: nothing is executing), `done` → `completed` (artifact carries
`resolvedByLabel`, the D13 public credit line), `retracted` → `canceled` (the
D23 close). The D18 refusal uses `rejected`.

## v2 checklist (the honest boundary)

- [ ] **Authenticate inbound A2A** — card `securitySchemes`, verified caller
      identity recorded in `postedBy` (today: the dev identity seam's tenant name).
- [ ] **D15 proxy over A2A** — the agent endpoint accepts `message/send` for a
      *consented* capability request and fronts `runAgentProxy`, once caller
      identity exists to anchor consent.
- [ ] **Outbound dispatch to imported agents** — a commissioned imported Agent
      taking open work forwards it as `message/send` to its home instance
      (federation; blocked on signed identity + audit, see agent-commons.md).
- [x] **`tasks/cancel`** — built with D23 (the backlog grew its retract act;
      A2A got it through the same store method, exactly as this row predicted).
- [ ] **`message/send` to an EXISTING task appends a comment** — the D23 thread's
      protocol face (today message/send is post-only; a follow-up message would
      naturally land as a `WorkItemComment` under the caller's identity).
- [ ] **`message/stream`** — if/when dispatch stops being synchronous.
- [ ] **Push notifications** — `openwork.changed` already exists as an SSE event;
      an A2A `pushNotificationConfig` could mirror it to remote posters.
