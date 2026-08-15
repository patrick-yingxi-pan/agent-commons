# Surface from nature — deriving the right UI from what a thing *is*

> **The method, in one line:** before choosing a control or a layout, ask what the
> thing you're showing fundamentally *is* — its temporal nature, the information it
> carries, the interactions it accumulates over time, and what it relates to — and let
> that nature *dictate* the surface. Form follows function, taken all the way down to
> the entity.
>
> This is a **standing design principle** for this repo (like the locked decisions in
> `src/CLAUDE.md`), not a one-off. Apply it to new features *and* as a lens for finding
> refinement opportunities in existing ones. The running audit + refinement backlog it
> produces lives in [`docs/design/surface-audit.md`](surface-audit.md).

## Why (the failure mode this fixes)

The easy path builds a *primitive* surface: a status word, a flat list, a modal
dialog — whatever is quickest to render the data. That surface is chosen from the
**shape of the data at one instant**, not from the **nature of the thing over its
life**. The result reads as thin: a change proposal shown as a modal loses that it is
a negotiation with a history; a work item shown as "done by X" loses that it was
posted, waited, was taken, and resolved; a fork shown as a number loses that it is a
lineage. The information *is* there in the backend — the surface just fails to honor
what the thing is.

The fix is to design the surface from the entity's nature. Do the thinking first;
the layout falls out of it.

## Step 1 — characterize the thing (four questions)

Ask these of any event or entity before drawing anything:

1. **Temporal nature — is it a moment, a state, or a lifecycle?**
   - *Moment* (a point event that happened): a fork, a login, a payment. → a log line.
   - *State* (a current condition): online/offline, role, budget remaining. → a chip/gauge.
   - *Lifecycle* (a thing that moves through stages and accretes history): an issue, a
     PR, an order, a routine's runs. → a **timeline**.

2. **Payload — what information does it carry?**
   - A *change* to something (before → after): a proposed edit, a version bump. → a **diff**.
   - A *body of prose / a document*: a README, a system prompt, a note. → a document view.
   - A *set of references*: participants, linked items, tags. → linked chips.
   - A *quantity over a domain*: credit, usage, counts by kind. → a chart / meter.

3. **Interaction over time — what does it accumulate?**
   - *Discussion* (a conversation): comments, replies. → a **thread**, interleaved into
     the timeline (not a detached list).
   - *A negotiation with a verdict*: proposal → review → checks → decision. → the
     PR pattern: discussion + checks + a decision act, all on one durable surface.
   - *A ledger of acts by others*: an audit trail, contribution history. → a timeline,
     read-only.

4. **Relations — what does it link to, and what links back to it?**
   - Outbound: "this proposal targets *that* agent"; "this item is on *that* project."
     → a **ref link** (a chip that navigates, ideally with a hover preview).
   - Inbound (back-references): "referenced by", "forked into", "resolved by". → a
   reciprocal entry in the target's timeline ("mentioned in …").

### Resource composition — one nature, two projections

For an account resource, ask one more structural question before drawing either
navigation or content: **is this resource atomic, or does it contain other
independently addressable account resources?** A relation alone does not make a
composite. A session can reference context and be the provenance of an artifact
without containing either; a routine contains its run sessions, and a project
contains its work, artifacts, scoped contexts, routines, changes, sessions and
discussion.

That answer governs two surfaces at once:

- The **left rail is the account-resource forest**. An atomic resource is a leaf.
  A composite resource is a branch with an addressable structural level between
  it and its descendants: **parent → section → canonical resource**. A Project
  therefore discloses About / Contributors / Context / Recent sessions / …
  before any artifact, context, session or discussion row. The parent name opens
  the overview, the section name opens that section's page, and the resource name
  opens its one canonical page. Flattening descendants under the parent erases
  the explanation of how the composite is built.
- The **main page is the honest projection of the selected node**. An atomic
  resource may use the form its payload names. A composite page enumerates all
  of its composing resources, then uses the Project page's shared grammar: one
  `max-w-3xl` reading column, one `FoldSection` vocabulary, bounded definition
  before folded configuration before growing history, and one page-level fold
  scope. Collection roots and hubs solve the same grouped-resource presentation
  problem, so they reuse that page grammar too while keeping the payload form
  named by their contents: projects scan as rows, artifacts preview as synopsis
  rows, and messages read as conversations. An artifact's rich document, email,
  image, slide, or sheet body stays on its canonical page; the index does not
  miniaturize five reading surfaces into five unrelated cards. A visible
  ownership/state/kind band does
  not thereby become a rail place; those partitions remain filters under UI-19.

The dependency-free classification lives in `src/lib/resourceNature.ts`; the
ordered structural pages live in `src/lib/compositeSections.ts`. Keep the rail,
overview, section page, and resource-page projections honest against them;
never infer the ontology from whatever one component happens to render today.

## Step 2 — map nature → form (the vocabulary)

A small, deliberate vocabulary of surfaces. Reach for the one the nature names:

| The thing is… | Its surface is… | In this app |
|---|---|---|
| a durable object with identity | a **dedicated page** (a route/`NavLocation`), never a modal for the primary view | project page, workspace profile |
| a lifecycle + discussion | a **timeline** on that page — state-transition events and comments interleaved chronologically | *target:* work item, change proposal |
| a change (before → after) | a **diff** (side-by-side or unified), *comment-able* when under review | proposal review (partial), version changelog |
| a relationship | a **ref link** — a navigating chip with a preview + a reciprocal back-reference | *target:* fork lineage, "in Project X" |
| a conversation | a **thread**, folded into the entity's timeline | work-item comments, proposal thread |
| a current condition | a **status chip / gauge** | share flag, budget gauge, watch state |
| a point event | a **log line** in a feed | notification row, audit entry |
| a quantity | a **chart / meter** | usage, D13 credit |

Note the escalation: a *modal dialog* is right only for a **transient, focused act**
(confirm, pick, edit-one-field) — never as the canonical home of a thing that has a
lifecycle, a history, or a shareable identity. When you find a lifecycle entity living
in a modal, that is the signal to promote it to a page with a timeline.

## Step 3 — the decision procedure

1. Name the thing and answer the four questions.
2. Read the nature off the answers (moment / state / lifecycle; change / prose / refs /
   quantity; discussion / negotiation / ledger; the links).
3. Pick the surface(s) the nature names from the vocabulary — usually a **composition**
   (a lifecycle entity = a page hosting a timeline that interleaves a thread and, where
   the payload is a change, a diff, with ref-link chips to its relations).
4. Check it against the **anti-patterns** below and the **locked decisions** it must
   compose with.
5. Record the nature→form rationale next to the code (a header comment) and as a row
   in [`surface-audit.md`](surface-audit.md).

## Anti-patterns (the tells that a surface fights its nature)

- **A lifecycle in a modal.** A thing with stages + history + identity crammed into a
  dialog — no route, no back-reference, no timeline. (The change-proposal review dialog
  is the archetype: a PR shown as a modal.)
- **A state word for a lifecycle.** "done by X" where the story is posted → taken →
  resolved. Show the transitions, not just the terminus.
- **A flat comment list beside the events.** Comments detached from the state changes
  they respond to. Interleave them into one timeline so the conversation reads in
  context.
- **A change shown as prose.** "updated the prompt" instead of the actual before/after.
  If the payload is a change, show the diff.
- **A relation shown as duplicated content or a dead label.** If X references Y, link
  to Y (navigable, with a back-reference on Y), don't inline a copy or print a
  non-clickable name.
- **A number where a lineage lives.** "forked 3 times" with no way to see the forks or
  the ancestor. A lineage is a graph; give at least the ref links.

## Composes with the locked decisions

This principle *extends* the existing ones, it doesn't fight them:

- **Form follows function — parallel controls share one primitive** (`src/CLAUDE.md`). That
  governs *sameness* (two controls doing one job look the same). This governs *fit*
  (the surface matches the thing's nature). Together: pick the right form, then render
  every instance of it through one primitive. A **timeline**, a **diff**, and a
  **ref link** should each become such a shared primitive the first time two entities
  need them.
- **The entity page is the shared surface — capability shapes affordances, not
  location** (`src/CLAUDE.md`). The dedicated-page form here is the same doctrine: owner and
  visitor get *one* page; the timeline/diff/thread render for both; only the *acts*
  (merge, retract, comment) gate on the viewer-relative `own` flag.
- **Progressive disclosure** (`PROPOSAL.md`): a page need not show its whole timeline at
  once; recent events + "show earlier" is the natural fold.

## Worked examples (the targets this method surfaces)

- **Change proposal → a PR page.** Nature: a *lifecycle* (opened → discussed → checked →
  merged/declined) whose *payload is a change* (field diffs) with a *negotiation* thread
  between two parties and a *relation* to the target agent. Form: a **dedicated proposal
  page** (owner and proposer, capability-gated) hosting a **field diff**, a **timeline**
  that interleaves the opened/version/check/verdict events with the comment thread, and
  a ref link to the agent. Today it is a **modal dialog** — the archetypal anti-pattern.
- **Work item → an issue with a timeline.** Nature: a *lifecycle* (posted → taken →
  resolved/retracted) with a *thread* and *relations* (its project, its resolver, any
  `@mention`ed workspace). Form: a row that expands to (or a page that shows) a
  **timeline** interleaving the status transitions with comments, not a single "done by
  X" line beside a flat comment list.
- **Notification → a pointer into a timeline.** Nature: a *moment* that is really a
  *reference* to one entry in another entity's timeline. Form: a **log line** whose door
  lands on that exact entry *in the timeline that gives it context* (this is why routing
  matters, and why the destinations must be timelines — a bell is only as good as the
  surface it opens).
- **Fork → a lineage.** Nature: a *relationship* (this definition descends from that
  one, at version N). Form: **ref links** both ways — "forked from ‹ancestor›" on the
  fork, and the forks reachable from the source — not just a count.

## The one-line test

> If you printed this thing on paper, what would it be — a **receipt** (moment), a
> **form** (state), a **logbook** (timeline), or a **contract redline** (diff)? Build
> the screen that document would be.
