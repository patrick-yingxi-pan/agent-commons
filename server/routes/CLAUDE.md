<!-- context-schema: v1 -->
# server/routes/ — route-table module index

## Scope

The layer's rules are [`server/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md). This file governs `server/routes/` only.

## Read path

Read [`../http/CLAUDE.md`](../http/CLAUDE.md) for registration/dispatch rules,
[`../testkit/CLAUDE.md`](../testkit/CLAUDE.md) for the handler-level driver, and
[`docs/mcp-access.md`](../../docs/mcp-access.md) for access classifications.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| ROUTES-A1 | architecture | `buildRouter()` is plain route data and the authoritative capability catalog. | [`index.ts`](index.ts) | [`../mcp-parity.test.ts`](../mcp-parity.test.ts) · [`../../tests/access-surface-parity.test.ts`](../../tests/access-surface-parity.test.ts) | refines SERVER-A2 |
| ROUTES-D1 | data-access | Product is default; every form, alias, or intrinsic realization is declared on its route with a reason. | [`index.ts`](index.ts) · [`../http/router.ts`](../http/router.ts) | [`../../tests/access-surface-parity.test.ts`](../../tests/access-surface-parity.test.ts) | refines SERVER-D3; requires ROUTES-A1 |
| ROUTES-D2 | data-access | A session detail is full by default for contract compatibility, but browser opt-in returns a newest chronological message tail with an opaque stable older cursor; mutation projections never echo transcripts. | [`sessionHistory.ts`](sessionHistory.ts) · [`index.ts`](index.ts) | [`sessions.test.ts`](sessions.test.ts) · [`workspace.test.ts`](workspace.test.ts) · [`../pagination.test.ts`](../pagination.test.ts) | refines SERVER-D3; requires ROUTES-A1 |
| ROUTES-D3 | data-access | Retransmitting a conversation turn never duplicates its user row: a live/completed key attaches or replays, while a post-restart/error retry reuses only the exact unresolved final user message. | [`index.ts`](index.ts) · [`../turns.ts`](../turns.ts) | [`../send-idempotency.test.ts`](../send-idempotency.test.ts) · [`turns.test.ts`](turns.test.ts) | refines SERVER-D1; requires ROUTES-D1 |
| ROUTES-D4 | data-access | Session detail projects viewer preferences per reader; their mutation is declared UI presentation form, not a shared model/MCP workspace capability. | [`index.ts`](index.ts) · [`../http/router.ts`](../http/router.ts) | [`session-preferences.test.ts`](session-preferences.test.ts) · [`../../tests/access-surface-parity.test.ts`](../../tests/access-surface-parity.test.ts) | refines ROUTES-D1; requires SERVER-D5 |
| ROUTES-D5 | data-access | Session context mutation validates the complete operation list + workspace before touching state, is idempotent under replay, tenant-walled, and replaces the three partial legacy doors. | [`index.ts`](index.ts) | [`session-contexts.test.ts`](session-contexts.test.ts) · [`workspace.test.ts`](workspace.test.ts) · [`../../tests/access-surface-parity.test.ts`](../../tests/access-surface-parity.test.ts) | refines ROUTES-D1; requires CONTRACT-D5 |
| ROUTES-D6 | data-access | Relation operations are idempotent logical mutations whose acknowledgement carries the graph revision advanced by their one server-side application. | [`index.ts`](index.ts) · [`../idempotency.ts`](../idempotency.ts) | [`relations-commons.test.ts`](relations-commons.test.ts) · [`../idempotency.test.ts`](../idempotency.test.ts) | refines ROUTES-D1; requires STORE-D5 |
| ROUTES-D7 | data-access | A durable-write failure returns `storage_unavailable`, then one global wall refuses every product request until restart while health, readiness, and metrics remain operable. | [`index.ts`](index.ts) · [`../http/router.ts`](../http/router.ts) | [`../persistence/acknowledgement.test.ts`](../persistence/acknowledgement.test.ts) | refines SERVER-D4; requires STORE-D6 |
| ROUTES-D8 | data-access | Conversation metadata PATCH validates an optional revision precondition, returns 409 on stale state, and replays a successful logical retry without advancing the revision twice. | [`index.ts`](index.ts) · [`../idempotency.ts`](../idempotency.ts) | [`sessions.test.ts`](sessions.test.ts) | refines ROUTES-D1; requires STORE-D8 |
| ROUTES-D9 | data-access | Routine definition PATCH validates an optional revision precondition, returns 409 on stale state, and replays a successful logical retry without advancing the revision twice. | [`index.ts`](index.ts) · [`../idempotency.ts`](../idempotency.ts) | [`schedules.test.ts`](schedules.test.ts) | refines ROUTES-D1; requires STORE-D9 |
| ROUTES-D10 | data-access | Artifact body PATCH validates an optional revision precondition, returns 409 on stale state, and replays a successful logical retry without advancing the revision twice. | [`index.ts`](index.ts) · [`../idempotency.ts`](../idempotency.ts) | [`artifact-content.test.ts`](artifact-content.test.ts) | refines ROUTES-D1; requires STORE-D10 |
| ROUTES-V1 | verification | Each resource suite drives the real router/store through the shared HTTP testkit. | [`../testkit/http.ts`](../testkit/http.ts) | [`sessions.test.ts`](sessions.test.ts) · [`schedules.test.ts`](schedules.test.ts) | refines SERVER-V1 |
<!-- context-rules:end -->

## What lives here

`index.ts` — one `buildRouter()` returning the route table for the whole
backend. The router is **plain data**: adding a resource is adding a `.get(…)`
line, which is what lets `server/apiSurface.ts` GENERATE the MCP and in-app tool
surfaces from it rather than from a second hand-kept list (access parity,
INV-11 — see [`docs/mcp-access.md`](../../docs/mcp-access.md)).

Every route also owns its access classification. An ordinary product route is
projected into the UI and both MCP forms by default. Protocol/credential form,
semantic alias, and in-session intrinsic realizations must use the named router
shorthands and explain the exception at registration; no access door keeps a
private exclusion list.

Beside it: the ~77 suites that lock those endpoints, one per resource or
behavior. A suite here drives the **real** router through
[`../testkit/http.ts`](../testkit/http.ts) — `buildRouter()` + the real store,
no port bound and no entry point booted — so it reads like HTTP without the
process plumbing.

## Naming

A suite is named for the resource it locks (`sessions.test.ts`,
`schedules.test.ts`). The `routes-` prefix these carried while they lived in a
flat `tests/` directory is now said by the directory, so it was dropped —
**except** where dropping it would collide with a suite that locks the same
resource at the store level (`messages.test.ts` + `routes-messages.test.ts`,
`providers.test.ts` + `routes-providers.test.ts`). Two locks on one resource are
both real; silently merging them would delete a file, so the prefix stays where
it still distinguishes.

## The ratio is the argument for splitting this file

77 suites point at one 3,591-line module. That is not a property of routing —
it is what a monolith looks like once its locks are colocated, and the suite
names already enumerate the seams a split would cut along (sessions, turns,
messages, providers, schedules, dispatch, fs, workspace, agents, audit,
directory, proxy, reservations, saved-contexts, system-prompts, worker-agents,
commission, relations/commons, a2a, social). Splitting `buildRouter()` into
per-resource `register*(r)` modules is the natural next refactor; when it
happens, each suite here already sits next to the module it will belong to.
Until then, don't take the flat listing as a sign that new endpoints should keep
piling into one function — prefer extracting the resource you're touching. The
session history projection is the first such extracted resource seam
(`sessionHistory.ts`); route registration still stays in the catalog until the
larger registration split can preserve access-surface generation cleanly.

## Verification

Run the changed resource suite. Access classification changes also run both
parity suites linked in ROUTES-A1/ROUTES-D1.
