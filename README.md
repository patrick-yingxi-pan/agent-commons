# Claude · Unified Workspace — a UI/UX proposal

> A working prototype arguing that the Claude desktop app's three top-level
> tabs — **Chat**, **Cowork**, and **Code** — should collapse into **one
> conversation with an adaptive workspace**.

This repo is a clickable demo built to accompany a written proposal to
Anthropic. It is **not** affiliated with or endorsed by Anthropic; all visuals
are an independent concept and use mock data.

---

## The argument in one breath

Chat, Cowork, and Code are the *same primitive* — a threaded conversation with
Claude plus some context and tools — presented as three siloed tabs. That split
forces you to **choose a mode before you know where the work will go**, keeps
**separate histories and composers** you can't flow between, and makes three
**heavily-overlapping** surfaces feel redundant.

The prototype proposes the alternative: you just start talking, and **context
(a folder, a repo, a connector) attaches to the thread**. The panel on the right
**progressively reveals** the right tools — artifacts for a workspace, a code
editor / diff / terminal for a repo — all inside one conversation, one history.

See [`PROPOSAL.md`](PROPOSAL.md) for the full write-up. **Evaluating this with a
code agent?** [`AGENTS.md`](AGENTS.md) is the agent-facing digest — quick start,
how to verify, and a claim-by-claim evaluation guide.

## What the demo shows

Open it and press **Play the tour**. One conversation walks through four beats
without ever switching tabs:

1. **Chat** — an ordinary message thread. No mode chosen up front.
2. **→ Workspace** — the same thread grows a workspace; a panel slides in with a
   one-pager, a launch email, and a hero image. *(This is today's "Cowork".)*
3. **→ Repo** — it becomes a coding session: a branch, a diff, and a passing
   test run in the terminal (representative fixtures — repo content is mocked; see
   [`docs/spec/11-mock-boundary.md`](docs/spec/11-mock-boundary.md)). *(This is
   today's "Code".)*
4. **→ Organize** — Claude proposes how to file what you just made (the session
   under a project, the drafts as artifacts, a schedule to keep a digest) as
   **inline confirmation cards**. Confirm one and it shows up in Projects /
   Artifacts / Scheduled. One-off edits confirm each time; a recurring schedule
   is approved once, then runs unprompted. You can also just type *"file this
   under Growth experiments"* in any session to get the same cards.

The sidebar shows the payoff: **one unified history** instead of three
scattered across tabs — each conversation's capabilities surface on its own
composer chips and panel. Open "Refactor auth middleware" (chat + repo) or
"Vector databases, explained" (chat only) to see the panel adapt per
conversation.

## Architecture: a real frontend over a portable backend

The UI is **not** wired to in-process mock data — it's a real web frontend that
talks to a backend over a versioned HTTP + SSE API. That backend is a
**zero-dependency mock server** today, but the contract is designed so the same
UI runs unchanged in two deployments:

1. **Native desktop app** — the UI renders in an app shell; the backend is a
   local sidecar. It can reach native resources (the filesystem, a local git
   working tree, OS pickers) that a browser can't, and later proxy the real
   Anthropic API — *without changing the API the UI speaks*.
2. **Web app** — the same UI is served by a remote web server that implements the
   same API. So the desktop and web experiences are byte-identical, with no drift
   between two separate codebases.

Three trees, one contract:

```
contract/   Framework-free wire types, imported VERBATIM by the UI (Vite) and the
            server (Node 26's native TypeScript). This type-identity IS the
            portability guarantee: entities, the relationship graph + reducer, the
            ServerEvent union (SSE), Capabilities, and the id invariants both ends
            must agree on.

server/     The mock backend — a near-zero-dependency node:http server run directly
            by Node 26 (no build step). In-memory store + event bus, a tiny router,
            SSE, and the seed data. Serves the built UI from dist/ too, so "web UI
            served from the server" is literally true. Its one dependency is the
            Anthropic SDK, used by the generation seam; server/model/ is the dev
            mock of the Messages endpoint it streams from (api.anthropic.com in prod).

src/        The UI. Components read through hooks (src/api), controllers issue
            commands; nothing else knows a URL or an event. Point VITE_API_BASE at
            a native sidecar or a remote server and the whole app moves.
```

**How it stays in sync (simple, push-based).** Reads go through a small
read-through query cache (`useSyncExternalStore`). The server pushes everything
the UI *didn't* request over one SSE stream (`GET /v1/events`) — a scheduled run
firing, a standing approval acting, a connector's auth expiring — and an event
router turns each into a cache patch. An assistant turn streams token-by-token
from `POST /v1/sessions/:id/messages`. The backend gets that text the production
way — it calls an Anthropic **Messages** endpoint through `@anthropic-ai/sdk`
**with a real tool interface** (`server/model/tools.ts`, one tool per resource
manipulation) and runs the tool-use loop: the model answers with `tool_use`
blocks, the backend executes each call into a consent-gated proposal (a relation
card or a panel escalation), feeds the `tool_result`s back, and relays the final
stream. In dev that endpoint is a local Anthropic-compatible mock
(`server/model/`, `:8788`) that decides which tools to call by matching the
message (fixed string for the guided tour, keyword otherwise) and wraps canned
prose around them — so even the guided tour is a real round-trip. Going live is
just `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` — the whole pipeline is already
real, only the model is mocked.

**Native vs remote, without env-sniffing.** `GET /v1/capabilities` tells the UI
what *this* backend can do (`localFs`, `localGit`, `osPicker`, …). The UI gates
native-only affordances on those flags — never on detecting Electron vs web.
Native-only endpoints (`/fs/pick`, `/fs/folders/:id`, `/git/repos/:id/diff`) live
behind the same API; a remote backend returns `409 capability_unavailable`. Run
the server with `BACKEND=remote` to see the web-server variant.

## Run it

Requires **Node 26+** (the mock server runs TypeScript natively, no build step).

```bash
npm install
npm run dev        # boots BOTH the UI (Vite, :5173) and the mock backend (:8787)
                   # → http://127.0.0.1:5173   (Vite proxies /api → the server)
```

Other scripts:

```bash
npm run dev:ui     # just the Vite UI (expects a backend on :8787)
npm run server     # just the mock backend (node --watch server/index.ts)
npm run model      # just the Anthropic-compatible mock model server (:8788)
npm run start      # one process: serve the built UI + the API (the deploy shape)
npm run build      # production build to dist/
npm run typecheck  # tsc --noEmit (UI + contract)

BACKEND=remote npm run server   # the remote-web-server variant (native ops 409)

# point the backend at the REAL Anthropic API instead of the in-process mock:
ANTHROPIC_BASE_URL=https://api.anthropic.com ANTHROPIC_API_KEY=sk-... npm run dev
```

## Stack

- **React + TypeScript + Vite** (UI) · **Tailwind CSS v4** · **framer-motion** ·
  **lucide-react**
- **Node 26 + node:http** (mock backend) — runs the TypeScript directly; one
  runtime dependency, **`@anthropic-ai/sdk`** (the Messages client for the model
  seam), otherwise dependency-free.
- The data is mock on purpose (deterministic, easy to review) — but it now lives
  *behind the API*, in the server, exactly where a real backend's database +
  Anthropic API would.

## Project layout

```
contract/                 # the shared wire types (the API IS these types)
  entities · cowork · relations · graph · runs · contexts · content
  events (SSE union) · api (Capabilities + DTOs) · ids (shared invariants)

server/                   # the mock backend (Node 26 native TS; one dep: the SDK)
  index.ts                # http server: prefix routing, CORS, static dist/, daemon
  store.ts                # working state + event bus + the run daemon
  persist.ts              # filesystem persistence — snapshots UI state to .data/store.json
  generate.ts             # the Anthropic Messages seam — declares the tools, runs the tool-use loop, streams the reply
  model/                  # the Anthropic-compatible mock model server (POST /v1/messages)
    tools.ts              #   the resource-manipulation tool interface + executor (one tool per manipulation)
    intents.ts            #   the mock's tool-decision logic (fixed-string tour table + keyword fallback)
    replies.ts            #   the mock's canned prose ("weights")
  http/{router,respond,sse}.ts
  routes/index.ts         # the route table (one .get/.post per endpoint)
  data/                   # the seed data (sessions, cowork, contexts, …)

docs/                     # forward-looking design notes (exploration, not locked-in)
  capability-broker-architecture.md  # control plane + native-agent registry direction

src/
  main.tsx · App.tsx · types.ts (re-exports the contract) · index.css
  api/                    # the UI's one door to the backend
    client.ts             # fetch wrapper (base URL = VITE_API_BASE ?? /api/v1)
    cache.ts              # normalized read-through query cache (useSyncExternalStore)
    events.ts             # EventSource → cache invalidations (the event router)
    commands.ts           # writes: streaming send, relation ops, schedules, recents
    hooks.ts · keys.ts
  controller/             # useSessionWorkspace · useRelations · useLayout
  components/             # Sidebar · SectionView · Composer · AddContextButton · …
  lib/                    # connectors · sections · recents (server-backed) · …
  data/                   # thin shims over server/data for not-yet-migrated reads
```

## Status

A public proposal prototype, shared with Anthropic as constructive feedback
alongside the written proposal. An **independent concept** — mock data, **not
affiliated with or endorsed by Anthropic**.
