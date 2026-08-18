# The agent contribution workflow — version control for work that explains itself

> **Status: design proposal (2026-07-20), owner-reviewed through CW9 +
> foundations + build plan; not yet built.** Rethinks how an agent's
> contribution to a shared Project is tracked, reviewed, and landed — end to end,
> with the UX of every stage designed from the entity's nature
> ([`surface-from-nature.md`](surface-from-nature.md)). GitHub is the reference
> point we borrow from *and* deliberately depart from; each departure names its
> reason. Extends the D-series (notably D11 guardian coordination, D12 clamped
> authority, D14 roles, D16 provenance) and the shipped surfaces S1–S18.

## The one-sentence thesis

GitHub versions **what changed**; an agent platform must version **why it
changed** — because for the first time in the history of version control, the
complete reasoning trace behind every change *actually exists* (the
conversation), and a workflow that throws it away is discarding the most
valuable review, audit, and archaeology signal the system produces.

## Where GitHub's model fits agents — and where it breaks

Borrowed (these survived a century of collaborative-work evolution for a reason):

- **The proposal as a durable negotiation surface** (the PR): change + checks +
  thread + verdict on one page with one address. This is the strongest single
  idea in GitHub and we keep it whole.
- **Append-only public history**; a link as the coordination primitive; the
  title-as-door; capability shapes affordances on one shared page (rules this
  repo already locked).
- **Trust as a social gradient** — roles, track records, and review
  requirements that tighten or relax the gate.

Broken for agents (each break drives a design decision below):

1. **Commits are authored; agent work is *traced*.** A human batches work into
   deliberate snapshots with hand-written messages. An agent's work is already a
   fully-recorded sequence of turns and tool effects — asking the agent to also
   write commits manufactures a *second, lossy* narrative beside the true one.
   → checkpoints are **derived from the trace**, and the trace is the message
   (CW2).
2. **Branches isolate; agents coordinate.** Git resolves conflict *after* the
   work (merge), acceptable when contributors are few and slow. Dozens of
   concurrent agents make after-the-fact conflict the common case. This system
   already chose coordination-*before*-work (D11 sub-goal reservations;
   "conflict is a question, not an abort") → the branch's job is done by the
   **declared Intent** (CW1), and landing is guardian-serialized so project
   history is **linear** — no merge commits (CW6).
3. **Not everything merges.** Git versions the recipe, never the meal
   ([`shared-resource-coordination.md`](../shared-resource-coordination.md)): an
   email sent, a ticket mutated, a charge — no ancestor, no un-send. A workflow
   pretending the whole contribution is branch-and-mergeable lulls exactly where
   it must not. → a contribution's payload is **explicitly two-part**: the
   mergeable changeset and the effectful acts, with different verbs and
   different affordances at every stage (CW3, CW6, CW7).
4. **Force-push destroys review context.** GitHub's answer to revision is
   history rewriting; reviewers lose "what changed since I looked." → revisions
   are **versions of the changeset** with first-class inter-version deltas;
   nothing is ever rewritten (CW4).
5. **Human attention doesn't scale to agent throughput.** Review can't mean "a
   human reads every diff." → review is **tiered by risk × trust × harness** —
   machine checks, adversarial agent review, human consent — and the tier is
   computed, visible, and owner-tightenable (CW5).
6. **Post-hoc review cannot govern irreversible acts.** A PR review judges work
   already done — sound when everything under review is revertible text; unsound
   the moment the contribution includes an act with no undo (an email to an
   external party, a charge, a remote mutation). GitHub has no pre-approval
   primitive at all — the closest analogs (environment protection rules,
   deploy gates) bolt on after CI because the core model never needed them.
   → irreversible effects are **pre-approved at plan time as an envelope**,
   deliberated like a team discussing an action plan; execution later is a
   mechanical envelope match, not a fresh judgment (CW1, CW5, CW6).
7. **Human gates assume human throughput.** Required reviewers, CODEOWNERS,
   approval checkboxes — GitHub's judgment moments are hard-wired to a person
   clicking, which at agent throughput means queues or rubber stamps. And its
   only escape hatch (name a bot as reviewer) records no policy, no reasoning,
   no criteria-revision trail. → every human act here is **delegate-able to an
   agent under a consented, versioned policy prompt**, with structural
   safeguards (separation of duties, mandatory escalation, cooling-window
   rope) and full decision provenance (CW8).

## Foundations — what approval and delegation actually are

The workflow above the fold is mechanism; this section is the theory it stands
on. Getting these two words right changes what the mechanisms are *for*.

**Approval is a bundle of four functions, not a primitive.** An approval act
simultaneously performs: (1) **error-catching** — a second predictor of
consequences; (2) **accountability anchoring** — ownership of consequences
moves to the approver; the signature is a liability instrument, and it is how
acts of non-liable actors (agents cannot bear liability; a track record is
reputation, not responsibility) get connected to a liable principal; (3) the
**boundary ritual** — a forced moment of deliberate attention exactly at the
reversible→irreversible discontinuity, where the friction *is* the function;
(4) **preference revelation** — every approve/reject/amend is a labeled
datapoint of what the principal actually wants, with a rejection carrying more
bits than an approval. These four scale differently: error-catching delegates
freely (machines are better at it); preference revelation cannot be delegated
even in principle — only **pre-paid** (a policy is batched preference
revelation); accountability cannot move to a non-liable entity at all; the
ritual is about attention placement, not about who clicks. Every legacy system
(GitHub included) bundles all four into one button — so delegating the bundle
accidentally delegates the parts that must not move. This design decomposes
them (CW9).

**The observability inversion.** Approval hierarchies, sign-offs, and audit
chains evolved for a world where a delegate's effort and reasoning were
*unobservable* — the classic principal-agent problem is defined by information
asymmetry, and the machinery compensates for it. Agent systems invert the
premise: the trace records every reasoning step; observability is total and
**attention** is what's scarce. Most inherited approval machinery therefore
compensates for a scarcity we no longer have while ignoring the one we do.
The design consequence: strip approval down to the functions that were never
about observability — liability anchoring and preference revelation — and let
traces, tiers, and delegates carry the rest.

**Delegation is a cache of judgment.** A principal cannot transmit their full
preference function (tacit, unbounded, context-dependent); a delegation
instrument is a **lossy compression** of it, and delegation quality is
compression fidelity on the distribution of cases that actually arrives.
Corollaries: escalation triggers are the compression's *confessed blind spots*
("out of distribution → return to source"), so a delegation claiming no
escalation conditions is claiming lossless compression of human judgment — a
lie, refused at mint; policy rot is cache invalidation; and since a cache pays
off only on a predictable request distribution, delegation buys throughput
exactly where work is routine, concentrating residual human attention on
novelty — the human's equilibrium role is **handler of distribution shift**.

**The conservation law.** The keystone invariant: **delegation transfers
labor, never liability.** A delegated decision is owned by the delegator as if
made personally. This is precisely what makes universal delegability *safe* —
the incentive to write honest policies and honest escalation triggers is the
retained ownership; if delegation shed responsibility, the rational move would
be to delegate everything to a sacrificial bot. Liability does not dilute
across hops: chains cannot launder it; sub-delegation depth is a legibility
question, never a safety one.

**Trust is a cache too — with a known exploit.** Trust = compressed prediction
from history = permission to skip verification; tiering (CW5) spends trust to
save attention. Its structural failure mode is the con-man pattern: build
trust on routine, spend it on one exceptional act (an agent farms benign
Tier-0 landings, then fires the exploit). Since history never bounds the
future, **trust must never buy past the risk floor** — the floor is held by
structure (envelopes, harnesses, role gates), not by reputation. CW5's floor
rule is this, stated as arithmetic.

**The human click is the least auditable act in the system.** Every agent act
carries a reasoning trace; a human "Approve" carries nothing — no evidence of
attention, no reason. A *delegated* approval is more auditable than a manual
one. The repair is not surveillance but **evidence-carrying approvals** (CW9):
attention receipts recorded passively and reasons captured cheaply, with the
*precedent weight* of a decision scaling with its evidence — protection and
compounding value for the approver, not obligation.

**In a commons, the click is the residue — deliberation is the substance.**
Approval language implies hierarchy; a commons of peers needs *consent of the
affected*. The envelope thread (CW1) is not preamble to the approval — it is
where plans become **common knowledge** among contributors, which is what
actually prevents substantive collision; the Guardian's reservation only
prevents overlap. A system that optimizes gate latency while skipping
deliberation produces *permission without coordination*. The success metric
for the approval surface is common-knowledge formation, not click speed.

These foundations retroactively explain the mechanism choices — pre-approval
(CW1) weakens exactly two of the four functions (instance-level error-catching
and the per-act ritual), and the harness ladder (CW5) is precisely the repair
kit for those two: escrow restores instance-level error-catching, cooling
windows restore the boundary ritual. The lens carves at a joint.

## The lifecycle at a glance

```
 declare & pre-approve    work          crystallize     verify        judge          land            watch
┌───────────────┐    ┌──────────┐    ┌───────────┐   ┌────────┐   ┌──────────┐   ┌─────────┐   ┌───────────┐
│ INTENT + PLAN │ →  │  TRACE   │ →  │ CHANGESET │ → │ CHECKS │ → │  REVIEW  │ → │ LANDING │ → │ AFTERMATH │
│(reserve scope;│    │(session  │    │ (diff +   │   │(locks, │   │(tiered:  │   │(merge + │   │(reverts,  │
│ deliberate +  │    │ turns +  │    │  effects  │   │ tests) │   │ machine/ │   │ execute │   │ amends,   │
│ approve the   │    │ checkpts,│    │  vs the   │   │        │   │ agent/   │   │ within  │   │ effect    │
│ effect        │    │ inside a │    │  envelope,│   │        │   │ human)   │   │ envelope│   │ audit)    │
│ envelope)     │    │ harness) │    │  vN)      │   │        │   │          │   │ — once) │   │           │
└───────────────┘    └──────────┘    └───────────┘   └────────┘   └──────────┘   └─────────┘   └───────────┘
     ↑___________________|________________|______________|____________|              │
     a failed check, a review finding, or an act OUTSIDE the approved                ▼
     envelope reopens WORK / DELIBERATION — the loop is part of the           project ledger
     record (new checkpoints → changeset vN+1 → delta)                        (linear history of
                                                                               landed changesets)
```

**The load-bearing timing rule:** human judgment attaches to each stage at the
*earliest moment that can bind it*. For mergeable changes that moment is the
landing (a diff is fully inspectable and revertible, so post-work review is
honest). For **irreversible external effects it is the plan** — an act with no
undo must be approved *before* it can happen, not reviewed after; what remains
at execution time is a **mechanical match against the pre-approved envelope**,
never a fresh judgment call (CW1). This is a team's natural shape — you discuss
the action plan before acting, and you review the writing after drafting.

One first-class entity — the **Contribution** — carries a contribution from
intent to aftermath. It is a *lifecycle* entity whose payload is a *change*
accumulating a *negotiation*: by the surface-from-nature method its canonical
form is a **dedicated page with a timeline** interleaving the diff, the checks,
the thread, and the verdict — the PR pattern, extended fore (intent, trace) and
aft (aftermath). Everything below designs the stations of that page.

---

## CW1 — Declare before doing: the Intent replaces the branch and carries the pre-approved plan

**Decision.** A contribution begins with a **declared Intent**: the agent states
*what it will do* and *what scope it claims* (files, entities, sub-goals) before
work starts. The Intent is the existing D11 sub-goal reservation, promoted to a
visible, first-class lifecycle stage — TTL-leased at the Guardian, conflict-
checked at declare time. Overlapping scope is refused as a **question**
("‹other› is already on this — narrow, wait, or coordinate?"), never a silent
fork that collides at merge time.

**Sub-decision — the effect envelope: approval before action, not review
after.** When the planned work includes irreversible/external effects, the
Intent must carry an **effect envelope**: a typed, bounded declaration of every
external act the plan may need — kind, target, cardinality, and the harness it
will run under (CW5) — e.g. *"send ≤1 email · to ‹partner@ext.example› · re:
launch timeline · via draft-escrow"*. The envelope must be **approved before
any effect can fire** (before work starts in the simple case; an envelope can
also be added mid-work when the agent discovers a need — work pauses on the
effectful path until the amendment is approved). Approval mints the envelope as
a **scoped, revocable standing grant** — exactly the PD50 standing-approval
shape, TTL-bound to the Intent's lease: *approved once, then the matching acts
run unprompted, withdrawable at any time*. At execution the Guardian checks the
concrete act against the envelope **mechanically** — target ∈ approved set,
count within cardinality, harness honored; a matching act proceeds without
re-prompting, a deviating act is refused and **reopens deliberation** (never
silently widened, never silently dropped). Depending on trust (CW5), the
approver may keep a *content-confirm* residue in the envelope ("show me the
drafted email before release") — but that residue is a term of the envelope the
agent knows up front, not a surprise gate at the end.

**UX — the plan is a discussion before it is a permission.** An Intent with an
effect envelope opens as a **deliberation thread** on the Intent card — the
team-discussing-the-action-plan moment, given a surface: the envelope renders
as consent-card-shaped rows (one per act kind, blast radius stated plainly),
stakeholders comment, and — the key affordance — **counter-propose amendments**
to the envelope itself ("2 recipients → 1; add draft-escrow"), which the agent
accepts or argues in-thread. Approval is role-gated (D14: who may approve is
what the role lattice already answers) and the approve act stamps the envelope
version it approved. The whole negotiation is ordinary timeline material —
when the Contribution page renders later, its story *begins* with the plan
debate, so a reviewer at landing time reads what was authorized and why before
reading what was built.

**Version-control meaning.** GitHub versions only outputs; this versions the
**authorization** too. The envelope is a first-class, versioned object (v1,
amended-v2, approved-v2 …) with the same append-only discipline as everything
else — so "what exactly was this agent allowed to do, who granted it, and what
did it actually do under the grant" is one page, not an archaeology dig across
chat logs and audit rows.

**UX — the In-flight board.** The project page gains an **In flight** strip
(sibling of Open work): one card per live Intent — who (agent byline → its
page), what (the declared goal), the claimed scope as chips, lease freshness
("started 12m ago · lease renews in 48m"), and a live pulse (turns/effects
ticking, from the trace). The card **is a door into the live session**
(read-only for other contributors, clamped by the session owner's visibility
choice). A work item being worked shows "in flight — ‹agent›" with the same
door, so an issue's taker is one click from *watching the work happen* —
GitHub's assignee tells you who; the Intent card shows you *the work, live*.

**Version-control meaning.** The Intent is the branch-name analog made
semantic: instead of `fix-auth-2`, a machine-checkable claim over scope, with a
lease so abandonment self-heals (TTL lapse frees the scope; the card fades to
"lapsed" rather than vanishing — history is append-only from the very first
stage).

**Rejected.** Optimistic branching (work first, discover conflict at merge):
re-imports the shared-prefix assumption D11 demolished, and at agent
concurrency the *common* case becomes wasted duplicate work. Silent
reservations (today's form — held but invisible): coordination the other
contributors can't *see* invites exactly the thrash it exists to prevent.
Landing-time effect consent (the first draft of this very design): positions
human judgment where it can only rubber-stamp or waste the work — by landing
time the tokens are spent and the momentum is toward "approve"; judgment
belongs where it can still shape the plan. Per-act prompting with no envelope
(today's one-shot consent cards, applied to a busy commons): every act a
fresh interrupt neither scales nor builds a record of *what was authorized* as
a coherent grant.

## CW2 — The trace is the commit message: checkpoints are derived, not authored

**Decision.** During work, the system — not the agent — cuts **checkpoints**:
micro-versions of the workspace at semantic boundaries (a tool-effect batch, a
consent grant, an escalation). Each checkpoint records the diff since the last
one *and the turn span that produced it*. The narrative of the contribution is
the **trace itself** — turns ↔ checkpoints are linked both ways, so "why does
this hunk exist" always has a real answer, not a reconstructed one.

**UX — the trace rail.** Inside the session (the contributor's own view) a thin
**checkpoint rail** marks the thread: "cp3 · 4 files · turn 12–15". Nothing to
write, nothing to stage — the agent works; the record accretes. On the
Contribution page (everyone's view), the trace renders as a **collapsed
timeline segment** — "14 turns, 6 checkpoints, 2 consent grants — expand" —
honoring progressive disclosure: reviewers who need the why drill in; those who
don't aren't buried.

**Version-control meaning.** This inverts git's unit of record. Git: the
snapshot is primary, the reasoning is a message (lossy, optional, often
`"wip"`). Here: the reasoning is primary and snapshots are *derived indexes
into it*. Nothing is lost by not hand-authoring commits, because the full
causal record is strictly richer than any message the agent would have written.

**Rejected.** Agent-authored commits (the GitHub-literal path): manufactures a
second lossy narrative beside the true one, spends tokens narrating instead of
working, and *invites* divergence between what the message says and what the
trace shows. Checkpoint-per-turn (too fine): turns without effects produce
noise; semantic boundaries (effect batches) match how reviewers actually chunk
work.

## CW3 — Crystallization: the Changeset is two-part by construction

**Decision.** When the agent judges the work ready (or the work item's goal is
met), the trace **crystallizes** into a **Changeset**: (a) the **mergeable
diff** — files, instructions, relation-graph ops, artifacts — computed
trace-end vs. trace-start, and (b) the **effect manifest** — the concrete
irreversible/external acts the work now wants to fire, **each stamped with the
envelope line it instantiates** (CW1). An act with no covering envelope line
cannot crystallize — it bounces the contribution back to deliberation for an
envelope amendment, before any reviewer spends attention on an unauthorizable
plan. The two parts are visually and semantically distinct at every later
stage; the system never lets an irreversible act hide inside a diff's visual
idiom.

**UX — the story diff.** The Changeset page's centerpiece departs from GitHub's
file-ordered diff: hunks are **grouped by the intent step that produced them**
(from the checkpoint structure) — "Step 2 · rename the handler — 12 hunks
across 4 files" — because a reviewer reasons over the *story*, and file order
is an accident of the filesystem. A per-file lens remains one toggle away (the
familiar view is a lens, not the default). Hovering any hunk reveals its
provenance — "cp4, turns 12–15" — and clicking opens the trace at that exact
span: **blame that answers *why*, before the change even lands.** The effect
manifest renders as a separate, visually heavier block — each act a
consent-card-shaped row (the S2 pattern: show the body, old→new where it
exists) with its blast radius stated plainly ("sends 1 email to 3 recipients ·
cannot be undone").

**Version-control meaning.** The Changeset is the PR analog, but honest about
its payload: diffs merge; effects execute once. Rendering both under one
"merge" verb (GitHub Actions' deploy-on-merge blur) is the confusion we refuse.

**Timing note — when acts actually fire.** Because judgment happened at plan
time (CW1), an envelope-matched act may fire **the moment the work needs it**
— some effects are inherently mid-work (asking an external party a question
the rest of the work depends on) — guardian-serialized and audited, appearing
in the trace as an ordinary effect event. The manifest at crystallization then
shows both faces honestly: acts **already executed under the envelope** (a
record) and acts **pending, to fire at landing** (a plan). "Hold everything
until landing" is itself a harness the envelope can demand (CW5), not the
built-in default pretending to be a safety property.

**Rejected.** Effects fired mid-work *without* an envelope (today's ad-hoc
one-shot consent, scaled up): the act's authorization lives in a dismissed
card, reconstructible only from audit rows. Forcing every effect to landing
time: breaks inherently-interactive work and adds no safety — the judgment
already happened at the plan; withholding an approved act is scheduling, not
protection. A unified "everything is a change" rendering: precisely the lull
CW3 exists to prevent.

## CW4 — Revision without amnesia: changeset versions and review deltas

**Decision.** A Changeset revises by **versioning** (v1, v2, …), never by
rewriting. Each version pins its checkpoint range; the page offers first-class
**deltas between versions** — and, sharper, **since-your-last-review deltas**
per reviewer. A failed check or a review finding *reopens the work stage*: the
agent resumes the same session, new checkpoints accrue, v(n+1) crystallizes,
and the loop is an ordinary, visible segment of the timeline — "check failed →
resumed → cp7–cp9 → v2 (delta: 2 files)".

**UX.** The timeline shows each version as a node with its delta chip ("v2 · +2
files vs v1"); a reviewer returning to the page lands on **what changed since
they left** (their last-seen version is remembered per principal — the same
per-account memory pattern the split workspace uses), with one tap up to the
full current diff. Review comments anchor to hunks *by content*, so an
unchanged hunk carries its thread forward across versions instead of orphaning
it (GitHub's "outdated" graveyard is the anti-pattern this kills).

**Version-control meaning.** Append-only all the way down: intents, traces,
checkpoints, versions, comments — nothing in the system rewrites history,
because the history *is* the audit trail (PD27) and the training ground for
trust (CW5). Force-push has no analog here on purpose.

**Rejected.** Force-push semantics: destroys the reviewer's frame of reference
and the audit trail in one act. Immutable-but-new-changeset-per-revision (close
a changeset, open another): scatters one negotiation across N pages — the
lifecycle entity is the *contribution*, and its page must hold its whole story.

## CW5 — Review is tiered by risk × trust × harness, and the tier is visible arithmetic

**Decision.** Every judgment moment — the plan approval (CW1) and the landing
review — computes a **tier** from three inputs: **risk** (what the payload
touches — monotonic config vs. guarded scope vs. irreversible effects; the OQ4
static classification), **trust** (the contributor's role (D14) × its track
record here (S8/S10 — landed, reverted, refuted counts)), and **harness** (the
containment the plan commits to run under — below). Risk raises the tier;
trust and harness lower it — a contributor can *substitute containment for
reputation*, which is how a capable newcomer earns real work without a
cold-start wall. The tiers:

- **Tier 0 — checks only.** Monotonic, in-role, no effects: green checks
  auto-land it. Audited, revertible, visible — but no attention demanded.
- **Tier 1 — adversarial agent review.** A *different* agent (different
  provider allowed; refuter-prompted — "find the reason this is wrong") reviews
  the story diff; its findings are ordinary timeline comments with
  confirm/refute verdicts the contributor answers. Green + no confirmed
  findings → lands.
- **Tier 2 — human consent.** Any envelope approval for irreversible effects
  (always — see the floor rule), any out-of-role scope, any Tier-1 confirmed
  finding, or the owner's explicit tightening. At plan time this is the
  deliberation thread's approve act (CW1); at landing time the consent card
  renders **inside the Changeset page** as the landing control itself —
  consent *is* the merge button (the gate and the act are one moment, which is
  exactly the serialization the Guardian already enforces).

**The harness ladder.** A harness is a *structural* containment the plan runs
under — trust you don't have to extend because the mechanism withholds the
blast radius. In escalating strength:

1. **Dry-run** — the act executes against a simulation/sandbox; the output
   (the rendered email, the would-be API call) is previewed, nothing leaves.
2. **Draft-escrow** — the act is fully composed and *held* (the email exists,
   unsent); release is one tap by an approver, who reads the real artifact,
   not a description of it.
3. **Canary** — a bounded first slice fires (1 of N recipients, the cheapest
   variant of the charge); the rest gates on the outcome.
4. **Cooling window** — the act executes on a short delay with a visible
   cancel affordance (send-undo, generalized to every effect kind that can
   tolerate latency).
5. **Hold-until-landing** — all effects deferred to the final serialized
   moment, for work where batching beats interactivity.

The envelope names its harness per act; an approver may demand a stronger one
as an amendment (CW1) — that negotiation is exactly the "which safety measures
before we act" conversation a human team has, given a typed vocabulary.

**The floor rule (harness ≠ blank check).** A harness lowers *how much* trust
an approval needs, never *whether* one is needed: an irreversible external
effect always requires at least one human envelope approval **per envelope**
— where "human" includes a delegate deciding under that human's consented
policy (CW8 relocates the human moment to the policy, never removes it)
— but per envelope is the point: approve "≤5 status emails to ‹list› this
week, draft-escrow" once, and the five sends run unprompted inside it. What
trust and harness together can reach is Tier 0/1 for the *landing* of the
mergeable part, and lighter *residues* inside the envelope (high trust → no
content-confirm; low trust → every draft shown before release).

The computed tier and all three inputs render as a plain-arithmetic chip on
the header — "Tier 1: writer role · 14 landed / 0 reverted here · 1 effect
under draft-escrow" — so the gate is *legible*, never a black box. Owners can
only tighten, never loosen, a computed tier (attenuation discipline, D8's
shape applied to review).

**UX.** The track-record chip is a door (S10's lineage rule) to the
contributor's landed history *on this project*. Tier-0 landings collect in a
digest row ("7 auto-landed today") rather than one card each — attention spent
where the tier says it matters.

**Rejected.** Uniform mandatory human review: doesn't scale past a handful of
agents and *degrades* human attention precisely when it matters (rubber-stamp
habituation is the real risk). Pure auto-merge on green: hands the commons to
the fastest prompt-injection. Reputation-only gating (no role floor): a fresh
account's agent could farm trivial Tier-0 landings to unlock reach — role sets
the floor, record only moves tiers *within* what role admits.

## CW6 — Landing is one act with two verbs; project history is a linear ledger

**Decision.** Landing applies the mergeable diff **and** fires the still-pending
envelope-matched effects (those not already executed mid-work under the
envelope, CW3), guardian-serialized, in one atomic stage. Each pending act is
checked against its envelope line one final time — mechanically, not
judgmentally; a deviation refuses the landing and reopens deliberation. Before
the act, a **pre-flight summary** states both verbs plainly: "merge 12 file
changes + 2 instruction edits · then release 1 escrowed email (irreversible,
approved in the plan)". The project's history
becomes a **linear ledger of landed Changesets** — L1, L2, L3 … — no merge
commits, because parallelism was spent *before* landing (CW1) and landing
itself is serialized at the Guardian (D11). Concurrent-landing races resolve by
auto-rebase: the later changeset re-computes against the new ledger head; a
genuine overlap (rare by construction — scopes were reserved) reopens work with
the conflict *as a question to the agent*, which resolves it in-trace, visibly.

**UX — the ledger.** The project page's third strip: **Recently landed** — one
row per landing: number, title, contributor byline, tier chip, the two-verb
summary, relative time. Each row is a door to the full Contribution page
(trace and all). The ledger *is* the project's version history — scrolling it
reads as the project's story, every entry expandable to its complete why.

**Version-control meaning.** Linear history is a *feature*, not a limitation:
agent parallelism doesn't need DAG topology (coordination happened at intent
time), and a linear ledger is legible to humans and machines in a way a merge
DAG never is. The landing number is the project's version: "as of L47" is a
complete, addressable state reference.

**Rejected.** Merge-commit DAG (GitHub-literal): topology that records *when
isolation ended* is meaningless when isolation was never the mechanism —
reservations were. Effects executing on a timer/deploy hook after merge: splits
the consented moment from the executed moment, exactly what "the consent gate
is the serialization gate" forbids.

## CW7 — Aftermath: the page keeps accruing, and irreversibility is honest

**Decision.** A landed Contribution's page stays live. Reverts and follow-up
fixes **back-link**: reverting L47 mints an ordinary new Contribution whose
payload is the inverse diff, and both pages cross-reference ("reverted by L52"
/ "reverts L47") — a revert is a contribution *about* a contribution, subject
to the same tiers (reverting is not privileged vandalism). For the effectful
part there is no revert: the page instead carries a **compensation note** slot
— "cannot un-send; correction sent in L53" — because pretending effects revert
is the dishonesty the whole two-part design exists to avoid. The effect audit
rows (PD27/PD46) anchor here too: every executed act's fulfilled/denied record
is one hover away from the consent that authorized it.

**UX — asking the history.** On any project entity — a file region, an
instruction line, an artifact — **"why is this here?"** resolves through the
ledger to the landing that introduced it, *and through the landing to the trace
turns that produced it*. Blame stops answering "who, when" and starts answering
"why, and what else was considered" — the reviewer reads the reasoning that
made the change, at the exact span that made it. This is the payoff the whole
design builds toward: **a project whose every line can explain itself.**

**Rejected.** Terminal-state pages (GitHub's merged-PR fossil): the
contribution's consequences (reverts, amendments, effect outcomes) are part of
its story; a page that stops accruing at the verdict tells half of it.
Privileged instant revert: a revert changes shared state like any other change
and earns the same review arithmetic.

## CW8 — Every human act is delegate-able: judgment is itself a contribution

**Decision.** Human attention is the binding constraint of an agent platform,
so **every human act in this workflow — envelope approval, amendment,
escrow release, review verdict, landing consent, revert decision — can be
delegated to an agent**, by the human's explicit consent, under **detailed
instructions**. A **Delegation** is a first-class, versioned entity: *{which
act kinds · over what scope (this project / this envelope pattern / this risk
ceiling) · the policy prompt (the human's judgment criteria, in their words) ·
mandatory escalation triggers · TTL · revocable at a tap}*. The delegate then
exercises the delegator's authority — attenuated, never widened (D8's shape:
a delegation grants ⊆ what the delegator holds; the delegate's own authority
is irrelevant, it acts *as* the principal) — and every delegated act stamps
**both** identities plus the policy version: "approved by ‹Reviewer-bot› for
Ada · delegation #12 v3."

The governing invariant is the Foundations' **conservation law: delegation
transfers labor, never liability.** Every delegated decision is owned by the
delegating human as if made personally — undiluted across sub-delegation hops,
so chains cannot launder accountability and sub-delegation depth is a
legibility question, never a safety one. This is what makes *universal*
delegability safe to offer: the retained ownership is the incentive to write
honest policies and honest escalation triggers. (Its converse names the one
thing delegation can never move: an agent cannot bear liability, so there is
no configuration of this system in which responsibility rests on a non-human —
the question is only *which* human, and the answer is always the delegator.)

This is D15's principle (an agent proxies its owner's resources) applied to
the owner's *judgment*, and PD50's standing approval applied to *deciding*
rather than *doing*. It does not lower the human floor (CW5) — it **relocates
it one level up**: the human judges the **policy** instead of each instance,
which is the same move the envelope already made for effects (judge the class
at the earliest binding moment, let instances match mechanically — here the
"match" is the delegate's judgment under the policy, so the policy prompt is
the envelope of judgment). Somewhere up every decision chain there is always a
human-authored, human-consented text — that invariant is the floor now.

**Three structural safeguards** (not policy suggestions — refusals at the
funnel):

- **Separation of duties.** A delegation can never decide on work its own
  principal chain produced: the contributing agent cannot hold or exercise the
  deciding delegation, and a delegate never rules on an act it performed
  itself. Self-approval is unrepresentable at the funnel, the way over-grants
  are (D8).
- **Mandatory escalation triggers.** Every delegation names the conditions
  under which the delegate must *not* decide and must wake the human —
  uncertainty above a stated bar, out-of-policy shape, stakes above a ceiling.
  An empty escalation set is invalid: a delegation with no path back to its
  human is abdication, not delegation.
- **Delegated release keeps a rope.** When a delegate approves an
  *irreversible* act, a **cooling window** (CW5 harness 4) attaches by default
  — the human's overrule affordance survives the delegation for the window's
  duration. Waivable, but only by the human, explicitly, in the delegation
  text.

**The autonomy ladder — delegation is earned by demonstrated fidelity, not
flipped on.** A Delegation is not a switch but a position on a ladder, per
decision class:

- **L0 — shadow.** The human decides; the delegate decides *in parallel,
  silently*. Nothing changes for the human — but the system accumulates the
  agreement record.
- **L1 — draft.** The delegate's decision + guessed reason are pre-staged;
  the human confirms or corrects with one tap (correcting a guess is far
  cheaper than composing a judgment from scratch).
- **L2 — decide + notify.** The delegate decides; the human gets the
  reasoning receipt, no blocking ask.
- **L3 — decide + ledger.** Visible in the attention ledger and audit only.

Ascent is evidence: promotion is *offered* (never automatic) when the shadow/
draft record supports it — "your delegate matched your decision 9/10 times
over two weeks; here is the one divergence" — so the compression's fidelity
(Foundations) is **measured on your own cases before the compression goes
live**, not asserted by the policy text. Descent is free: one tap, any
escalation trigger, or any distribution-shift signal (novel counterparty, new
effect kind, a policy past its review TTL) drops the class back down. The
irreversibility floor (CW5) caps the ladder: an external irreversible act's
*envelope approval* can climb at most to L2-with-cooling-window — there is
always a rope, and always a human whose rope it is.

1. **The inbox is triaged by "who can decide this."** A human's queue shows
   only what genuinely needs *them* — instances the delegations don't cover
   plus escalations, each escalation carrying the delegate's stated reason
   ("outside policy: recipient not on the approved list"). Everything a
   delegation absorbed collapses into the Tier-0-style digest row ("9 decided
   under your delegations today" — expandable, every row a door).
2. **Policy-from-precedent.** The system drafts a delegation *from the
   human's own decision history*: "you've approved 12 escrowed status emails
   in a row — here's a policy prompt distilled from those decisions; edit and
   consent to delegate this pattern." The human edits the text (it is theirs
   — the prompt is written in the delegator's voice, not generated
   legalese-by-default), then consents. Delegation onboarding becomes a
   *reveal of your own revealed preferences*, not a blank-page prompt-writing
   exam.
3. **Decisions have traces too.** A delegated judgment is an agent act, so it
   has a session behind it — the delegate *reasoned* to its verdict. The
   stamped byline is a door to that trace, exactly as a hunk is a door to the
   turns that produced it (CW2). "Why was this approved?" gets the same
   quality of answer as "why does this line exist?" — the symmetry is the
   point: **contributions and judgments are both work, both traced, both
   accountable.**

**The trust loop closes.** Delegated decisions accrue to a **judgment track
record**, distinct from the contribution track record: a delegate whose
approvals keep getting reverted or overruled loses deciding-trust (its
delegations tighten or its owner is nudged to revise the policy), symmetrical
with how a contributor whose landings keep getting reverted loses landing-trust
(CW5). Judgment quality becomes measurable, improvable, and visible — which is
what "trust based on historical behavior" requires once deciding is also
agent work.

**Version-control meaning.** The full decision provenance chain — *human
policy text (versioned) → delegation (versioned) → delegate's trace →
stamped act* — is append-only and addressable, like everything else here. When
a decision was wrong, the archaeology distinguishes *bad policy* (the human
revises the text; every future instance inherits the fix) from *bad judgment
under good policy* (the delegate's trust drops; the policy stands). GitHub's
analog — CODEOWNERS naming a bot — records none of this: no policy text, no
per-decision reasoning, no revision trail for the *criteria*.

**Rejected.** Human-only judgment (the pure form of my first draft): re-creates
the bottleneck this decision exists to break, and at agent throughput it
degrades into rubber-stamping — nominally human, actually worse than a good
policy faithfully applied. Unrestricted delegation (no escalation floor, no
separation of duties): the contributing system approving itself is the
textbook failure; refusing it structurally is what keeps "delegate-able" from
meaning "unaccountable." Implicit delegation (the system infers consent from
inaction — auto-approve after N days): consent must be an act, not a timeout;
silence is attention exhausted, not judgment given.

## CW9 — Fluency: the formality is compiled, the conversation is the source

**Decision.** All of the machinery above — envelopes, harnesses, tiers,
policies, receipts — is the system's **bytecode. The human's source language
is conversation**, and compilation runs both ways: a natural-language reply
compiles into the formal act ("fine, but only one email, and show me the
draft first" *is* the envelope amendment — rendered back as the formal rows
for one confirming tap), and every formal object renders as plain sentences
with doors to its receipts. The human never fills an envelope form, never
writes a policy on a settings page, never learns the vocabulary — they talk,
decide, and correct, exactly as they would with a human team, and the
paperwork assembles itself around the talk. Three sub-decisions carry it:

**(a) Asks are function-labeled, and the UI takes the function's shape.**
Everything needing a human converges on the one triaged inbox (CW8), and each
ask *names which approval function it serves* (Foundations) — because the
four functions want four different interfaces, and serving them one generic
modal is how attention gets wasted:

- a **liability** ask leads with the ownership statement — "you become
  responsible for: 1 email to ‹partner@ext.example›" — one sentence, the
  detail behind a door; reading 400 diff lines was never what this function
  needed;
- a **preference** ask arrives as the delegate's guess — decision + reason
  pre-staged (L1) — because a correction is cheaper than a composition and a
  *confirmed* guess is high-grade preference data;
- a **ritual** ask carries *substantive* friction, never ceremony: the
  release control for an escrowed email sits at the end of the draft — the
  reading is the friction — and cooling windows tick visibly; there is no
  "are you sure" dialog anywhere in this design;
- an **error-catching** ask should usually not reach a human at all — its
  presence in the inbox is itself a signal the tier arithmetic wants tuning.

**(b) Human decisions are evidence-carrying — voluntarily, and it compounds.**
Every human decision can carry **evidence**: an *attention receipt* recorded
passively (the approver opened the escrowed draft; scrolled the diff) and a
*reason* captured by the confirm-the-guess pattern above. Evidence is never
demanded — but **precedent weight scales with it**: policy-from-precedent
(CW8) drafts from reasoned decisions with confidence and from bare clicks
weakly, so the human who explains occasionally finds their delegate learning
faster — compounding, not compliance. The receipt also protects the approver:
"approved v2, having read the draft" is a stronger instrument than an
unwitnessed click, in exactly the way a signed-and-witnessed document is.
(This answers the Foundations' inversion — the human click was the least
auditable act in the system; now it is as evidence-bearing as the human
chooses to make it, and the system's honesty about *approval theater* is
mechanical: ceremony and attention are distinguishable in the record.)

**(c) The attention ledger — interrupts justify themselves.** Human attention
is metered and displayed the way tokens are (the D8 move applied to the truly
scarce resource): per project and per person — "this week: 14 asks · ~22 min
· 60% matched a pattern a policy could hold." The system carries the burden
of proof for every interrupt (each ask shows *why it needs you*: which
function, why this tier, what's blocked), and it proposes its own
optimizations from the ledger ("these 8 look policy-shaped — want the
draft?"). The success metric is not gate latency but the trend of the ledger:
**attention receding from the routine and concentrating on the novel** — the
Foundations' equilibrium, made visible and steerable.

**Rejected.** Settings-page governance (author envelopes/policies in forms):
a second authoring surface that drifts from the conversational one, and a
formality tax that would make the safety machinery feel like bureaucracy —
the failure mode where users route around their own protections. Mandatory
reasons (a "why" field on every decision): turns preference revelation into
unpaid labeling work and poisons the signal with resentful boilerplate;
reasons must be cheap, guessed, optional, and compounding. Ceremony friction
(confirmation stacking): habituates away exactly the attention the ritual
function exists to summon — the design's rule is *friction lives in the
substance or not at all*.

---

## The surfaces, summarized (what a builder would build)

| Stage | Surface | Form (per surface-from-nature) |
|---|---|---|
| Intent + plan | **In flight** strip on the project page; card = live door into the session; effect envelope as a deliberation thread with amend/approve acts | state chips + live gauge + door; negotiation thread + consent rows |
| Trace | checkpoint rail in-session; collapsed trace segment on the Contribution page | timeline (foldable) |
| Changeset | the **Contribution page** `/projects/:id/changes/:n` — story diff (intent-grouped hunks, provenance hover), effect manifest block | page + diff + timeline |
| Checks | check rows in the timeline, output expandable, failure → implicated hunk | log lines in the timeline |
| Review | tier chip (visible arithmetic), adversarial-agent findings as verdict-carrying comments, consent card embedded as the landing control | thread + chip + consent card |
| Landing | pre-flight two-verb summary; the **Recently landed** ledger strip | act + ledger rows |
| Aftermath | accruing back-links (reverted-by / amends), compensation notes, effect audit anchors; "why is this here?" from any entity | ref links + timeline continuation |
| Delegation (cross-stage) | account-level **Delegations** registry (one home, like Models/Agents); the triaged attention inbox + delegated-decision digest; policy-from-precedent drafting; the autonomy ladder with shadow-mode fidelity reports; delegated bylines as doors to the decision trace | registry + inbox + versioned policy doc + ladder gauge + trace door |
| Fluency (cross-stage) | function-labeled asks (ownership statement / pre-staged guess / substantive friction); conversational compilation of envelopes + policies with formal rows rendered back for one tap; attention receipts; the per-project **attention ledger** with self-proposed optimizations | compiled consent rows + receipts + meter (CW9) |

Every piece composes with the locked rules: one canonical URL per page
(ADAPT-15), one shared entity page gated on capability, timeline/diff/ref-link
as shared primitives (`TextDiff`/`ProposalFieldDiff` grow into the story diff;
the S14 work-item timeline is the Contribution timeline's sibling), the
consent-card funnel unchanged (it *relocates* into the page; the wire shape and
the D8/D12/D14 clamps are untouched), and the Guardian stays the one
arbitration point (Intents are its reservations, landings its serialized
writes).

## What exists today vs. what is new

| Piece | Today | Under this design |
|---|---|---|
| Sub-goal reservation | held at the Guardian, invisible to peers | promoted to the visible Intent card (CW1) |
| Standing approvals | PD50: scoped, revocable, pre-authorized grants for schedules | generalized into the effect envelope — a deliberated, versioned, TTL'd grant per contribution (CW1) |
| Effect consent | one-shot cards at act time, per act | plan-time envelope approval + mechanical match at act time; harness ladder (CW1, CW5) |
| Session provenance | per-turn `agentId` stamps (D16) | trace ↔ checkpoint bidirectional links (CW2) |
| Change review | agent-definition proposals with field diffs (S1); relation ops as one-shot consent cards | the two-part Changeset + story diff for *project* contributions (CW3) |
| Revision | n/a (proposals are single-shot) | changeset versions + review deltas (CW4) |
| Review gating | owner consent on every mutation card | tiered risk × trust × harness arithmetic (CW5) |
| History | audit log (flat, detective) | the linear landing ledger, every entry tracing to its why (CW6) |
| Revert | n/a | contributions-about-contributions + compensation notes (CW7) |
| Delegated judgment | D15 agent-as-proxy (for resources); D16 per-turn provenance | the Delegation entity — proxying the owner's *judgment* under a versioned policy prompt, dual-stamped acts, judgment track record, the autonomy ladder (CW8) |
| Human decisions | a bare click, unrecorded reasoning | evidence-carrying: attention receipts + confirm-the-guess reasons, precedent weight scaling with evidence (CW9) |
| Governance authoring | dialogs + registry forms | compiled from conversation; formal objects render back as sentences + receipts (CW9) |

## Honest residue

- **Trace privacy vs. review depth.** The trace may contain context the
  contributor's owner wouldn't share project-wide (other attached contexts,
  private data read under the agent's own authority). Default: the trace
  segments visible on the Contribution page are those produced *under the
  commission's clamped authority* (D12 already bounds what could have been
  read); anything else is redacted-with-a-count, honest about its absence.
  The exact redaction boundary needs its own pass before build.
- **Checkpoint boundary quality.** "Semantic boundary = tool-effect batch" is a
  heuristic; bad chunking degrades the story diff to noise. Mitigation: the
  crystallization step may *re-group* hunks (it has the whole trace); grouping
  quality should be judged in the running app before the heuristic is locked.
- **Adversarial-review economics.** Tier-1 review spends someone's tokens
  (D13 owner-pays): whose? Natural answer — the *project* names a reviewing
  agent whose owner donates review compute the way contributors donate work
  compute; but this touches D13's economics and deserves explicit sign-off.
- **Envelope specificity vs. approving the unseen.** A plan-time approval
  authorizes an act whose *content* doesn't exist yet — the email isn't
  written when "send ≤1 email re: launch timeline" is approved. The design's
  answer is the harness ladder (draft-escrow and content-confirm residues put
  the real artifact in front of a human before release), but the *calibration*
  — which risk levels may ever run envelope-only, with no content residue —
  is a policy the platform must set and revisit; too loose re-opens the
  post-hoc hole in pre-approved clothing, too tight collapses back to per-act
  prompting. Related: envelope vocabulary design (kind/target/cardinality) must
  be expressive enough that a *legible* envelope exists for each real effect
  kind — an envelope nobody can read precisely is consent theater.
- **Sub-delegation is deferred (depth 1 in v1).** A delegate re-delegating the
  judgment it holds would need attenuation across a chain (each hop ⊆ the
  last, D8-style) plus chain-aware separation of duties; representable, but
  every hop dilutes the "human policy at the top" floor's legibility. V1:
  delegations are exercised only by the agent they name.
- **Policy rot and sparse ground truth (CW8).** A policy prompt is judgment
  frozen at authoring time — the world drifts, and the prompt doesn't know.
  Escalation triggers catch the out-of-shape cases, but in-shape-yet-wrong
  decisions surface only through overrules and reverts, which are sparse
  signals; the judgment track record will be slow to converge and easy to
  over-read. Periodic policy re-consent (a TTL on the *policy*, not just the
  delegation) is the honest mitigation, and the policy-from-precedent drafter
  should also run in reverse — flagging where recent human decisions diverge
  from the standing policy text.
- **Attention receipts watch the human — handle with care.** The receipt is
  designed as the approver's *own* instrument (evidence that strengthens their
  approval, weight that trains their delegate), but the same record read by a
  project owner is a monitoring surface over a person. V1 boundary: receipts
  are visible to their subject and carried *in aggregate* by the decision's
  precedent weight; per-decision receipt detail is never surfaced to other
  principals. Whether an owner may ever require evidenced approval for a role
  (a "witnessed signature" tier) is a policy fork left open.
- **The preference flywheel is the unpriced asset.** If every human decision
  is labeled data, the per-principal corpus of (situation → judgment, reason)
  pairs becomes the platform's compounding asset — each principal's
  *externalized judgment*, portable in principle across projects and even
  platforms. Who owns it, whether it exports, and whether a delegate trained
  on it may act for the principal elsewhere are product-defining questions
  this design deliberately does not answer yet — flagged because deferring
  them by accident would answer them by default.
- **Cross-project contributions** (one change spanning two projects) are out of
  scope v1 — two ledgers can't atomically co-land without a coordinator above
  both Guardians, which is new machinery (the same reason cross-org sharing is
  deferred, PD65).

## Coda — the co-evolution thesis (what this design is ultimately for)

Every mechanism above serves one claim: **the platform is a playground in
which humans and AI models, each doing the part they are best at, co-evolve a
project toward ever-higher productivity — and co-evolve the *process* itself.**

The division of labor the Foundations derived is the stable equilibrium, not a
transitional arrangement: models do the work, the error-catching, the drafting
of judgments, and the *reflection on the process* (harvesting policies from
precedent, proposing attention optimizations, flagging policy rot); humans do
what cannot move — bear liability, reveal preferences, mark irreversible
boundaries, and handle distribution shift. Neither substitutes for the other;
each side's output is the other side's input.

That closed loop is an **accelerating flywheel**:

```
   human decisions (+ reasons, receipts)          ← the scarce input
        ↓ compile (CW8/CW9)
   better policies, tiers, envelopes              ← judgment, cached
        ↓ delegate (the ladder)
   more agent throughput per unit attention       ← the productivity gain
        ↓ reflect (harvest / ledger / rot-flags)
   sharper asks, arriving only where novel        ← attention refined
        ↓
   human decisions again — fewer, harder, richer  ← the input, upgraded
```

Each revolution makes the next one cheaper: attention withdrawn from the
routine is reinvested in the novel, whose resolutions become the next round of
cached judgment. The workflow (CW1–CW7) is the flywheel's *chassis*; the
delegation and fluency layers (CW8–CW9) are its *bearing* — the part that
determines whether turning it costs friction or returns momentum. And the
version-control discipline throughout — every authorization, policy, decision,
and change versioned and traced — is what lets the process *itself* be
inspected, criticized, and refined like any other artifact in the commons: the
process is a contribution too.

## From design to build — the implementation plan

Phased so every phase lands whole (feature + tests + spec rows, per
`tests/CLAUDE.md`), each usable without the next, ordered by
dependency-then-value. Mock-boundary items (the model seam, content diffing)
are named per phase — mocked *by design*, real interfaces throughout
(`docs/spec/11-mock-boundary.md` gets a row for each).

| Phase | Ships | Key contract / server / UI | Locks |
|---|---|---|---|
| **A — the Contribution spine** | the entity + ledger + page: create-from-session, per-project list, lifecycle events; the **Recently landed** strip; `/projects/:id/changes/:n` (ADAPT-15 round-trip) | `contract/contributions.ts` (`Contribution`, `ContributionEvent`); store slice + routes (tenancy-walled, 404 existence-hiding); `ContributionPage` timeline reusing the S14 work-item timeline shape | lifecycle transitions; URL round-trip; tenancy + redaction; persistence round-trip |
| **B — Intents in flight** | reservations projected as the **In flight** strip; intent card (goal, scope chips, lease freshness) as a door into the live session; lapse → honest faded state | projection route over the Guardian's ledger (`holder` → agent byline via commission); card = door honoring session visibility | strip renders live holds; lapse states; no peer-invisible reservations remain |
| **C — the effect envelope** | typed envelope on the Intent (kind/target/cardinality/harness); the deliberation thread (reuse `WorkItemComment`); role-gated approve + amend-as-counter-proposal; **mechanical match at the effect funnel** (the PD50 generalization); refusal → reopened deliberation | `EffectEnvelope` + versions in `contract/`; approval funnel beside the commission funnel (D8 discipline: over-grant unrepresentable); guardian-side match check | envelope versioning append-only; match/deviate paths; the floor rule (irreversible ⇒ ≥1 human approval per envelope); harness honored |
| **D — crystallization + the story diff** | Changeset v1/v2… with review deltas; mergeable diff via the shared `TextDiff`/`ProposalFieldDiff` primitives, hunks grouped by checkpoint; effect manifest stamped with envelope lines; uncovered act → bounce to deliberation | checkpoint cuts at tool-effect batches (server-side, from the existing turn/effect stream); crystallize route; content-anchored comment threads | version deltas; hunk↔turn bidirectional links; manifest-line coverage; no-force-push (append-only) |
| **E — tiers + landing** | risk × trust × harness arithmetic + the legible chip; Tier-0 auto-land digest; Tier-1 adversarial review as a model-seam intent (mock: canned findings); embedded consent as the landing control; linear ledger numbers; auto-rebase or reopen-as-question | tier computation server-side (OQ4 static table × D14 role × S8/S10 record × harness); landing = guardian-serialized transaction | tier arithmetic table-driven tests; owners tighten-only; floor un-buyable by trust; ledger linearity |
| **F — delegation + the ladder** | the `Delegation` registry entity (policy text, scope, triggers, TTL); L0 shadow records + fidelity report; L1 confirm-the-guess; dual-stamped decisions with trace doors; separation-of-duties + empty-escalation refusal at the funnel; policy-from-precedent drafting (model-seam intent) | registry beside Agents/Models (one home, registries rule); attention inbox triaged by who-can-decide | conservation law (delegator stamped on every act); self-approval unrepresentable; ladder promotion offered-not-automatic; cooling-window rope on delegated irreversibles |
| **G — the fluency layer** | function-labeled asks with per-function shapes (ownership sentence / pre-staged guess / end-of-draft release, no confirm dialogs); passive attention receipts (subject-visible only); the attention ledger + self-proposed optimizations | receipt capture at the consent surfaces; ledger aggregation route; conversational compilation of amendments (model-seam intent) | receipt privacy wall; no bare `confirm()`-style ceremony anywhere (a sweepable funnel rule); ledger math |

Sequencing notes: **A+B are one demonstrable slice** (the project page gains
its pulse: in flight / awaiting review / landed) and touch no consent
machinery — the safe start. **C is the pivot** (the pre-approval thesis lands
here) and must precede D's manifest stamping. **E completes the
contribution-side story**; F and G are each independently valuable after E and
can reorder as implementation evidence changes. Throughout: seed-data worlds
(`server/data/`) gain a mid-flight exemplar project so every stage is
*visible* on first sign-in so every stage remains reviewable.
