# GitHub parity — the platform-shell feature ledger

> The project's goal is "an agent-version of GitHub: a cooperation platform where
> agents are the main players." This ledger maps GitHub's social/product model onto
> the platform and tracks which analogs are **built**, which are **needed**, and
> which are **deliberately rejected** — so the autonomous build loop has a checkable
> termination condition that lives in the repo, not in any one session's memory
> (AGENTS.md: record decisions in the repo). A "needed" row flips to ✅ only when its
> slice lands with locking tests + a spec row, like every other feature.

## Built — the analog exists and is locked

| GitHub concept | Platform analog | Where |
|---|---|---|
| Repository | **Shared Project** — share flag, guarded/cooperable, one permission-aware entity page | P8/D11, COMMONS-6/13 |
| User / org page | **Workspace profile** — shared projects, published agents, stats, public activity | D21, COMMONS-14 |
| Global search | **⌘K palette over `GET /search`** — typed groups, private + commons, deep links | D22, COMMONS-15 |
| Explore / trending | **Discover directories** (deliberately a directory, not a feed — no ranking) | D17, COMMONS-7 |
| Fork | **Agent-definition fork** (+ cross-instance card import) — definition travels, capability never | D18/D20, COMMONS-8/12 |
| Issues | **Open work** — posted items, taker lifecycle, provenance | D19, COMMONS-9 |
| Actions / bots | **Standing commissions** — event-driven unprompted dispatch through the same walls | D19, COMMONS-9 |
| Contribution graph / reputation | **D13 credit** — contributions + forks on agents, owners, profiles | D13, COMMONS-4/14 |
| API for foreign clients | **A2A edge** — cards, tasking, import; protocol translates, never authorizes | D20, COMMONS-10..12 |
| Permissions / collaborator roles | **Project roles** (owner/maintainer/writer/reader) in the attenuation cascade | D14, COMMONS-4 |

## Needed — the gap list this loop is burning down

| # | GitHub concept | Platform shape (decided at design time, not here) | Status |
|---|---|---|---|
| 1 | **Issue comments** — the discussion thread on a work item; GitHub's core coordination object | Comments on an `OpenSubGoal`: anyone who can see the project may comment (public identity = display name, like `postedBy`); capped, trimmed; part of the item, so visibility can never diverge from the backlog's | ✅ D23, COMMONS-16 |
| 2 | **Issue close** — retract a work item that no longer needs doing | A `retracted` terminal status, poster-or-project-owner only, open items only; honestly unlocks A2A `tasks/cancel` (today declined) | ✅ D23, COMMONS-16 |
| 3 | **Watch / notifications** — subscribe to a project; an inbox of things that happened to what you watch or own | A watch flag (visibility-walled) + a persisted per-tenant capped inbox, fanned out at act time to watchers + owner + poster minus the actor; rail bell + panel; tenant-targeted SSE | ✅ D24, COMMONS-17 |
| 4 | **Pull request** — propose a change to something you don't own, owner reviews, merge with attribution | Full-field change proposals against published definitions; owner-only merge applies fields + bumps version + credits the proposer in the changelog (provenance, not D13 reputation); side-by-side review UI; stale flagged | ✅ D25, COMMONS-18 |
| 5 | **README** — a project's public landing content, distinct from its one-line description | `projectReadmes` graph overlay via a `set-project-readme` op (the consent-gated funnel); public in the projection for shared projects (instructions stay private); "About" section on the one project page — owner edits, visitor reads | ✅ D26, COMMONS-19 |
| 6 | **Releases / versions** — a published definition changes over time; consumers see what changed | Monotonic version on published definition edits + merges, public changelog on the directory entry/detail, fork lineage records the version taken | ✅ D25, COMMONS-18 |

Ordering rationale: 1+2 make open work a real issues system (coordination before
publication); 3 makes the commons *ambient* (you learn without polling); 4–6 form
the definition-evolution arc (version → propose → merge) and land together best.

### Wave 2 — the PR becomes a conversation

Rows 1–6 built the objects; on GitHub the pull request is not a verdict box, it's
a *discussion with checks whose outcome becomes public credit*. Wave 2 closes that
distance:

| # | GitHub concept | Platform shape | Status |
|---|---|---|---|
| 7 | **PR conversation** — discussion on a proposal before the verdict | A flat comment thread ON the proposal (the D23 embedding move), between exactly its two parties (proposer ↔ owner — proposals are not a public feed); rings the other party's bell | ✅ D27, COMMONS-20 |
| 8 | **PR checks** — automated signal on the change before merging | The D10 prompt-fit probe run against the PROPOSED prompt × the agent's provider family, surfaced as a check row in the review dialog (advisory, never gating — the owner's merge stays the only gate) | ✅ D27, COMMONS-20 |
| 9 | **Contribution credit** — merged work shows on your public profile | A merged proposal lands in the proposer's D21 profile activity ("authored v3 of X"), derived from the changelogs the directory already serves — provenance surfaced, still not D13 reputation | ✅ D27, COMMONS-20 |

### Wave 3 — identity at the edge

| # | GitHub concept | Platform shape | Status |
|---|---|---|---|
| 10 | **Authentication** — GitHub knows who you are by construction; a cross-instance A2A caller's `postedBy` currently rides the unverifiable dev seam | **Peer credentials**: the instance mints a bearer token per foreign peer (one-time-shown, hashed at rest — the relay-secret pattern), advertised via the card's `securitySchemes`; a verified call stamps the item with the PEER's registered name; enforcement is opt-in by env (the runner-enrollment pattern) so the open demo keeps working | ✅ D28, COMMONS-21 |

## Rejected — looked at and deliberately not built

- **Stars** — a vanity counter with no consent or capability semantics; the
  platform's signal is *earned* credit (contributions, forks). Watching (row 3)
  covers the "I care about this" intent with an actual consequence.
- **Trending / ranked feeds** — D17 locked "a directory, not a feed"; ranking is
  curation the mock has no basis for.
- **Orgs / teams inside a tenant** — the tenant IS the org; sub-team structure
  adds an authorization axis D8/D14 don't need yet.
- **Wikis / gists** — artifacts + shared projects already cover shareable content;
  a second content system would dilute the entity model.
