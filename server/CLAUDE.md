# server/ — backend rules (loaded when working under server/)

Scoped context for the mock backend. The always-on map is
[`AGENTS.md`](../AGENTS.md); this file holds the locked decisions that govern
`server/` code.

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
way — the sweep signs in as Ada first). Locked by `tests/auth-gate.test.ts`;
spec row SYNC-8.

## Persistence and snapshots

When the real server runs (`dev` / `start` / `server`), the UI-owned state —
sent messages, created sessions, attached context + its panels, schedules,
recents, relation edits, and the Agent Commons registries — is snapshotted to
`.data/store.json` on each mutation and rehydrated on boot
(`server/persist.ts`), so it survives a restart. The simplest viable format
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
generator is checked in. `tests/snapshot.test.ts` locks the round-trip and the
every-slice coverage invariant.

## Seed data and demo accounts

Seed fixtures live in `server/data/` (sessions, projects, artifacts, repos,
diffs, terminal output). Six demo accounts, each a distinct themed world —
roster + credentials in [`docs/demo-accounts.md`](../docs/demo-accounts.md),
data standard locked by `tests/demo-accounts.test.ts`. The untagged flagship
seeds belong to the backend default AND Ada/Acme (one seat, two faces); the
desktop's local user has no credential on purpose (it never signs in).
