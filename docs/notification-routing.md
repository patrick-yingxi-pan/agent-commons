# Notification routing — every bell is a door to the exact place

> **Initiative.** The notification inbox (D24, `contract/notifications.ts`) is the
> GitHub bell: what happened to what you watch, own, or posted. Each row is meant to
> be a *door*. Today the doors are **coarse** — `work.*` opens the project page but
> not the item's thread; `agent.forked` opens the whole Agents section; and every
> `proposal.*` kind lands **nowhere** (the panel's `open()` only handles
> `agent.forked` and `projectId`, and proposals carry neither). This initiative makes
> **every** `NotificationKind` jump to the exact, meaningful place — GitHub-adapted,
> focused on the specific sub-entity — and makes that guarantee *machine-checkable*
> (an exhaustive door switch, a test that every kind resolves to a concrete door).
>
> This doc is the design + the implementation ledger the loop burns down. Rows flip
> to ✅ only when their slice lands with locking tests + a spec row, like every other
> feature (AGENTS.md).

## The problem, precisely

`src/components/NotificationsPanel.tsx` `open(n)`:

```ts
if (n.kind === 'agent.forked') onOpenSection('agents')
else if (n.projectId) onOpenProject(n.projectId)   // → project page, not the item
onClose()
```

- `proposal.opened / merged / declined / commented` have `agentId` but **no**
  `projectId` and aren't `agent.forked` → they **silently just close**. The single
  most GitHub-shaped notification (a PR event) is a dead click.
- `work.posted / resolved / commented / retracted / mentioned` open the project
  **page**, then you must find the item and expand its thread by hand. GitHub jumps
  you to `…/issues/42#issuecomment-99`.
- `agent.forked` opens the Agents **section list**, not the forked definition or its
  lineage.

The root cause is structural: **`NavLocation` addresses pages, not sub-entities.** A
work item, a proposal, and an agent card are all *within* a page; there is no way to
say "open that page **and** focus this thing on it." Fix that seam once, and every
door lands.

## The underlying design (the seam)

### 1. A transient focus channel, separate from page identity

Navigation identity (`NavLocation`, `sameLocation`) must **not** carry the focus
target — otherwise "back" would re-trigger the highlight, and two arrivals at the
same page from different bells would count as different pages. Focus is *ephemeral UI
intent*, consumed once on arrival.

```ts
// src/lib/focusTarget.ts — "highlight this on arrival"; NOT part of NavLocation.
export interface FocusTarget {
  projectId?: string     // project page → focus a work item
  workItemId?: string
  commentId?: string     // anchor an exact comment inside a thread (the #comment-N of GitHub)
  agentId?: string       // agent detail → focus a proposal, or highlight the agent card
  proposalId?: string
}
```

The controller (`useSessionWorkspace`) holds `pendingFocus: FocusTarget | null`,
set by a nav entry point and **cleared by the destination page** the moment it
consumes it (`consumeFocus()` → returns the target once, then null). Back/forward and
re-renders never re-fire.

### 2. Nav entry points that set page + focus together

New controller methods, each recording the page in history via the existing
`openProject / openOwner / openSection` (so "back" still works) **and** setting
`pendingFocus`:

- `openWorkItem(projectId, workItemId, commentId?)` → project page + focus the item.
- `openProposal(agentId, proposalId, viewerOwnsAgent)` → the agent's detail (owner
  gets the review queue; a proposer gets the public directory entry) + focus the
  proposal.
- `openAgent(agentId)` → the Agents hub / source-agent detail + highlight the card.

### 3. Destinations consume focus (scroll · highlight · expand)

- **Project page** (`SectionView` projects detail → `OpenWorkList` → `WorkItemRow`):
  the row whose id matches `workItemId` `scrollIntoView`s, gets a ~1.5s highlight
  ring, and if `commentId` is present auto-expands its thread and anchors the comment.
- **Agent detail**: `proposalId` opens `ProposalsReviewDialog` (if you own the agent)
  or expands `YourProposals` (if you're the proposer), scrolled + highlighted to that
  proposal. This honours the locked "one entity, capability shapes affordances"
  decision — the recipient's relationship to the agent (do I own it?) picks which
  affordance opens, not a different destination.
- **Agents hub**: `agentId` highlights the matching agent card.

### 4. Contract carries the ids (public-face only)

`AppNotification` gains `workItemId?`, `proposalId?`, `commentId?` — all ids of
entities the recipient can already see (never raw tenant ids). Populated at every
mint site in `server/store.ts` (the item/proposal/comment is in scope there).

### 5. The exhaustiveness guarantee (the crown)

The panel's ad-hoc `if/else` becomes an **exhaustive** `doorFor(n): NavIntent`
switch with a `never` default — TypeScript fails the build if a future
`NotificationKind` is added without a door. A unit test asserts **every** member of
`NotificationKind` yields a concrete door (never "just close"). That is the
mechanical form of the user's ask: *make every one jump to a meaningful page.*

## Exhaustive notification-type ledger

Every act on the platform with an audience distinct from the actor. **Built** = the
kind exists today. **New** = a real gap worth minting. **Deferred / Rejected** =
imagined, with rationale (anti-vanity + the D24 leak-wall govern what earns a bell).

Leak-wall (D24, load-bearing): *a notification never tells you something the
visibility walls wouldn't show you if you went looking.* Every door below points only
at something the recipient may already see.

### Built — the kind exists; this initiative gives it a precise door

| Kind | Trigger (act) | Audience | GitHub counterpart | Door (page + focus) |
|---|---|---|---|---|
| `work.posted` | a work item is posted | poster · owner · watchers −actor | Issue opened | Project page → item row scrolled + highlighted |
| `work.resolved` | an item is resolved | audience −resolver | Issue closed | Project page → item row (status "done by X") |
| `work.commented` | a comment on an item | thread audience −commenter | Issue comment (`#issuecomment-N`) | Project page → item → **thread expanded**, comment anchored |
| `work.retracted` | poster/owner retracts | audience −actor | Issue closed as not planned | Project page → item row (struck, "retracted by X") |
| `mentioned` | `@<name>` in an item comment (shared project only) | the named workspace | @mention in an issue | Project page → item → thread expanded, the naming comment anchored |
| `agent.forked` | someone forks your published agent | source owner | Fork event | Source agent's detail → card highlighted (lineage/fork count visible) |
| `proposal.opened` | a change proposal against your definition | target owner | PR opened | Your agent detail → **review dialog** open, that proposal focused |
| `proposal.merged` | owner merges your proposal | proposer | PR merged | Public agent detail → Your proposals, proposal focused ("merged into vN") |
| `proposal.declined` | owner declines your proposal | proposer | PR closed | Public agent detail → Your proposals, proposal focused ("declined") |
| `proposal.commented` | a comment on the proposal thread | the **other** party | PR review comment | The proposal — surface picked by whether the recipient owns the agent; thread scrolled to newest |

### New — a real gap; mint it (own row, tests, spec + parity)

| Kind | Trigger | Audience | GitHub counterpart | Door |
|---|---|---|---|---|
| `work.taken` | a Contributor claims an open item (standing dispatch **or** a manual reserve) | poster · owner −taker | Issue assigned | Project page → item row (status "taken by X — in progress") |
| `project.commissioned` *(candidate — verify)* | an agent is commissioned to a project **as a role**, and the agent's owner is a **different** tenant | that owner | Added as a collaborator | The project page you were added to |

`project.commissioned` is a candidate: its row's design step must first confirm
cross-tenant commissioning produces a notifiable recipient distinct from the actor,
and that minting after the grant keeps the leak-wall (the recipient gains access, so
may see the project). If the act is same-tenant-only, the row moves to Rejected with
that finding recorded — no speculative bell.

### Deferred / Rejected — imagined, deliberately not built

- **New-watcher / new-fork-count / credit milestone** — *vanity counters*. The parity
  ledger already rejected stars/reactions on the same grounds; the platform's signal
  is *earned* (credit, forks) or *consequential* (watch, mention), not applause.
- **Your standing commission acted** (your bot took/resolved unprompted) — *noise*:
  you configured it to run without you; a bell on every autonomous act inverts that.
  A **failure** signal might earn a bell later (GitHub Actions notifies on failed
  runs) — v2, not now.
- **Upstream published a new version** of an agent you forked/proposed against
  ("your fork is behind" / "your proposal is now stale") — *enrichment*. The stale
  flag already shows in the review dialog; a push bell is a later refinement.
- **README changed on a project you watch** — GitHub doesn't bell this; low signal.
- **Peer credential minted/revoked (D28)**, **delegated-cognition session
  connected**, **another instance imported your agent (federation)** — admin/edge or
  exploration surfaces; the owner sees these live or they belong to BROKER-EXP.
- **Mention inside a proposal thread** — deliberately **no** fan-out (D29 wall):
  proposal threads are parties-only over a non-public definition; naming a third party
  would leak the proposal's existence.

## Implementation ledger (the loop burns this down)

Each row is a self-contained slice: design → implement → complete locking tests +
spec/ledger rows → self `/code-review` → fix → verify (`typecheck` + `node --test
tests/*.test.ts` + `build` + live app) → commit + push to `main`. A row flips to ✅
only when shipped.

| # | Slice | Ships | Status |
|---|---|---|---|
| R1 | **Focus seam** — `FocusTarget` + controller `pendingFocus`/`consumeFocus` + nav entry points (`openWorkItem`/`openProposal`/`openAgent`) recording history | `src/lib/focusTarget.ts`, controller wiring, `tests/nav.test.ts` (+ focus helper tests) | ☐ |
| R2 | **Contract ids** — `workItemId?`/`proposalId?`/`commentId?` on `AppNotification`; populate at every mint site (public-face) | `contract/notifications.ts`, `server/store.ts`, `tests/notifications.test.ts` (3 R2 tests) | ✅ |
| R3 | **Exhaustive door switch** — `doorFor(n): NavIntent` with `never` default; panel routes through it; the every-kind-has-a-door test | `NotificationsPanel.tsx`, `tests/notification-doors.test.ts` | ☐ |
| R4 | **Work-item doors live** — project page consumes work-item focus (scroll + highlight + thread expand + comment anchor); route `work.*` + `mentioned` | `SectionView.tsx` (`OpenWorkList`/`WorkItemRow`), `e2e/*`, tests | ☐ |
| R5 | **Proposal doors live** — agent detail / directory consume proposal focus (own→review dialog, proposer→Your proposals; scroll + highlight + thread) | `SectionView.tsx`, tests | ☐ |
| R6 | **Fork door live** — `agent.forked` → source agent detail, card highlighted | `SectionView.tsx`, tests | ☐ |
| R7 | **New `work.taken`** — mint on claim (poster+owner −taker); kind + icon + copy + door (reuses R4); leak-wall | `contract/notifications.ts`, `server/store.ts`, `NotificationsPanel.tsx`, `tests/*`, spec + parity rows | ☐ |
| R8 | **`project.commissioned`** — verify the cross-tenant act; build the bell + project-page door, or record Rejected with the finding | as R7, or a Rejected note here | ☐ |
| R9 | **Close** — full verify + `/code-review` sweep across the whole diff; fix; finalize spec ledger + `docs/github-parity.md` note + this doc's status; final commit | verify + docs | ☐ |

### Termination condition (checkable, lives in the repo)

The loop stops when **all** hold:
1. Every `NotificationKind` resolves to a concrete door — the exhaustive switch
   compiles and `tests/notification-doors.test.ts` passes for every kind.
2. Every built row R1–R9 is ✅ with locking tests + a spec row.
3. The imagined-but-not-built set above is recorded with its rationale (done).

Re-open only by adding a `New` row with a concrete, leak-wall-clearing rationale.
