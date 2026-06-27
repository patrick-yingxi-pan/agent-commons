# Shared-resource coordination — when independent sessions cause irreversible effects

> **Status: forward-looking research note.** Part of the design log, not shipped
> behavior: it does **not** describe what the prototype does today and does **not**
> change current behavior. It generalizes a problem first surfaced in
> [`capability-broker-architecture.md`](capability-broker-architecture.md) — the
> "Availability / partition behavior" section and its session-branch model — to its
> true form, and records the reasoning so it isn't re-derived. "Principle" here means
> *settled within this exploration*, not implemented.
>
> It extends the D-series of that doc (D1–D4) with a candidate **D5 — the
> resource-guardian principle**. Read the broker doc first; this picks up where its
> branch discussion stops.
>
> *(Forward pointer: [`agent-commons.md`](agent-commons.md) carries D5 into a
> multi-tenant model (D6–D13), where this note's hardest open residue —
> multi-principal negotiation, item 3 below — becomes the **default** case.)*

## The problem, in its general form

The broker doc's branch model handled a *partition*: one session forks into two
continuations, and you reconcile them on reconnect. That framing leaned — secretly —
on a **shared prefix**. "Manage session branches as git branches" works *only* because
the two continuations share an ancestor and a conceivable merge point.

The general problem drops the ancestor:

> **Different, independent sessions — possibly different users, different agents,
> different times — produce irreversible effects on the same shared resource.**

Now there is no fork, no merge, no common prefix. Session A and Session B have exactly
one thing in common: the resource they both mutate. So the entire locus of
coordination collapses off the *conversation* and onto the *resource*. The first
consequence is structural:

- **Sessions never reconcile with each other.** They only ever meet at the shared
  thing they both touch. Any solution that lives in the conversation/session layer is
  solving the special case. The general solution lives at the resource.

Git was the right tool for the branch case because conversation history is
**immutable, append-only, and locally-copied** — exactly git's world. Side effects on
a shared resource are none of those: one timeline, mutable, often irreversible, remote.
*Git versions the recipe, never the meal.* Two branches of a recipe merge; two meals
already cooked and served do not.

## How sessions touch the world here: context elements

In this system a session never addresses a raw resource. It **attaches a context** —
one of six kinds (`files | photos | folder | repo | connector | mcp`;
[`../contract/contexts.ts`](../contract/contexts.ts), `ContextTypeId`) — and every
side effect a session initiates flows *through* that context. A `repo` or `folder`
context **bound to a host's agent** (D4) carries fs / terminal / process effects on
that repo; a `connector` / `mcp` context carries effects on an external service (a
GitHub repo, a calendar, a ticketing system, an outbound email). **The context element
is the conduit between session-*intent* and resource-*effect*.**

That makes the "shared resource" of the general problem concrete and already
first-class. A **`SavedContext`** is *reusable across sessions* and counts its own
fan-in — `sessions: number`, "how many sessions have attached this"
([`../contract/contexts.ts`](../contract/contexts.ts), `SavedContext`). **A context
with `sessions > 1` is a shared resource**: the same repo attached to two threads, the
same connector used by ten. So the object the system must protect is not an abstract
"resource" — it is a **shared context element**, and it is exactly the kind that is
externally effectful (`connector`, `mcp`, `repo`) that lands in the hard case below.
The guardian this note proposes attaches to the context element.

## The boundary of "hard" is monotonicity, not reversibility

The broker doc sketched a reversibility × sharedness grid. The exact axis is sharper
and comes from **CALM** (Consistency As Logical Monotonicity): *a computation has a
coordination-free, consistent distributed implementation **iff** it is monotonic.*

- **Monotone effects** only ever *add* — append to a log, add to a set, increment a
  counter. More concurrent input never retracts a conclusion already drawn. Any number
  of sessions can run them, anywhere, offline, forever, and they converge (CRDT-like).
- **Non-monotone effects** test a negative or a global property — *uniqueness* ("am I
  the only booking?"), a *threshold* ("is the budget still ≥ 0?"), a *maximum*, a
  *final* state. A concurrent action can *retract* a conclusion another session already
  acted on. **Non-monotonicity is the mathematical signature of "needs coordination."**

Layer irreversibility on top and the real taxonomy falls out:

| Effect class | Coordination | Tool |
|---|---|---|
| **Monotonic** | none needed | runs anywhere; just converges |
| **Non-monotonic, reversible** | needed, but *optimistic* | serializable isolation, **abort** on conflict (MVCC/SSI) |
| **Non-monotonic *and* irreversible** | needed, and *can't abort* | **the hard quadrant** — coordinate *before* the act |

The whole problem in one line: **you must coordinate (CALM), and you can't roll back
(irreversible), so the coordination cannot be optimistic — it must be pessimistic,
ahead of the act.** Optimistic-abort, the workhorse of database concurrency control, is
simply unavailable once the email is sent.

## The general primitive: escrow turns the hard quadrant into the easy one

The move that does the most work: **an agent must never perform an irreversible effect
on the strength of its own read of shared state. It performs it on the strength of a
*reservation* issued by the resource's authority.**

Reservations are *reversible* — they expire, they can be revoked, they hold capacity
without consuming it. Consuming one (the single irreversible step) is guarded on the
reservation still being valid. This **transforms a non-monotonic-irreversible decision
into a non-monotonic-reversible reservation plus one guarded consumption** — dragging
the entire deciding phase out of the hard quadrant and leaving only a thin, single,
guarded commit.

The world already runs on this wherever stakes are high:

- **Payment auth/capture** — the authorization is a reversible hold; the capture is the
  irreversible settle.
- **Seat / inventory holds** — reservable with a TTL; ticketing is the irreversible
  step.

The thesis: **the general solution to "many sessions, irreversible effects, one shared
resource" is to make the resource reservable.** Where you can make it reservable, the
problem is solved. Where you cannot, you are left with **compensation** (sagas) — no
prevention, only detect-and-correct — which is the genuine fallback, not a first
choice.

## D5 (candidate) — the resource-guardian principle

This is the architectural payload, and it extends the D-series cleanly. The system has
had **two** systems-of-record:

1. the frontend caches the **session** (server-authoritative shared state); and
2. **D2** made each **agent** the authority for its **host's** local effects.

The general problem reveals a **third, orthogonal axis** neither covers:

> A shared resource touched by many sessions across many hosts needs **its own
> authority** — a *resource guardian* that owns the resource's invariant and its
> reservation ledger, and is **neither a session nor a host**.

The host-agent (D2) and the resource-guardian are the **same pattern** — a single
serialization point owning a durable ledger and enforcing policy — applied to two
different objects: a **host** vs. a **shared, invariant-bearing resource**. And the
irreducible coordination always happens *at* such an authority; **sessions coordinate
only *through* the guardian of whatever they share**, never with each other.

```
   Session A ─┐                          Guardian for context C
   Session B ─┤   reserve / commit   ┌──────────────────────────────┐
   Session C ─┼────────────────────▶ │  invariant (e.g. budget ≥ 0) │
      …       │                      │  reservation ledger          │ ──▶ irreversible
   Session N ─┘  ◀── grant / refuse  │  transactional outbox        │     effect (once,
                  & re-reason         └──────────────────────────────┘     idempotent)
   sessions never talk to each other — only to C's guardian
```

Even the dispatch mechanism already exists. **D2's agent outbox is the
transactional-outbox pattern**, which is precisely how an external irreversible effect
gets a transaction boundary at all: commit the *intent to act* atomically with the
reads it depended on (reversible, serializable), then dispatch the *act* exactly once,
after the transaction wins, with an idempotency key. The outbox was never only for
offline replay — it is the seam through which irreversible effects join a transaction.

So in broker terms: the broker routes *capabilities* to host-agents; **irreversible
shared-resource effects route to that resource's guardian**, where reservation,
invariant-check, and one-shot dispatch live. In our concrete terms (above), the
guardian attaches to a **shared context element**.

## The agentic move: conflict is a question, not an abort

One thing classical concurrency control cannot do that we can: **the actors are
intelligent.** When the guardian detects a conflict at commit, the right response is
often not a mechanical abort but to **return the conflict to the agent as new
information and let it re-reason** — "the room you reserved is gone; here are three
alternatives." The agent replans; across users, the two agents (or their humans) can
*negotiate*.

This matters because the true unit of correctness is **human/goal intent**, which the
effect log cannot represent. Reconciling at the effect level (last-writer-wins, merge,
compensate) is always a *degraded* fallback for having lost the intent; routing the
conflict back up to an intelligence *recovers* it. Classical systems retry the same
*operation*; agents can retry the *intent*.

And there is a clean alignment with this product's ethos. Irreversible shared effects
are exactly the ones the prototype already gates behind human consent ("nothing
happens until you confirm" — the relation-edit cards, the escalation prompts). So:

> **The consent gate and the serialization gate are the same chokepoint.** The moment
> you ask the human "send this?" is the moment you validate the reservation and acquire
> commit authority. The thing that protects the user *from the agent* is the same thing
> that protects shared state *from concurrency*. Two motivations, one gate.

## Levers that shrink the hard core

The hard quadrant is unavoidable but you can make it *small*:

- **Maximize the monotonic surface** (event-sourcing / append-only): most state becomes
  a fold over an append log — coordination-free — so only the thin non-monotonic
  invariants need a guardian.
- **Express effects commutatively** — deltas not absolutes, add/remove not set ("add
  line item" commutes; "set total" does not). Re-expression moves actions out of the
  hard quadrant outright.
- **Isolate invariants to explicit decision points** so the guardian guards a few small
  things, not the whole resource.

A well-designed system ends up mostly coordination-free; only a thin invariant-bearing
core needs the pessimism.

## The irreducible core (a pick-two)

Strip it down and there is a CAP-flavored impossibility — but **only for irreversible
effects** (reversible ones escape it; you can always reconcile after the fact). For a
**non-monotonic, irreversible** effect you cannot have all three of:

> { act **independently / offline** · **no coordination point** · **correctness** }

- independent + irreversible-shared → give up *no-coordination*: pre-acquire a
  reservation, or compensate afterward.
- no-coordination + irreversible-shared → give up *independence*: commit only under
  synchronous authority.
- independent + no-coordination → give up *irreversible-shared*: act only on the
  monotonic / reversible surface.

CALM says coordination is *required*; irreversibility says it can't be optimistic. So
it must be **pessimistic reservation** or **post-hoc compensation** — there is no third
option. That is the theorem-shaped center.

## The honest residue (genuinely open)

Not a clean, closed solution — what stays open:

1. **Unanticipated semantic conflict.** Reservation only protects *contended resources
   you knew to guard*. Two actions that conflict without touching the same item — an
   agent approves a refund while another changes the refund *policy* — are undetectable
   until they manifest → compensation only. You cannot escrow against a constraint you
   did not know existed.
2. **Cross-guardian atomicity.** An action irreversibly touching *two* shared resources
   reintroduces distributed commit across their guardians — 2PC (liveness cost) or
   sagas (compensation complexity). The general form brings distributed transactions
   back, with no free lunch.
3. **Multi-principal negotiation.** When the conflicting sessions belong to *different
   users*, "whose reservation wins" is mechanism design — priority, first-come,
   auction, fairness — not concurrency control. Open, and interesting.
4. **Lossy intent recovery.** Once you are compensating after the fact, reconstructing
   what each human *actually wanted* (to compensate *correctly*) is itself lossy.

## How this grounds onto today's code

The prototype already has the right seams; this note says what they would carry:

- **Context elements are the effect conduit.** `ContextTypeId`
  ([`../contract/contexts.ts`](../contract/contexts.ts)) is *where* a session reaches a
  resource; `SavedContext.sessions` is the **fan-in counter that distinguishes shared
  from private** — the guardian is needed precisely for `sessions > 1` contexts of the
  externally-effectful kinds (`connector`, `mcp`, `repo`).
- **The resource↔agent binding** D4 already requires (a `repo` context *bound* to the
  host where it lives) is the host-local case of the same idea; a guardian generalizes
  it to resources no single host owns (a connector, a shared cloud service).
- **D2's journal/outbox** ([`../server/journal.ts`](../server/journal.ts)) is the
  transactional-outbox dispatcher this needs — idempotency by `commandId`, monotonic
  per-author sequence, projected on commit. The reservation ledger is a sibling log at
  the guardian.
- **The consent surface** (relation cards; escalation prompts) is the existing human
  chokepoint that would double as the serialization/commit gate.

## Current mediation gap (inventory)

A concrete audit of session-initiated actions and whether the context mechanism guards
them **today**. The finding: the context mechanism is currently a **read-only catalog**
(`GET /saved-contexts`, `/connectors/detail`, `/recents`) plus an MRU writer
(`POST /recents/:type`); before slice 5 there was **no server-side session→context
binding** (attach was ephemeral client state), so no effect was context-mediated. Tiered
by whether the effect touches a shared / external resource:

| Tier | Action | Effect | Guard before mediation |
|---|---|---|---|
| **A** (native) | `POST /agents/:id/invoke`, `/sync` | `fs.write` / `terminal` / `process` on a host | host **scope-grant** (D3) only — `target` raw, no context |
| **A** (reads) | `GET /fs/folders/:id`, `/git/repos/:id/diff`, `/fs/pick` | reads of native fs / repo (stale-read risk) | capability flag |
| **B** (shared internal) | `POST /relations/ops` | mutate the shared relation graph | human **consent** |
| **B** | `POST /sessions/:id/messages` | model call + relation proposals | none on the turn |
| **C** (standing) | `POST /schedules`, `PATCH`/`DELETE /schedules/:id`, `/run` | a routine runs unprompted; runs can produce A/B effects | one-time approval at creation |
| **D** (session-local) | `PATCH`/`DELETE /sessions/:id` | rename / pin / archive / delete | single-owner; mediation N/A |
| **E** (bookkeeping) | `POST /recents/:type` | MRU ordering | n/a — not an effect |

Tiers **A–C** are the surface full mediation must cover; **D–E** largely don't need it.

## Closing the gap — the two primitives (implementation status)

> What of this note is **built** in the repo now, vs. forward-looking. Each slice ships
> with tests (`npm test`) and keeps `npm run typecheck` + `build` green.

- **Primitive 1 — session↔context binding. ✅ Built (slice 5).** A server-owned,
  persisted `SessionContext` per session — the *attachment of record*, replacing the
  ephemeral client-side attach (`SessionContext` in
  [`../contract/contexts.ts`](../contract/contexts.ts); `GET`/`POST /sessions/:id/contexts`,
  `DELETE …/:contextId`; the `session.contexts.changed` event; `useSessionContexts` +
  `attachContext`/`detachContext`). This is the object a guardian hangs off, and it fixes
  Tier B's structural root (attach is now a real, mediated write) while giving Tier C a
  referent.
- **Primitive 2 — context handle on the effect path. ✅ Built (slice 6).**
  `CapabilityRequest` ([`../contract/agents.ts`](../contract/agents.ts)) carries
  `sessionId` + `contextId`; `POST /agents/:id/invoke` resolves the binding and enforces
  `target ∈ context.scope` — the **reference-monitor** check — *on top of* the agent's
  host grant. That makes two authorities explicit: **D3 host grant** (may this host touch
  this path?) in the runtime, and **D5 resource mediation** (is this effect attached and
  in-scope?) at the broker. An effect can no longer reach a resource without naming a
  context bound to the session (Tier A). A scheduled task carries `contextIds` so its
  unprompted runs are mediation-ready (Tier C).
- **Guardian — per-resource reservation / escrow. ✅ Built (slices 8–9).** Each shared
  resource (a context element id) has a `ResourceGuardian`
  ([`../server/guardian.ts`](../server/guardian.ts)) enforcing a **capacity** invariant via
  a reservation ledger: `reserve` (reversible, TTL'd, re-entrant per holder) → `commit` (the
  single irreversible step) → `release`, capacity bounding concurrent distinct holders
  (1 = mutual exclusion). **Monotonicity is honored** — `isMonotonic`
  ([`../contract/agents.ts`](../contract/agents.ts)) marks `fs.read` coordination-free, so
  reads skip the guardian (CALM); non-monotonic effects (`fs.write` / `terminal` /
  `process`) must hold a reservation. The **invoke path enforces it**: a non-monotonic
  effect reserves the resource (the context element) and commits on success; a second
  session is refused with **`409 conflict`** — the escrow turning away a concurrent
  irreversible writer up front. There are now two authorities at the broker — mediation
  (attached + in scope?) and the guardian (resource free to write?) — atop the agent's host
  grant (D3). Routes: `reserve` / `commit` / `release` / `status` / capacity; UI:
  `useResourceStatus` + reserve/commit/release/setCapacity commands.
- **Still forward — cross-guardian coordination.** A single effect spanning *two* shared
  resources reintroduces distributed commit across guardians (2PC / sagas) — the
  reserve-all → consent → commit-all pattern. Single-resource escrow is built; the
  cross-resource orchestration, plus the open residue (unanticipated semantic conflict,
  multi-principal negotiation), is the next, harder slice.

## Relationship to the broker doc

- **D1–D4** answer *where work runs* and *who is authoritative for a host*. **D5
  (resource-guardian)** answers *who is authoritative for a shared resource's
  invariant* — the missing third axis.
- The broker doc's **open question 7** (model availability under partition) is a
  *special case* of this note restricted to one effect (a model turn) and one
  reconciliation (branch-or-queue). This note is the general theory that subsumes it:
  a model turn that writes shared session state is just another non-monotonic effect
  whose commit belongs at a guardian.
