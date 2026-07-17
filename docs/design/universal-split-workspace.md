# The universal split workspace — design + phase plan

> **Status: ACTIVE BUILD (decided 2026-07-15).** The product owner's direction,
> verbatim in intent: a **general-purpose split of the MAIN area** — like
> Chrome's split view, but with **arbitrarily many panes**, split horizontally
> and vertically, where **each pane can display anything the single main area
> can display**, every pane **fully independent** (a conversation pane has its
> own composer and streams its own replies), and the existing right context
> panel **folds into the same mechanism** rather than remaining a parallel
> system. This document is the architecture + the phase backlog; each phase
> lands separately with its tests.

## 1. What exists today (and why it isn't this)

Two split systems ship already, both narrower than the goal:

- **The right-panel split frame (ADAPT-16, 2026-07-15).** A split tree for the
  right CONTEXT panel only: its leaves host the session-scoped panels
  (workspace / repo / connector / attachments / runs). The main area — the
  thread and the section pages — is untouched. Its pure tree math
  (`src/lib/splitFrame.ts`) is exactly the general model and is REUSED below;
  its UI surface is a special case that Phase 4 absorbs.
- **The rail + one main surface.** The center renders exactly one thing at a
  time: the active conversation OR one section page, both driven by the
  singleton controller.

The blocker to generality is architectural, not visual:
`src/controller/useSessionWorkspace.ts` is a **singleton session controller** —
one `activeId`, one `live` workspace, one streaming turn, one composer, one
escalation consent slot, one panel focus. Two fully-interactive conversation
panes require that machinery **per session**, not per app.

## 2. Target model

### 2.1 The view vocabulary

One split tree spans the whole workspace surface right of the rail. Leaves are
**views**; every view kind is a first-class, fully interactive citizen:

| View kind | Content | Interactivity |
|---|---|---|
| `conversation` | one session: thread + composer + consent cards | full — its own composer, its own streaming turn, its own escalation cards |
| `section` | a section page (Projects, Artifacts, Contexts, Models, Agents, Scheduled, …) with its own sub-view and detail focus (a project page, an agent page, …) | full — per-pane local nav state; global data through the shared api hooks |
| `context-panel` | a session-scoped context panel (workspace / repo / connector / files / photos / runs), referencing `(sessionId, focus)` | full — the same panels the right frame hosts today (Phase 4) |

Splits nest arbitrarily (row/col binary tree, ratio per split — the
`splitFrame.ts` model, generalized over the content type). Dividers are the ONE
keyboard-operable `ResizeHandle`. The tree persists per account and prunes at
render, never in storage.

### 2.2 Per-session conversation state — the keyed store

The heart of the refactor. The singleton's session half decomposes into a
**module-scoped, subscribable store keyed by session id**
(`src/controller/conversationStore.ts`), owning per session: the `live`
workspace state, typing / busy / the streaming turn, send / stop / retry, the
pending escalation, attach/detach effects, and panel focus. React panes
subscribe via `useConversation(sessionId)` (useSyncExternalStore).

Consequences that fall out correctly:

- **Two panes on one session share one state** (the store dedupes by key);
  they render identically and a turn streamed in one appears in both. The
  server's existing one-live-turn-per-session slot remains the concurrency
  wall — the composer in either pane hits the same honest 409/busy behavior.
- **Concurrent turns across panes just work**: two different sessions each
  stream through their own store entry; nothing global serializes them (the
  relay's one-turn-per-relay gate still applies per provider, as today).
- The singleton hook shrinks to app concerns: the pane tree + focused pane,
  URL sync, back stack, account switch, rail state, drafts.

### 2.3 Focus, URL, and navigation

- Exactly one pane is **focused** (last pointer/keyboard interaction). Focus
  never gates interactivity — every pane is live; focus decides which pane's
  location the **address bar** shows (ADAPT-15's one-URL rule holds: the URL
  is the focused pane's canonical location; the tree itself is client layout,
  not page identity) and which pane rail clicks retarget.
- **Rail / palette / deep-link navigation lands in the focused pane** (VSCode's
  editor-group rule). Splitting clones nothing: the new pane opens as a picker
  (choose: a conversation, a section, a context panel).
- Browser Back/Forward walk the focused pane's history (the existing
  parallel-histories rule, now per focused pane; pane-local back stacks are a
  Phase 5 refinement).
- **Entity doors inside a pane stay in the pane** (landed 2026-07-16). Section
  pages route every entity door — owner bylines, context rows, work-item
  links, "View in …" — through ONE bridge (`useRelations().navigate`), whose
  root lands on the primary. A pane-hosted section page provides the
  `SectionNavOverride` that `useRelations()` composes, resolving the bridge
  against the pane via the pure mapper `src/lib/paneNav.ts`: a same-section
  target pushes the pane's own detail focus (back stack works); a
  cross-section target RETARGETS the pane's leaf, seeded with the detail
  (`msection.seed`); a bare section jump falls through to the root. One
  funnel — 22 escape doors fixed with zero per-callsite edits (the owner
  report: a Contexts pane's connector row opened its detail on the primary).
  Conversation doors (open thread / new session / proposal) still hand off
  deliberately. Locked by `tests/pane-nav.test.ts` (the mapping mirrors
  `App.navigateToSection` shape for shape) + `e2e/main-split.spec.ts`
  (verified to fail without the override).

### 2.4 The right panel folds in (Phase 4 — LANDED 2026-07-15)

A context chip / attach / approved-escalation sets the active session's `focus`
(one per-session source of truth, remembered by `panelPrefs`, FWD-2). On the WIDE
tier the App effect **projects `focus` into the universal tree** as a
`context-panel` pane beside the primary (`setPrimaryContext` →
`setPrimaryContextTree`); the pane is marked `primary` and located by that flag,
so it survives any tree rearrangement, swaps in place on a session switch, and is
removed when `focus` clears (the rail cluster's close routes a `primary` context
pane back to `closePanel`). Rendering is edge-to-edge through the ONE `PanelShell`
(`embedded` via the trimmed `paneChrome` — no own width / slide / close X). The
separate ADAPT-16 right frame and its per-session split memory are **retired**;
the reusable tree math (`splitFrame.ts`) and per-account tree persistence live on.
ADAPT-16's spec row is superseded, not deleted (history stays honest).

**Why a render-projection of `focus` rather than a stored context pane per
session?** `focus` is per-session and cross-tier (it also drives the non-wide
overlay, so resizing wide↔narrow keeps the panel open); the per-account tree
holds the user's explicit tiling. Keeping ONE source of truth (`focus`) and
deriving the wide-tier pane from it avoids a second store to reconcile — the
`primary` marker is what lets that derived pane still be a first-class,
rail-managed pane. A DUPLICATED context pane drops the marker and becomes an
independent PINNED pane the tree owns outright (the ADAPT-16 multi-pane capability,
now via the universal split).

### 2.5 Degradation (ADAPT-11)

The overlay tiers cannot tile: medium/narrow render the **focused pane only**,
full-surface; the tree persists and re-tiles on return to wide. The `short:`
axis and every existing ladder rule apply inside each pane (container queries
— UI-9 — govern pane-internal responsive behavior, since a pane's width is not
the viewport's).

### 2.6 Persistence

One per-account layout blob (`claude-ui.workspace-split.v1`, scoped like
`uiPrefs`): the tree (JSON — the splitFrame round-trip), each split's ratio,
the focused path. Restore prunes against what exists (a deleted session's pane
collapses); prune at render, never in storage.

## 3. Phases (each lands green, with tests)

1. **Conversation store extraction** — ✅ **LANDED 2026-07-15**: the
   per-session state and turn pipeline live in `conversationCore.ts` (pure,
   transport-injected) + `conversationStore.ts` (the api wiring + React hook);
   `useSessionWorkspace` subscribes for its one active session. Epochs replaced
   the global runId (streams keep landing in their keyed entry across
   navigation; only a reset of the same session stales them); sends serialize
   per session, not globally; `adopt` moves the draft's optimistic state under
   the materialized id. Locked by `tests/conversation-store.test.ts` (keyed
   isolation, epoch staleness, reconcile-without-stale, adopt-once, failure
   copy, C28 hold, settle hook, keyed notification); all pre-existing tests +
   the full e2e suite pass unchanged.
2. **Generic pane tree + section panes** — ✅ **LANDED 2026-07-15**:
   `splitFrame.ts` is generic over the content type (default type argument —
   the right-panel frame's call sites unchanged); the main surface tiles
   through `MainSplitGate` (the pre-split JSX passes through as children —
   byte-identical when no tree), with `SectionPane` hosting fully-interactive
   section pages on pane-local nav state and the rail's **Split the view**
   button minting the first frame. Exactly-one-primary invariant
   (`closeMainPane`), per-account persistence, URL parity (a pane's local
   navigation never touches the address). Spec row ADAPT-17; locked by
   `tests/main-split.test.ts` + `e2e/main-split.spec.ts`.
3. **Multi-conversation panes** — ✅ **LANDED 2026-07-15**: the picker offers
   every conversation; `ConversationPane` renders the thread through the keyed
   store (`usePaneConversation` — the primary's open recipe without its
   navigation), with a lean own composer (`dispatchTurn`: optimistic turn +
   flags + per-session chain; stop included) streaming independently of the
   primary. Consent applies through ONE funnel (`applyEscalationToLive` /
   `escalationBinding` / `approvalView` — the controller refactored onto it).
   Locked by `tests/conversation-store.test.ts` (dispatchTurn),
   `tests/escalation-funnel.test.ts`, `e2e/main-split.spec.ts`.
   **Homogeneous views landed 2026-07-15** (the owner's rule: refactor first —
   a session is a well-factored view, so panes and primary must render the
   same one): the fully-fledged conversation surface is ONE component,
   `src/components/ConversationView.tsx` (thread + compaction + stop/retry +
   the FULL composer: context chips, add-context pickers, model picker, usage
   gauge, relay-wait state derived internally), mounted by the primary AND
   every `ConversationPane` — two panes on one session are two views in sync
   with the same keyed model. The pane's controller is a thin command adapter
   over the SAME shared funnels (`bindingsFor` moved into `data/liveSession.ts`;
   attach/remove/compact/model-pick session-parametric). Still open here:
   pane focus driving the URL, and pruning a deleted session's pane live.
4. **Fold the right panel in** — ✅ **LANDED 2026-07-15**: the right context
   panel is a `context-panel` pane in the ONE main tree
   (`src/components/ContextPanelView.tsx` — the panel-side twin of
   `ConversationView`), resolved against its OWNING session's keyed live and
   mutated through the SHARED `useSessionContextCommands` funnel that
   `ConversationPane` also uses (so the mapping can't fork). The active session's
   `focus` projects into the tree on the WIDE tier (`useMainSplit.setPrimaryContext`
   → `setPrimaryContextTree`); the pane is marked `primary` and found by that FLAG
   not by position, so splitting the primary never orphans it, it self-heals on a
   session switch, and the rail cluster's close clears its driver (`focus`) so tree
   and `focus` stay in step. A context pane DUPLICATED via the rail drops the flag →
   an independent PINNED pane (the old ADAPT-16 multi-pane frame, for free). The
   NON-WIDE tiers keep the docked / takeover overlay (ADAPT-11 — the tree doesn't
   tile there; App's overlay path renders `focus` as before). Retired with the
   frame: `SplitFrame.tsx`, the per-session `claude-ui.split.v1` memory, and
   `paneChrome`'s `onSplit` / `onClosePane` chrome; the tree math (`splitFrame.ts`)
   and per-account tree persistence (`claude-ui.mainsplit.v1`) live on. ADAPT-16's
   spec row is **superseded** (kept, not deleted — history stays honest). Locked by
   `tests/main-split.test.ts` (context-panel vocabulary / identity / dedup /
   aliveness / prune, `setPrimaryContextTree`, the primary-close guard) and
   `e2e/main-split.spec.ts` (the fold-in tiling + rail close; the split-mechanics
   tests close the auto-tiled panel first).
5. **Hardening** — the ADAPT-11 degradation matrix, the remaining spec/doc rows,
   the e2e matrix (split × navigate × stream × reload × tiers), the pages-in-panes
   audit (section pages already single-column on every tier), `/ui-review` sweep,
   README/AGENTS.md updates, and the deferred **live prune** (`mainPaneKeep` wired
   at render / restore — a deleted session's or detached context's pane collapses;
   today the primary context pane self-heals via `focus`, a pinned one shows a quiet
   "no longer attached" placeholder until closed).
6. **Dissolve the primary (owner-approved 2026-07-16: the FULL store-backed
   dissolve)** — no `{kind:'primary'}` at all: every pane an equal store-backed
   view, the singleton reduced to a pure app shell (URL/boot/account/memory),
   the URL following the FOCUSED pane, drafts opening in a pane. Sequenced so
   the app stays green at every commit — each step lands with tests + review:
   1. ✅ **LANDED 2026-07-16** — rename the context-panel `primary` FLAG to
      `focusDriven` (frees the word for the pane KIND being deleted; the two
      concepts were homonyms — a rename hazard the mapping flagged).
   2. ✅ **LANDED 2026-07-16** — `focus` moves into the keyed per-session store
      (`ConversationState.focus`, `conversations.setFocus`): one per-session
      source any pane can read; `adopt` carries the panel choice; the
      singleton's `useState` + hand-rolled dispatch-time capture retired.
   3. (a) ✅ **LANDED 2026-07-16** — the draft funnel extracted from
      `handleSend` into `draftCore.ts` (pure, dependency-injected,
      node-tested) + `draftController.ts` (the app instance): coalesce,
      FWD-1 buffer + flush-before-send, FWD-2 focus carry, late-pick
      sanitize, adopt, degradation. One flow for every draft host.
      (b) ✅ **LANDED 2026-07-16** — a `ConversationPane` hosts the draft:
      "New session" routes the fresh draft INTO the focused pane
      (`routeToFocused` + `draft.reset()`; the primary path unchanged when
      the primary is focused), the pane dispatches through the shared funnel,
      and `onDraftAdopted` retargets every draft-id pane to the real id by
      CONTENT match (`retargetDraftPanes` — duplicates follow; same-reference
      no-op). Locked by `tests/main-split.test.ts` (retarget) +
      `e2e/main-split.spec.ts` (New session lands in the focused pane and
      materializes in place; the primary keeps its content; URL unmoved).
   4. ✅ **LANDED 2026-07-16** — URL follows focus (`focusedContent` → the
      address; a focus hop IS a navigation; a context pane addresses as its
      OWNING conversation; picker/background keep the address), entity doors
      land in the focused pane (`routeDoor`/`routeSession`/`routeSection` —
      the six detail doors, palette hits, bells, the boot address, restore
      memory), and **the dissolve itself**: `{kind:'primary'}` deleted,
      `PaneBody` the one leaf renderer, the BACKGROUND at zero panes, ONE
      close rule, `migrateMainSplit` for legacy blobs, the overlay tiers
      rendering the focused pane (+ `OverlayPanelDock` off the store focus),
      drafts fully pane-equal (writable pick, `addSeed` multi-add). The
      review pass (2 adversarial agents over the flip commit) surfaced and
      fixed 11 findings — see commit b299656.
   5. ✅ **Deep-URL fidelity LANDED 2026-07-16** — a section pane REPORTS its
      live location (`PaneAt`: sub-view + open detail) into its tree leaf via
      a REV-STABLE update (`updatePaneContent` — the pane must not remount
      from describing itself; `replacePane`'s rev bump stays route-only): the
      URL projects the focused pane's deep page (`/projects/:id`,
      `/u/:name`…), popstate/boot seed it back, persistence restores the pane
      to the same spot on reload (locked by a boots-twice e2e, per the
      lesson). Initial state = `at ?? seed`; `at` is NOT in the pane's key.
      Docs/spec reconciled 2026-07-16 (ADAPT-15/17 restated to the
      equal-panes model).
   6. ✅ **The singleton PRUNED — LANDED 2026-07-17.** `useSessionWorkspace`
      rewritten as the slim SHELL controller (boot address, URL projection,
      popstate, account-switch store reset, notification `pendingFocus`, the
      entity doors, session row mutations) — every conversation-owned member
      deleted (~1,000 lines): send/stop/retry/compact, the model pick, the
      escalation funnels, the context add/removes, panel focus, the in-app
      history stack, `extraSessions`, the auto-scroll ref. `routeToFocused`
      made TOTAL (a stale focus path lands in the first pane — doors never
      silently no-op), so every `if (!route(...)) fallback` collapsed. The
      per-account VIEW MEMORY blob (`viewMemory.ts`) retired: the persisted
      split tree IS the view memory (the account-switch e2e passes unchanged
      on the tree alone). Pruning exposed — and fixed — five stale readers
      of the dissolved authority (see Lessons): the rail's active highlight
      (froze at boot; now derived from the FOCUSED pane, aria-current
      stamped), the relation card's attach-context (attached to "the active
      session" = the stale draft; now session-scoped through
      `useSessionContextCommands(sessionId)`), attach-opens-panel +
      remove-clears-dangling-focus (re-homed INTO the shared funnel,
      `focusForAdded`/`focusValidIn`), the C28 push-reconcile resurface
      (added to `usePaneConversation`'s push site), and a DRAFT pane's
      composer attach (bound a nonexistent server row; now routes
      `draft.addSeed`). Locked by `tests/shell-nav.test.ts` (the no-grow-back
      ratchet + the five re-homes), `tests/focusForAdded.test.ts`
      (`focusValidIn`), and the rail-highlight e2e in
      `e2e/main-split.spec.ts`. The adversarial review pass (2 agents over
      the prune diff) surfaced six more, all fixed: **the boot dedup** (the
      HIGH one — the boot address is the FOCUSED pane's projection but the
      transient focus cursor boots at the first pane, so a reload of a
      multi-pane tree routed pane B's address INTO pane A and destroyed the
      layout; `applyBootRoute` now FOCUSES a restored pane already showing
      the address — locked by a fail-verified reload e2e), the **boot-target
      URL latch** (the URL effect ran in the same commit as the boot route
      with the restored tree's stale focusedPath and pushed it OVER the boot
      address — pushes hold until the projection catches the canonical
      target), **popstate session validation restored** (history can hold
      another account's or a deleted thread's address; a dead link stays a
      dead click instead of persisting a blank pseudo-conversation into the
      tree), the **StrictMode double-mount guard** (`bootValidation` — the
      second effect run follows the in-flight session validation instead of
      consuming a now-null boot view and minting a draft over it), the
      **account-leak gates** (a late async boot callback could route — and
      persist — into the NEXT account's tree scope; every arm gates on
      `leftAccount`), and the **draft funnel semantics** (the composer
      attach re-home had picked `addSeed`, whose launcher reset WIPED an
      in-progress draft thread — `draft.attach` always stacks; draft chip /
      folder removes route through new `draft.removeContexts`/`removeFolder`
      that purge the FWD-1 buffer, so a removed seed can't re-attach at
      materialization, instead of 404ing the real-session funnel).
   7. ✅ **Live prune — LANDED 2026-07-17.** Two halves, one rule (a pane
      whose subject is definitively GONE collapses; pruning the last pane
      leaves the background, exactly like close):
      • **The delete half** — deleting a session evicts EVERY pane it hosts
        (`hostsSession` × `prunePanes` → `pruneMainPanes`), conversation and
        context panes alike, not just the focused one (locked by a
        fail-verified e2e: split a fresh session, delete from the rail →
        the layout collapses to the background).
      • **The detach half** — a PINNED context pane whose context was
        removed self-reports gone (`ContextPanelView.onGone` →
        `nav.onPaneSubjectGone`) and the tree closes it; the focus-driven
        twin clears its DRIVER instead (closing the projection would just
        be re-projected — the loop the door's split handling avoids) and
        forgets the FWD-2 pref. The report gates on the new
        `ConversationState.reconciled` AUTHORITY latch (set by the store's
        server `reconcile`, cleared by `reset`): a mirror-seeded live
        missing a runtime attach is a transient unknown, never a prune
        signal — the projection-latch rule grew a store face. Locked by
        `tests/main-split.test.ts` (prune unit), the reconciled-latch lock
        in `tests/conversation-store.test.ts`, and verified live (pin a
        duplicate of a repo panel, remove the repo → both context panes
        collapse, no re-projection loop).
   8. ✅ **The tail — LANDED 2026-07-17.** The three remaining items, closing
      the phase:
      • **Cross-client delete prune** — a new `session.removed` wire event
        (the definitive gone-signal; `session.updated` can only say
        "refetch", and a run session isn't in any list to vanish from):
        `store.removeSession` emits it (gated exactly like session.updated —
        a delete is only observable where the session was), the client
        routes it (invalidate + a new `onSessionRemoved` seam mirroring
        `onSessionPush`), and App prunes every hosting pane. This client's
        own delete echoes through the same seam (idempotent). Locked by the
        emit + tenancy locks in `tests/session-tenancy.test.ts`; verified
        live (raw-API DELETE → the SSE round-trip collapsed the pane).
      • **The narrow-tier rail toggle on panel-only surfaces** — NarrowBar
        now covers every focused surface without its own title bar: section
        pages (as before), a pinned context pane (titled after its owning
        conversation), a legacy picker, and the BACKGROUND (whose "open from
        the sidebar" advice previously had no way to open the sidebar).
      • **Per-pane notification highlight targets** — `routeToFocused`
        reports its LANDING path; `routeDoor` records it; `focusCtxFor`
        (App) answers the pending target only for that pane, and `PaneBody`
        provides the pane-scoped `FocusContext` — so a duplicate pane
        showing the same page can no longer steal or double-fire a bell's
        flash. Locked by `tests/shell-nav.test.ts`.
      Phases 1–8 complete: nothing remains open on the universal-split
      punch list.

## 4. Decisions locked by the owner (2026-07-15)

- **Fully independent panes** — not a focused-pane-only interactivity model;
  every conversation pane composes and streams.
- **Everything displayable** — conversations, all section pages incl. detail
  pages, and (by integration) the context panels.
- **One mechanism** — the right panel is absorbed; no parallel split systems
  at end state.
- **Every page equal in one background (2026-07-16, the owner's formulation
  of the Phase 6 end state):** *"Every page is equally displayed in the main
  'background' and supports the same functionality: split in two directions
  and close. When the last page is closed, only the background is
  displayed."* Consequences: no privileged pane at all (the `{kind:'primary'}`
  placeholder dies — panes are the ONLY render path); every pane, the fresh
  DRAFT included, splits and closes; the tree may reach ZERO panes — an empty
  background surface (not an implicit un-split primary) is a legal state, and
  the rail's doors repopulate it. This settles the previously-open fork
  "can the last pane close" with: yes, to the background.

## 5. Lessons from the build (Phases 1–6, generalizable)

Phase 6 (the dissolve) added four:

- **Deleting a privileged component surfaces every behavior it provided
  IMPLICITLY.** The singleton surface didn't just render — it *defaulted*: the
  boot's fresh draft existed because singleton state initialized to it, with
  no explicit step anywhere. When panes became the only render path, a
  no-address no-memory boot landed on the bare background. Generalized: before
  deleting a default-owner, enumerate not only its explicit behaviors but the
  states that exist merely because it initializes them — each needs an
  explicit new home.
- **A projection latch is a PATTERN, not a one-off fix — it recurs every time
  the projection is re-keyed.** The "unresolved row is unknown, not absent"
  latch was built for the singleton projection, then silently LOST when the
  projection re-keyed to the focused session, and the identical dissolve/
  re-form bug returned. When a guard exists to protect an effect from a
  transient input, moving the effect must move the guard — name the pattern in
  the code so a rewrite can't drop it.
- **Bridged fallbacks must respect lifecycle flags.** Routing `selectSession`
  through the pane bridge was right for every door — and wrong for the ONE
  caller running during account TEARDOWN (`onAccountSwitch`'s land-on-draft),
  which persisted a draft pane into the OUTGOING account's tree blob. A
  callback that both renders and PERSISTS must check "is this instance being
  left?" before writing.
- **A test suite that always boots clean is structurally blind to
  returning-visitor bugs.** Every e2e context starts with fresh localStorage,
  so "the deep link dies when a tree is already persisted" could never fail in
  CI — it shipped and only adversarial review caught it. Lock at least one
  boots-twice flow per persisted-state feature.

Step 6 (the prune) added two more:

- **Dissolving an authority leaves STALE READERS — enumerate every consumer of
  the old state, not just its writers.** The dissolve rerouted every WRITE
  (doors → panes) but left five READERS quietly consuming the now-frozen
  singleton state: the rail highlight (`activeId`/`activeSection` never moved
  again → no row ever highlighted), the view-memory save (recorded the boot
  draft forever), the relations attach bridge (attached to "the active
  session" = the draft), and two funnel side effects that lived in the
  singleton's composition rather than the shared command (attach-opens-panel,
  remove-clears-focus) plus one reconcile site (C28 push resurface) that the
  pane copy had silently dropped. Generalized: when a source of truth is
  dissolved, grep for every READ of it and re-derive each from the new source
  — and when a shared funnel replaces a privileged composition, diff the two
  member-by-member; anything the old composition did AROUND the shared core
  (side effects, guards, resurfacing) must move INTO the funnel or it is
  simply gone. The dead code was never the risk; the half-alive code was.
- **Make a routing primitive TOTAL instead of guarding every caller.** While
  `routeToFocused` could return false, every door needed an `if (!route())
  fallback` — and the fallbacks were the dead singleton. Reconciling the
  stale-path edge INSIDE the primitive (land in the first pane) deleted the
  whole caller-side guard genus at once.

### From Phases 1–4

- **Unify two systems of different SCOPE by picking one source and PROJECTING the
  other — never persist the projection.** The context panel was per-session
  (`focus`, cross-tier, FWD-2 memory); the split tree is per-account. Folding them
  kept `focus` as the single source and *derived* the wide-tier context pane from
  it at render (via the `primary` MARKER, so the derived pane is still a
  first-class rail-managed pane). Persisting that transient derivation caused
  churn + a wrong-session flash on reload (a review finding) — stripped before
  persist (`withoutPrimaryContext`). The rule: **transient/derived state is
  clamped/projected at render, never written to storage** (the same rule the rail
  width and the old frame's prune follow).
- **Locate a managed pane by an intrinsic MARKER, not by position.** Finding the
  primary context pane by an adjacency heuristic would have orphaned it the moment
  the user split the primary; a `primary:true` flag (found by `findPrimaryContext`)
  survives any tree rearrangement, and a *duplicate* simply drops the flag to
  become an independent pinned pane.
- **A change to a DEFAULT/auto behavior ripples into every test that assumed the
  old initial state.** Auto-tiling a repo session's context pane changed the split
  tests' starting layout (they expected a lone primary); the fix was to reset to a
  clean primary (`clearAutoPanel`) rather than re-encode the new counts everywhere.
- **When a UI element's TIER presence changes, its tier-specific tests move with
  it.** Retiring the wide docked panel moved the width-animated resize handle to
  the medium overlay — so its keyboard-resize regression test moved to 768px.
- **`node --test` can't catch React hook-order (Rules-of-Hooks) bugs — no DOM.**
  A pre-existing one surfaced only via a dev-console check during manual
  verification. Dev-mode console inspection (or a console-error e2e assertion) is
  the only net for that class; keep verifying observable UI changes in the running
  app, not just by tests.
- **A literal control char in an edit is a real hazard.** A NUL character
  (intended as a template-literal separator, written via a unicode escape) landed
  as an actual NUL byte, flipping the file to git-"binary" and would have shipped
  NULs into a `data-*` DOM attribute. Use a real, id-safe separator (a space, for
  slug ids); a "binary" diff on a `.ts` file is the tell.
