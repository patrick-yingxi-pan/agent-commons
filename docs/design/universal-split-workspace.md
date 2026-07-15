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

### 2.4 The right panel folds in (Phase 4)

A context chip click today opens the session-scoped right panel (or routes
into the ADAPT-16 frame). End state: it opens/focuses a **sibling
`context-panel` pane** in the universal tree, scoped to its conversation. The
ADAPT-16 frame's persisted trees migrate (its `PaneContent` embeds into the
universal vocabulary with the owning session id stamped); `PaneChromeContext` —
the chrome adapter that lets the existing panels render inside any pane —
carries over unchanged. ADAPT-16's spec row is superseded, not deleted
(history stays honest).

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

1. **Conversation store extraction** — pure refactor, zero UI change: the
   per-session state and turn pipeline move into `conversationStore.ts`;
   `useSessionWorkspace` consumes it for its one active session. Lock: all
   existing tests + e2e pass unchanged; new unit tests for the store's keyed
   isolation (two sessions stream independently; two subscribers to one
   session see one state).
2. **Generic pane tree + section panes** — `splitFrame.ts` generalizes over
   the content type (the right-panel frame keeps working through the same
   lib); the main area becomes a tree whose leaves host fully-interactive
   section pages (per-pane nav state) beside the (still single) conversation
   pane. Split/close/resize/persist/picker.
3. **Multi-conversation panes** — any pane hosts a conversation through the
   store: own composer, own streaming turn, shared state for duplicate panes;
   focused-pane URL semantics.
4. **Fold the right panel in** — `context-panel` view kind; chip clicks open
   sibling panes; ADAPT-16 surface retired with tree migration.
5. **Hardening** — the ADAPT-11 ladder, spec rows (new ADAPT row superseding
   ADAPT-16's frame surface), the e2e matrix (split × navigate × stream ×
   reload × tiers), `/ui-review` sweep, README/AGENTS.md updates.

## 4. Decisions locked by the owner (2026-07-15)

- **Fully independent panes** — not a focused-pane-only interactivity model;
  every conversation pane composes and streams.
- **Everything displayable** — conversations, all section pages incl. detail
  pages, and (by integration) the context panels.
- **One mechanism** — the right panel is absorbed; no parallel split systems
  at end state.
