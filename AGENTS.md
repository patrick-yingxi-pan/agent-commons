# AGENTS.md — context for code agents evaluating this repo

> If you are an AI coding agent (Claude Code, Cursor, Codex, …) opening this
> repo, start here. This file is the fast path to understanding *what to look at*
> and *how to evaluate it*. `CLAUDE.md` imports this file.

## What this is (and isn't)

A **working prototype + written proposal** arguing that the Claude desktop app's
three top-level tabs — **Chat**, **Cowork**, **Code** — should collapse into
**one conversation with an adaptive workspace**. It is an **independent concept,
not affiliated with or endorsed by Anthropic**, built to share *with* Anthropic
as constructive feedback.

- **It is:** a clickable, end-to-end demo (a scripted guided tour) running as a
  real web frontend over a real — but **mock** — HTTP + SSE backend, so the
  interaction model and the client/server shape are both tangible.
- **It is not:** a production client. Data is mocked on purpose (deterministic,
  reviewable) and there is **no real model** behind the streaming reply.

The full argument is in [`PROPOSAL.md`](PROPOSAL.md); the engineering tour is in
[`README.md`](README.md). This file is the agent-facing digest of both.

## Suggested read order for an evaluator (≈10 min)

1. **[`PROPOSAL.md`](PROPOSAL.md)** §1–§4 — the problem and the proposed model.
2. **Run it and press *Play the guided tour*** (see below) — the whole thesis in
   one conversation: chat → workspace → repo → organize.
3. **[`README.md`](README.md) "Architecture"** — how one UI runs over a portable
   contract (desktop sidecar *or* remote web server, same wire types).
4. Skim **`contract/`** — the shared types *are* the API; this is the portability
   claim made concrete.

## Quick start

Requires **Node 26+** (the mock server runs TypeScript natively — no build step).

```bash
npm install
npm run dev        # boots the UI (Vite, :5173) AND the mock backend (:8787)
                   # → open http://127.0.0.1:5173
```

On first load an intro dialog summarizes the proposal — click **Play the guided
tour** to watch the scripted chat → workspace → repo → organize escalation in a
single thread. The tour asks for consent (folder pick, repo connect, project
create) before each escalation, mirroring the desktop app's permission prompts.

Other scripts:

```bash
npm run typecheck  # tsc --noEmit over UI + contract  ← run before declaring done
npm run build      # production build to dist/
npm run start      # one process: serve built UI + API (the deploy shape)
BACKEND=remote npm run server   # the remote-web-server variant (native ops 409)
```

## Verify health quickly

```bash
npm run typecheck && npm run build
```

Both should pass clean. If you only changed UI under `src/`, `npm run typecheck`
is the fast check; the dev server has HMR so most changes are visible without a
restart.

## How to evaluate the proposal

The demo is the argument. Each proposal claim has a place you can see it — this
mirrors `PROPOSAL.md` §5:

| Claim | Where to see it |
|---|---|
| No mode chosen up front | App opens to a single empty thread + composer; no Chat/Cowork/Code switcher. |
| Context is *attached*, not a mode | The composer's single **Add context** button (files, folders, repos, connectors, MCP) and the chips it produces. |
| In-place escalation | **Play the guided tour** — one thread escalates chat → workspace → repo with nothing re-explained. |
| Progressive disclosure | The right panel is absent in chat and morphs (artifacts → code editor/diff/terminal) as context attaches. |
| Unified history | The sidebar — one row per conversation; open "Refactor auth middleware" (chat+repo) vs "Vector databases, explained" (chat only) to see the panel adapt. |
| Relations, edited with consent | The tour's **project-create** and **Organize** beats — Claude proposes relation edits as inline cards; nothing changes until you confirm. Standing approval (a schedule) is approved once, then runs unprompted. |
| Portability (one UI, two backends) | `contract/` (types imported verbatim by both ends) + `GET /v1/capabilities` gating native-only endpoints; `BACKEND=remote` returns `409 capability_unavailable`. |

**A good evaluation answers:** does collapsing the three tabs into one
context-attached thread reduce friction without losing power-user density? Are the
consent moments (escalation, relation edits, standing schedule approval) the right
shape? Is the contract genuinely backend-portable, or does the UI secretly assume
the mock?

## What's intentionally mock (don't file these as bugs)

- **No real model.** The assistant reply is deterministic, streamed from
  `server/generate.ts` (the seam where a real Anthropic Messages proxy would go).
- **Seed data** lives in `server/data/` — sessions, projects, artifacts, repos,
  diffs, terminal output are fixtures, not live.
- **Native ops are stubbed** behind capability flags; a remote backend returns
  `409 capability_unavailable` by design.
- **Created state is in-memory** — a project created during the tour persists only
  until the server restarts.

## Working in this repo (conventions)

- **The contract is load-bearing.** `contract/*.ts` is imported *verbatim* by both
  the Vite UI and the Node server — that type-identity **is** the portability
  guarantee. Don't add framework or Node-only types to `contract/`, and keep the
  client and server reducers (`contract/graph.ts`) in agreement.
- **One door to the backend.** UI components read through hooks (`src/api`);
  controllers issue commands. Nothing else should know a URL or an SSE event.
- **No new runtime dependencies** without good reason — the server is
  zero-dependency and the UI's deps are deliberately minimal.
- **Run `npm run typecheck` before declaring a change done.** Verify UI changes in
  the running app, not just by reading code.
- **Git:** this repo commits and pushes straight to `main` over HTTPS.

## Repo map (detail in [`README.md`](README.md))

```
contract/   framework-free wire types — the API IS these types
server/     zero-dependency mock backend (Node 26 native TS): store, router, SSE, seed data
src/        the UI — api/ (cache, events, commands) · controller/ · components/ · data/
PROPOSAL.md the written proposal (the argument)
README.md   architecture + run guide (the engineering tour)
```
