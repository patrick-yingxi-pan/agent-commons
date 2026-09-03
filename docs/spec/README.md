# Design spec — the conformance baseline

> **What this is.** A hierarchical, checkable specification of *what Agent Commons
> is supposed to do*, written so a maintainer can verify the code still implements
> it — and so a gap like "files/photos/folders are mocked, not
> really served" is **visible by construction** instead of discovered by accident.
>
> It complements, not duplicates, the other docs: [`README.md`](../../README.md)
> is the engineering tour and [`AGENTS.md`](../../AGENTS.md) is the context map.
> This spec is the **requirements ledger**, with each requirement traced to the
> code that satisfies it and the test that locks it.

## The goal (L0)

Agent Commons is an agents-collaboration platform. People configure bounded
workers, drive work through adaptive conversations, and coordinate shared
projects, resources, routines, discussions, and proposals. Conversations attach
context and disclose the tools that context enables; every resource remains
addressable through the same split workspace. The system uses real UI/backend,
HTTP + SSE, authentication, MCP, Messages tool-use, and filesystem boundaries;
deterministic fixtures are enumerated in [pillar 11](11-mock-boundary.md).

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

### Where the L2 rows live

Colocation applies to the spec too: when a pillar's rows are owned by **one
module**, the table moves into that module as its `SPEC.md`, beside the code
that satisfies it and the suites that lock it — and the pillar here keeps the
*Intent* and links down. **Pillars keep the claim; modules keep the rows.** One
home per row, so there is no second copy to drift.

Migrated: [`07-persistence.md`](07-persistence.md) →
[`server/persistence/SPEC.md`](../../server/persistence/SPEC.md).

**Why only that one — measured, not assumed** (2026-08-12, after all three
layers colocated, so every locking test had found its module). Of **200**
requirement rows: **70** are locked entirely within one module, **80** name
suites in two or more, and **50** cite no test (in-app or planned). At a **40%
cross-module** rate, no other pillar is close to `07`'s ~100% single-owner
shape, and splitting one would put some rows in a module and leave the rest
behind — turning a pillar you can read in one sitting into a hunt across eight
files, for the third of rows that happen to qualify.

That ratio is not a defect in the ledger; it is what this system is. A
requirement like "an escalation is consent-gated and lands in place" is
*supposed* to be pinned by a contract test, a route test, and a browser spec at
once — a row that only one module could break would be a smaller claim than the
one worth making. **So a pillar migrates when its rows are single-owner, and not
because migration is the pattern.** Re-run the measurement before assuming that
has changed.

Wherever rows do live, `tests/spec-conformance.test.ts` scans them — it walks
`docs/spec/` **and** every module `SPEC.md`. That is load-bearing: when the
persistence rows moved, they left the scan's reach and six ✅ rows went
unchecked until the walk was widened to follow them.

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
| [09](09-design-invariants.md) | Design invariants | Locked-in decisions: current product identity, token theming, IPv4 bind, shared primitives (form follows function), one door to the backend, framework-free contract. |
| [10](10-forward-looking.md) | Forward-looking — required but not built | The top-down gap rows: platform features the current implementation does not fully ship yet (`📝`/`🟡`). This is what makes the spec a gap-finder, not a code inventory. |
| [11](11-mock-boundary.md) | The mock boundary | The complete set of surfaces faked beyond the model (artifact bodies, connector/MCP detail, repo content+git, seed entities, usage) — so "real vs mock" is always answerable. |
| [12](12-social-layer.md) | Social layer | Share / discuss / improve are orthogonal primitives over a generic entity ref; discussions, applying proposals, the Commons, profiles, messages, posts, mentions, and reply chains are built, with anonymous/indexed reading deliberately deferred. |

## Known gaps (the unimplemented / partial features)

These are the requirements the platform goal implies that the current implementation does **not** fully
satisfy today — kept here at L0 so they're visible, and enforced by
`tests/spec-conformance.test.ts` (every `📝` requirement must appear in this list).
Detail + anchors are in [pillar 10](10-forward-looking.md).

- ~~**FWD-1**~~ `✅` — context-seeded conversation entry is complete through `newSession(seed)` and the shared `EmptyState` attachment launcher; duplicate resource-specific launchers are not required.
- ~~**FWD-2**~~ `✅` — panel intent is **done and moved to [ADAPT-28](01-adaptive-conversation.md)**: per-viewer absent/closed/named-context state persists server-side, syncs live across devices, and keeps an account-scoped offline mirror. The universal split retired the old per-conversation frame-width follow-on.
- ~~**FWD-3**~~ `✅` — responsive layout is **done and moved to [ADAPT-11](01-adaptive-conversation.md)**: narrow-tier rail drawer + full-viewport panel takeover + the `short` height axis (the icon-rail idea was superseded by the drawer — PD35).
- **FWD-4** `🟡` — general cross-device conflict semantics remain partial. Persistence + tenant-scoped SSE fan-out are built; panel intent has serialized reconciliation; conversation metadata and deletion, routine definition/creation/execution, artifact bodies, Dispatch creation, Provider create/configure/remove lifecycles, saved Context connection state and removal, the Agent and Contributor create/configure/remove lifecycles, system-prompt creation/definition/removal, Project description/instructions, sharing, and authored social prose use conflict-safe or exact-identity writes with held intent and explicit recovery; proposal verdicts freeze the reviewed revision. Other mutable domains still rely on invalidation/refetch or last-write-wins.
- ~~**FWD-5**~~ `✅` — the **principals & namespaces** re-rooting is **done and moved to [INV-10](09-design-invariants.md)**: person-only login with one namespace per account, principal-stamped acts (kind-only wire), the agent-actor badge + attribution chain; orgs deferred by design behind the opaque owner id.
- ~~**FWD-8**~~ `✅` — **`server/` is now typechecked** ([pillar 10](10-forward-looking.md)): `server` joined the tsconfig include (37 errors → 0). Three real defects fell out of it — a dropped session-unfile override, a contract face declaring `epoch: number` against a string, and a seeded Agent missing required fields behind a double cast.
- **SOCIAL-10** `📝` — **anonymous rendering + indexing** ([pillar 12](12-social-layer.md)): the declared S6 tail. Today "anyone with the link" means anyone SIGNED IN who redeems it; reading with no account, and being indexable, are deliberately unbuilt — the one part of the social layer with no honest mock.
- ~~**FWD-6**~~ `✅` — **orgs as namespaces** is done (v1): founding, consent invitations, the member-union walls, the owner picker, the org page's member panel (`server/routes/orgs.test.ts`, `e2e/orgs.spec.ts`). Org-owned registries, role-graduated member writes, and the invite bell stay v2 by design.
