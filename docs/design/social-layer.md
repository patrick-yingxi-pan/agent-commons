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
| S1 | Grant | grants CRUD + note field; shared-with-me band; `GrantsPanel`/`TierBadge`; session share (readable at view) | ✅ (SOCIAL-2..5). Lessons earned along the way: existence-hiding beats forbidden on every face (sequential ids are probeable); the flagship faces own unstamped seeds for grants (one seat, two faces — a strict default-tenant check 403'd Ada on her own demo world, found live); seed grants are code-owned and re-ensured on load. **Adjudicated:** consent cards gate CLAUDE-proposed acts — the user's own SharePanel click IS the consent (ShareToggle precedent); a conversational "share this…" model tool is future work alongside the other api-tools. Session-share UI ✅ (2026-07-22) — the title bar's share door. **Adjudicated:** a conversation has no entity page to hang an owner rail off, so the door is CHROME and the roster opens in a popover; what opens is the unchanged generic `GrantsPanel`, so a conversation's tiers, link grants, publish-note semantics and revoke are identical to every other subject's *by construction*. **Adjudicated:** ownership became a viewer-relative `Session.own` on the projection rather than a client-side inference from list membership — the list excludes run sessions, so inferring would have silently dropped the door for them (UI-12: never assert a status a registry owns). **Adjudicated:** the widest tier does NOT confer the door — `co-own` opens the conversation, not its audience configuration; only READ widens. |
| S2 | Discussion | Discussion entity + root-thread rule; `/d/:id`; timeline page; `AnchorChip` + resolvers; gutter affordance; `ReactionCluster`; rail section; discussion-as-Context attach | 🚧 server core ✅ (SOCIAL-6: entity + routes, anchor-inherited walls, root get-or-create, comment tier vs silent view, react-at-view, opener/owner resolve, redaction, recursion — `tests/discussions.test.ts`; persisted + snapshot coverage). **Adjudicated:** visibility strictly INHERITS the anchor (the narrowing option is deferred — a narrower private review thread is better served by a discussion on a *proposal* in S3, keeping S2's rule one sentence). UI slices 1–2 ✅ (`DiscussionsPanel` on the entity page; the Discussions rail section with state facets over `mine=1`; the `/discussions/:did` timeline page — **adjudicated: `/discussions/:did`, not the sketched `/d/:id`** — this app's grammar reserves subview ids under the section name, and a second prefix would be a parallel convention; `AnchorChip` doors both ways; one shared `DiscussionPostList`). Agent hook ✅ ("Discuss with Claude": session + thread-digest first message + open — **adjudicated:** the digest-message form ships the loop now; a first-class Context TYPE for discussions is follow-up, recorded here). **Locus anchors ✅ (SOCIAL-6b, 2026-07-22)** — the flagship surface first: a conversation TURN. The gutter that mints one is hover-revealed and the marker only exists once a thread does, so the app's most sacred surface pays nothing when the feature is unused (GitHub's line gutter). **Adjudicated:** composing is INLINE (a comment's value is being written next to what it's about) but READING is the thread's own `/discussions/:did` page — a discussion is a lifecycle entity and this repo already decided a lifecycle wants a timeline page, so the marker is a door, not an expander. **Adjudicated:** the root-thread rule generalizes to *one public stream per (subject, locus)* — equality, not overlap, since a per-kind notion of "near enough" would break S0's kind-generic substrate. The per-kind resolvers live in ONE registry (`src/lib/anchorLocus.ts`) that is total over the union, so a new locus kind must decide its phrase and its landing in a single edit; kinds whose surfaces host no position yet degrade to a named chip that doors to the entity. **Lesson earned:** a position-landing door must out-rank a surface's default landing — the conversation's open-at-the-bottom scroll silently beat the turn focus, and only the browser walk caught it (the node suites can't see scroll). Remaining: gutters on the artifact / schedule-run surfaces; `ReactionCluster` popover waits for a second reaction kind. **Why the artifact gutter did NOT come next (2026-07-22):** `artifact-range {from,to}` means LINES, but this prototype's artifact bodies are structured, not linear — `doc` has blocks, `sheet` rows, `slides` slides, `figure` nothing ordered at all (`contract/content.ts`). Mapping a line range onto blocks would make the chip's own phrase ("lines 4–9") a lie, and the one genuinely line-oriented renderer (`ServedText`, real file bytes) needs a served filesystem folder, so it can't be demoed from the seeds. The honest sequence is: give `ArtifactContent` a line-oriented variant (or render served text with a gutter) FIRST, then anchor to it — not bend the locus to fit the surfaces that exist. |
| S3 | Proposal | generalize ledger to any entity; delta appliers + `DeltaView`; review-discussion composition; land/decline consent; session fork + provenance edge | 🚧 server core ✅ (SOCIAL-7: `SocialProposal` — named so because D25's agent-change entity owns the bare name — over the seventh noun `proposal`, whose wall canonicalizes to its subject's; delta kinds `suggestion` + `relation-op` (landing runs the real reducer); review thread = a Discussion anchored to the proposal; owner-consent land with monotonic per-subject L#; `tests/proposals.test.ts`, persisted + snapshot coverage). UI ✅ (SOCIAL-7b — offer/land/decline verified cross-account in-app; the seed grant ships at `propose`). **Consolidated (owner-directed, 2026-07-21):** the separate Improvements section is gone — contributions (Phase A–E) and social proposals are two PATHS into ONE landing ledger, so the project page renders one merged **Changes** panel (both composers in its header; rows interleave: in-flight, then landed by L# descending, then declines) and the server derives ONE L# sequence across both landing paths (`nextLandingNumber` — locked by the one-ledger test in `tests/proposals.test.ts`; the contribution page's next-L# preview spans both too, a stale-L1 label found + fixed live). Full data-model absorption (contributions AS a proposal delta kind) stays recorded follow-up — the Phase A–E machinery (envelopes, tiers, delegation) is too load-bearing to fold in a UI pass. Remaining: further delta kinds (artifact patch, schedule change, session fork + provenance edge). |
| S4 | Commons | feed projection endpoint (share-events + ledger events); `FeedCard` + `ResourcePreview`; `/commons` + facets; Discover consolidation; entity-page enrichment (Discussions/Improvements sections, follow) | 🚧 core ✅ (SOCIAL-8: `GET /commons` — the projection over grants-with-note + landings, per-kind embed faces resolved at serve time, the card's comments = the subject's root thread; the Commons rail section + `FeedCard` with title-as-door into the entity page; verified in-app — the seeded publish renders and doors through; `tests/commons.test.ts` locks silent-grants-out, per-viewer walls, live comment count). Entity-page enrichment already shipped with S2/S3 (Discussion + Improvements sections). Inline comments ✅ (the card renders the root thread's tail + the ONE `RootThreadComposer` shared with the entity panel — a comment posted on the card provably renders on the entity page: one conversation, two projections, verified in-app). Facets ✅ (Shares/Landings — **adjudicated: one partition per section**, per the rail rule; audience/activity become in-page filter chrome if ever needed) and the session embed ✅ (last turns, roles + trim). Artifact embed ✅; follow ✅ (the feed card carries the D24 `WatchButton` for project subjects — follow IS watch where watch machinery exists; other kinds gain it when the watch key generalizes. Surfacing it found + fixed a latent wall bug: `projectHiddenFrom` hand-rolled the read union WITHOUT the flagship-faces rule, so Ada 404'd watching her own seed project — the route now delegates to the ONE social read wall). Discover consolidation ✅ (owner-authorized — **adjudicated:** the D17 project directory becomes the Commons' Browse band below the feed's ALL view; the Agents-hub Discover keeps agent discovery. The split rule: resources are discovered where resources live, definitions where definitions live). S4 complete. |
| S5 | Ambient | person profiles; social notifications; guardrails (report/mute, moderation, rate limits) | 🚧 notifications ✅ (SOCIAL-9 slice 1: share → audience, offer → owner, verdict → offerer, through the one D24 fan-out; every kind carries a door — the registry's exhaustiveness forced icon/sentence/door together). Escalation bell ✅ (a WIDENED tier re-rings; lateral/narrowing re-grants stay silent — silence over noise, locked). Profiles ✅ (the `ProfileCommonsBand` + the publisher-existence rule — a name with viewer-visible publishes IS a public identity to that viewer; existence-hiding holds for everyone else). Guardrails ✅ (owner-authorized: **moderation lives with the anchor owner** — author-retract or owner-delete, last-delete dissolves the thread; **report rings the owner** who holds the delete, instance escalation deferred to S6; **mute is an earmuff, never a wall** — it filters the viewer's own feed/bell by actor name and leaves the muted party's access untouched). **Adjudicated earlier:** accept/decline lives on the grant itself (either party revokes), so the bell needs no inline verdict buttons — the door is the act's surface. |
| S6 | Public | link-token audience, anonymous viewing through the auth gate, indexing, moderation-before-strangers | 🚧 link slice ✅ (owner-authorized): server-minted tokens, signed-in redeem through the ordinary tier machinery, rotation-as-revocation (one link per subject; re-mint kills old redemptions), silent + roster-redacted redemption, the `/shared/:token` boot consumer landing on the subject's page. Moderation-before-strangers shipped with S5's guardrails. **The deliberately-unbuilt tail** (recorded, consistent with the mock-boundary discipline): anonymous rendering through the auth gate + indexing — production work with no honest mock. |
