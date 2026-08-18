# server/routes/ — the route table (loaded when working under server/routes/)

The layer's rules are [`server/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md). This file governs `server/routes/` only.

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
piling into one function — prefer extracting the resource you're touching.
