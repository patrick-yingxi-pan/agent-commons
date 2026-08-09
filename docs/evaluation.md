# Evaluating this proposal — read order, evidence, and the mock boundary

> The evaluator's guide. [`AGENTS.md`](../AGENTS.md) is the map that points
> here; [`PROPOSAL.md`](../PROPOSAL.md) is the argument itself.

## Suggested read order (≈10 min)

1. **[`PROPOSAL.md`](../PROPOSAL.md)** §1–§4 — the problem and the proposed model.
2. **Run it and free-type the flow** (quick start in `AGENTS.md`) — the whole
   thesis in one conversation: chat → workspace → repo → organize, each step a
   consent-gated proposal. (There is no scripted tour to look for: the original
   guided tour and the proposal top bar were removed in 2026-07 — the direction
   landed; the repo now focuses on the platform work.)
3. **[`README.md`](../README.md) "Architecture"** — how one UI runs over a portable
   contract (desktop sidecar *or* remote web server, same wire types).
4. Skim **`contract/`** — the shared types *are* the API; this is the portability
   claim made concrete.
5. For the full requirements ledger, see **[`docs/spec/`](spec/README.md)** —
   the hierarchical spec (goal → pillars → leaf requirements), each requirement
   traced to its implementation + locking test. It's the **conformance baseline**:
   if you wonder "is X actually built or just mocked?", that's where to check.

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

The complete enumerated ledger of declared fixtures is spec pillar
[`docs/spec/11-mock-boundary.md`](spec/11-mock-boundary.md) (MOCK-1…). The
evaluator-facing summary:

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
  [`docs/demo-accounts.md`](demo-accounts.md) for the roster (emails,
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
- **The social layer's deliberate simplifications** (design:
  [`docs/design/social-layer.md`](design/social-layer.md), spec pillar
  [`docs/spec/12-social-layer.md`](spec/12-social-layer.md)): **mutes match by
  actor display name** (the wire's only public identity — names-as-handles,
  same rule as the D21 profile byline), so a renamed actor un-mutes. That is a
  PREFERENCE keyed on a name, which is honest: you mute the name you saw. It is
  deliberately *not* how AUTHORIZATION works anywhere — display names are
  attacker-controlled (`createWorkspace` has no uniqueness guard) and
  renameable, so every standing decision (retract, resolve, delete, share)
  compares raw tenant ids server-side and ships the answer as a viewer-relative
  flag (`canRetract` / `canResolve` / `canDelete` / `own`). If you see a name
  comparison deciding who may DO something, that is a bug, not this
  simplification; **"anyone
  with the link" means anyone signed in** who redeems it — anonymous rendering
  through the auth gate (and any indexing) is the recorded, deliberately
  unbuilt production tail; and the seeded share (Ada's *Insights dashboard* →
  Grace at `propose` tier) is code-owned so the share → discuss →
  improve demo needs no setup. Don't file these as bugs.
- **The demo scene stands up from a COLD start** (verified 2026-07-22 against an
  empty `.data/`, in a fresh browser profile — which is what a clone gets, since
  `.data/` is gitignored): the sign-in front door renders with its
  not-affiliated disclosure, `ada@acme.example` / `ada-demo-password` lands in
  the workspace, the seeded share (`grant-seed-1`, *Insights dashboard* → Beta
  Platform at `propose`, carrying a note) is already there so the Commons has a
  card, and free-typing *"Open a workspace and draft the launch assets"* returns
  a real round-trip whose consent card reads **"Claude would like to Cowork in a
  folder"** (Deny · Choose folder). Nothing in the walk needs setup.
- **Created state is persisted** to `.data/store.json` and rehydrated on boot
  (`server/persist.ts`) — it survives a restart; snapshot back-up/restore
  tooling lives in `scripts/snapshot.ts`. Operational detail in
  [`server/CLAUDE.md`](../server/CLAUDE.md).
