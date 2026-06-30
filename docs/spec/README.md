# Design spec — the conformance baseline

> **What this is.** A hierarchical, checkable specification of *what this prototype
> is supposed to do*, written so an evaluator (human or agent) can verify the code
> still implements it — and so a gap like "files/photos/folders are mocked, not
> really served" is **visible by construction** instead of discovered by accident.
>
> It complements, not duplicates, the other docs: [`PROPOSAL.md`](../../PROPOSAL.md)
> is the *argument*, [`README.md`](../../README.md) is the *engineering tour*, and
> [`AGENTS.md`](../../AGENTS.md) is the *evaluation digest*. This spec is the
> **requirements ledger** they imply, with each requirement traced to the code that
> satisfies it and the test that locks it.

## The goal (L0)

The Claude desktop app exposes **Chat / Cowork / Code** as three sibling tabs.
This prototype argues they are three presentations of one primitive and should be
**one conversation surface with an adaptive workspace**: you start a normal
conversation, *attach context* to it, and the UI **progressively discloses** the
right tools as the work demands them. The whole system is built as **real
boundaries with only the model mocked** — a real frontend over a real (mock) HTTP +
SSE backend, a real Anthropic Messages + tool-use seam, real filesystem serving —
so the interaction model *and* the client/server shape are both tangible.

Everything below decomposes that goal into pillars, and each pillar into leaf
requirements you can check against the tree.

## How to read it (progressive disclosure)

Three layers, drill down only as far as you need:

- **L0 — the goal** (this page, above).
- **L1 — the pillars** (one file each, below). Each opens with a one-paragraph
  *Intent* — the load-bearing claim and why it exists.
- **L2 — leaf requirements** (a table inside each pillar). Each row is one checkable
  requirement, traced to its **implementation** and what **verifies** it, with a
  **status**.

## Status legend

| Status | Meaning |
|---|---|
| ✅ built | Implemented and locked by an automated test (or, for DOM-only UI, verified in the running app and marked *in-app*). |
| 🟡 partial | Implemented but incomplete, or implemented yet only thinly verified. |
| 🧭 exploration | Forward-looking design recorded in `docs/` — **not** built behavior (the spec says so on purpose). |
| 📝 planned | Specified here, not yet implemented. |

## How the spec is checked against the code

Two layers, deliberately:

1. **Behavioral checks — the real guard.** Every ✅ leaf names a **locking test**
   under `tests/`. Running `node --test` *is* the conformance run for behavior: if
   an implementation regresses, its named test fails. UI-only behavior the headless
   harness can't exercise is marked *in-app* and names the component to inspect.
2. **Reference integrity — the drift guard.** `tests/spec-conformance.test.ts`
   scans every file in `docs/spec/` and asserts that **every repo path referenced
   in backticks actually exists**. So a renamed or deleted implementation/test file
   that a requirement points at fails the suite — the spec can't silently rot.

**What this does _not_ catch:** that a named test actually exercises the
requirement it claims to (a human/agent still authors honest tests), or behavior
drift in code a requirement under-specifies. The ledger makes those gaps *locatable*;
it doesn't make them impossible. When you add a feature, add its requirement row
here and its locking test — that is the discipline this directory enforces.

## Pillars (L1)

| # | Pillar | The claim in one line |
|---|--------|-----------------------|
| [01](01-adaptive-conversation.md) | Single adaptive conversation | One thread + composer; no mode up front; the panel and history adapt to attached context. |
| [02](02-context-attachment.md) | Context as attachment | One Add-context entry point; six context types; files/photos/folders served from three **real** filesystem sources. |
| [03](03-in-place-escalation.md) | In-place escalation | A chat levels up to workspace then repo in one thread, via consent-gated model tool calls. |
| [04](04-consent-and-relations.md) | Consent & the relationship graph | Ten relations, edited only via inline confirm cards; per-action vs standing approval; one gate for everything Claude changes. |
| [05](05-portable-contract.md) | Portable contract & push sync | One UI, two backends, one verbatim contract; read-through cache + SSE; capability gating with `409`. |
| [06](06-model-and-tools.md) | Real model + tool boundary | Generation runs through a real Anthropic Messages API with a real tool-use loop; only the model is mocked. |
| [07](07-persistence.md) | Server-owned state & persistence | UI-owned state is the server's, snapshotted to disk and rehydrated; transient state is not. |
| [08](08-capability-broker.md) | Capability broker (built + exploration) | A live runner registry brokers host capabilities (fs/terminal/process) with mediation, a journal, and reservations; Agent Commons layers authority/budget. |
| [09](09-design-invariants.md) | Design invariants | Locked-in decisions: light-theme-only, no "before" view, IPv4 bind, shared primitives (form follows function), one door to the backend, framework-free contract. |
| [10](10-forward-looking.md) | Forward-looking — required but not built | The top-down gap rows: features the goal implies that the prototype doesn't (fully) ship yet (`📝`/`🟡`). This is what makes the spec a gap-finder, not a code inventory. |
| [11](11-mock-boundary.md) | The mock boundary | The complete set of surfaces faked beyond the model (artifact bodies, connector/MCP detail, repo content+git, seed entities, usage) — so "real vs mock" is always answerable. |

## Known gaps (the unimplemented / partial features)

These are the requirements the goal implies that the prototype does **not** fully
satisfy today — kept here at L0 so they're visible, and enforced by
`tests/spec-conformance.test.ts` (every `📝` requirement must appear in this list).
Detail + anchors are in [pillar 10](10-forward-looking.md).

- **FWD-1** `🟡` — pre-attached entry shortcuts (§7); the `newSession(seed)` seam + an `EmptyState` launcher are built, dedicated per-mode sidebar entries remain.
- **FWD-2** `🟡` — the right panel's expansion remembered per-conversation (§7); auto-open is built, per-session memory isn't.
- **FWD-3** `📝` — responsive panel rules / auto-collapse to a rail on small windows (§8).
- **FWD-4** `🟡` — cross-device sync of the server-owned state (§10); the foundation is built, multi-device fan-out isn't.
