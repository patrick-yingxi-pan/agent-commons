# The social layer — share, discuss, improve (orthogonal primitives + the Commons portal)

> **Status:** design agreed 2026-07-21 (owner conversation); implementation phased below.
> **Pillar.** Every resource in the system can be **shared**, **discussed**, and
> **improved** with other users — via three orthogonal primitives that compose with
> any entity kind — and surfaces publicly through a **Twitter-like Commons feed**
> whose cards click through to the resource's **GitHub-like entity page**.
> Builds on: the five nouns + relation graph ([`contract/relations.ts`](../../contract/relations.ts)),
> orgs-as-namespaces ([`contract/orgs.ts`](../../contract/orgs.ts)),
> the Contribution landing ledger ([`contract/contributions.ts`](../../contract/contributions.ts)),
> existence-hiding (O-D3), the consent-card pattern, the universal split workspace,
> and the Discover/COMMONS surfaces. Distinct from [P8](P8-agent-commons.md) (the
> *agent* commons — registries/commissions); this is the *human* social layer.

## 1. Design stance

**Three primitives, not N features.** "Social" decomposes into exactly three
orthogonal capabilities, each defined against a generic entity reference — never
against a specific entity kind:

| Primitive | What it is | Best practice learned from |
|---|---|---|
| **Grant** | who can see/do what on a resource | Notion / Drive share tiers |
| **Discussion** | talk anchored *to* a resource | Google Docs comments, GitHub review threads |
| **Proposal** | a typed change *offered* to a resource, landed by consent | GitHub PRs, Figma branching |

**Still three (S7, 2026-08-07).** Adding people to the layer did *not* add a
fourth primitive. A **direct message** is the Discussion primitive with a
`principal` anchor, and **follow** is not a primitive at all — it is a standing
per-viewer relationship, the positive twin of the S5 mute, whose entire payload
is a lens on the feed. If a future "social" feature seems to need a fourth
primitive, that is the signal to check whether it is really one of these three
pointed at a subject the layer hasn't named yet.

**Still three (S8, 2026-08-08).** Neither did the SQUARE. The layer could carry
talk *about a resource* and talk *with a person*, but not talk *to nobody in
particular* — there was no way to simply say something, which is the one
recognizable social affordance it lacked. The answer was not a Post entity but
an anchor already in the union, whose meaning S7 had left refused:

| the anchor is | the wall is | what it is |
|---|---|---|
| a RESOURCE | the resource's | a comment thread |
| ANOTHER person | the pair | a direct message |
| **YOURSELF** | **the square** | **a post** |

So "a tweet" and "a wall post" turned out to be objects this layer already had;
only the third row was missing. Replies, reactions, retract/report, mute, the
`/discussions/:did` permalink and the hand-it-to-Claude hook all came along by
construction. The rule this keeps proving: when a social feature seems to need a
new primitive, first ask which of the three it is, pointed at a subject the
layer hasn't named yet.

Because each primitive takes an `EntityRef`, any primitive × any entity composes
for free: discuss a schedule run, propose an edit to someone's artifact, share a
single session. **The orthogonality test** (hold every review to it): pick any
cell in the 3-primitives × 6-entities matrix at random — "propose against a
schedule", "discuss a grant", "share a discussion" — and it must either work
through the generic path or be an explicitly documented refusal, never an
unhandled case. No primitive's core type may name an entity kind; kind-specific
behavior lives in per-kind **adapters** (anchor resolvers, delta appliers,
resource previews) — the registries-one-home pattern.

**Two moves unique to this system:**

1. **Discussion is itself an entity** — a sixth noun in the relation graph. All
   primitives apply recursively (share a discussion, propose an edit to a post),
   and crucially a discussion can be **attached as a Context to a session** —
   closing the loop only this product can close: *share → discuss → hand the
   debate to Claude → Claude drafts the revision → it returns as a Proposal.*
2. **Social acts are consent-gated proposals** reusing the existing
   confirmation-card pattern for `RelationOp`s. Sharing out, landing a proposal,
   escalating a grant — each renders the same consent card. Social inherits the
   product's existing trust model; no parallel one.

**Invariants extended, not invented:** existence-hiding (a resource you can't
see 404s identically whether absent or denied) applies to grants, discussions,
and proposals; REDACTED wire faces (display names cross tenants, raw ids don't)
apply to all social payloads; INV-9 absence classification for every new field.

## 2. The model

### 2.1 Foundations (Phase 0)

- **`EntityRef`** — one canonical ref for every shareable noun (the five +
  Discussion). Every ref has a canonical URL (entity pages exist already).
- **`Anchor = { ref, locus? }`** — a typed position *inside* an entity: artifact
  range, session turn id, diff hunk, schedule run, graph edge. Per-kind **anchor
  resolvers** (registry) turn a locus into scroll/highlight in the entity's pane.
- **`Audience = principal | org | link-token`** and
  **`Tier = view | comment | propose | co-own`** — tiers strictly ordered; every
  social read/write checks one predicate.

### 2.2 Grant (Phase 1)

- `POST /v1/grants` proposes a grant (consent card); listing + revocation
  symmetric. Org grants reuse membership machinery; link-tokens defer to the
  public phase.
- A grant carries an optional **note** — the publish text (see §4). **INV-9:**
  absent note = share silently (access only, no feed card); present note =
  publish to the audience's feed. The distinction between *giving access* and
  *publishing* is exactly this field.
- **Session sharing is the flagship** (ShareGPT done better): replayable at
  `view`, forkable at `propose` ("continue from turn 12 in your namespace" =
  the Proposal primitive applied to sessions).

### 2.3 Discussion (Phase 2)

- New entity: `Discussion { id, anchor, state: open|resolved, posts[] }`. Posts:
  one-level replies (resist deep nesting), mentions, **reactions** (the one
  lightweight-signal feature, deliberately *inside* Discussion — "endorse a
  resource" = react on its root discussion; one thin reaction set).
- **Visibility rule:** a discussion inherits its anchor's grants by default and
  can be *narrowed* (private review thread on a shared artifact), never widened
  beyond the anchor — comments cannot leak a resource.
- The **root discussion** (anchor with no locus) is the resource's public
  comment thread — the same object projected under the feed card (§4) and on
  the entity page.

### 2.4 Proposal (Phase 3)

- Generalizes the Contribution landing ledger from Projects to any entity:
  `Proposal { anchor, delta, discussionId, state: offered|revised|landed|declined }`.
- `delta` is typed per kind via **delta appliers** (registry): artifact patch,
  relation op, schedule change, session fork-point. The linear ledger (L1, L2, …)
  generalizes — every entity gets a legible improvement history, no merge DAG.
- Every proposal auto-carries a normal Discussion anchored to it (composition,
  not coupling). Landing = consent card to the owner; declines existence-hidden
  from third parties. Fork/remix = a proposal against your own namespace with a
  "derived from" provenance edge in the relation graph.

### 2.5 Ambient layer (Phase 5)

Derived surfaces, not new primitives: person profiles (the D21 org-profile
pattern, showing only what the viewer can already see); notifications derived
from the SSE stream (mentions, grant offers, proposal transitions, replies —
grant offers render inline accept/decline like org invites); guardrails
(report/mute at principal level, owner moderation, router rate limits — needed
the moment strangers interact).

## 3. UI design — no new paradigms

The social layer is the existing machinery applied to new subjects:

- **Social surfaces are panes, not overlays.** A discussion opens as a
  store-backed pane **split beside** the anchored entity (the equal-pages
  model); never a drawer/modal. Modals are only for transient acts, and the only
  transient acts here are consent moments — already the consent card.
- **One canonical page per social entity, viewer-relative** (`own`/tier gates
  affordances, never location). Not-granted renders the same 404 as not-exists.
- **Shared-with-me is a facet, not a silo:** granted resources appear in their
  kind's rail section under the **ownership** facet group (Mine / Shared with
  me / Org) — no parallel "Shared" section.
- **Discussions earn a rail section** (its entries attach to sessions as
  contexts — the stated test for first-class rail presence). Facets: state,
  anchored kind, participation. Proposals do **not** get a section — they
  surface through their target entity and notifications.
- **URLs:** `/d/:id` (discussion), `/commons[/:facet]` in `urlRoutes.ts` with
  round-trip tests. Which post is highlighted is transient focus — out of the
  URL; the discussion page is the addressable unit (no comment permalinks).
- **Back-history:** every cross-surface door (feed card → entity page, anchor
  chip → resource, resource marker → discussion) routes through the pane funnel.
- **Live (UI-12):** all social data through api hooks invalidated by new SSE
  events (`grant.changed`, `discussion.posted`, `proposal.transitioned`) — no
  seed mirrors, no component-state registries.

### 3.1 Minted primitives (each with a funnel lock test)

| Primitive | Role | Reuses |
|---|---|---|
| `SharePanel` + `TierBadge` | the one share surface on every entity page (gated `own`); one ordered tier ramp | consent card, `AddTrigger`, `SectionAction`, `foldHeader` |
| `AnchorChip` + anchor-resolver registry | the ref-link between discussion ↔ resource locus; opens via pane funnel, resolver scrolls/highlights | pane funnel, `BackButton`, `paneHistory` |
| `ReactionCluster` | hover-revealed reactions; picker via the shared popover | `popover.ts`, `useDismissable`, `SECTION_REVEAL` idiom |
| `DeltaView` registry | renders a proposal's delta per kind (diff / op card / before-after / fork chip) | existing diff + op-description forms |
| Discussion timeline page | thread + lifecycle → dedicated page, timeline form | `pageHeader`, `PublicFace`, split workspace |
| `FeedCard` + `ResourcePreview` registry | the Commons post card (§4) | `PublicFace`, `TierBadge`, `ReactionCluster` |

The one genuinely new *interaction*: a hover-revealed comment affordance in the
margin/gutter of anchorable content (the `SECTION_REVEAL` recessive-until-needed
idiom); existing anchors render as small dots that split the discussion pane
open. No inline expanding comment boxes inside artifacts — the pane is the
reading surface.

**Deliberately not built:** per-kind share dialogs, a "Shared" rail silo,
presence cursors, comment permalinks, deep-nested replies, algorithmic ranking.

## 4. The Commons portal (Phase 4) — the Twitter-shaped front

The current UI is a personal resource manager; the Commons is its public face.
The existing Discover card grid **becomes** the Commons (consolidate, don't
proliferate — directory cards were already doors, COMMONS-13).

**The reconciling insight: a "post" is a projection, not a new entity.**

> A feed post = a **share act** + its **note** + the resource's **root Discussion**.

- The grant's note is the tweet text; share-with-note *is* the publish act.
- The comments under the card are the resource's root Discussion — the *same*
  object shown on the entity page. One conversation, two projections; no forked
  comment store, no feed-specific write path.
- Landing-ledger events also surface as feed items ("L3 landed on *Launch
  assets*") — improvement activity gets social visibility for free.
- **Quote/repost** = another grant-with-note by you, embedding the same
  resource, provenance ("via Ada") from the grant chain. No retweet entity.

**The feed surface:** rail section **Commons**, URL `/commons[/:facet]`, facet
groups: kind / audience (my org · public) / activity (new · discussed ·
landed). One chronological column — **no algorithmic ranking** (a work commons,
not an engagement machine; "most discussed this week" is a facet, not a ranker).

**`FeedCard` anatomy:** byline row (`PublicFace` + `TierBadge` + time) → the
share note → the **`ResourcePreview`** embed (per-kind registry: artifact
excerpt/thumb; session → its last 2–3 turns rendered small — a conversation
previewing *as* conversation is this product's native trick; project → name +
ledger stat; schedule → cadence + last run) → action row (`ReactionCluster`,
comment count, propose, share) → top-N root-discussion comments + inline
composer ("view all" opens the discussion pane, not an accordion). The embed's
**title is the door** (title-as-link) → the entity page through the pane
funnel; on the wide tier the page opens **split beside the feed**.

**The entity page as the GitHub-like home** — the existing canonical page,
enriched with sections: content (README) · `PageHeader` + `PublicFace` + share
note (About) · **Discussions** foldable section (root + anchored threads) ·
**Improvements** section (open proposals + landed ledger; titles are doors) ·
**Propose / Continue from here** (Fork) · follow toggle + reactions
(Watch/Star). All viewer-relative on one page.

**Org-commons first, public later.** Ship with audience = my org (auth gate
intact; the six demo accounts seed a believable feed). Truly-public (anonymous
viewing, link-tokens) is a separate later phase — it drags in unauthenticated
rendering through the auth-gate wall, indexing, and moderation-before-strangers.
`FeedCard` and the entity page don't change; only the audience enum grows.

**Watch-for (add to evaluation doc when multi-user grows):** feeds reward
posting; mitigations are structural — publish requires the deliberate note,
facets over ranking, one thin reaction set.

## 5. Implementation backlog (append-only status; a phase is ✅ only when its locking tests pass)

Each phase lands the standard way: contract types (+ INV-9 classification) →
server routes/store/seed (multi-account scenes: Ada shares, Grace comments, one
pending proposal) → UI via hooks/controllers → `tests/` locks + spec-ledger
rows + e2e anchor → `/ui-review` → review → commit → push.

| # | Phase | Slice | Status |
|---|---|---|---|
| S0 | Foundations | `contract/social.ts`: refs, `Anchor`, `Audience`, ordered tiers — locked by `tests/social.test.ts` (tier order/monotonicity, nouns = relations+discussion, kind-generic substrate). Existence-hiding lock lands with S1's routes. | ✅ |
| S1 | Grant | grants CRUD + note field; shared-with-me band; `GrantsPanel`/`TierBadge`; session share (readable at view) | ✅ (SOCIAL-2..5). **Capability face ✅ (2026-07-22, SOCIAL-4b):** the ordered tier is now readable BY THE VIEWER (`GET /social/capability` → `canComment`/`canPropose`), so the UI can shape affordances to the wall. **Lesson earned:** the tier lattice was enforced only on WRITE, so every read-only surface happily offered acts it would refuse — invisible while the only visitor in the demo held `propose`, and glaring the moment a `view` reader met a per-row gutter. A wall with no matching capability face is an invitation to build dead affordances; the two ship together. **The audit found the inverse too:** resolve standing is the opener *or* the anchor owner, but the thread page gated on `mine` alone — so the owner of a discussed resource could resolve a thread from the entity panel and not from the thread's own page. Same root cause (the wire face didn't carry the viewer's standing), opposite symptom: a real capability with no affordance. `Discussion.canResolve` now reports it and `setDiscussionState` enforces the identical helper, so the control and the act are one decision. **Adjudicated:** booleans, not the raw tier — ownership and the legacy everyone-switch confer the same acts without being tiers, so a tier alone would be a second, weaker model of the same question. Lessons earned along the way: existence-hiding beats forbidden on every face (sequential ids are probeable); the flagship faces own unstamped seeds for grants (one seat, two faces — a strict default-tenant check 403'd Ada on her own demo world, found live); seed grants are code-owned and re-ensured on load. **Adjudicated:** consent cards gate CLAUDE-proposed acts — the user's own SharePanel click IS the consent (ShareToggle precedent); a conversational "share this…" model tool is future work alongside the other api-tools. Session-share UI ✅ (2026-07-22) — the title bar's share door. **Adjudicated:** a conversation has no entity page to hang an owner rail off, so the door is CHROME and the roster opens in a popover; what opens is the unchanged generic `GrantsPanel`, so a conversation's tiers, link grants, publish-note semantics and revoke are identical to every other subject's *by construction*. **Adjudicated:** ownership became a viewer-relative `Session.own` on the projection rather than a client-side inference from list membership — the list excludes run sessions, so inferring would have silently dropped the door for them (UI-12: never assert a status a registry owns). **Adjudicated:** the widest tier does NOT confer the door — `co-own` opens the conversation, not its audience configuration; only READ widens. |
| S2 | Discussion | Discussion entity + root-thread rule; `/d/:id`; timeline page; `AnchorChip` + resolvers; gutter affordance; `ReactionCluster`; rail section; discussion-as-Context attach | 🚧 server core ✅ (SOCIAL-6: entity + routes, anchor-inherited walls, root get-or-create, comment tier vs silent view, react-at-view, opener/owner resolve, redaction, recursion — `tests/discussions.test.ts`; persisted + snapshot coverage). **Adjudicated:** visibility strictly INHERITS the anchor (the narrowing option is deferred — a narrower private review thread is better served by a discussion on a *proposal* in S3, keeping S2's rule one sentence). UI slices 1–2 ✅ (`DiscussionsPanel` on the entity page; the Discussions rail section with state facets over `mine=1`; the `/discussions/:did` timeline page — **adjudicated: `/discussions/:did`, not the sketched `/d/:id`** — this app's grammar reserves subview ids under the section name, and a second prefix would be a parallel convention; `AnchorChip` doors both ways; one shared `DiscussionPostList`). Agent hook ✅ ("Discuss with Claude": session + thread-digest first message + open — **adjudicated:** the digest-message form ships the loop now; a first-class Context TYPE for discussions is follow-up, recorded here). **Locus anchors ✅ (SOCIAL-6b, 2026-07-22)** — the flagship surface first: a conversation TURN. The gutter that mints one is hover-revealed and the marker only exists once a thread does, so the app's most sacred surface pays nothing when the feature is unused (GitHub's line gutter). **Adjudicated:** composing is INLINE (a comment's value is being written next to what it's about) but READING is the thread's own `/discussions/:did` page — a discussion is a lifecycle entity and this repo already decided a lifecycle wants a timeline page, so the marker is a door, not an expander. **Adjudicated:** the root-thread rule generalizes to *one public stream per (subject, locus)* — equality, not overlap, since a per-kind notion of "near enough" would break S0's kind-generic substrate. The per-kind resolvers live in ONE registry (`src/lib/anchorLocus.ts`) that is total over the union, so a new locus kind must decide its phrase and its landing in a single edit; kinds whose surfaces host no position yet degrade to a named chip that doors to the entity. **Lesson earned:** a position-landing door must out-rank a surface's default landing — the conversation's open-at-the-bottom scroll silently beat the turn focus, and only the browser walk caught it (the node suites can't see scroll). **Second surface ✅ (2026-07-22)** — a routine's run rows. **Lesson earned:** the focus pipeline had two latent bugs that only a SECOND consumer surfaced, both in the shared `useFocusFlash`: (1) `scrollIntoView` fires once and never recomputes, so a page whose panels resolve progressively grows *above* the target and strands it — the hook now re-asserts on a backoff schedule, correcting only when the target is fully off-screen so it can't fight a user; (2) the settle chain must OUTLIVE the effect that started it, because `consume()` flips the activation false on the next render and an effect-scoped cleanup cancelled every retry (only attempt 0 ever ran). Also: `consume()` must come AFTER the first scroll — consuming first lets a surface with its own default landing (the conversation's scroll-to-bottom) re-assert it and win. Remaining: an artifact line gutter (blocked, see below); `ReactionCluster` popover waits for a second reaction kind. **Why the artifact gutter did NOT come next (2026-07-22):** `artifact-range {from,to}` means LINES, but this prototype's artifact bodies are structured, not linear — `doc` has blocks, `sheet` rows, `slides` slides, `figure` nothing ordered at all (`contract/content.ts`). Mapping a line range onto blocks would make the chip's own phrase ("lines 4–9") a lie, and the one genuinely line-oriented renderer (`ServedText`, real file bytes) needs a served filesystem folder, so it can't be demoed from the seeds. The honest sequence is: give `ArtifactContent` a line-oriented variant (or render served text with a gutter) FIRST, then anchor to it — not bend the locus to fit the surfaces that exist. |
| S3 | Proposal | generalize ledger to any entity; delta appliers + `DeltaView`; review-discussion composition; land/decline consent; session fork + provenance edge | ✅ **S3 complete (2026-08-07)** — server core (SOCIAL-7: `SocialProposal` — named so because D25's agent-change entity owns the bare name — over the seventh noun `proposal`, whose wall canonicalizes to its subject's; delta kinds `suggestion` + `relation-op` (landing runs the real reducer); review thread = a Discussion anchored to the proposal; owner-consent land with monotonic per-subject L#; `tests/proposals.test.ts`, persisted + snapshot coverage). UI ✅ (SOCIAL-7b — offer/land/decline verified cross-account in-app; the seed grant ships at `propose`). **Consolidated (owner-directed, 2026-07-21):** the separate Improvements section is gone — contributions (Phase A–E) and social proposals are two PATHS into ONE landing ledger, so the project page renders one merged **Changes** panel (both composers in its header; rows interleave: in-flight, then landed by L# descending, then declines) and the server derives ONE L# sequence across both landing paths (`nextLandingNumber` — locked by the one-ledger test in `tests/proposals.test.ts`; the contribution page's next-L# preview spans both too, a stale-L1 label found + fixed live). Full data-model absorption (contributions AS a proposal delta kind) stays recorded follow-up — the Phase A–E machinery (envelopes, tiers, delegation) is too load-bearing to fold in a UI pass. **`schedule-patch` ✅ (2026-07-22)** — the second APPLYING kind, so "improve" now means a real change on a second noun. **Adjudicated:** proposable fields are a SUBSET of the patch type, enumerated in the contract so the form and the validator share one list; structural fields stay the owner's own surface. **Lesson earned:** adding the delta exposed that SOCIAL-4's "a grant opens its subject" had only ever been wired for projects and sessions — a shared routine was readable by nobody, which made its whole social surface unreachable. Widening the read then immediately threatened an escalation, since the routine's run/patch/delete routes gated on VISIBILITY; they now gate on ownership. The general rule: when a read wall widens, every write that shared its predicate must be re-examined in the same change. **`artifact-patch` ✅ (2026-08-07)** — the THIRD applying kind and the last one S3 owed, so "improve a resource" finally means changing a document's CONTENT. **Adjudicated — the address is a BLOCK INDEX, not a line range:** §2.4 sketched an "artifact patch" and S2 had already recorded why an `artifact-range {from,to}` is a lie here (these bodies are STRUCTURED — a doc has blocks, a sheet rows, a deck slides, a figure nothing ordered), so rather than bend the surface to fit the locus this takes the address the body actually has. The patchable unit is a block carrying exactly ONE editable string (`docBlockText`, total over `DocBlock` in the contract): `ul`/`code` hold a LIST and `email` a structured header, and a one-line before→after cannot honestly address those — the `PROPOSABLE_SCHEDULE_FIELDS` cut, made once and read by the offer form, the owner's pencil AND the server's validator, so the three can't disagree. **Adjudicated — the fixture stays immutable; edits are an ID-KEYED overlay:** `ARTIFACT_CONTENT` is keyed by FILE NAME and two tenants can own artifacts with the same name, so a name-keyed edit store would write one workspace's revision into another's document — this repo's earned rule is that preference may key on a name while AUTHORITY never may (the S7 same-name signup collision, generalized). The library is then projected PER CALLER over the artifacts that caller can read, so a shared document's audience sees the landed revision and nobody else does. **Adjudicated — one write path, two doors:** landing runs `updateArtifactBlock`, the very mutator the owner's own in-place editor calls; the owner simply needs no consent from themselves. That editor had to be built in the same change, because artifacts had NO write path at all — an artifact was shareable and discussable but not improvable, and `ProposalsPanel` was mounted only on the routine page, so this delta would have shipped with no surface (the "capability with no surface" failure this layer's audits keep finding). **Lessons earned:** (a) the offer FORM was routine-specific while its own doc comment claimed a prose fallback for other kinds — harmless only while a routine was its sole host, and it would have offered "cadence" and "notifyOnFailure" on a document the moment it was mounted; the form is now per-kind, each kind driven by the server's own predicate. (b) `listArtifacts` returns only the SEEDED set — created artifacts live in the relation graph — so both the body-edit route and the form's id→name join silently missed every created artifact until a test and then the walk caught it; resolution now goes through `artifactById` / `allArtifacts` across both homes. (c) **The diff's before-side depends on whether the change still could apply** — found in the running app, not by a test: resolving it live for every state made a proposal's own row re-render as "− X / + X" the instant it landed, a no-op where a change had happened. An OPEN row wants the live base (what landing would replace, so a competing landing moves it); a LANDED row is history and wants the pre-image frozen at the moment it applied. (d) A delta's RENDERING had already been hand-written twice and had drifted — one copy labelled every row "routine change", graph edits and prose suggestions included — so a third kind would have been a third divergence; `components/DeltaView.tsx` is now the one home, exhaustive over `ProposalDelta` so a new kind must decide how a reviewer sees it in the same edit that teaches the server to apply it. Remaining: nothing — S3 is complete. |
| S4 | Commons | feed projection endpoint (share-events + ledger events); `FeedCard` + `ResourcePreview`; `/commons` + facets; Discover consolidation; entity-page enrichment (Discussions/Improvements sections, follow) | 🚧 core ✅ (SOCIAL-8: `GET /commons` — the projection over grants-with-note + landings, per-kind embed faces resolved at serve time, the card's comments = the subject's root thread; the Commons rail section + `FeedCard` with title-as-door into the entity page; verified in-app — the seeded publish renders and doors through; `tests/commons.test.ts` locks silent-grants-out, per-viewer walls, live comment count). Entity-page enrichment already shipped with S2/S3 (Discussion + Improvements sections). Inline comments ✅ (the card renders the root thread's tail + the ONE `RootThreadComposer` shared with the entity panel — a comment posted on the card provably renders on the entity page: one conversation, two projections, verified in-app). Facets ✅ (Shares/Landings — **adjudicated: one partition per section**, per the rail rule; audience/activity become in-page filter chrome if ever needed) and the session embed ✅ (last turns, roles + trim). Artifact embed ✅; follow ✅ (the feed card carries the D24 `WatchButton` for project subjects — follow IS watch where watch machinery exists; other kinds gain it when the watch key generalizes. **Re-examined 2026-07-22 and DEFERRED with a reason:** generalizing the key is easy; the problem is that it would deliver nothing. `watches` is consumed by exactly one call site — `workItemAudience` — so watching means "ring me on work-item activity", and work items are project-only. Discussion bells deliberately exclude watchers (S5: a bell means you are INVOLVED; mere access isn't involvement), and the Commons feed isn't watch-filtered. So a Follow button on a routine or artifact card would be an affordance with no effect — the exact class the capability audit has been removing. Generalize the key when there is a payload to deliver (a watch-filtered feed view, or a per-subject activity bell), not before. Surfacing it found + fixed a latent wall bug: `projectHiddenFrom` hand-rolled the read union WITHOUT the flagship-faces rule, so Ada 404'd watching her own seed project — the route now delegates to the ONE social read wall). Discover consolidation ✅ (owner-authorized — **adjudicated:** the D17 project directory becomes the Commons' Browse band below the feed's ALL view; the Agents-hub Discover keeps agent discovery. The split rule: resources are discovered where resources live, definitions where definitions live). S4 complete. |
| S5 | Ambient | person profiles; social notifications; guardrails (report/mute, moderation, rate limits) | 🚧 notifications ✅ (SOCIAL-9 slice 1: share → audience, offer → owner, verdict → offerer, through the one D24 fan-out; every kind carries a door — the registry's exhaustiveness forced icon/sentence/door together). Escalation bell ✅ (a WIDENED tier re-rings; lateral/narrowing re-grants stay silent — silence over noise, locked). Profiles ✅ (the `ProfileCommonsBand` + the publisher-existence rule — a name with viewer-visible publishes IS a public identity to that viewer; existence-hiding holds for everyone else). Guardrails ✅ (owner-authorized: **moderation lives with the anchor owner** — author-retract or owner-delete, last-delete dissolves the thread; **report rings the owner** who holds the delete, instance escalation deferred to S6; **mute is an earmuff, never a wall** — it filters the viewer's own feed/bell by actor name and leaves the muted party's access untouched). **Adjudicated earlier:** accept/decline lives on the grant itself (either party revokes), so the bell needs no inline verdict buttons — the door is the act's surface. **Guardrail UI ✅ (2026-07-22)** — the audit that followed the capability face found the guardrails were server-only: routes and tests existed, but no client command and no button, so nobody could retract their own post or flag anyone's. A ledger row saying "✅" for a capability with no surface is the failure mode this whole sweep is about; the row now says which half shipped when. **Lesson earned:** when a slice lands "server core ✅, UI remains", the ledger must keep saying so until the UI lands — otherwise the next reader (including a later me) treats the capability as available and builds on sand. **`social.discussed` ✅ (2026-07-22)** — the loop's one-way gap: every other social act rang someone, but a POST rang nobody, so "share → discuss" required the owner to go looking. **Adjudicated:** the audience is the anchor owner + prior participants, NOT everyone who can read the anchor — on a widely-shared subject the latter turns every comment into a broadcast, and D24's rule is that a bell means *you* are involved; access isn't involvement (watchers get the feed, not the bell). **Adjudicated:** the first post rings too — that is the moment someone starts talking about your thing. **Lesson earned:** `doorFor` was total over NotificationKind, but the panel's DISPATCH switch had no `never` guard — a new NavIntent variant would have type-checked and become a silent dead click. Both halves of a door contract need the guard, not just the mapping. |
| S7 | The person layer | follow/unfollow a principal (mute's positive twin) + 1:1 direct messages as Discussions anchored to a PRINCIPAL, the eighth noun | ✅ (SOCIAL-11, SOCIAL-12, owner request 2026-08-07: "add follow/unfollow and messaging features much like that of social networks"). **The design move:** everything through S6 is about RESOURCES; the layer had no way to address a human, so two people who could see each other had no channel between them. Rather than mint a fourth primitive (a Message entity with its own posts, moderation and bells), `principal` joins the nouns and the EXISTING Discussion primitive means *talk directed at a person* when its anchor is one — so a DM inherits posts, reactions, retract/report/mute, the `/discussions/:did` timeline and the hand-it-to-Claude hook by construction. **The orthogonality test is answered in full, three cells as explicit refusals:** grant × principal (you cannot share a person), proposal × principal (no owner to consent, no fields to patch), and grant × a principal-anchored discussion (the pair wall has no third seat to sell — the ONE place S2's recursion rule is cut, and it is cut at the door). **Four specializations, each stated once:** (1) stream identity is the unordered PAIR, not the subject — a person has no public stream, so `openDiscussion` get-or-creates over {opener, target} and Ada→Grace and Grace→Ada are one conversation, which *is* the inbox; (2) the wall is the pair, by strict tenant equality — the org-seat read union exists so a member can read their org's RESOURCES, and a private message is not one; (3) reachability is the D21 publisher-existence rule, which is also the anti-spam floor and needs no new wall; (4) no locus — a person has no interior positions, so `AnchorLocus` is untouched. **Adjudicated — follow is NOT watch:** watch's key is a resource and its one consumer is the work-item bell audience; follow's subject is a person and its consumer is the FEED (the fifth Commons lens, the only one keyed on who ACTED rather than on the subject). Merging them would put two questions behind one key. The genuine sibling is the S5 MUTE — also name-keyed, also per-viewer — and the two are exclusive: following clears a mute, unfollowing does not restore one. **Adjudicated — the deliberate non-bell:** a followee's publishes reach the follower's LENS and never their bell (D24: a bell means you are involved, and access isn't involvement — the same cut watch already makes); `social.followed` rings only because somebody acted ON you. **Adjudicated — a DM has no resolved state:** "resolved" is a question-settled verdict on a thread ABOUT something, and the control was rendering for a DM's opener and nobody else, so one party could mark a two-party conversation finished and the other could not reopen it. **Adjudicated — Messages is its own rail section, list-only:** a DM inbox is a different reading mode from "threads about my resources" (per-person, unread-driven, recency-ordered), and the server lists a DM in exactly one of the two so the same rows never appear twice; but a thread's canonical page stays `/discussions/:did`, because a second `/messages/:did` would be a duplicate address for one page. **Lessons earned:** (a) *reachability is ASYMMETRIC* — Ada publishes so Grace can reach her, while Grace may be nobody to Ada — so gating the whole open on it let Grace start a conversation Ada could never answer; write authority on a DM is PARTY MEMBERSHIP (`discussionWritableBy`), and being written to is standing to write back. (b) Reordering get-or-create ahead of the authority checks (to make that reply work) silently made the pair predicate `parties.includes(me) && parties.includes(me)` — trivially true of every conversation you are in — so a self-addressed note appended to whichever thread matched first; the self-guard has to run *before* the lookup. (c) S7 surfaced a REAL S5 defect: the profile's publisher-existence check read the MUTED feed, so muting a workspace whose only public face was its publishes made their profile 404 — a mute erasing an identity, when the rule is "an earmuff, never a wall". (d) A labelled unread dot inside a button splices itself into the button's accessible NAME, so the control was called something different depending on whether mail happened to be waiting; the count belongs in the description. (e) The Following lens is the ONE lens whose emptiness is ambiguous (you follow nobody / the people you follow haven't published), and the single sentence told a reader "you aren't following anyone" while they were — an empty state asserting something false, whose suggested next click is the one already done. |
| S8 | The square | standalone POSTS (self-anchored discussions) + @-mentions; the feed composer; posts as a Commons kind | ✅ (SOCIAL-13, SOCIAL-14, owner request 2026-08-08: "fully-fledged social features like twitter and facebook … integrated nicely with our website's topic and workflows"). **The design move:** a post is a Discussion anchored to the author's OWN principal. S7 had refused a self-anchor with a 403 ("there is no existence to hide from yourself") — but that refusal was a placeholder around a REAL bug (get-or-create had been moved ahead of the authority checks, making the pair predicate `parties.includes(me) && parties.includes(me)` trivially true, so a self-addressed note appended to whichever thread matched first). S8 gives the anchor a meaning and keeps the bug dead by inverting the identity rule: **a DM is get-or-create (one conversation per pair, forever); a post is always NEW** (two things you say are two posts, not one conversation with itself), so a post never looks a thread up. **Adjudicated — the wall is the SQUARE:** a post is readable by every signed-in principal, because anchoring to your own name IS a publication; the pair rule would make it readable by its author alone, which is a diary. **Adjudicated — anyone who can read may reply:** the alternative is a broadcast channel, and the layer already answers the abuse that admits — the author holds the delete on their own wall, mute is the reader's earmuff, and the router's rate limit bounds volume. That required teaching `ownsDiscussionAnchor` that a PERSON's owner is simply whoever they are (grant × principal is refused, so a person has no `grantSubjectRow`), without which the S5 rule "moderation lives with the anchor's owner" found nobody on a wall. **Adjudicated — a post rings NOBODY:** a followee's utterance reaches their followers' Commons lens and never their bell, the identical cut `social.followed` and `watch` already make (a bell means you are involved; access isn't involvement) — a feed that rang would be the engagement machine §4 rules out by name. A REPLY rings the author as `social.discussed`, because it is talk about what they said, not mail. **Adjudicated — no per-anchor cap:** `MAX_DISCUSSIONS_PER_SUBJECT` counts threads on one anchor and would cap a person at 100 posts for life, the same lifetime-cap trap S7 stepped around for correspondents. **@-mentions** are the one bell the square adds, and they reuse the ONE resolver the work-item comments already had (word-boundary rules, longest-match, a recipient cap — all earned by earlier review); the SAME resolution decides who is rung and what the UI linkifies, so the affordance and the act cannot drift, and a mention is filtered to people who can READ the thread so it can never announce a private one. **Lessons earned:** (a) `dmFace` stamped `direct` on every principal thread, so a post wore the DM face — counterpart, unread, mail styling — until a test asserted the two are mutually exclusive; the anchor cannot be both you and not-you. (b) A post card's only door was "view all N comments", which does not exist at N=0 — the moment someone most wants to answer. Found by the browser walk, which the node suites structurally cannot see. (c) Posting had to count as PUBLISHING for the D21 publisher-existence rule, or @-mentioning someone who had only ever posted landed the reader on "shares nothing publicly — or doesn't exist", about a person whose words they were reading. It works because a post IS a Commons item, which is the predicate S5 already used. |
| S6 | Public | link-token audience, anonymous viewing through the auth gate, indexing, moderation-before-strangers | 🚧 link slice ✅ (owner-authorized): server-minted tokens, signed-in redeem through the ordinary tier machinery, rotation-as-revocation (one link per subject; re-mint kills old redemptions), silent + roster-redacted redemption, the `/shared/:token` boot consumer landing on the subject's page. Moderation-before-strangers shipped with S5's guardrails. **The deliberately-unbuilt tail** (recorded, consistent with the mock-boundary discipline): anonymous rendering through the auth gate + indexing — production work with no honest mock. |
