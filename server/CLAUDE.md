# server/ — backend rules (loaded when working under server/)

Scoped context for the mock backend. The always-on map is
[`AGENTS.md`](../AGENTS.md); this file holds the locked decisions that govern
`server/` code.

## Layout — a module carries its own context, spec and locks

Each subdirectory is a module that holds everything needed to read, verify and
reuse it: the code, a scoped `CLAUDE.md`, the requirement rows it owns
(`SPEC.md`), and the suites that lock it — as **siblings**, not in a mirrored
tree elsewhere. Progressive disclosure applied to every kind of file, not just
to `CLAUDE.md`: you load a module's context by opening its directory.

| Module | What it owns |
|---|---|
| [`routes/`](routes/CLAUDE.md) | the route table (plain data — the tool surfaces are generated from it) |
| [`store/`](store/CLAUDE.md) | the in-memory store and its tenant-scoped projections |
| [`http/`](http/CLAUDE.md) | transport: router, responses, SSE, non-HTTP door re-entry |
| [`model/`](model/CLAUDE.md) | the Anthropic-compatible mock endpoint (the model seam) |
| [`persistence/`](persistence/CLAUDE.md) · [`SPEC.md`](persistence/SPEC.md) | snapshots, backends, migration, durability |
| [`data/`](data/CLAUDE.md) | seed fixtures and the demo-account data standard |
| [`testkit/`](testkit/CLAUDE.md) | the drivers suites boot the server with |

Root-level modules (`auth.ts`, `accounts.ts`, `mcp.ts`, `relay.ts`, `turns.ts`,
`generate.ts`, …) keep their locks beside them as `<module>.test.ts`. **A suite
belongs to the module it locks, not to the one it drives through**: a test that
exercises auth over HTTP is an auth test and sits next to `auth.ts`; a test
whose subject is an endpoint's contract sits in `routes/`.

Suites are excluded from `tsconfig.json` so colocation does not silently
reverse the measured decision that the test surface is verified by running
rather than by the compiler ([`tests/CLAUDE.md`](../tests/CLAUDE.md)). What
stays in [`tests/`](../tests/CLAUDE.md) is only what the *repo* owns — the
doc-lint and cross-layer locks with no single module to belong to.

## Ground rules

- **Few runtime dependencies.** The server carries a single, intentional
  dependency — **`@anthropic-ai/sdk`**, the Messages client behind the
  generation seam (below). Don't add others without good reason; the rest of
  `server/` stays dependency-free (it even hand-rolls its Node types in
  `server/node.d.ts`).
- **Strict core, convenient edge (INV-9).** An absent request field must mean
  something fixed (inherit / complete-set constant / minimal-risk none), or be
  refused with `ValidationError` → 400 — never resolved to a mutable entity or
  privileged value on the caller's behalf. Conveniences (pre-selections,
  name→id resolution) run at the edge, before the request or consent card, and
  their result is shown. Full statement + earned instances:
  [`docs/spec/09-design-invariants.md`](../docs/spec/09-design-invariants.md).

## Generation runs through a real Anthropic Messages API boundary with a real tool interface

(Not an in-process fake.) `server/generate.ts` calls an
Anthropic-compatible endpoint via `@anthropic-ai/sdk` — the one accepted server
dependency — declaring the resource-manipulation tools (`server/model/tools.ts`)
and running the **tool-use loop**: model → `tool_use` → backend executes →
`tool_result` → final prose. The resource manipulations are therefore the
model's *tool calls*, executed by the backend and surfaced as the consent-gated
proposals the UI confirms (`message.relations` for relation edits,
`message.escalation` for panel escalations) — they are part of the Messages API
tool-use protocol, **not** a backend keyword overlay. `server/model/` is the dev
mock of the endpoint: it *decides* which tools to call (matching the message by
fixed string / keyword, `intents.ts`) and wraps canned prose around them
(`replies.ts`), speaking the Messages wire format (JSON + streaming SSE,
including `tool_use` blocks). Going live is `ANTHROPIC_BASE_URL` +
`ANTHROPIC_API_KEY`, nothing more; model id `claude-opus-4-8`. This follows the
project's broader rule: build the real boundaries now (the frontend is a cache of
the backend; the backend is a client of the model; the model manipulates
resources through tools), not prototype shortcuts a production system would have
to unwind.

## Front door by default — no data before sign-in

Real boots default the
auth gate ON (`server/index.ts` sets `AUTH_GATE ??= 'require'`): pre-sign-in,
the UI shows the auth surface and the API refuses data routes with 401 — the
gate is a server-side WALL (one router middleware + the ANONYMOUS principal in
`store.identity`), not client chrome. The open set is only the front door
(`/capabilities`, `/me`, `/auth/*`, ops probes) and the self-authenticated
machine edges (`/a2a/*`, `/relay/*`, `/connector`). `AUTH_GATE=off` opts a
boot out (the E2E stack and `scripts/ui-sweep.mjs`'s target may run either
way — the sweep signs in as Ada first). Locked by `server/routes/auth-gate.test.ts`;
spec row SYNC-8.

## Three access doors, one wall (access-parity INV-11)

The product is reachable by the browser UI, the in-app session, and the **MCP
door** (`POST /mcp`, `server/mcp.ts`) — equally capable, gated by the same
policies, **by construction**. The route table owns whether an operation is an
authenticated product capability, protocol/credential form, semantic alias,
or session-intrinsic realization. Both MCP catalogs project that metadata and
re-enter the router (`server/http/dispatch.ts`); the cross-layer lock derives
the shipped UI's reachable API calls and compares all three semantic capability
sets in both directions. The in-app leg (`server/model/apiTools.ts`, MODEL-25):
reads run NOW as the sending user (provenance rows); mutations become
family-carded proposals executed as the CONFIRMER on the user's click. Never
hand-add a generated tool, create a private exclusion list, or give an access
method a private policy branch. Auth is the one session credential over cookie
OR `Authorization: Bearer` (`transport: 'bearer'` on login/signup mints for
machines).
Explainer: [`docs/mcp-access.md`](../docs/mcp-access.md); locks:
`tests/access-surface-parity.test.ts`, `server/mcp-parity.test.ts`,
`server/model/api-tools.test.ts`, `server/mcp.test.ts`,
`server/routes/auth-bearer.test.ts`.

**The hand-written seam** (owner directive, 2026-08-09: *"always update the MCP
interface of this website to keep the UI and MCP in sync"*). Generation keeps
the TOOLS in sync for free; the door's `initialize` **instructions** are prose,
and they point a machine caller at places in the human UI ("mint a token in
Contexts → …"). That makes MCP a consumer of UI copy with no compiler behind
it: rename the panel and the door keeps directing callers to a screen that no
longer says that — which happened on 2026-08-09, with every suite green. So
every UI string the door quotes is declared in `MCP_UI_COPY` and scanned
against the live components by `server/mcp-ui-sync.test.ts`. Quoting more UI copy
means adding an entry, never another bare literal. Note what the rule does NOT
ask for: a UI change that adds no route needs no new tool — parity is about
capability and policy, not about minting an endpoint per affordance (the rail's
"Your profile" door composes `get_me` → `get_directory_owners_by_name`, and a
second address for that profile would be the drift, not the fix).

## Persistence and snapshots

When the real server runs (`dev` / `start` / `server`), the UI-owned state —
sent messages, created sessions, attached context + its panels, schedules,
recents, relation edits, and the Agent Commons registries — is snapshotted to
`.data/store.json` on each mutation and rehydrated on boot
(`server/persistence/persist.ts`), so it survives a restart. The simplest viable format
(one JSON snapshot, atomic write). Transient state (reservations, the live
agent registry) is deliberately *not* persisted. Tests run in-memory.

Back up / restore for testing (`scripts/snapshot.ts`): `npm run snapshot:save`
copies the live store to `.data/snapshots/backup.json`;
`npm run snapshot:restore` copies it back (restart the server — persistence
loads once on boot); `npm run snapshot:list` shows them. `npm run snapshot:build`
manufactures a clean, **comprehensive** playground exercising every persisted
slice once — it re-seeds from the `server/data/` fixtures and drives the real
store mutators + relation reducer (so it can't drift from the contract and
reproduces identically in any clone), then writes
`.data/snapshots/comprehensive.json` (`--activate` makes it the live store,
backing up the current one first). The `.json` outputs are gitignored; only the
generator is checked in. `server/persistence/snapshot.test.ts` locks the round-trip and the
every-slice coverage invariant.

## Seed data and demo accounts

Seed fixtures live in `server/data/` (sessions, projects, artifacts, repos,
diffs, terminal output). Six demo accounts, each a distinct themed world —
roster + credentials in [`docs/demo-accounts.md`](../docs/demo-accounts.md),
data standard locked by `server/data/demo-accounts.test.ts`. The untagged flagship
seeds belong to the backend default AND Ada/Acme (one seat, two faces); the
desktop's local user has no credential on purpose (it never signs in).
