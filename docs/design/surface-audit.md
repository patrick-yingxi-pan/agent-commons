# Surface audit — the living refinement backlog

> Applies the method in [`surface-from-nature.md`](surface-from-nature.md) across every
> core entity: a 15-entity fan-out characterized each thing's nature, judged the
> surface fit, and proposed refinements; a synthesis pass ranked them and an
> **adversarial critic** challenged each (rejecting gold-plating and tuned-surface
> rewrites). This is the backlog the redesign loop burns down — one item per iteration,
> each shipped with the full design → test → self-review → verify → commit rhythm, a row
> flipping to ✅ only when it lands with a locking test.
>
> **The bar** (from the method + the critic): build only a genuine nature↔form mismatch
> the **backend already supports** (a pure *reveal* of stored fields beats a new
> feature; never surface invented data — mock-by-design); never gratuitously rewrite a
> well-tuned surface; compose with the locked decisions (one shared entity page gated on
> `own`; parallel controls share one primitive; light-theme-only). New **Timeline /
> Diff / RefLink** forms become **shared primitives** the first time two entities need
> them.

## Themes (the cross-cutting shapes)

1. **Diff — a change belongs in a diff, not prose.** The proposal's side-by-side field
   diff (`SectionView.tsx`, `ProposalsReviewDialog`) is already well-tuned. Extract it
   as the shared **`FieldDiff`** primitive and reuse it verbatim where a change is shown
   as prose today: the proposer's own "Your proposals" (note-only — they can't see their
   own change) and the content-bearing relation-consent cards (README / instructions /
   prompt bodies approved **blind**). *The critic's steer: this is the primitive worth
   extracting first — concrete and immediately reused — not a speculative universal
   Timeline.*
2. **Timeline — a lifecycle wants an interleaved event-list.** Several entities (the
   proposal's terminal state, the work-item transitions, the changelog, the commission
   track record) share the shape of "typed events in time." Introduce a **`Timeline`**
   primitive *only when a second consumer genuinely needs it* — start by revealing the
   terminal lifecycle events inline; don't reshape a tuned thread speculatively.
3. **RefLink — a relation is a navigable link, not a dead label.** Bylines and lineage
   refs (work-item poster, per-turn author, fork/import source, the profile's "authored"
   line, the audit actor) should route through the one existing profile door
   (`openOwner` / `rel.navigate('agents', owner)` / `a2aAgentCardUrl`), not inert text.
4. **Reveal what's already stamped.** The safest, highest-yield shape is surfacing
   fields the backend already carries (`o.note`, `postedAt`/`resolvedAt`/`retractedAt`,
   `agent.changelog[]`, per-turn `agentId`, `artifact.meta`, `forkedFrom.version`,
   `importedFrom.url`) — several fix a *drift* where the same entity shows richer info on
   a lesser surface than on its canonical one.

## Backlog (ranked, critic-vetted)

| # | Item | Entity | Nature→form mismatch | Primitive | Impact | Effort | Status |
|---|---|---|---|---|---|---|---|
| S1 | **Unify the change-proposal onto one diff+lifecycle surface** — extracted the tuned diff as the shared `ProposalFieldDiff`; gave the proposer's "Your proposals" the current-vs-proposed diff (couldn't see their own change before); revealed `resolvedAt` on the terminal state in both surfaces. Merge/Decline stay owner-only; walls intact (diff uses the public entry + already-served `p.fields`). Deferred the speculative thread→timeline reshape (critic's gold-plating call) | Change proposal (D25, the PR analog) | A PR (change + open→merged/declined lifecycle + negotiation) split into two divergent renderings, proposer couldn't see the diff — breached "one shared entity page, gate on `own`" | **Diff** (`ProposalFieldDiff`) | high | M | ✅ |
| S2 | **Content-bearing consent cards show the body (+ old→new diff)** — a default-collapsed "Review ‹body›" disclosure on the ~5 content ops reveals the proposed text (old→new diff when a current value exists, proposed-alone otherwise — no faked diff); extracted the **shared `TextDiff`** primitive (now used by proposals AND consent cards). Pure reveal of op payloads (no server change); gated to content ops via pure `relationContentPreview` | Relation consent card | A change shown as prose — you approved replacing a public README / private instructions / a prompt body **without seeing the text** | **Diff** (`TextDiff`) | high | M | ✅ |
| S3 | **Reveal the work item's note + lifecycle timestamps** in `WorkItemRow` — `o.note` shown when non-empty; `relativeTime` appended to the status line for posted/done/retracted (guarded for legacy items). Pure reveal of served fields, no backend change | Work item (OpenSubGoal, the issue analog) | A lifecycle (3 stamped transitions) collapsed to a status word with no *when*, and the taker-help prose (`note`) never rendered | Timeline (inline) | medium | S | ✅ |
| S4 | **Surface the changelog on the owner's `AgentCard`** — a `History (N)` reveal (shown regardless of publish state; the badge is published-only, the changelog persists) opens the extracted shared `ChangelogList`, reused verbatim by the visitor detail so they can't drift. Pure reveal of `agent.changelog` | Agent definition + version history | A version badge is a number where an authorship lineage lives; shown to *visitors* but not the owner who authored every version | Timeline (`ChangelogList`) | medium | S | ✅ |
| S5 | **Per-turn author byline when a non-default agent drove the turn** — shared pure `driverByline` resolves `message.agentId` via `useAgents()`; default/absent/unresolvable → "Claude" (ordinary threads byte-unchanged), a non-default worker agent → its own label. Reachability code-traced (D16 hand-off intent → `handoff-agent` op → `setSessionAgent` → route stamps the driver → byline) | Session / conversation thread | `agentId` stamped per turn for D16 hand-off traceability, yet the byline was a hardcoded constant | **RefLink** | low | S | ✅ |
| S6 | **Show `artifact.meta` in the full viewer + gallery card** — the specific descriptor ("functional spec", "1600×900") replaces the generic kind label in the viewer header + adds a card line, via one shared `artifactMetaIsSpecific` guard so gallery-created artifacts (meta = the label) never read "Document · Document". Pure reveal | Artifact | The canonical viewer read *less* specific than the humble side panel — a form-follows-function drift | shared guard (reveal) | medium | S | ✅ |
| S7 | **Reveal fork version + make the import URL a real link** — "Forked from X · v{version}" (pinned baseline, was dropped); `importedFrom.name` is now an `<a href={url}>` (was a dead label, URL buried in a hover). Label kept a verbatim snapshot (no 404-prone deep link); forks stays a count (enumerating would invent data) | Fork / import lineage | A cross-instance provenance relation shown as a dead label; the pinned version dropped | **RefLink** | low | S | ✅ |
| S8 | **Per-commission track record on the standing `ContributorRow`** — "Took N item(s) here · last {time}" (or "Standing · no items taken yet"), from a pure `resolvedByCommission` fold of the project's open work (fetched once per group). Standing commissions only; owner-scoped reveal of already-served `resolvedBy`/`resolvedAt` | Commission / standing dispatch | A capability badge (state word) with none of the acts it produced; the only number is a cross-project total misread as local | Timeline (line) | low | M | ✅ |
| S9 | **Make the profile's "authored" activity line a ref link** — the evolved definition now links to its (other) owner's profile via `rel.navigate('agents', owner)`, matching the posted/resolved project doors. Zero-cost projection add of `owner`+`agentId` (public-face) to `OwnerActivity` | Workspace profile activity (D21) | A parity break: "authored" was inert text while sibling lines were live doors — same weight, different affordance | **RefLink** | medium | M | ✅ |
| S10 | **Expand the D13 contribution count into a per-agent resolved-work track record** — `GET /agents/:id/resolved-work` + `useAgentResolvedWork`, rendered as a "Resolved work (N)" list under `CreditLine` (each project a deep link). **The P8 redaction is the load-bearing wall** (server returns ONLY shared-project resolutions; a private-project resolution never leaks) — locked by a dedicated redaction test; existence-hiding 404 + no tenant id also locked | D13 credit / contributions | A number that is a lineage, beside the changelog rendered *as* a timeline — the "agents as verifiable main players" pillar left implicit | Timeline (list) | medium | M | ✅ |
| S13 | **The work-item bylines are workspace doors** — poster, retractedBy, and the comment author now route through the shared `OwnerLink` (a new `bare` variant, derived from `bylineLabel`) to their profile, like every other byline; `done by {agentLabel}` stays text (an agent, not a workspace). Surfaced by the 2nd completeness pass — Theme #3's "work-item poster" target that S12 wrongly believed already built | Work item byline (D19/D23) | The poster/retractedBy/comment-author were inert text on the canonical work-item surface while every other byline is a door | **RefLink** | medium | S | ✅ |
| S12 | **The changelog author is a workspace door** — wrap `l.author` in the shared `OwnerLink` (→ `rel.navigate('agents', author)`), closing the last workspace-byline parity gap (every other byline — postedBy, resolvedBy, the profile's "authored" line from S9 — is a door). Surfaced by the completeness pass; pure reveal of the already-served `AgentChangelogEntry.author` (resolution guaranteed by the "authored" activity in `store.ownerProfile`) | Agent changelog author (D25) | The lone workspace name in the app rendered as inert text while every sibling is a door | **RefLink** | medium | S | ✅ |
| S15 | **Projects list to single-column rows** — the "Yours" / org / commons bands all stack full-width cards (`space-y-3`; ProjectCard grows `w-full`). A text-led entity list's nature is a scannable, comparable LIST (GitHub's repo-list idiom): the 2-col grid made reading order ambiguous, halved title width, and drifted from the SAME entity's 1-col rendering in Discover and on profiles. **Artifacts deliberately stays a grid** — thumbnail-led browsing is a GALLERY, where multi-column IS the honest form (1→2→3 responsive, 1-col on phones); the diff panes and the frequency chip-grid aren't lists at all. Rule of thumb this row records: columns follow the content's nature — text lists stack, galleries tile | Projects list (the section's three bands) | Same role, two looks: 2-col cards under "Yours" vs 1-col commons cards; Z-scan ambiguity on a comparable list | list (reveal) | medium | S | ✅ |
| S14 | **The work item gets its OWN page with a full timeline** — `WorkItemPage` at `/projects/:id/work/:item` (address parity, spec ADAPT-15): title + status badge (Open/Done/Retracted), provenance meta line (poster door, effect → target, via-A2A stamp, project door), then the timeline — the opening post as the body (GitHub's issue description), every comment, and the terminal transition interleaved in TIME order — plus the same comment composer and Retract funnels the backlog row uses. The backlog row's title is the door (GitHub title-as-link); its inline quick-thread stays as the compact face. The D24 bell now lands here, anchoring the named comment. Completes S3's inline reveal into the full form the method names (spec COMMONS-24) | Work item (OpenSubGoal, the issue analog) | A lifecycle entity with a thread rendered ONLY as a row squeezed into the project sidebar column — the method's canonical "lifecycle wants a dedicated page with a timeline" mismatch | **Timeline** (page) | high | M | ✅ |
| S11 | **Audit log: a Denied filter** — an All · Denied two-state control (reusing the shared `SubTabs`) + counts, so the sharpest signal (a denied outcome) isn't lost as one red dot in a growing ledger; an empty-Denied state reads "every recorded effect was allowed". **Actor-ref-link reclassified/deferred** (finding below) | Audit log (D15) | The sharpest signal (a denied proxy) lost among fulfilled rows | control (reveal) | low | S | ✅ |

Build order roughly follows rank, but respects primitive dependencies: **S1 establishes
`FieldDiff`**, which **S2** reuses; a `ChangelogList` (S4) and the `resolvedBy`
track-record rendering (S8, S10) are shared where they recur. Pure reveals (S3, S6, S7)
can slot in early as low-risk wins.

## Rejected (investigated, deliberately not built)

- **A chronological "Activity" feed on the Project page** (was rank 8) — the critic's
  strongest gold-plating call: the project page is *genuinely well-tuned*, and once S3
  lands each work item carries its own lifecycle where it belongs, so a cross-item feed
  corrects no wrong *form* — it just re-presents the same items re-sorted. Adds a
  surface; "reuses a primitive" is not a reason to build one that isn't needed. Trips
  "don't gratuitously rewrite a well-tuned surface."
- **A deterministic sort for the Discover directory** (was rank 13) — not a nature↔form
  mismatch (the searchable card-index form already fits); a missing sort is a
  consistency nit, and adding ordering semantics brushes locked decision **D17**
  ("ranking is a policy this prototype doesn't take"). Cheapness isn't a reason to adopt
  a policy the prototype deliberately abstains from.
- **A navigable actor ref link on the audit row** (the second half of S11) — investigated
  and deferred. Two findings kill its value: (1) a worker-Agent actor has **no clean nav
  target** — the `AgentDetailDialog` is directory-only (a non-published agent has no
  page), so the link would have nowhere honest to go; (2) audit actors are often
  **users/tenants, not resolvable Agents** (the critic's point), so the link is dead for
  most rows. Threading nav handlers into `AuditTab` for a coarse, rarely-useful link is
  disproportionate to a detective-audit surface whose scope is deliberately minimal (no
  taint graph, no row restructure). The **Denied filter** — the row's real value — shipped.

## Termination — MET (audit complete)

The loop stops when every kept row is ✅ **or** honestly reclassified (built /
rejected-with-finding), and a fresh pass over the method surfaces no new genuine
nature↔form mismatch that clears the bar.

**Reached.** Every row **S1–S13** is ✅; the deferred/rejected set is recorded with
findings above. Termination was earned by **loop-until-dry**, not asserted: after the
S1–S11 backlog shipped, three adversarial completeness passes ran —

- **Pass 1** found **S12** (the changelog author was the last un-doored workspace byline) — shipped.
- **Pass 2** found **S13** (the work-item poster / retractedBy / comment-author bylines were still dead labels — a gap S12 wrongly believed closed) — shipped.
- **Pass 3** returned **empty** — zero candidates, nothing clears the bar. The audit is complete.
- **Pass 4** (a later at-HEAD review, 2026-07) found the claim above had been premature
  in one spot pass 3 missed: the **AgentDetailDialog / ProposeChangeDialog owner
  bylines** rendered as plain `bylineLabel` text — the same parity break S12/S13 were
  filed for, on the one public entity surface. Shipped: both now wear `OwnerLink`
  (close-the-dialog-then-navigate, the resolved-work rows' pattern). A lesson for the
  method: a "returned empty" pass certifies the sweep it ran, not the theme forever.

The method's four families are now satisfied across the app: every **change** renders
as a diff (S1/S2, shared `ProposalFieldDiff`/`TextDiff`); every **lifecycle** carries its
timeline/timestamps rather than a bare state word (S3, S4/S12); every **relation** is a
live ref link, not a dead label (S6, S7, S9, and the exhaustively-closed byline-parity
theme S9/S12/S13 — every workspace-identity byline is a profile door via the shared
`OwnerLink`, while `done by {agent}` correctly stays an agent label); and every **number
that is a lineage** is expanded into its track record (S8 per-commission, S10 D13
per-agent, P8-redacted). Shared primitives earned across the initiative: `TextDiff`,
`ChangelogList`, `driverByline`, `artifactMetaIsSpecific`, `resolvedByCommission`,
`useFocusFlash`, `SubTabs`, `OwnerLink` (+ `bare`).

The **method itself is the durable deliverable** — a standing principle in
[`AGENTS.md`](../../AGENTS.md) + [`surface-from-nature.md`](surface-from-nature.md) that
governs all future UI work, not just these thirteen fixes. Re-open by adding a row with a
concrete, backend-supported nature↔form mismatch that clears the bar.
