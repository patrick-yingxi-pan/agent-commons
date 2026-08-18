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

Generation runs through `@anthropic-ai/sdk` and a real Messages tool-use loop.
Development boots an Anthropic-compatible deterministic model server at `:8788`.
Set `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and optionally `ANTHROPIC_MODEL` to
point the same seam at a live provider.

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
npm run start        # serve the built UI and API in one process
npm run typecheck
npm run build
npm test             # Node behavior and repository locks
npm run e2e          # Playwright browser wiring
npm run ui:sweep     # signed-in surface × viewport review harness
npm run verify       # typecheck + Node suite + build + sharded E2E
```

Run the remote-web capability profile with `BACKEND=remote npm run server`.

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
