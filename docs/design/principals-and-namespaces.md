# Principals & namespaces — the GitHub/HF identity model, plus agents

> **Status: BUILT — all four phases (decided AND executed 2026-07-12).** Settled
> in a design dialogue and recorded here per the repo rule that decisions live in
> files, not agent memory; implemented the same day as phases 1–4 below (each
> with its locks). Now invariant **INV-10**
> ([`../spec/09-design-invariants.md`](../spec/09-design-invariants.md)). The
> **orgs phase** — deferred at decision time (§4.1) — was un-deferred by user
> direction and is being built per **§8** (spec FWD-6; O1 ✅, O2/O3 in
> progress). The pre-collapse workspace model survives only as history in
> [`F2-identity-tenancy.md`](F2-identity-tenancy.md) +
> [`multi-account-ui.md`](multi-account-ui.md).

## 1. Why — the dialogue that forced this

The trigger was a simple observation: **workspaces-within-an-account complicate
the model, and projects already group things within an account.** Working it
through:

1. *Workspace ≠ grouping.* In the current design the workspace is the **tenant**:
   the visibility wall, the membership unit, the commons actor (D21 profile, D13
   credit), and the scope of every registry. Projects group *inside* it. So a
   naive collapse doesn't delete a layer, it relocates one.
2. *But shared projects already exist.* Cross-tenant shared Projects with roles
   (D11/D14/D17) cover "several parties collaborate on one body of work." The
   residual justification for a multi-account workspace shrinks to **organizations
   as first-class actors**: one shared public face, one pooled registry/infra
   set, co-equal ownership of the residue outside any project.
3. *The precedent decides it.* GitHub and Hugging Face both faced this and
   converged on the same shape (§2). GitHub even ran the sequence live: 2008
   launched with only person-owners + per-repo collaborator grants (our shared
   projects), and added orgs in 2010 — as **namespaces, not switched-into
   worlds** — only when teams demanded the three residuals above.

**Decision: move to the GitHub/HF model, with one added complexity — agents.**
The Slack/Notion/Claude-desktop workspace-switching family (tenant = a world you
enter; everything swaps) fits apps whose content is all tenant-private. This
prototype is a conversation app *in front of a public commons*; the GitHub/HF
family is the one built for that.

## 2. The precedent

### 2.1 What GitHub and Hugging Face agree on

1. **The person is the only login; the org is a namespace, not a world you
   enter.** You sign in as yourself, once. Org rights are resolved per-resource
   at access time; nothing "switches."
2. **One owner axis, two owner kinds, same shape.** Every artifact has exactly
   one owner (`owner/name`); a person-owner and an org-owner are structurally
   identical — same profile-page shape, same directory behavior. (Our D21
   profile already mirrors this.)
3. **Actor and owner are different concepts; attribution never leaves the
   person.** A commit/comment/review in an org-owned repo is attributed to the
   human forever; the org owns but never acts. Orgs can't log in.
4. **Progressive disclosure of the org layer.** Signup mints only the implicit
   personal namespace; "organization" doesn't exist in the UI until you create
   or join one.
5. **Teams are permission groups inside an org, never owners.** (Already our
   position — [`../github-parity.md`](../github-parity.md) rejected sub-teams.)
6. **Grouping within an owner is deliberately weak** — topics/collections/pins,
   never ownership containers. Ownership and grouping don't blur.

### 2.2 GitHub Apps — the mature "agents in this model" design

The anti-pattern GitHub explicitly discourages is the **machine user**: a bot
wearing a human-shaped account — fakes a principal, burns a seat, evades
scoping, muddies attribution. The replacement, GitHub Apps:

1. **An app is its own principal kind** — acts as itself (`dependabot[bot]`),
   visibly badged, never impersonating a human. Only humans and apps act.
2. **Definition vs installation.** The app's manifest is owned by a publisher
   namespace and grants *nothing*; capability comes only from each target's
   explicit **installation** with enumerated scoped permissions. Uninstall kills
   capability; the identity and its history remain.
3. **Attenuation by construction** — effective power = requested ∩ granted;
   tokens short-lived, per-installation.
4. **On-behalf-of attribution** — acting for a user records both.
5. **Publishable, forkless** — the listing travels; installations never do.

### 2.3 The recognition: Agent Commons already built this, rooted on the wrong axis

| GitHub Apps | This repo (already built) |
|---|---|
| App manifest vs installation | **D18** — "definition travels, capability never" |
| Installation with scoped permissions | **Commission** (agent + project + role + guardian, D19/D14) |
| Install flow for a foreign app | **Fork-and-bind** (D18/D20) |
| On-behalf-of attribution | `via A2A` provenance; per-turn provenance (D16) |
| Marketplace | **Publish to directory** (D17) |
| App's own identity + bot badge | *the gap Phase 3 closes* |

So "GitHub/HF + agents" is not a redesign of Agent Commons — it is a
**re-rooting**: the same walls and grants, hung off principals/namespaces
instead of workspaces.

## 3. Target model

Three orthogonal concepts; "workspace" is not one of them.

- **Principals** — things that authenticate and act: **human accounts** and
  **bound agents**. Every act (message, comment, work-item take, proposal, tool
  call) stores its principal forever. Agents are visibly badged everywhere (one
  `publicFace` cue, UI-10). Orgs never act.
- **Namespaces** — things that own and have profiles: **persons** (implicit,
  minted 1:1 with an account at signup, never surfaced as a "workspace" in the
  UI) and **orgs** (memberships; deferred — §4.1). Every entity — project,
  artifact, session, published agent definition, model provider, prompt,
  connector — has exactly one owner namespace. Registries are namespace-owned;
  once orgs exist, pickers list *yours + each org's you belong to*,
  GitHub-repo-creation style.
- **Grants** — the only carriers of capability: collaborator **roles on shared
  projects** for humans (D14) and **commissions** for agents (D19). Both
  attenuate, both revoke, neither travels with a definition (D18). The D8
  cascade is unchanged — its root moves from "the workspace's ambient set" to
  "the owner namespace's ambient set."

**The attribution chain.** Every act carries three parts: **who** (principal) +
**under what authority** (grant) + **on whose thing** (owner namespace) — e.g.
*"taken by `research-bot` 🤖 (owned by `ada`) under commission #12 on
`acme/insights-dashboard`."* Open-work provenance already records two of the
three; Phase 3 completes it.

**What "workspace" dissolves into:**

| Workspace job today | Where it goes |
|---|---|
| Visibility wall / tenancy | The person namespace (1:1 with the account) |
| Membership unit (N accounts, one tenant) | Deleted; orgs re-add it later as namespaces |
| Commons actor (profile, credit, @mention target) | The **namespace** (person now; org later) — same D21 page, same D29 resolution |
| Registry scope | The owner namespace |
| Switcher entry | Deleted; the switcher shrinks to the **account stack** (multiple signed-in humans — a browser convenience, not tenancy) |
| Sessions / unfiled residue | Owned by the person namespace |

## 4. The three calls (resolved)

### 4.1 Orgs: **deferred** (GitHub-2008 → 2010 sequence)

The commons/A2A thesis — agents as players, forking, open work, consent walls —
does not need org actors to make its argument; person-tenants exercise every
wall. Orgs return later as owner-namespaces (memberships, org registries, an
owner picker) *without* a migration because the contract keeps the owner id
**opaque**: `tenantId` is redefined as *the owner namespace id* and
`Tenant.kind: 'personal' | 'org'` ([`../../contract/identity.ts`](../../contract/identity.ts))
already names both kinds — the `org` arm simply goes dormant, not deleted.

### 4.2 Credit: **dual accrual**, GitHub-style

An act builds the **agent's own track record** (an agent with history is a real
thing even after its commission ends — like an app's marketplace listing), and
D13 credit **also rolls up to the owner namespace's profile** (the publisher's
reputation). Both visible, neither substitutes for the other.

### 4.3 Agent identity: **never a credential**

Agents never hold account credentials (the machine-user anti-pattern). An
agent-principal id is minted by **binding** (creation or fork-and-bind) and
exercised only through grants; the rendezvous/runner and commission seams
already model exactly this. No agent sign-in, no agent seats.

## 5. What deletes / what stays

**Deletes** (Phase 2): workspace switching; the chip menu's workspace list;
`POST /v1/workspaces` + `GET /v1/me/workspaces`; the signup wizard's optional
team-workspace step; multi-account-per-workspace memberships (the Ada/Acme
"one seat, two faces" demo pair — the flagship seeds move to Ada's person
namespace; Acme keeps its own distinct world as a separate account).

**Stays, recontextualized**: the account **stack** and switch-mid-generation
machinery (multi-account §12 — now switching *humans*, not tenants; I1–I5 hold
unchanged); shared Projects as the collaboration primitive; all of Agent
Commons D6–D29 and the A2A edge; the desktop `user-local` (a person namespace
with no credential — unchanged posture); `AUTH_GATE`, cookies, scrypt — the
whole P6–P9 auth stack minus its workspace arm.

**Renames in meaning, not on the wire**: `tenantId` stays the field name but
now means "owner namespace id" (a wire rename to `namespaceId` is a mechanical
sweep with no behavior; do it only if a contract-breaking change is batched
anyway). D21 "workspace profile" → **namespace profile**; D29 mentions resolve
namespaces.

## 6. Phased migration (each phase shippable, tested, spec-ledgered)

**Phase 1 — actor/owner split (additive, no deletions). ✅ BUILT (2026-07-12).**
`PrincipalRef` (`{ kind: 'user' | 'agent'; id }`) lives in `contract/identity.ts`;
every native commons act — work-item post / comment / retract, proposal,
proposal-comment (mentions ride the comment's stamp) — is stamped with its acting
principal. Two refinements earned at implementation time: **(a)** the raw ref is
server-private like the raw tenant ids — stored rows carry the full `PrincipalRef`
(`StoredOpenSubGoal.postedByPrincipal` etc., `server/persistence/format.ts`) and
the public projections derive only the KIND (`postedByKind` / `authorKind` /
`retractedByKind` / `proposedByKind`); a foreign A2A act gets NO kind (its
attribution stays `verifiedPeer`/`via`, D28). **(b)** the compile-side lock is the
mutators' **required-but-undefinable** `principal` parameter (every caller decides
attribution explicitly) rather than a contract-boundaries row; `resolvedBy` needs
no stamp — a resolution is definitionally an agent act and that field already
records the grant. Locks: `tests/principals.test.ts`.

**Phase 2 — the workspace collapse. ✅ BUILT (2026-07-12).** Signup mints
exactly one person namespace (named after the person, GitHub-style — the
"(personal)" suffix dropped); the workspace routes (`GET /me/workspaces`,
`POST /workspaces`), the wizard's team step, and the chip-menu workspace
section are gone; the session route's tenantId re-mint arm is **refused
loudly** (INV-9 — never normalized to the namespace it would have meant);
memberships collapse to one-per-user (`homeOf`), enforced also at `rehydrate`
so a pre-collapse snapshot can't resurrect a second seat; `AuthAccount` keeps
its shape (its `tenant` is derived; a stale stack cookie's tenant is ignored,
not trusted). Demo seeds: Grace's Acme membership and the desktop user's
"Acme (work)" second tenant are gone — six worlds, strictly one per account.
Two reality corrections earned at implementation time: **(a)** the flagship
world's dual visibility (`seedVisibleTo`: backend default + `tenant-acme`) is
a cross-BACKEND fixture share, not account multiplicity — it stays; **(b)**
the dev header seam's synthesized tenants (`IDENTITY_HEADERS`, off in the
production posture) are the test impersonation mechanism, not the feature —
they stay too. Locks: rewritten `tests/auth-session|auth-accounts|onboarding|
auth-flow|demo-accounts` (+ the one-membership-per-user and
snapshot-can't-resurrect guards), `e2e/auth-wizard|onboarding|account-switch`
(the switch-mid-generation crux unchanged — it never depended on tenancy).

**Phase 3 — agents as principals. ✅ BUILT (2026-07-12).** The agent-actor cue
is a `publicFace` funnel (UI-10): `AgentActor` (Bot badge + label + the one
tooltip; an agent is TEXT, not a door — its OWNER has the profile page) and
`ActorByline` (picks door-vs-badge by `PrincipalKind` — work-item and proposal
threads route through it, ready for the day an agent authors a comment). The
resolved work-item row renders the full chain: *who* (`resolvedByLabel`, badged)
· *for which owner* (`resolvedByOwner`, NEW — captured at act time like the
label, so the record survives a commission delete; an `OwnerLink` door) · *under
what grant* (`resolvedBy`, on the tooltip). One reality finding: **dual credit
already existed** — D13 built the agent increment (`runProjectEffect`) and the
owner-profile rollup (`ownerProfile` stats fold, `ownerReputation`) before this
migration; Phase 3 verified rather than added it. Locks:
`tests/public-face.test.ts` (funnel + no hand-rolled cue/fallback),
`tests/principals.test.ts` (the chain on the wire),
`e2e/work-item-surface.spec.ts` (the chain rendered, owner door working).

**Phase 4 — docs/spec sweep. ✅ BUILT (2026-07-12).** AGENTS.md (the
exploration entry → BUILT pointer), [`../github-parity.md`](../github-parity.md)
("User / org page" → namespace profile), `docs/agent-commons.md` +
[`multi-account-ui.md`](multi-account-ui.md) banners,
[`../demo-accounts.md`](../demo-accounts.md) (Phase 2). FWD-5 moved into the
invariants pillar as **INV-10** with the full lock list; the forward-looking row
is a tombstone pointing there.

**Orgs phase — designed 2026-07-12 (§8, by user direction), building as
O1→O3.** The §4.1 deferral ended when the user asked for it; the contract seam
held (everything below is additive).

## 7. Open questions (deliberately left)

- Whether sessions can ever be **org-owned** (GitHub has no analog — issues are
  the closest; revisit with orgs).
- Whether the **desktop** ever grows a second signed-in human (today: one local
  user, account stack is a web concern).
- Federation identity (BROKER-EXP-5) — namespace names across instances; the
  A2A import stub's lineage is the current answer.

## 8. The orgs phase (the GitHub-2010 move) — designed 2026-07-12

Six calls, each with the alternative it rejects. Spec row **FWD-6**.

### O-D1 — An org is a namespace with members, never a world

An org owns entities, has the D21 profile page, is a D29 mention target, can
publish agents and share projects. It never acts (no principal), never logs in,
and is never *entered*: there is **no switching**, no org rail, no org session
list. Its ONE surface is its namespace page — the same COMMONS-13 shared page,
with member affordances gated by the viewer's membership (capability shapes
affordances, not location). *Rejected:* any workspace-shaped org (a switched
world) — that is exactly what Phase 2 deleted.

### O-D2 — Membership re-enters through the surviving join table

`Membership` (kept in Phase 2 as "the seam orgs re-enter through") reactivates
with a refined invariant: every user holds **exactly one person-namespace
membership** (their namespace, role `owner`) **plus any number of org
memberships**. Roles reuse `TenantRole`; v1 uses `owner` (the founder) and
`member` — `admin` stays dormant until a real need (the parity doc already
rejected sub-team structure). `rehydrate`'s one-per-user guard becomes
one-PERSON-membership-per-user; org memberships round-trip freely.

### O-D3 — Joining is a consent act: email-keyed invitations, existence-hidden

An owner **invites**; the invitee **accepts** — membership is never written
onto someone (the repo's consent thesis; GitHub does the same). The invite is
keyed by **email**, and the response is uniform whether or not an account
bears it (the login's existence-hiding posture — display names are public but
non-unique, so name-keyed invites would either leak or misfire; the email is
the one private, unique handle an inviter legitimately knows). A pending
invite surfaces to the *invitee* (their bell + the org page's member panel)
once an account with that email exists; accept mints the membership, decline
closes it — a small lifecycle (`invited → accepted | declined`), poster-side
revocable. *Rejected:* owner-side direct add (a capability grant without
consent) and name-keyed invites (enumeration / collision).

### O-D4 — The owner picker: an absent owner means YOUR namespace (INV-9)

Creation flows gain an optional `ownerTenantId`. **Absent = the caller's
person namespace** — a fixed, documented absence semantic (the minimal-risk
class; never "the last-used org" or any mutable default). Present = must name
an org the caller holds a membership in, else refused loudly. **v1 scope:
projects only** — the shareable, collaboration-bearing entity. Org-owned
*registries* (pooled providers/keys, org agent fleets) are the real "pooled
infrastructure" residual and stay v2: they drag the D8/D9 cascade root with
them and deserve their own pass.

### O-D5 — Member access is a UNION at the walls, not a switched world

Every project-visibility wall (`rowVisibleTo`-family, the open-work/watch/
notification/event funnels that key off a project's tenant) moves from
`=== callerTenant` to `∈ visibleTenants(caller)` — the person namespace plus
org memberships — **one systematic change at the funnels**, not per-surface
patches (the encode-invariants-centrally rule). Consequences, embraced: an
org-owned project appears in a member's Projects list (banded under its org,
like the *Shared with you* band), its bells reach members (the org inbox is
member-readable), its SSE events pass `eventVisibleToTenant` for members.
Sessions stay person-owned (§7's open question stays answered "no" for now),
so the rail's session list is untouched. *Rejected:* the org page as the ONLY
door (pull-only member access) — it would make org projects second-class in
every live surface the thesis cares about.

### O-D6 — Attribution is already right; `own` grows a role

Acts on org entities need nothing new: the principal is the human (Phase 1),
the owner is the org (Phase 3's chain renders it). The viewer-relative `own`
flag on org-owned projections derives from membership role (owner-role ⇒ the
owner controls; member ⇒ cooperation affordances); where a surface needs finer
than a boolean, the projection may carry a computed `memberRole` — viewer-
relative, never stored (the INV-9 read-side rule).

### O-D7 — Demo seeds stay; orgs are demonstrated at runtime

The six demo worlds keep their Phase-2 shape (one namespace per account —
`tenant-acme` stays *Ada's namespace*, whatever its display name suggests).
Re-seeding Acme as a true org would orphan the flagship world from Ada's rail
(sessions are person-owned) and re-tangle what Phase 2 untangled. Orgs are
exercised the honest way: created through the real flow (the e2e founds one,
invites Grace, and collaborates on an org-owned project). *Rejected:* a seeded
org — seed surgery for a feature the runtime path must prove anyway.

### Build order (each shippable, tested, spec-ledgered)

- **O1 — server core. ✅ BUILT (2026-07-12).** `Membership.home` marks the
  namespace seat (seeds/`createUser` stamp it; `homeOf` resolves it; `rehydrate`
  normalizes legacy first-rows and walls org seats out of every namespace);
  `POST /orgs` (founder = owner), the invite lifecycle (create / accept /
  decline / revoke — email-keyed, existence-hidden: known and unknown addresses
  answer identically, a wrong-party verdict is the same 404), `GET /me/orgs` +
  `GET /me/invites`, org walls (outsider 404, member-non-owner 403, person
  namespaces take no org machinery). The invite BELL ships with its door in O3
  (a bell without a door is the anti-pattern the notification-doors lock
  exists for). Locks: `tests/orgs.test.ts`.
- **O2 — walls + owner picker:** `visibleTenants` union at the project walls
  and the notification/event funnels; `ownerTenantId` on project creation
  (op + route, INV-9-refused when not a held org); the Projects-list org band.
- **O3 — UI:** the chip menu's **Organizations** section (rows are DOORS to
  org pages + "New organization…" — unlike the deleted workspace rows, nothing
  re-mints); the org page's member panel (members, invites, accept/decline);
  the New-project owner picker; the create-project consent card naming the
  resolved owner.
