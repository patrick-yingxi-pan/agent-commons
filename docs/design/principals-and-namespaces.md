# Principals & namespaces — the GitHub/HF identity model, plus agents

> **Status: BUILT — all four phases (decided AND executed 2026-07-12).** Settled
> in a design dialogue and recorded here per the repo rule that decisions live in
> files, not agent memory; implemented the same day as phases 1–4 below (each
> with its locks). Now invariant **INV-10**
> ([`../spec/09-design-invariants.md`](../spec/09-design-invariants.md)); the
> **orgs phase stays deferred by design** (§4.1 — the opaque owner id is the
> re-entry seam). The pre-collapse workspace model survives only as history in
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

**Deferred phase — orgs.** Memberships, org creation/joining, org-owned
registries, the owner picker on create flows, org profile = the same D21 page.
Build only when the thesis needs an org actor; the contract seam (§4.1) is the
guarantee this is additive.

## 7. Open questions (deliberately left)

- Whether sessions can ever be **org-owned** (GitHub has no analog — issues are
  the closest; revisit with orgs).
- Whether the **desktop** ever grows a second signed-in human (today: one local
  user, account stack is a web concern).
- Federation identity (BROKER-EXP-5) — namespace names across instances; the
  A2A import stub's lineage is the current answer.
