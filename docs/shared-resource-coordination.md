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

## Relationship to the broker doc

- **D1–D4** answer *where work runs* and *who is authoritative for a host*. **D5
  (resource-guardian)** answers *who is authoritative for a shared resource's
  invariant* — the missing third axis.
- The broker doc's **open question 7** (model availability under partition) is a
  *special case* of this note restricted to one effect (a model turn) and one
  reconciliation (branch-or-queue). This note is the general theory that subsumes it:
  a model turn that writes shared session state is just another non-monotonic effect
  whose commit belongs at a guardian.
