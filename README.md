# Agent Commons — an agents-collaboration platform

Agent Commons is a multi-account platform where people configure agents, work
through adaptive conversations, and coordinate shared projects. Conversations,
projects, artifacts, contexts, model providers, agents, routines, discussions,
and change proposals are addressable resources in one collaboration workspace.

The repository is a working end-to-end implementation over a deterministic
development backend. The UI, versioned HTTP + SSE contract, authentication and
authorization, MCP doors, model/tool-use seam, persistence, and session-relay
connector are real boundaries. Seeded entities and the local model are explicit
fixtures documented in [`docs/spec/11-mock-boundary.md`](docs/spec/11-mock-boundary.md).

## What the platform supports

- **People and agent workers.** Accounts register providers and system prompts,
  configure agents with bounded authority and budgets, and commission them onto
  shared projects.
- **Adaptive conversations.** A conversation can attach workspaces,
  repositories, files, connectors, and MCP servers. Its tools and context panes
  grow in place without losing the thread.
- **Shared resource coordination.** Projects collect contributors, open work,
  artifacts, contexts, routines, discussions, proposals, and contribution
  history under one canonical resource model.
- **Consent and delegation.** Model-requested mutations become explicit
  confirmation cards. Standing grants, routine approval, principal attribution,
  and audit records make delegated effects inspectable.
- **Equivalent access doors.** The browser UI, a permitted in-session model, and
  an authenticated remote MCP client enter the same route-owned capability and
  authorization surface. See [`docs/mcp-access.md`](docs/mcp-access.md).
- **One split workspace.** Every conversation and resource page is an equal pane
  that can be focused, split, resized, navigated, and closed.

## Architecture

The React frontend does not import backend fixtures. It reads through hooks and
issues commands through controllers against a versioned API. The server owns
state, authorization, persistence, scheduling, model tool execution, and the SSE
event stream.

```text
contract/   Framework-free wire types and reducers imported verbatim by UI and server
server/     Node HTTP + SSE backend, route catalog, stores, persistence, auth, model seam
src/        React UI, API cache, controllers, projection models, and rendered surfaces
connector/  Session-relay connector served by the product
```

The contract is the portability boundary. The same UI can talk to a local
sidecar or a remote server; `GET /v1/capabilities` describes which host-bound
operations are available, and unsupported native operations return
`409 capability_unavailable` rather than being guessed from the environment.

Generation runs through `@anthropic-ai/sdk` and a real, bounded Messages tool-use
loop, including result-dependent follow-up tool batches. `MODEL_MAX_TOOL_ROUNDS`
sets the executed-batch budget (default 4, hard ceiling 8); the first over-budget
request runs nothing and ends visibly.
Development boots an Anthropic-compatible deterministic model server at `:8788`.
Set `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and optionally `ANTHROPIC_MODEL` to
point the same seam at a live provider.

Routine cadence and execution are durable in the desktop process. A fire freezes
its authored definition and endpoint binding, then runs the same guarded Messages
loop under the bound Agent's live authority and budget. Transient failures retry
three times by default with exponential backoff; operators can tune
`ROUTINE_MAX_ATTEMPTS` (1–8) and `ROUTINE_RETRY_BASE_MS` (default 5000).

## Run it

Requires **Node 26+**.

```bash
npm install
npm run dev        # UI 127.0.0.1:5173 + API 127.0.0.1:8787 + mock model :8788
```

The auth gate defaults on. Ada is the flagship demo account:
`ada@acme.example` / `ada-demo-password`. All six accounts are listed in
[`docs/demo-accounts.md`](docs/demo-accounts.md). Use `127.0.0.1`, not
`localhost`, because the remembered account stack is origin-local.

Useful commands:

```bash
npm run dev:ui       # Vite only; expects the backend on :8787
npm run server       # backend only
npm run model        # deterministic model server only
npm run connector    # session-relay connector
npm run start        # desktop profile: built UI + loopback API + SQLite
npm run start:web    # hosted profile (required env below)
npm run typecheck
npm run build
npm test             # Node behavior and repository locks
npm run e2e          # Playwright browser wiring
npm run ui:sweep     # signed-in surface × viewport review harness
npm run verify       # typecheck + Node suite + build + sharded E2E
```

`npm run dev` and `npm run server` retain the review/demo posture. Release-shaped
boots use explicit profiles:

- `npm run start` (also `start:desktop`) is the near-term desktop profile:
  native capabilities, loopback-only binding, embedded SQLite, the credential-less
  device owner, client-asserted identity disabled, and an exact loopback origin.
  A fresh signing secret is generated for the process when none is supplied. A
  genuinely new database starts clean: no fictional conversations, projects,
  artifacts, routines, accounts, connections, or usage history. Release profiles
  also disable the inline mock: without a configured endpoint, the composer says
  so and the API refuses a turn before writing it.
- `npm run start:web` preserves the later hosted boundary: remote capabilities,
  required sign-in, client-asserted identity disabled, Secure cookies, and SQLite
  by default. It refuses to boot without a 32+ character `AUTH_SECRET` and exact
  HTTPS `CORS_ORIGIN`. The current persistence engine is single-process; a managed
  multi-instance store remains a web-service follow-on.

The initial-world choice applies only to absent storage and is then recorded in
the snapshot. An existing demo database remains a demo database under a release
profile, and an existing clean/user database is never repopulated from fixtures.
To evaluate a clean first run after using the demo, point `DATABASE_PATH` at a new
file (or first preserve the old store with the snapshot tooling below).

For example: `AUTH_SECRET=replace-with-32-plus-random-characters CORS_ORIGIN=https://app.example npm run start:web`.
For remote-capability development without the release checks, use
`BACKEND=remote npm run server`.

To run the built-in provider in a release profile, supply the live connection:

```bash
npm run build
ANTHROPIC_BASE_URL=https://api.anthropic.com ANTHROPIC_API_KEY=… npm run start
```

The Models page can register another Messages-compatible endpoint. Its optional
credential is a `PROVIDER_*` environment-variable reference: launch the server
with the variable already set, then enter only that variable's name. The endpoint
is probed before it is saved; endpoint URLs and secret values never appear on the
provider read shape.

## Persistence and recovery

JSON is the development default. The desktop profile selects embedded SQLite:

```bash
npm run build && npm run start              # defaults to .data/store.db
DATABASE_PATH=/path/to/store.db npm run start
```

Backups are portable across both backends. `save` can run against the selected
live store; stop the server before `restore` so the old process cannot overwrite
the recovered state, then restart it.

```bash
npm run snapshot:save -- before-update
npm run snapshot:list
npm run snapshot:restore -- before-update
```

`SNAPSHOT_DIR` can place exports outside the store directory. Imports are parsed,
forward-migrated, and checked before mutation, then read back from the selected
backend; a restore that cannot be proven fails loudly. An export contains the full
application state (including credential hashes and private content), so keep it in
access-controlled storage.

A live write failure is also loud: the mutation returns `503 storage_unavailable`,
`/readyz` fails, and the process refuses further product traffic until restart. It
does not resume merely because disk access returns—the in-memory graph may have
advanced past the last durable snapshot. `/healthz` and `/metrics` remain available
for the desktop shell or service supervisor to diagnose and restart safely.

Startup distinguishes a genuinely absent store from an unusable existing one. Only
absence creates the seeded baseline; malformed, structurally invalid, unrecognized,
newer, or un-migratable JSON/SQLite storage stops the process before replacement.
An orphan atomic temp, WAL, or journal also counts as recovery data—not absence.
Repair or restore the preserved store explicitly, then restart.

## Stack

- React + TypeScript + Vite, Tailwind CSS v4, Framer Motion, Lucide
- Node 26 + `node:http`
- `@anthropic-ai/sdk` at the replaceable generation boundary
- Framework-free shared contract and dependency-light server modules

## Project layout

```text
contract/   shared API types, entities, reducers, events, and capability vocabulary
server/     backend modules; scoped context, specs, and tests live beside their owners
src/        frontend modules; shared primitives and projection templates live in lib/
docs/       design rationale, operational guides, and the requirements ledger
tests/      repository-owned document and cross-layer locks
e2e/        Playwright tests for rendered browser behavior
scripts/    development, verification, snapshot, and UI-sweep tooling
connector/  session-relay connector
```

Start with [`AGENTS.md`](AGENTS.md) for the progressive-disclosure context map.
The checkable requirements and implementation/lock correlations live in
[`docs/spec/`](docs/spec/README.md); production-oriented architecture decisions
live in [`docs/design/`](docs/design/README.md).
