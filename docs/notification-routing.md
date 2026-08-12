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
// src/lib/notificationDoor.ts — "highlight this on arrival"; NOT part of NavLocation.
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

New controller methods, each routing the page into the FOCUSED pane via the
existing `openProject / openOwner / openSection` doors (Phase 6 — every door
is pane-routed; browser Back works off the address bar) **and** setting
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
mint site in `server/store/index.ts` (the item/proposal/comment is in scope there).

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

### New — imagined, then REJECTED after verifying the trigger doesn't exist

Both candidates were investigated at build time (R7/R8) and found to have **no clean
triggering act in the current platform** — so minting a bell for them would be a
speculative notification for an event that can't happen, exactly what the leak-wall
discipline forbids. Recorded here rather than fabricated (the same honesty that
terminated the parity loop).

| Kind | GitHub counterpart | Why rejected (the verified finding) |
|---|---|---|
| `work.taken` | Issue assigned | `OpenSubGoal.status` is only `open \| done \| retracted` — there is **no "taken/in-progress" state**. Dispatch is **atomic**: a standing Contributor takes *and* resolves in one synchronous call (`dispatchOpenSubGoal`), which already fires `work.resolved` ("done by X") — so "taken" and "resolved" are the same moment; a `work.taken` bell would double every `work.resolved`. The guardian `reserveSubGoal` lease is a **transient** coordination primitive keyed by a sub-goal *string*, not a persisted claim on a posted backlog item. And explicit assignment was **already deliberately deferred** (`docs/github-parity.md`: "adds an authority axis the take-model avoids"). A real `work.taken` needs async work-claiming first — a separate feature, out of this initiative's scope. |
| `project.commissioned` | Added as a collaborator | The only cross-tenant commissioning today is **self-service** (workspace B commissions B's *own* agent onto A's project — `clampContributorRole`), where the actor **is** the agent owner, so the recipient equals the actor and is dropped (no bell). The owner-driven case that *would* notify a distinct owner ("A adds B's agent to A's project") is **explicitly a Phase 2 item** (`clampContributorRole` comment; `docs/design/test-plan-coop-lifecycle.md`), not built. No distinct notifiable recipient exists yet. |

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
| R1 | **Routing brain** — `FocusTarget` + `NavIntent` + `doorFor(n): NavIntent` total over `NotificationKind` (`never` default); a runtime `NOTIFICATION_KINDS` array so the switch + tests can enumerate every kind; degrades a legacy row to the page, never a dead click | `src/lib/notificationDoor.ts`, `contract/notifications.ts`, `tests/notification-doors.test.ts` | ✅ |
| R2 | **Contract ids** — `workItemId?`/`proposalId?`/`commentId?` on `AppNotification`; populate at every mint site (public-face) | `contract/notifications.ts`, `server/store/index.ts`, `server/routes/notifications.test.ts` (3 R2 tests) | ✅ |
| R3 | **Panel + controller wiring** — controller `pendingFocus`/`consumeFocus` + nav entry points (`openWorkItem`/`openProposal`/`openAgent`, ownership-resolving the proposal surface) recording history; panel `open(n)` routes through `doorFor` → dispatch (proposals stop being dead clicks) | `useSessionWorkspace.ts`, `NotificationsPanel.tsx`, `App.tsx`; app-verified live (proposal bell → Agents hub); click→navigate→focus e2e lands with R4 | ✅ |
| R4 | **Work-item doors live** — project page consumes work-item focus (scroll + flash highlight + thread expand + comment anchor) via a `FocusContext`; `work.*` + `mentioned` land precisely | `src/lib/focusContext.ts`, `SectionView.tsx` (`WorkItemRow`), `App.tsx`; `e2e/notifications.spec.ts` (work.commented → auto-expanded thread) | ✅ |
| R5 | **Proposal doors — owner side** — the owner's `AgentCard` auto-opens `ProposalsReviewDialog` on the proposal (scroll + highlight); the hub forces the Agents tab | `SectionView.tsx`; `e2e/notifications.spec.ts` (proposal.opened → review dialog on the proposal) | ✅ |
| R5b | **Proposal doors — proposer side** — the owner's profile auto-opens the agent's public detail with "Your proposals" focused on the proposal (merged/declined/commented-to-proposer) | `SectionView.tsx` (`OwnerProfilePage`/`AgentDetailDialog`/`YourProposals`); `e2e/notifications.spec.ts` (proposal.merged → Your-proposals focused) | ✅ |
| R6 | **Fork door live** — `agent.forked` → the source agent's own hub card scrolls + flashes (never the fork — leak-wall); the flash behavior unified into a shared `useFocusFlash` hook (work-item rows + agent cards) | `src/lib/focusContext.ts` (`useFocusFlash`), `SectionView.tsx` (`CommonsCard`/`AgentCard`/`WorkItemRow`); `e2e/notifications.spec.ts` (agent.forked → source card) | ✅ |
| R7 | **New `work.taken`** — investigated; **REJECTED** (no "taken" state; dispatch is atomic so `work.resolved` already covers it; explicit assignment deferred by parity) | finding recorded above | ⊘ rejected |
| R8 | **`project.commissioned`** — investigated; **REJECTED** (the only cross-tenant commissioning is self-service, actor = recipient; the owner-driven case is Phase 2, unbuilt) | finding recorded above | ⊘ rejected |
| R9 | **Close** — adversarial 5-dimension review workflow over the whole diff (10 raised, 4 confirmed after per-finding refutation, **0 high, 0 leak-wall**); all 4 fixed + locked; spec row COMMONS-23 + `docs/github-parity.md` note; full verify | see "R9 — the close" below | ✅ |

### Termination condition (checkable, lives in the repo)

The loop stops when **all** hold:
1. Every `NotificationKind` resolves to a concrete door — the exhaustive switch
   compiles and `tests/notification-doors.test.ts` passes for every kind.
2. Every **built** row (R1–R6) is ✅ with locking tests; the two imagined new-kind
   rows (R7/R8) are resolved — here, ⊘ **rejected** with a verified finding, not built.
3. The imagined-but-not-built set above is recorded with its rationale (done).

The routing initiative's core ask — *every notification jumps to a meaningful page* —
is met: all ten existing `NotificationKind`s land on a precise, tested door, and the
two candidate new kinds were investigated and honestly rejected (their triggers don't
exist yet). Re-open only by adding a `New` row with a concrete, leak-wall-clearing
rationale for an act that actually occurs.

## R9 — the close (adversarial review + fixes)

A 5-dimension review workflow (React-effect/consume-once races, leak-wall/tenant-id,
exhaustiveness/legacy-degrade, test coverage, dead code) swept the whole diff; each
finding was independently **refuted-or-confirmed** by a skeptic pass. **10 raised, 4
confirmed** — all low/medium, **none high, none a crown-jewel/leak-wall violation**
(the confidentiality posture held; the `useAgents()` mis-route race and the
lingering-focus re-assert were among the 6 correctly refuted). All four confirmed
findings were fixed and locked:

1. **(med, coverage)** `work.resolved`'s `workItemId` mint (the standing-dispatch path,
   the only site it's minted) was asserted by no wire test → added the assertion to the
   unprompted-resolution test (`server/routes/notifications.test.ts`).
2. **(low, correctness)** the coarse `agent` degrade routed a *legacy* proposer-side
   `proposal.*` row (no `proposalId`) to the caller's own hub instead of the owner's
   profile → the panel's `agent` door is now ownership-aware (`n.kind` + `iOwn`); a fork
   bell still lands on the hub.
3. **(low, coverage)** the bare-row scroll+flash arm (`work.posted/resolved/retracted`,
   no comment) had no live coverage → the work.posted e2e now asserts the item is on the
   focused page with its thread **collapsed** (the branch distinct from the comment arm).
4. **(low, dead-code)** `commentId` was plumbed into `pendingFocus` on the proposal path
   but no proposal consumer read it → removed (proposal threads render open, so a
   per-comment anchor added nothing; the anchor stays a work-item affordance).

Verification: `typecheck` + `node --test tests/*.test.ts` (890) + `build` + `npx
playwright test e2e/notifications.spec.ts` (5) all green. **Initiative complete.**

## R10 — a bell leaves a way home, and the inbox becomes a place (2026-08-08)

Owner report: *"the back button should honestly link to previous page in
history. In the case the page is opened from notifications, the back button
should link to it as well."*

Every door above landed on the right PLACE and left no way back, because the
notification panel was filed with the rail and the palette under "chrome doors
reset the back stack" (ADAPT-18, GitHub's top-nav rule). The first fix gave the
panel's doors a pushing flavour at the shell — a rule with an exception — so
Back named the page you were reading when the bell rang.

Then the owner asked the better question: *"shouldn't the back button get him to
the notifications page?"* It couldn't, and the reason was the actual defect:
**there was no notifications page.** The inbox was a `fixed inset-0` dialog
opened by a local flag. An overlay has no address, never becomes a pane, and can
therefore never be on the back stack or returned to — so "answer a bell, come
back for the next one" was impossible by construction, and the pushing-doors
machinery had been an elaborate way to paper over the wrong FORM.

So the inbox is now a **section**: `/notifications`, a rail row beside Messages,
a pane of its own, splittable and deep-linkable. Its rows became ordinary
in-page doors routed through the pane bridge (`rel.navigate` + `onFocusHere`),
which means what a bell opens carries the inbox on its back stack through the
one funnel every other in-page door uses — and the shell's notification doors,
the pushing bundle, and the overlay all deleted themselves.

**The generalizable lesson: when a navigation rule needs an exception, suspect
the form of the thing asking for it.** A modal is only for a transient act
(surface-from-nature); triaging a list of entities with state and doors is not
one, which is why Messages had been a page since S7 and this had not.

Locked by `tests/notification-doors.test.ts` (the section is registered, the URL
round-trips, the rows route through the pane bridge, no shell-level notification
door or overlay survives) and walk 4 of `e2e/social-layer.spec.ts`, which rings
Ada, follows the bell to the thread's page, and asserts Back both NAMES and
REACHES **Notifications**. `e2e/notifications.spec.ts`'s five walks drive the
page instead of a dialog; the bell carries `data-testid="notification-bell"`
because it now shares its accessible name with the rail row it opens.

## R11 — a bell is a POINTER at an act, so it dies with the act

*(Owner-reported 2026-08-09.)* Grace's inbox read **"Acme, Inc. replied to your
post"** twice, doored into a thread containing no such reply, and named a party
whose profile said "Ada Lovelace". Three defects behind one row:

1. **A retracted post left its bell standing.** `deleteDiscussionPost` removed
   the post and nothing else, so the inbox went on announcing an act that had
   un-happened, with a door that landed nowhere. `NOTIFICATION_CAP`'s own
   contract already called the inbox *"a pointer cache over acts that remain
   readable … not a second history"* — a pointer at a deleted act is not
   history, it is a false claim. Fixed at the funnel: `retractNotifications`
   is the inverse of `notifyTenants`, and every discussion bell now carries the
   **`postId`** it announces (server-private) so retraction can find exactly its
   own row — `discussionId` would have silenced the thread's survivors too. The
   last delete dissolves the thread and takes every remaining row with it.
2. **The actor NAME had no authority id.** Every other social row pairs a public
   name with the raw id it derives from; the inbox was the exception, so the
   2026-08-09 namespace rename left it speaking the old name one click away from
   the new one. Rows now carry **`actorTenant`**, and `refreshStoredNames`
   re-derives `actor` on load like every other stored public face.
3. **Rows minted before those anchors** still sat in snapshots, unreachable by
   either fix. `retractOrphanedBells` reconciles them at load: a bell whose
   thread is gone, or whose named post is gone, or — for a legacy row — with no
   surviving post at its own timestamp (`notifyTenants` stamps `at` in the same
   tick as the post) is retracted.

**The mistake worth keeping.** The legacy arm first judged a row by whether its
`actor` name still resolved — and swept two *correct* bells out of the owner's
store on first run, because after a rename no legacy name resolves. That is the
staleness this whole change exists to tolerate; it says nothing about whether the
act happened. Locked by `server/persistence/snapshot.test.ts`, which plants a rename-orphaned
bell and requires it to SURVIVE, alongside the orphans that must not.

Locks: `server/routes/posts.test.ts` (retraction takes only its own bell; the last delete
takes the rest; the name re-derives from `actorTenant`), `server/persistence/snapshot.test.ts`
(the load-time sweep, in both directions).
