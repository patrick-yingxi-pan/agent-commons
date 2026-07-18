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

- **It is:** a clickable, end-to-end demo running as a real web frontend over a
  real — but **mock** — HTTP + SSE backend, so the interaction model and the
  client/server shape are both tangible.
- **It is not:** a production client. Data is mocked on purpose (deterministic,
  reviewable) and there is **no real model** behind the streaming reply.

The full argument is in [`PROPOSAL.md`](PROPOSAL.md); the engineering tour is in
[`README.md`](README.md). This file is the agent-facing digest of both.

## Suggested read order for an evaluator (≈10 min)

1. **[`PROPOSAL.md`](PROPOSAL.md)** §1–§4 — the problem and the proposed model.
2. **Run it and free-type the flow** (see below) — the whole thesis in one
   conversation: chat → workspace → repo → organize, each step a consent-gated
   proposal.
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

The app opens on the **sign-in front door** (the auth gate defaults ON for real
boots — see `docs/demo-accounts.md` for the six demo credentials; Ada
`ada@acme.example` / `ada-demo-password` is the flagship. `AUTH_GATE=off` opts a
boot out). Once signed in you land on a fresh thread. Free-type the escalation
flow in one session —
“Open a workspace and draft the launch assets”, “Connect the repo”, “Create a
project called X” — and each step asks for consent (folder pick, repo connect,
project create) before it lands, mirroring the desktop app's permission prompts.
(The original scripted guided tour and the proposal top bar were removed in
2026-07 — the direction landed; the repo now focuses on the platform work.)

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
**rendered UI** (the layer `node --test` can't — no DOM), booting its **own** stack on
dedicated ports (UI 5183 / API 5184 — it never reuses a running dev server, whose mode
and store can't be trusted) with an isolated store (`DATA_FILE=.data/e2e-store.json`),
`BACKEND=remote` (so Playwright browser contexts impersonate **tenants** via the identity
headers — `e2e/co-author-article.spec.ts` is the two-tenant multi-tenancy regression — and
the in-app **account switcher** is live: `e2e/account-switch.spec.ts` locks the
switch-mid-generation crux of `docs/design/multi-account-ui.md`, and
`e2e/auth-wizard.spec.ts` + `e2e/onboarding.spec.ts` lock its §12 front door —
the full-screen sign-up wizard and the multi-account stack —
and `e2e/responsive.spec.ts` locks the viewport ladder at phone/tablet/landscape
sizes: the narrow-tier rail drawer, the full-viewport panel takeover, and the
`short:` chrome compression, spec ADAPT-11), and
a pinned local `ANTHROPIC_BASE_URL` (an ambient one would stand the mock model down);
`e2e/*.spec.ts`. The store/route suites lock the logic, the E2E locks the wiring.
E2E spec gotchas: the app **opens on a fresh draft** (sending materializes a new
session), and the sidebar is an `<aside>` (role `complementary`) — only its nav
buttons carry a `navigation` role.

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
| In-place escalation | Free-type it — “Open a workspace and draft the launch assets”, then “Connect the repo” — one thread escalates chat → workspace → repo with nothing re-explained, each step a consent prompt. |
| Progressive disclosure | The right panel is absent in chat and morphs (artifacts → code editor/diff/terminal) as context attaches. |
| Unified history | The sidebar — one row per conversation; open "Refactor auth middleware" (chat+repo) vs "Vector databases, explained" (chat only) to see the panel adapt. |
| Relations, edited with consent | Free-type an organize request (“file this under X”, “save the recap as an artifact”) — Claude proposes relation edits as inline cards; nothing changes until you confirm. Standing approval (a schedule) is approved once, then runs unprompted. |
| One gate for everything Claude changes | The Agent-Commons concepts (model providers — the **Models** rail section; worker agents, prompts, commissions — the **Agents** hub) are managed two ways — by hand (their dialogs) **and conversationally**: free-type "create a worker agent called X on Anthropic" or "commission X to the Insights dashboard project" and Claude proposes it through the *same* confirm card the relation edits use (`docs/agent-commons.md` slice 17). |
| Agents as the main players (the platform shell) | The Agents hub's **Discover** tab — cross-tenant directories of shared Projects and published Agents (D17); **Publish to directory** on an agent card and **Fork** on a directory entry — the definition travels, capability never does (D18); a project page's **Open work** list — post a work item and a **standing** Contributor takes it *unprompted*, through the same role/reach/guardian walls, earning D13 credit (D19); each item is a **conversation** — a comment thread for anyone who can see the project, and an honest close (**Retract**, poster/owner only, which also powers A2A `tasks/cancel`) (D23). Spec rows COMMONS-7/8/9/16; the feature roadmap vs GitHub's model lives in `docs/github-parity.md`. |
| A foreign agent can join (the A2A edge) | The platform speaks Google's **A2A** protocol as pure translation (D20, `docs/a2a-integration.md`): a published agent's **A2A card** link (a spec-shaped Agent Card from the same directory redaction; the platform card at `/.well-known/agent-card.json`); JSON-RPC `message/send` to a shared Project posts **open work** through the identical walls (task = the item's lifecycle; `via A2A` shown on the backlog); messaging an *Agent* endpoint gets a `rejected` Task naming fork-and-bind; the Discover tab's **Import from another instance** fetches a remote card into an unbound stub with lineage. Spec rows COMMONS-10/11/12. |
| Identities and lookup (the findability layer) | Any **owner byline** (a Discover card, a shared project's header, a search hit) opens that workspace's **profile page** — its shared projects, published agents, public track record, and recent public acts, identical for owner and visitor (D21, spec COMMONS-14). The **⌘K palette** is GitHub's global search in this shell's one search surface: server-side typed groups across sessions, projects, artifacts, routines, registries, AND the commons (shared projects, published agents, **workspaces**, open work), every hit a deep link (D22, spec COMMONS-15). |
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
  that decides which tools to call by matching the message by **keyword pattern**
  (`server/model/intents.ts` — every escalation/relation tool is reachable by a
  free-typed phrase) and wraps canned prose around them
  (`server/model/replies.ts`). Every organizing turn is a **real round-trip**: its
  message travels UI → backend → model and back, so every escalation and relation
  edit you see is the result of an actual tool call (the panels' content is the
  tool's *output*, not a client fixture). Point `ANTHROPIC_BASE_URL` at
  `api.anthropic.com` + set `ANTHROPIC_API_KEY` to talk to the real API — no code
  change. (Don't file "the reply is canned" as a bug.)
- **Seed data** lives in `server/data/` — sessions, projects, artifacts, repos,
  diffs, terminal output are fixtures, not live.
- **Six demo accounts, each a distinct themed world** — see
  [`docs/demo-accounts.md`](docs/demo-accounts.md) for the roster (emails,
  `<name>-demo-password` credentials, and what each contains). Sign in through
  the real flow (multi-account §12/§13 — nothing enumerates identities); the
  data standard (disjoint worlds, exhaustive-in-types, moderate scale) is
  locked by `tests/demo-accounts.test.ts`. The untagged flagship seeds belong
  to the backend default AND Ada/Acme (one seat, two faces). The desktop's
  local user has no credential on purpose (it never signs in).
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
- **Review the diff before every commit, then commit and push.** The standing
  flow for every change (owner directive, 2026-07-17): implement → tests green →
  run a code-review pass over the working diff (adversarial review for
  substantial changes, an inline pass for small ones) → fix confirmed findings →
  commit → push. Landed work is never left uncommitted, and no commit lands
  unreviewed — the Phase 6 dissolve review caught eleven real bugs the full test
  suite had missed, so the gate is default, not opt-in.
- **Git:** this repo commits and pushes straight to `main` over HTTPS.

### Design decisions (locked in)

- **Light theme only.** There is no dark mode — no `dark:` variants and no theme
  toggle. Don't add one unless the proposal direction changes.
- **Front door by default — no data before sign-in.** Real boots default the
  auth gate ON (`server/index.ts` sets `AUTH_GATE ??= 'require'`): pre-sign-in,
  the UI shows the auth surface and the API refuses data routes with 401 — the
  gate is a server-side WALL (one router middleware + the ANONYMOUS principal in
  `store.identity`), not client chrome. The open set is only the front door
  (`/capabilities`, `/me`, `/auth/*`, ops probes) and the self-authenticated
  machine edges (`/a2a/*`, `/relay/*`, `/connector`). `AUTH_GATE=off` opts a
  boot out (the E2E stack and `scripts/ui-sweep.mjs`'s target may run either
  way — the sweep signs in as Ada first). Locked by `tests/auth-gate.test.ts`;
  spec row SYNC-8.
- **No "before" view.** The prototype deliberately does *not* reproduce today's
  three-tab UI. The motivation lives in the docs, and
  reviewers can diff against the live app — so don't build a side-by-side "before".
- **Form follows function — parallel controls share one styled primitive.**
  Logically / structurally similar elements must *look* the same: same role ⇒ same
  look, so the UI reads as one system and the cue can't drift between copy-pasted
  copies. When you find two controls doing the same job rendered differently, unify
  them onto a single shared component/token rather than hand-restyling one to match.
  Embodied by `src/lib/inlineAction.ts` + `src/components/AddTrigger.tsx` (every
  "+ Add ‹thing›" picker-opener) and `src/lib/sectionAction.ts` +
  `src/components/SectionAction.tsx` (every SECTION HEADER's verb — edit/add/post/
  commission — one compact icon button in the header's right-aligned cluster,
  hover-revealed via `SECTION_REVEAL` in `src/lib/hoverReveal.ts`, pinned visible
  when the section is empty; locked by `tests/sectionAction.test.ts`) and
  `src/lib/foldHeader.ts` (every foldable section
  header) and `src/lib/pageHeader.ts` (every PAGE's opening title block — hub and
  detail pages share one title look + container rhythm; the chrome bars
  `SessionTitleBar`/`PanelShell` are a different role, deliberately distinct)
  and `src/lib/scrim.ts` (every dimmed overlay backdrop — the tier scrims and
  the dialog scrims alike) and `src/lib/popover.ts` (every anchored popover surface —
  chrome + the stay-inside-the-viewport containment, applied by
  `src/lib/usePopoverShift.ts` / `clampLeft`) and `src/lib/copyButton.ts` +
  `src/components/CopyButton.tsx` (every copy-to-clipboard button — the rendezvous-secret
  reveal and the A2A-card viewer alike, label swapping to "Copied" then self-resetting)
  and `src/lib/spinner.ts` + `src/components/Spinner.tsx` (every loading spinner — its
  spin gated behind `motion-safe:` so it respects `prefers-reduced-motion`, WCAG 2.3.3;
  the lock forbids ANY bare `animate-{spin,pulse,ping,bounce}` so no infinite animation
  ships ungated — which also keeps a headless screenshot from chasing an animation that
  never settles);
  each shared cue is locked by a test
  that fails if a component re-hardcodes it (`tests/addTrigger.test.ts`,
  `tests/foldHeader.test.ts`, `tests/pageHeader.test.ts`, `tests/scrim.test.ts`,
  `tests/popover.test.ts`, `tests/copy-button.test.ts`, `tests/spinner.test.ts`).
  The same rule governs
  shared *behaviour*, not just styling: every popover / dropdown / menu dismisses on
  outside-click + Escape through one hook, `src/lib/useDismissable.ts` (locked by
  `tests/useDismissable.test.ts`, which fails if a component re-hardcodes the document
  `mousedown` listener). Add new shared tokens / hooks the same way — one source of
  truth, asserted by a test. The primitives double as **enumeration handles for
  review**: because every subject routes through one funnel, a single scan (or a
  `data-*` stamp, e.g. `data-popover`) can visit all of them — see
  [`docs/ui-invariants.md`](docs/ui-invariants.md), the earned ledger of
  machine-checkable UI rules behind the `/ui-review` skill
  (`.claude/skills/ui-review/SKILL.md`). After a UI change, review against that
  ledger — sweep the surfaces × viewports the *diff* could affect, not the spots
  you edited — and ratchet every confirmed escape into a new funnel + lock + row.
  The **exhaustive** oracle catalog above the earned ledger — function (F-·) and
  aesthetic (A-·) rules, each with a mechanical detection + fix procedure, the
  severity policy, and the five-phase review-and-fix process — is
  [`docs/review-rulebook.md`](docs/review-rulebook.md) (structure locked by
  `tests/review-rulebook.test.ts`); rulebook rules promote into the earned
  ledgers when an escape confirms them.
- **Registries have one home and live points-of-use.** Every account-level registry
  (Model providers → the **Models** rail section; worker agents / prompts /
  commissions → the **Agents** hub; saved connectors & repos → **Contexts**) is
  *managed* in exactly one surface, and every control that *offers* its entries —
  the composer's model selector, a routine's model picker, Customize's default
  model, the Agent dialog's provider picker — reads the **same live registry
  through the api hooks**, never a hard-coded mirror. (The composer's model list
  was once a frozen trio while providers lived in a hub tab — registering a model
  didn't make it selectable; that class of drift is the target.) Embodied by
  `src/components/ModelPickerMenu.tsx` (the one provider→model→effort menu, all
  three pickers) and locked by `tests/model-picker.test.ts`, which fails if ANY
  src/ file declares a model/effort catalog constant: the models a picker lists
  are each provider's **own catalog** (`ModelProvider.models` — fetched from its
  endpoint's `GET /v1/models` or declared at registration, spec MODEL-16/-17), so
  even the default Claude models are registry rows, and the composer strip's
  usage gauge measures against the resolved model's provider-sourced context
  window (honest unknown-capacity when it doesn't expose one).
  When adding a picker for a registry concept,
  drive it from the registry hook and route it through the shared menu — and if the
  concept's entries are usable in sessions, make the registry a first-class rail
  surface, not a sub-tab of the thing that consumes it. A registry entry can be
  flagged the caller's **default** (`isDefault`, set via the one shared
  `DefaultToggle` in the entry's own dialog) — a pure UI pre-selection shortcut
  (spec MODEL-15), governed by the *Strict core, convenient edge* decision below.
  The rule's general form is
  invariant **UI-12** (`docs/ui-invariants.md`): every displayed datum reads a LIVE
  source and has a SYNC path — no seed-mirror reads (the rail's project menus once
  missed every runtime-created project), no SSE case that invalidates a key nothing
  reads, no component-state "registry" that evaporates on unmount (the Contexts
  page's add/remove once did), no asserted status a registry actually owns (the
  composer quick list's fabricated green dot). Locked by
  `tests/connectivity-freshness.test.ts` + `tests/event-tenancy.test.ts` (the
  2026-07 connectivity audit's ratchet).
- **Strict core, convenient edge — an absent request field must mean something, or be
  refused.** The generalization of the registry-default rule (invariant **INV-9**,
  `docs/spec/09-design-invariants.md`): the API never fills in an absence by *choosing
  for the caller*. A write-path field is either present and concrete, or absent with a
  fixed, documented semantic — the three allowed absence classes are **inherit** (a
  session's unset provider pick = its Agent's), **complete-set value default from
  fixed constants** (a confirmed create-provider op's effort levels / root authority),
  and **none, the minimal-risk meaning** (unset budget = no cap; unset instructions =
  `''`; unset agent tools = the **empty** set — the API never *widens* a grant
  silently; a Project with no `defaultRole` = no preference). What is *never* allowed:
  resolving an absence to a **mutable entity or a privileged value** — a registry
  entry, a "current default", a role picked on the caller's behalf. The same write
  would mean something different later, and the wiring bug surfaces far from its
  cause — so that class is refused loudly (`ValidationError` → 400), and an INVALID
  value is refused the same way, never silently normalized. Earned instances: the
  agent provider/prompt bindings (MODEL-15), the commission `role` (D14 — required;
  the Project's optional `defaultRole` is only a picker pre-selection), and the
  explicit tool grant. Conveniences live at the **edge, visibly**: pickers pre-select
  (`defaultEntry`, a Project's `defaultRole`); the conversational tools resolve names
  and defaults *before* the consent card, and the card states the result (provider +
  prompt + tool grant; the commission's role) — what crosses the API is always the
  resolved, concrete form. Read-side, the server may decorate responses with
  **computed, viewer-relative annotations** (`isDefault`, `online`, `own`) — never
  stored, stripped at every mint/patch funnel. When adding a request field, classify
  its absence into one of the three classes or refuse it; when adding a convenience,
  put it at the edge and show its result.
- **Rail navigation is an inline disclosure tree.** Sections render as a VSCode-explorer
  tree (spec ADAPT-13): a section with sub-nodes carries a chevron and expands **in place**
  — children indented below it, siblings staying put, **no push and no back button**. (The
  earlier drill-in *replaced* the section list with a pushed sub-menu behind a "‹ Sections"
  chip + a height-reservation hack; the odd post-click view that produced is exactly what
  the tree fixes — a rail that reflows or navigates-away on expand is the bug.) The chevron
  toggles children without navigating; the row body opens the page. It's driven by ONE
  registry — `src/lib/subviews.ts` (`SECTION_SUBVIEWS`) — read by **both** the rail
  (`Sidebar`, `SectionTreeRow`) and the body (`SectionView`), so they can't drift (the
  *Registries have one home* rule). Two node kinds, by nature: **content sections**
  (Contexts / Artifacts / Scheduled / Models / Projects) expand to their **facet groups**
  (kind / type / status / provider-class / ownership) — clicking a group focuses the page
  on it, the section row shows all groups; the **Agents hub** expands to its four
  *non-default surfaces* (Prompts / Commissions / Discover / Audit) — the section row
  itself is the worker-agents surface, so it isn't re-listed as a child (that would
  duplicate "Agents" and make the nav ambiguous). A section lands on its **default** view
  (rail sub-view `null`; each body maps null to its own default). A facet is chosen in
  **one** place — the tree — never *also* an in-page filter bar; a section's grouping and
  its rail children are the same partition, so don't add an in-page tab/dropdown that
  re-selects it. When a section grows a new facet, add its group nodes here — the body
  filters on the same `subview` the tree selects. Locked by `tests/section-subviews.test.ts`
  (inline tree not a push; child ids = the body's switch keys; grouping in the tree, no
  in-page filter bar). A **Sections** header carries one **fold/unfold-all** toggle. The
  rail's lower body is an **accordion of foldable, resizable panes** — Sections, Scheduled,
  Recents. Each pane's header has a **fold caret** (symmetric across all three); folding
  collapses it to its header (persisted per pane). Open panes hold a **persisted, FIXED**
  height except the **bottom-most open one**, which **flexes** to fill — so folding never
  opens a gap (fold Recents → Scheduled fills; fold Scheduled too → Sections fills). A
  divider moves only on drag — folding or a content change never moves it (**fixed unless
  manually adjusted**); heights **clamp at render, never in storage** (the rule the rail
  *width* follows, `useLayout`). A drag rewrites **only the dragged pane's** stored height,
  computed from the OTHER panes' **effective** heights, so the clamp can't leak into an
  untouched pane's stored value (a real bug an earlier sum-preserving model had). The pure
  allocation/drag math (`layoutPanes` / `dragPane`) lives in `src/lib/railPanes.ts`
  (dependency-free, node-tested); dividers are **in-flow gutters between panes** (never
  overlaying a pane's scroll content/scrollbar) reusing the ONE `ResizeHandle` primitive
  (now `top`/`bottom` orientation, with a persistent hairline on horizontals — form follows
  function). Every `ResizeHandle` — rail width, panel width, pane gutters — is
  **keyboard-operable** (WCAG 2.1.1, invariant UI-11): a focusable, distinctly named
  separator whose axis arrows run the same start→move→end pipeline as a pointer drag,
  announcing its size + bounds (`aria-valuenow/-min/-max`, WCAG 4.1.2) from the same
  constants the clamp enforces.
  Dividers **drop on the narrow tier** (`resizable` false → panes flow in the
  drawer, ADAPT-11; folding still works). Two **labeled** `<nav>` landmarks keep the rail
  landmark-unique (WCAG) *and* section rows navigation-scoped for e2e — "Create" (New
  session) and "Sections" (the tree) — while Scheduled/Recents stay out of navigation.
  Locked by `tests/rail-panes.test.ts` (fold combos + flex promotion, fit-to-avail clamp,
  min floors both drag directions, no clamp-leak into storage) and
  `tests/resize-handle.test.ts` + `e2e/keyboard-resize.spec.ts` (the keyboard path).
- **Every page has a canonical URL — the address bar is a projection of the nav
  model.** GitHub's navigation rule (a link is the coordination primitive:
  shareable, bookmarkable, open-in-new-tab-able) applied to this shell:
  `src/lib/urlRoutes.ts` is the ONE pure two-way mapping (NavLocation + sub-view ↔
  path — `/s/:id`, `/:section[/:subview]`, `/projects/:id`, `/scheduled/:id`,
  `/u/:name`; a registered sub-view id is a reserved word beating a detail id), and
  the controller owns the History sync: pushState mirrors every navigation
  (equality-guarded), popstate applies browser Back/Forward (page + sub-view,
  parallel to — never recorded in — the in-app back stack), and the **boot address
  is consumed once per page load, winning over per-account view memory** (a pasted
  link opens what it names; an account switch restores memory and rewrites the
  address). Transient focus (a highlighted item / comment) is not page identity and
  stays out of the URL. When adding a page kind, extend the mapping + its
  round-trip test — never parse or mint a path anywhere else. Locked by
  `tests/url-routes.test.ts`; spec row ADAPT-15. Companion rule — **titles are
  doors**: a card / list row fronting a page makes its TITLE the primary click
  target (GitHub's title-as-link), wired to the same handler as the explicit open
  affordance (`CommonsCardHead`'s `onOpen`; the work-item title opens its thread).
- **The back-history rule — an in-page door carries its origin; browser Back is
  per-page** (owner directive 2026-07-17, spec ADAPT-18). Every page opened by
  clicking WITHIN a page carries a back affordance to the page that opened it —
  across section boundaries and across the page↔conversation line (a session row
  opens a conversation whose title bar leads with back; a breadcrumb opens a
  project page whose back names the conversation). Mechanism: the pane's content
  carries a `back` stack of `PaneLoc`s (`src/lib/paneHistory.ts` is the model;
  `PaneBody` in `MainSplit.tsx` is the ONE push funnel for pane-originated doors);
  chrome doors (rail / palette / notifications) RESET the stack — top-level
  navigation starts fresh, GitHub's top-nav rule. The affordance is the one
  `BackButton` (`src/components/BackButton.tsx`) on detail pages, hub `PageHeader`s
  (when history exists), and the `SessionTitleBar`. Browser Back/Forward apply
  per page too (`planPop`): pop the focused pane's own back top, else REFOCUS the
  pane already showing the address (never clobber with a duplicate), else plain
  route. When adding a door, decide which side of the page/chrome line it's on —
  in-page doors must route through the pane funnel (or a push-flagged shell door),
  never bare `routeToFocused`. Locked by `tests/pane-history.test.ts` +
  `e2e/back-history.spec.ts`.
- **The entity page is the shared surface — capability shapes affordances, not
  location.** A shared Project (and any future shared entity) has ONE canonical page
  serving owner and visitor alike, GitHub-repo-style: what differs is which controls
  exist (the projection's viewer-relative `own` flag is the gate), never where you go.
  Directory cards (Discover) are *doors* into those pages, not parallel leaf surfaces;
  ownership cues (byline, credit, shared marker) come from one primitive
  (`src/lib/publicFace.ts` + `src/components/PublicFace.tsx`, invariant UI-10, spec
  COMMONS-13). Don't add a visitor-variant page or an owner-only rendering of the same
  entity — gate affordances on `own` inside the one page.
- **Surface follows the entity's nature.** Before choosing a control or layout, ask
  what the thing *is* — its temporal nature (moment / state / **lifecycle**), its
  payload (a **change** → a diff; prose; refs; a quantity), the interactions it
  accumulates (a **thread**; a **negotiation** with a verdict), and its **relations**
  (ref links + back-references) — and let that dictate the form. A lifecycle entity
  wants a **dedicated page with a timeline** (state transitions + thread interleaved),
  not a modal; a change wants a **diff**; a relation wants a **ref link**. A modal is
  only for a transient act. This is the deep form of "form follows function"; the full
  method + the living refinement audit are in
  [`docs/design/surface-from-nature.md`](docs/design/surface-from-nature.md) and
  [`docs/design/surface-audit.md`](docs/design/surface-audit.md). New timeline / diff /
  ref-link forms become shared primitives the first time two entities need them.
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

### Active build

- **The universal split workspace — Phases 1–6 LANDED (the equal-pages model,
  2026-07-16).** The owner's locked end state: *"every page is equally
  displayed in the main background and supports the same functionality: split
  in two directions and close; when the last page is closed, only the
  background is displayed."* The split tree is the ONLY render path — no
  privileged pane kind (the `{kind:'primary'}` singleton surface is dissolved;
  legacy blobs migrate): conversations (the fresh DRAFT included, through the
  shared draft funnel `draftCore.ts`), section pages, and context panels are
  equal store-backed panes; a `null` tree is the BACKGROUND, repopulated by
  the rail's doors. Every navigation — rail clicks, palette hits, notification
  bells, popstate, the boot address, restore memory — lands in the FOCUSED
  pane, and **the address bar projects the focused pane** (a focus hop IS a
  navigation; a context pane addresses as its owning conversation; a section
  pane REPORTS its deep location — `/projects/:id` fidelity round-trips). Wide
  tiles the tree; the overlay tiers render the focused pane alone with the
  `OverlayPanelDock` docked panel (ADAPT-11). The singleton controller is
  PRUNED (2026-07-17): `useSessionWorkspace.ts` is now only the SHELL's nav
  controller (boot address, URL projection, popstate, account switch,
  notification focus, doors) — conversations live in `usePaneConversation` +
  `ConversationPane`, context mutations in `useSessionContextCommands`, the
  rail highlight derives from the FOCUSED pane, and the per-account view
  memory IS the persisted split tree (`viewMemory.ts` retired). LIVE PRUNE
  landed (2026-07-17): deleting a session evicts every pane it hosts — on
  every client (the `session.removed` wire event is the definitive
  gone-signal) — and a pinned context pane whose subject was detached
  self-collapses once its entry is server-reconciled (the `reconciled`
  authority latch). The tail is closed (step 8): the NarrowBar houses the
  narrow tier's rail toggle on every title-bar-less surface (background
  included), and a notification bell's highlight is scoped to the pane the
  door landed in. **Phases 1–8 complete — the punch list is empty.** The
  architecture, phase ledger, and the
  generalized LESSONS (implicit defaults, the projection-latch pattern,
  lifecycle-flagged bridges, boots-twice testing, stale readers of a
  dissolved authority, total routing primitives) live in
  [`docs/design/universal-split-workspace.md`](docs/design/universal-split-workspace.md)
  — consult it before touching `useSessionWorkspace.ts`, the split libs, or
  the panel components, and land work as its phases, each with tests.

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

- **Delegated-cognition providers ("Session providers") — now BUILT through v4.**
  A D9 extension: a Model provider our backend *can't dial* (firewalled / key-less /
  no API) whose cognition is performed by an **AI session the user already runs** —
  reached by the session draining a mailbox we host at a one-time
  **rendezvous secret**, the cognition-plane mirror of a Runner. Preserves "zero
  provider code" while inverting the transport (dial-out → rendezvous dial-in)
  *honestly*: the messages route dispatches session turns to a small `relayReply`
  sibling of `generateReply` (same handlers seam, `server/relay.ts`), so the whole
  Messages stack stays byte-for-byte untouched — no loopback shim. The user-side is
  one MCP connector (`connector/relay-connector.ts` — `npm run connector` from a
  clone, or downloaded from the product itself: `GET /api/v1/connector` serves it
  type-stripped as one self-contained `session-relay.mjs`, spec MODEL-14) driven by
  a blocking `respond_and_wait` loop. v2 (2026-07-14) added the **framed mailbox**
  — relayed prompts declare the turn's tool surface, the far session relays tool
  calls back *unexecuted* (`toolCalls`), and each lands as the identical
  consent-gated proposal (`toolUse:true`, spec MODEL-18) — and the
  **process-owned keepalive**: the connector itself long-polls from the latch
  onward, so the relay survives indefinite idle without a daemon (spec MODEL-19).
  v3 (2026-07-15) added the framing dedupe (content-addressed system/tools,
  spec MODEL-21). v4 (2026-07-18) made onboarding **agent-driven and
  harness-agnostic** — the mint panel hands out ONE bootstrap prompt; the far
  agent fetches `GET /api/v1/connector/setup` and installs the connector into its
  own harness (Claude Code, Codex, Cursor, opencode, …), or drives the relay
  protocol over plain HTTP with no MCP at all (spec MODEL-22) — and added
  **multi-session channels**: one relay serves several UI sessions concurrently,
  every prompt self-contained (full per-conversation history), sub-agent
  delegation advised (spec MODEL-23). v5 (2026-07-18) added the **serving
  handshake** — fan-out is negotiated (`?channels=` on every poll; silence =
  serial), declared by the far model (`start({conversations})`, latched like the
  credentials), and observed (`relay.activity` events; the card shows "Answering
  X of Y conversations") — never assumed (spec MODEL-24). Locked by
  `tests/relay.test.ts`,
  `tests/relay-migrate.test.ts`, `tests/relay-connector.test.ts`,
  `tests/connector-serve.test.ts` (spec rows MODEL-10/-11/-18/-19/-21/-22/-23/-24).
  Providers are first-class **Models** (rail section + every model picker reads
  the live registry; a session's pick routes its turns — spec MODEL-13). The
  **from-zero explainer** (how the relay works, no prior context assumed —
  kept in sync with behavior by `tests/relay-primer.test.ts`):
  [`docs/session-relay-primer.md`](docs/session-relay-primer.md). The
  design log — six passes, each recording the ruling and the rejected
  alternative — and what remains:
  [`docs/delegated-cognition-provider.md`](docs/delegated-cognition-provider.md).

- **Principals & namespaces — decided 2026-07-12, now BUILT (all four phases).**
  Identity follows the GitHub/Hugging Face model *plus agents*: the person is the
  only login and holds exactly ONE namespace (minted at signup, named after the
  person — no workspaces to create or switch; the switcher hops ACCOUNTS, the
  stack), every entity has one owner **namespace** (`tenantId`, opaque — orgs
  deferred, to return as namespaces, never as switched-into worlds), every act is
  stamped with its **principal** — human or badged agent (never credentialed;
  capability only ever in grants, i.e. project roles and commissions — the
  GitHub-Apps shape D18/D19 already built), and a standing resolution renders the
  who/owner/grant attribution chain. Now invariant **INV-10**
  ([`docs/spec/09-design-invariants.md`](docs/spec/09-design-invariants.md));
  target model, precedent, and the phase log:
  [`docs/design/principals-and-namespaces.md`](docs/design/principals-and-namespaces.md).

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
