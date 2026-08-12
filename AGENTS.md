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
npm run verify     # THE SWEEP: typecheck + node suite + build + sharded E2E,
                   # all in parallel — 150s vs 244s run serially. One pass/fail
                   # summary; `npm run verify checks` runs just the static half.
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

**A module carries its own context, spec and locks.** Progressive disclosure is
not only a `CLAUDE.md` rule — it applies to every kind of file. A directory
holds its code, its scoped `CLAUDE.md`, the requirement rows it owns
(`SPEC.md`), and the suites that lock it, as siblings. So the map below points
at a *layer*, and the layer's own file points at its modules; you load context
by opening the directory you are working in. `tests/` keeps only what the
**repo** owns — doc-lint and cross-layer locks with no single module to belong
to — eight suites plus `helpers/source.ts`, down from 229.

| Working on / wondering about | Read |
|---|---|
| Wire types, API shape, the graph reducers | [`contract/CLAUDE.md`](contract/CLAUDE.md) |
| Backend: routes, store, persistence/snapshots, auth gate, the model boundary | [`server/CLAUDE.md`](server/CLAUDE.md) (→ per-module homes) |
| UI: shared primitives, registries, rail, URLs, back-history, panes, the split workspace | [`src/CLAUDE.md`](src/CLAUDE.md) |
| Writing tests, the spec ledger discipline | [`tests/CLAUDE.md`](tests/CLAUDE.md) |
| Browser E2E: stack, ports, anchor specs, gotchas | [`e2e/CLAUDE.md`](e2e/CLAUDE.md) |
| The session-relay connector (Session providers) | [`docs/session-relay-primer.md`](docs/session-relay-primer.md) (from zero) · [`connector/CLAUDE.md`](connector/CLAUDE.md) · design log [`docs/delegated-cognition-provider.md`](docs/delegated-cognition-provider.md) |
| The MCP door (`/mcp`) + the access-parity rule (INV-11) | [`docs/mcp-access.md`](docs/mcp-access.md) |
| Evaluating the proposal; "don't file these as bugs" | [`docs/evaluation.md`](docs/evaluation.md) |
| "Is X built or just mocked?" | [`docs/spec/`](docs/spec/README.md) (requirements ledger) · [`docs/spec/11-mock-boundary.md`](docs/spec/11-mock-boundary.md) (declared fixtures) |
| Reviewing after a UI change | [`docs/ui-invariants.md`](docs/ui-invariants.md) (earned ledger, the `/ui-review` skill) · [`docs/review-rulebook.md`](docs/review-rulebook.md) (oracle catalog) |
| API-shape invariants (absence semantics, principals) | [`docs/spec/09-design-invariants.md`](docs/spec/09-design-invariants.md) (INV-9, INV-10) |
| The social layer (Grants · Discussions · Proposals · the Commons) | [`docs/design/social-layer.md`](docs/design/social-layer.md) (design + backlog) · [`docs/spec/12-social-layer.md`](docs/spec/12-social-layer.md) (requirement rows) |
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
  Verify UI changes in the running app, not just by reading code — **signed in,
  with the demo accounts stacked** (owner directive, 2026-08-08: *always sign in
  test accounts for review*). This app's surface is viewer-relative: owner vs
  visitor controls, the tenant 404 wall, capability tiers, per-account rail
  prefs. A sweep from one account leaves those cells unreachable, and an
  unreachable cell is a coverage hole, not a skip. **Leave the preview signed
  in when you finish** (owner directive, 2026-08-08: *always leave the preview
  signed in so that I can test myself*) — the owner picks the app up where the
  agent put it down, and a sweep that ends on the auth gate hands them a
  password prompt instead of the change. Restore Ada (the flagship) with the
  roster stacked, and use **`http://127.0.0.1:5173`**, not `localhost:5173`:
  the account stack lives in `localStorage`, so the two spellings are
  different origins and one of them is always signed out. Roster + credentials:
  [`docs/demo-accounts.md`](docs/demo-accounts.md); procedure:
  [`.claude/skills/ui-review/SKILL.md`](.claude/skills/ui-review/SKILL.md) §1.
- **Review the diff before every commit, then commit and push** (owner
  directive, 2026-07-17): implement → tests green → code-review pass over the
  working diff (adversarial for substantial changes) → fix confirmed findings →
  commit → push. No unreviewed commits, no uncommitted finished work.
- **Git:** commit and push straight to `main` over HTTPS.
- **Keep the MCP door in sync with the UI** (owner directive, 2026-08-09:
  *"always update the MCP interface of this website to keep the UI and MCP in
  sync"*). Access parity (INV-11) is mostly structural — the tool catalog is
  GENERATED from the route table, so a new route is a new tool with no second
  list to update, and a UI change that adds no route needs no new tool
  (inventing one would be the drift). What is NOT structural is everything
  hand-written on that boundary: the door's `initialize` **instructions**, which
  point machine callers at places in the human UI. Every UI string they quote
  lives in `MCP_UI_COPY` (`server/mcp.ts`) and is scanned against the live
  components by `server/mcp-ui-sync.test.ts` — earned when an identity-copy pass
  renamed a panel and left the MCP door directing callers to words no screen
  said, with every suite green. So: after a UI change, ask what the MCP door
  says about the thing you changed; if it quotes copy, it goes through the
  registry.
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
  persistence shape) in [`server/CLAUDE.md`](server/CLAUDE.md). Theming is
  token-driven (light/dark/system — `src/CLAUDE.md`); no "before" view.

## Repo map (detail in [`README.md`](README.md))

```
contract/   framework-free wire types — the API IS these types
server/     mock backend (Node 26 native TS) — each module carries its own
            CLAUDE.md, SPEC.md and *.test.ts siblings:
              routes/ store/ http/ model/ persistence/ data/ testkit/
src/        the UI — api/ (cache, events, commands) · controller/ · components/ · data/
connector/  the session-relay connector (served by the product itself)
e2e/        Playwright browser specs (DOM-level wiring)
tests/      what the REPO owns: doc-lint + cross-layer locks, helpers/source.ts
docs/       design notes, spec ledger, explainers
PROPOSAL.md the written proposal (the argument)
README.md   architecture + run guide (the engineering tour)
```
