# AGENTS.md — the context map for code agents

> If you are an AI coding agent (Claude Code, Cursor, Codex, …) opening this
> repo, start here. This file is deliberately a **map, not a manual**
> (progressive disclosure): it says what the repo is, how to run and verify it,
> and *where* the detailed context lives — loaded only when your task needs it.
> Directory-scoped rules live in nested `CLAUDE.md` files (Claude Code injects
> them automatically when you touch that directory; other agents: open them via
> the table below). The map's size, link integrity, and the moved rules'
> new homes are locked by `tests/context-map.test.ts`.

## What this is (and isn't)

A **working prototype + written proposal** arguing that the Claude desktop app's
three top-level tabs — **Chat**, **Cowork**, **Code** — should collapse into
**one conversation with an adaptive workspace**. An **independent concept, not
affiliated with or endorsed by Anthropic**, built to share *with* Anthropic as
constructive feedback.

- **It is:** a clickable, end-to-end demo — a real web frontend over a real but
  **mock** HTTP + SSE backend, so the interaction model and the client/server
  shape are both tangible.
- **It is not:** a production client. Data is mocked on purpose (deterministic,
  reviewable) and there is **no real model** behind the streaming reply.

The full argument is [`PROPOSAL.md`](PROPOSAL.md); the engineering tour is
[`README.md`](README.md); the evaluator's guide (read order, claim→evidence
table, what's intentionally mock) is [`docs/evaluation.md`](docs/evaluation.md).

## Quick start

Requires **Node 26+** (the mock server runs TypeScript natively — no build step).

```bash
npm install
npm run dev        # boots the UI (Vite, :5173) AND the mock backend (:8787)
                   # → open http://127.0.0.1:5173
```

The app opens on the **sign-in front door** (the auth gate defaults ON — see
[`docs/demo-accounts.md`](docs/demo-accounts.md) for the six demo credentials;
Ada `ada@acme.example` / `ada-demo-password` is the flagship; `AUTH_GATE=off`
opts a boot out). Once signed in you land on a fresh thread. Free-type the
escalation flow in one session — “Open a workspace and draft the launch
assets”, “Connect the repo”, “Create a project called X” — and each step asks
for consent before it lands, mirroring the desktop app's permission prompts.

Other scripts:

```bash
npm run typecheck  # tsc --noEmit over UI + contract  ← run before declaring done
npm run build      # production build to dist/
npm run e2e        # Playwright browser E2E — details + gotchas: e2e/CLAUDE.md
npm run start      # one process: serve built UI + API (the deploy shape)
npm run model      # the Anthropic-compatible mock model server, standalone (:8788)
BACKEND=remote npm run server   # the remote-web-server variant (native ops 409)
```

`npm run dev`/`start` boot the mock model server in-process, so one command is a
complete stack. To run against the **real** API instead of the mock, set
`ANTHROPIC_BASE_URL=https://api.anthropic.com` and `ANTHROPIC_API_KEY` (the
in-process mock then stands down); `ANTHROPIC_MODEL` overrides the model id
(default `claude-opus-4-8`).

The dev server **binds IPv4** (`server.host: '127.0.0.1'` in `vite.config.ts`) —
on some hosts `localhost` resolves to `::1` only. Keep the explicit bind.

## Verify health quickly

```bash
npm run typecheck && npm run build
```

Both should pass clean. If you only changed UI under `src/`, `npm run typecheck`
is the fast check; the dev server has HMR so most changes are visible without a
restart.

## The context map — read on demand

| Working on / wondering about | Read |
|---|---|
| Wire types, API shape, the graph reducers | [`contract/CLAUDE.md`](contract/CLAUDE.md) |
| Backend: routes, store, persistence/snapshots, auth gate, the model boundary | [`server/CLAUDE.md`](server/CLAUDE.md) |
| UI: shared primitives, registries, rail, URLs, back-history, panes, the split workspace | [`src/CLAUDE.md`](src/CLAUDE.md) |
| Writing tests, the spec ledger discipline | [`tests/CLAUDE.md`](tests/CLAUDE.md) |
| Browser E2E: stack, ports, anchor specs, gotchas | [`e2e/CLAUDE.md`](e2e/CLAUDE.md) |
| The session-relay connector (Session providers) | [`docs/session-relay-primer.md`](docs/session-relay-primer.md) (from zero) · [`connector/CLAUDE.md`](connector/CLAUDE.md) · design log [`docs/delegated-cognition-provider.md`](docs/delegated-cognition-provider.md) |
| The MCP door (`/mcp`) + the access-parity rule (INV-11) | [`docs/mcp-access.md`](docs/mcp-access.md) |
| Evaluating the proposal; "don't file these as bugs" | [`docs/evaluation.md`](docs/evaluation.md) |
| "Is X built or just mocked?" | [`docs/spec/`](docs/spec/README.md) (requirements ledger) · [`docs/spec/11-mock-boundary.md`](docs/spec/11-mock-boundary.md) (declared fixtures) |
| Reviewing after a UI change | [`docs/ui-invariants.md`](docs/ui-invariants.md) (earned ledger, the `/ui-review` skill) · [`docs/review-rulebook.md`](docs/review-rulebook.md) (oracle catalog) |
| API-shape invariants (absence semantics, principals) | [`docs/spec/09-design-invariants.md`](docs/spec/09-design-invariants.md) (INV-9, INV-10) |
| The split-workspace architecture + its lessons | [`docs/design/universal-split-workspace.md`](docs/design/universal-split-workspace.md) |
| Identity model (namespaces, principals) | [`docs/design/principals-and-namespaces.md`](docs/design/principals-and-namespaces.md) |
| Surface design method (what form fits an entity) | [`docs/design/surface-from-nature.md`](docs/design/surface-from-nature.md) · [`docs/design/surface-audit.md`](docs/design/surface-audit.md) |
| Forward-looking explorations (not shipped behavior) | [`docs/capability-broker-architecture.md`](docs/capability-broker-architecture.md) · [`docs/shared-resource-coordination.md`](docs/shared-resource-coordination.md) · [`docs/context-compaction.md`](docs/context-compaction.md) |

## Conventions (always on)

- **Record decisions in the repo, not just memory.** Decisions, rationale, and
  notes belong in repo files — the scoped `CLAUDE.md` next to the code they
  govern, `docs/`, or the module's header comment — so **every clone shares
  them**. An agent's local memory is per-machine; the repo is the system of
  record.
- **Every feature ships with complete automated tests**, and the **spec ledger
  stays current** — the discipline in detail: [`tests/CLAUDE.md`](tests/CLAUDE.md).
- **Run `npm run typecheck` and `node --test` before declaring a change done.**
  Verify UI changes in the running app, not just by reading code.
- **Review the diff before every commit, then commit and push** (owner
  directive, 2026-07-17): implement → tests green → code-review pass over the
  working diff (adversarial for substantial changes) → fix confirmed findings →
  commit → push. No unreviewed commits, no uncommitted finished work.
- **Git:** commit and push straight to `main` over HTTPS.
- **The contract is load-bearing** — type-identity between UI and server is the
  portability guarantee ([`contract/CLAUDE.md`](contract/CLAUDE.md)).
- **One door to the backend** — components read hooks, controllers issue
  commands; nothing else knows a URL or SSE event ([`src/CLAUDE.md`](src/CLAUDE.md)).
- **Few runtime dependencies** — the server's one dependency is
  `@anthropic-ai/sdk` ([`server/CLAUDE.md`](server/CLAUDE.md)).
- **Locked design decisions live with their code**: UI decisions (form follows
  function, registries-one-home, rail tree, canonical URLs, back-history,
  entity pages, the split workspace) in [`src/CLAUDE.md`](src/CLAUDE.md);
  backend decisions (real Messages+tool-use boundary, auth-gate wall,
  persistence shape) in [`server/CLAUDE.md`](server/CLAUDE.md). Light theme
  only; no "before" view; no dark mode.

## Repo map (detail in [`README.md`](README.md))

```
contract/   framework-free wire types — the API IS these types
server/     mock backend (Node 26 native TS): store, router, SSE, seed data
server/model/  Anthropic-compatible mock model server — POST /v1/messages (the model seam)
src/        the UI — api/ (cache, events, commands) · controller/ · components/ · data/
connector/  the session-relay connector (served by the product itself)
e2e/        Playwright browser specs (DOM-level wiring)
tests/      node --test suites — the behavior locks
docs/       design notes, spec ledger, explainers
PROPOSAL.md the written proposal (the argument)
README.md   architecture + run guide (the engineering tour)
```
