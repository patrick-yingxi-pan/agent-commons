# 12 · Social layer — share, discuss, improve

> **Intent.** Every resource can be **shared**, **discussed**, and **improved**
> with other users through three orthogonal primitives — Grant, Discussion,
> Proposal — each defined against a generic entity reference, never a specific
> kind, and composing with any of the six social nouns (the relation graph's
> five plus Discussion itself). The full design + phased backlog:
> [`docs/design/social-layer.md`](../design/social-layer.md). Privacy rules are
> inherited, not invented: existence-hiding walls, REDACTED wire faces, INV-9
> absence classification.

## Built — S0 substrate + S1 grants (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| SOCIAL-1 | The kind-generic substrate: six social nouns (= relation entities + discussion), typed anchors, audiences, and a strictly-ordered share tier (`view ⊂ comment ⊂ propose ⊂ co-own`) with one permit predicate. The substrate never branches on an entity kind (orthogonality). | `contract/social.ts` | `tests/social.test.ts` | ✅ |
| SOCIAL-2 | Grants: owner-only creation over a generic subject ref (the one per-kind adapter lives in `server/store.ts`), one live grant per subject×audience (re-grant replaces), either-party revoke, persisted slice, two-party `grant.changed` SSE. The `note` field is the publish act (INV-9: absent = silent access-only share). | `server/store.ts`, `server/routes/index.ts`, `contract/social.ts`, `contract/events.ts`, `server/persistence/format.ts` | `tests/social.test.ts`, `tests/snapshot.test.ts` | ✅ |
| SOCIAL-3 | Existence-hiding on every grant face: an invisible subject 404s identically to a nonexistent one on GET **and** POST; a non-party probing a (sequential) grant id on DELETE gets the same 404 as a missing id. | `server/store.ts`, `server/routes/index.ts` | `tests/social.test.ts` | ✅ |
| SOCIAL-4 | A grant opens its subject: granted viewers pass the project wall and the session visibility funnel at any tier (read widens; ownership/writes stay strict). | `server/store.ts`, `server/routes/index.ts` | `tests/social.test.ts` | ✅ |

## Built — S2 discussions, server core (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| SOCIAL-6 | Discussions: the sixth noun — anchored threads over `GET/POST /discussions`, `/discussions/:did` (+ `/posts`, `/posts/:pid/react`, `/resolve`). Visibility INHERITS the anchor's read wall (existence-hiding on every face); the ROOT-thread rule (locus-free open is get-or-create — one public stream per subject); comment authority = owner / legacy-shared / comment-tier grant while `view` reads silently and may react; resolve is opener-or-anchor-owner; REDACTED wire face; recursion (a discussion anchors to and is grantable as a discussion). UI (the `/d/:id` timeline page, anchors, rail section, discussion-as-context) remains. | `contract/social.ts`, `server/store.ts`, `server/routes/index.ts`, `contract/events.ts` | `tests/discussions.test.ts` | 🟡 |

## Built — S3 proposals, server core (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| SOCIAL-7 | Proposals: the landing ledger generalized to any noun over `GET/POST /proposals`, `/proposals/:pid` (+ `/land`, `/decline`). A typed delta (`suggestion` — the reviewable floor; `relation-op` — landing runs the real reducer); offering needs the `propose` tier; the review thread is a normal Discussion anchored to the proposal (recursion — `proposal` is the seventh social noun, canonicalized so its wall IS its subject's); landing is subject-owner consent assigning monotonic per-subject L#; declined/landed are terminal; existence-hiding + REDACTED faces throughout. **UI built** (SOCIAL-7b): the entity page's Improvements section — offer form (suggestion + rationale), the ChangesPanel leading-slot idiom (pulse → L{n} → muted no), `DeltaView` (prose / the shared `describeOp` face for relation ops), review-thread door, owner land/decline inline; verified in-app cross-account (Grace at propose tier offers → Ada lands → the row flips to L1 live). The seed grant ships at `propose` so the demo flow needs no setup. Remaining: further delta kinds (artifact patch, schedule change, session fork + provenance). | `contract/social.ts`, `server/store.ts`, `server/routes/index.ts`, `contract/events.ts` | `tests/proposals.test.ts`, in-app | 🟡 |

## Built — S4 the Commons feed (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| SOCIAL-8 | The Commons feed as a PROJECTION (`GET /commons`, the rail's Commons section + `FeedCard`): a post = a grant carrying a note (silent grants stay out — the access/publish distinction) or a ledger landing; the embed face resolves per kind at serve time; the card's comments ARE the subject's root discussion (door + live count); walls mirror the subject's; chronological, no ranking. **The card carries its thread**: the last two root-thread posts render inline with the reaction toggle, "View all N" doors into the full thread, and the ONE `RootThreadComposer` (shared with the entity page's Discussion panel) posts into the SAME discussion — verified in-app: a comment posted from the card renders on the entity page's thread. **Facets** ✅ (Shares / Landings rail children — adjudicated to ONE partition per the rail rule; audience/activity stay filter-chrome for later) and the **session embed** ✅ (a shared conversation previews AS conversation — last turns, roles + trim locked). Artifact embeds ✅; follow ✅ (the D24 WatchButton on project cards; `projectHiddenFrom` unified onto the one social read wall — a latent flagship-faces hole found live and fixed). Remaining: Discover consolidation (owner-facing surface removal). | `contract/social.ts`, `server/store.ts`, `server/routes/index.ts`, `src/components/SectionView.tsx` | `tests/commons.test.ts`, in-app | 🟡 |

## Planned (the backlog lives in the design doc)

| ID | Requirement | Status |
|----|-------------|--------|
| SOCIAL-5 | S1 UI: the grants roster + share form (`GrantsPanel`, generic over the subject ref) in the project page's owner rail; `TierBadge` as the one tier cue (`src/lib/tierBadge.ts`); the shared-with-me band fed from grants (a granted project rides both list projections as the redacted visitor face, live on `grant.changed`, leaving on revoke). Verified in-app end-to-end (Ada shares → Grace's Shared-with-you lists it → click-through opens the canonical visitor page); funnel locks in `tests/social-ui.test.ts`, projections in `tests/social.test.ts`. Consent cards gate CLAUDE-proposed acts — a user's own SharePanel click IS the consent (the ShareToggle precedent); the conversational share *tool* is future model-tools work, not part of this row. | ✅ |
| SOCIAL-6b | S2 Discussion UI. Built: `DiscussionsPanel` (generic over the anchor ref) on the project page — the root thread with inline composer, viewer-relative reaction toggle, opener/owner resolve (verified in-app cross-account); the **Discussions rail section** (state facets via the one subviews registry) over the caller's participating threads (`GET /discussions?mine=1`); the **`/discussions/:did` timeline page** (canonical URL in `urlRoutes.ts`, round-trip locked; boot deep-link restores) with `AnchorChip` doors both ways (thread ↔ anchored entity, through the pane funnel); one shared `DiscussionPostList` form across both projections. **The agent hook is live**: "Discuss with Claude" on the discussion page creates a session, fires the thread digest as its first REAL message (a full model round-trip; the open pane reattaches the stream), and opens it — the design's share → discuss → hand-the-debate-to-Claude loop, verified in-app. Remaining: locus anchors + per-kind resolvers (scroll/highlight); the full Context-TYPE attach is recorded follow-up (the digest-message form ships the loop now). | 🟡 |
| SOCIAL-9 | S5 Ambient, slice 1 ✅ — **social notifications**: `social.shared` rings the audience at grant time, `social.offered` the subject owner, `social.landed`/`social.declined` the offerer (the D25 two-party loop generalized); rows carry only public faces (subject kind/id/display name); every kind has a door (project subjects → their page; session subjects → the Commons, recorded as the slice-1 mapping) — the kind registry's compile-time exhaustiveness forced icon + sentence + door in one edit. Verified in-app (Ada shares → Grace's bell reads "Acme, Inc. shared the project … with you"). Locked by `tests/notification-doors.test.ts` + the S5-bells test in `tests/proposals.test.ts`. Escalation bell ✅ (widened tier re-rings; lateral stays silent — locked in `tests/social.test.ts`). Remaining: person profiles, guardrails (report/mute, moderation, rate limits), S6 public. | 🟡 |
