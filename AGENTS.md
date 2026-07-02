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
5. For the full requirements ledger, see **[`docs/spec/`](docs/spec/README.md)** —
   the hierarchical spec (goal → pillars → leaf requirements), each requirement
   traced to its implementation + locking test. It's the **conformance baseline**:
   if you wonder "is X actually built or just mocked?", that's where to check.

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
npm run e2e        # Playwright browser E2E (boots the dev stack, headless) — DOM-level wiring
npm run start      # one process: serve built UI + API (the deploy shape)
npm run model      # the Anthropic-compatible mock model server, standalone (:8788)
BACKEND=remote npm run server   # the remote-web-server variant (native ops 409)
```

`npm run e2e` needs the browser once: `npx playwright install chromium`. It drives the
**rendered UI** (the layer `node --test` can't — no DOM), against an isolated store
(`DATA_FILE=.data/e2e-store.json`); `e2e/*.spec.ts`. The store/route suites lock the
logic, the E2E locks the wiring.

`npm run dev`/`start` boot the mock model server in-process, so one command is a
complete stack. To run the backend against the **real** API instead of the mock,
set `ANTHROPIC_BASE_URL=https://api.anthropic.com` and `ANTHROPIC_API_KEY` (the
in-process mock then stands down). `ANTHROPIC_MODEL` overrides the model id
(default `claude-opus-4-8`).

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
| One gate for everything Claude changes | The **Agents** hub's concepts (model providers, prompts, worker agents, commissions) are managed two ways — by hand (the hub's dialogs) **and conversationally**: free-type "create a worker agent called X on Anthropic" or "commission X to the Insights dashboard project" and Claude proposes it through the *same* confirm card the relation edits use (`docs/agent-commons.md` slice 17). |
| Portability (one UI, two backends) | `contract/` (types imported verbatim by both ends) + `GET /v1/capabilities` gating native-only endpoints; `BACKEND=remote` returns `409 capability_unavailable`. |

**A good evaluation answers:** does collapsing the three tabs into one
context-attached thread reduce friction without losing power-user density? Are the
consent moments (escalation, relation edits, standing schedule approval) the right
shape? Is the contract genuinely backend-portable, or does the UI secretly assume
the mock?

## What's intentionally mock (don't file these as bugs)

- **No real model — but the whole pipeline is real.** The mock model is the *only*
  faked part of the system. Everything around it is production-shaped:
  `server/generate.ts` calls an **Anthropic Messages endpoint through the official
  SDK with a real tool interface** (`server/model/tools.ts` — one tool per
  resource manipulation) and runs the **tool-use loop**: the model answers with
  `tool_use` blocks, the backend *executes* each call (turning it into a
  consent-gated proposal — a relation-edit card or an escalation), feeds the
  `tool_result`s back, and streams the model's final prose. In dev the endpoint is
  a local **Anthropic-compatible mock model server** (`server/model/`, on `:8788`)
  that decides which tools to call by matching the message — by **fixed string**
  for the guided tour's scripted beats, by **keyword pattern** otherwise
  (`server/model/intents.ts`) — and wraps canned prose around them
  (`server/model/replies.ts`). The **guided tour itself is a real round-trip**: its
  messages travel UI → backend → model and back, so every escalation and relation
  edit you see is the result of an actual tool call (the panels' content is the
  tool's *output*, not a client fixture). Point `ANTHROPIC_BASE_URL` at
  `api.anthropic.com` + set `ANTHROPIC_API_KEY` to talk to the real API — no code
  change. (Don't file "the reply is canned" as a bug.)
- **Seed data** lives in `server/data/` — sessions, projects, artifacts, repos,
  diffs, terminal output are fixtures, not live.
- **Files / photos / folders are *really* served from a filesystem**, not fixtures.
  The Add-context picker switches between three real sources (`contract/fs.ts`,
  `server/fs.ts`): **This computer** (the UI host, read client-side via the browser
  file APIs — the one source that can't go through the backend, since a web server
  can't read your browser's disk), each connected **runner's host** (browsed +
  read through the broker — real `fs.read` + the new `fs.list` capability, with a
  bytes route proxying the runner for images), and the web backend's **cloud
  storage** (a real directory it serves, available on both backends). Fulfilment is
  real `fs` reads rooted at the committed, deterministic `sample-cloud/` and
  `sample-runner-host/` trees (env-overridable: `CONTEXT_CLOUD_ROOT`,
  `CONTEXT_RUNNER_ROOT`). Text files serve real text; images serve real bytes
  (`<img>`, not gradients). *Don't file "the photos are gradients" — they're real
  now; the gradient is only a load/fallback.* A UI-host pick's bytes stay in the
  browser (the seam to upload them to the backend when an effect needs them is
  noted in `src/lib/uiHostFs.ts`).
- **Native ops are stubbed** behind capability flags; a remote backend returns
  `409 capability_unavailable` by design. This is the *arbitrary-path* OS seam
  (`/fs/pick`, `/fs/folders/:id`, `/git/repos/:id/diff`, gated by `osPicker` /
  `localFs` / `localGit`) — distinct from the served `/fs/*?source=` sources above,
  which work on both backends.
- **Created state is persisted to the filesystem.** When the real server runs
  (`dev` / `start` / `server`), the UI-owned state — sent messages, created
  sessions, attached context + its panels, schedules, recents, relation edits, and the
  Agent Commons registries (providers, prompts, worker agents, commissions) — is
  snapshotted to `.data/store.json` on each mutation and rehydrated on boot
  (`server/persist.ts`), so it survives a restart. The simplest viable format (one
  JSON snapshot, atomic write); refine later. Transient state (reservations, the
  live agent registry) is deliberately *not* persisted. Tests run in-memory.
- **Back up / restore that state for testing** (`scripts/snapshot.ts`): roll back
  after clicking around. `npm run snapshot:save` copies the live store to
  `.data/snapshots/backup.json`; `npm run snapshot:restore` copies it back (restart
  the server — persistence loads once on boot); `npm run snapshot:list` shows them.
  `npm run snapshot:build` manufactures a clean, **comprehensive** playground that
  exercises every persisted slice once — it re-seeds from the `server/data/`
  fixtures and drives the real store mutators + relation reducer (so it can't drift
  from the contract and reproduces identically in any clone), then writes
  `.data/snapshots/comprehensive.json` (`--activate` makes it the live store,
  backing up the current one first). The `.json` outputs are gitignored; only the
  generator is checked in. `tests/snapshot.test.ts` locks the round-trip and the
  every-slice coverage invariant.

## Working in this repo (conventions)

- **Record decisions in the repo, not just memory.** Project-related decisions,
  rationale, and notes belong in repo files — this file's *Design decisions (locked
  in)* / *Open exploration* sections, `docs/`, or the relevant module's header
  comment — so **every clone shares them**. A coding agent's local memory is
  per-machine and invisible to other clones; the repo is the system of record. When
  a decision settles, write it down where the next reader (human or agent) will find
  it, next to the code it governs.
- **The contract is load-bearing.** `contract/*.ts` is imported *verbatim* by both
  the Vite UI and the Node server — that type-identity **is** the portability
  guarantee. Don't add framework or Node-only types to `contract/`, and keep the
  client and server reducers (`contract/graph.ts`) in agreement.
- **One door to the backend.** UI components read through hooks (`src/api`);
  controllers issue commands. Nothing else should know a URL or an SSE event.
- **Few runtime dependencies.** The UI's deps are deliberately minimal. The
  server carries a single, intentional dependency — **`@anthropic-ai/sdk`**, the
  Messages client behind the generation seam (see Design decisions). Don't add
  others without good reason; the rest of `server/` stays dependency-free (it even
  hand-rolls its Node types in `server/node.d.ts`).
- **Every feature ships with complete automated tests.** A change isn't done until
  its behavior is locked by tests that fail on a regression — reducer/contract
  behavior in `tests/*.test.ts`, server routes via the HTTP helper, and the
  boundary contracts in `tests/contract-boundaries.test.ts` extended whenever a new
  cross-component seam appears. UI-only behavior the `node --test` harness can't
  exercise (it has no DOM) is verified in the running app and called out as such.
  This holds **across clones**: write the tests every time rather than leaning on a
  particular clone's existing coverage.
- **Keep the spec ledger current.** When a feature lands, add its requirement row(s)
  to the relevant **[`docs/spec/`](docs/spec/README.md)** pillar — statement,
  implementation pointer, locking test, status — so the spec stays the system of
  record for *what's built vs mocked*. `tests/spec-conformance.test.ts` fails if a
  spec reference rots; the named locking tests are what prove the behavior.
- **Run `npm run typecheck` and `node --test` before declaring a change done.**
  Verify UI changes in the running app, not just by reading code.
- **Git:** this repo commits and pushes straight to `main` over HTTPS.

### Design decisions (locked in)

- **Light theme only.** There is no dark mode — no `dark:` variants and no theme
  toggle. Don't add one unless the proposal direction changes.
- **No "before" view.** The prototype deliberately does *not* reproduce today's
  three-tab UI. The motivation lives in the docs and the in-app tour captions, and
  reviewers can diff against the live app — so don't build a side-by-side "before".
- **Form follows function — parallel controls share one styled primitive.**
  Logically / structurally similar elements must *look* the same: same role ⇒ same
  look, so the UI reads as one system and the cue can't drift between copy-pasted
  copies. When you find two controls doing the same job rendered differently, unify
  them onto a single shared component/token rather than hand-restyling one to match.
  Embodied by `src/lib/inlineAction.ts` + `src/components/AddTrigger.tsx` (every
  "+ Add ‹thing›" picker-opener) and `src/lib/foldHeader.ts` (every foldable section
  header); each shared cue is locked by a test that fails if a component re-hardcodes
  it (`tests/addTrigger.test.ts`, `tests/foldHeader.test.ts`). The same rule governs
  shared *behaviour*, not just styling: every popover / dropdown / menu dismisses on
  outside-click + Escape through one hook, `src/lib/useDismissable.ts` (locked by
  `tests/useDismissable.test.ts`, which fails if a component re-hardcodes the document
  `mousedown` listener). Add new shared tokens / hooks the same way — one source of
  truth, asserted by a test.
- **The dev server binds IPv4** (`server.host: '127.0.0.1'` in `vite.config.ts`).
  On some hosts `localhost` resolves to `::1` only, which a browser/preview hitting
  `127.0.0.1` can't reach. Keep the explicit bind (the API proxy targets it too).
- **Generation runs through a real Anthropic Messages API boundary *with a real
  tool interface*** (not an in-process fake). `server/generate.ts` calls an
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

### Open exploration (forward-looking — a design log, not shipped behavior)

- **Capability-broker architecture.** A worked-through future direction in which the
  web server is a **control plane** brokering a live **registry of native agents** (one
  per host) that advertise capabilities (fs / terminal / process); native and web
  collapse into one model differing only by a co-located **fast path** (Electron = an
  unbundled co-located agent). The dialogue settled four design choices — relay-default
  + fast path, **agents are the system of record** for their host, server-side content
  audit, and stable **ambient agent identity** — each recorded with its trade-offs and
  rejected alternative in
  [`docs/capability-broker-architecture.md`](docs/capability-broker-architecture.md).
  This is forward-looking; it does **not** change current behavior, and these "decisions"
  are settled *within the exploration*, not implemented in the prototype.

- **Shared-resource coordination.** The general form of the broker doc's branch model:
  *different sessions producing irreversible effects on shared resources* (no common
  ancestor to merge). Works through the monotonicity (CALM) boundary that defines the
  hard case, **escrow/reservation** as the primitive that tames it, and a candidate
  **D5 — resource-guardian principle** (a per-shared-resource authority, the third
  system-of-record axis beside session and host). Grounded on this repo's **context
  elements** as the session→resource conduit. Also forward-looking:
  [`docs/shared-resource-coordination.md`](docs/shared-resource-coordination.md).

- **Context compaction (UI reference).** A captured UI pattern for *when the
  context window fills* — the natural sequel to the context-window gauge in
  `src/components/UsageControl.tsx`: warm first-person caption ("Compacting our
  conversation so we can keep chatting…"), a determinate progress bar, and the
  gauge's disc dropping back once space is freed. Design reference for later, not
  built: [`docs/context-compaction.md`](docs/context-compaction.md).

## Repo map (detail in [`README.md`](README.md))

```
contract/   framework-free wire types — the API IS these types
server/     mock backend (Node 26 native TS): store, router, SSE, seed data
server/model/  Anthropic-compatible mock model server — POST /v1/messages (the model seam)
src/        the UI — api/ (cache, events, commands) · controller/ · components/ · data/
docs/       forward-looking design notes (exploration, not locked-in decisions)
PROPOSAL.md the written proposal (the argument)
README.md   architecture + run guide (the engineering tour)
```
