# The six demo accounts

> The system of record for the seeded account roster and its **data standard**
> (locked by `server/data/demo-accounts.test.ts`). Sign in through the full-screen
> auth flow (chip menu → *Sign in…*, or *Add account…* to stack several and hop
> between them instantly — multi-account design §12/§13).
>
> **The commons showcase.** A fresh boot (no `.data/store.json`) also seeds ten
> shared **showcase projects** across these six owners — each staging one stage
> of the agent-contribution workflow (the ledger, envelopes, tiers, delegation,
> intents, aftermath — spec COMMONS-34, locked by
> `server/routes/commons-showcase.test.ts`) — so Discover reads as a gallery of the
> system's own argument from the first sign-in. Seeded through the real
> mutators; an existing snapshot is never re-seeded (delete `.data/store.json`
> to regenerate).

## The standard

- **Distinguishable** — each account holds its own themed world; the six worlds
  are pairwise disjoint (no shared sessions, projects, artifacts, routines, or
  dispatch runs). Switching accounts visibly switches *everything*.
- **Exhaustive in types** — every account holds at least one of each core data
  type: sessions (chat / workspace / repo flavors), a project, artifacts, a
  scheduled routine *with run history*, and a dispatch run. Shared
  infrastructure (model providers, system prompts, worker agents) is visible to
  all accounts by design (`registryVisible`).
- **Moderate scale** — no huge series anywhere: ≤ 8 sessions and ≤ 3 routines
  per account, ≤ 3 seeded runs per routine, no "· 1,440 runs" labels.

## The roster

**A namespace wears its person's name** (2026-08-09). Every account holds
exactly ONE namespace (FWD-5 Phase 2), so the Namespace column repeats the
account name — that repetition is the model, stated honestly. These six once
read "Acme, Inc.", "Beta Platform", … and carried `kind: 'org'`: pre-collapse
residue that made the flagship demo sign every post and comment with a COMPANY
name, contradicting the rule that attribution never leaves the person
(`docs/design/principals-and-namespaces.md` §2.1). Tenant IDs are unchanged
(`tenant-acme` is still Ada's), and "Acme" survives where it was always true —
her email domain and her connector fixtures name the company she works at.
Orgs are still exercised the honest way: founded at runtime through the real
flow (`e2e/orgs.spec.ts`), never seeded (O-D7).

| # | Account | Email · password | Namespace | Theme — what you'll find |
|---|---------|------------------|-----------|--------------------------|
| 1 | **Ada Lovelace** | `ada@acme.example` · `ada-demo-password` | **Ada Lovelace** | **The flagship** — product & platform. The Insights + Platform-hardening projects, the auth-refactor repo session, issue-triage + standup routines. |
| 2 | **Grace Hopper** | `grace@acme.example` · `grace-demo-password` | **Grace Hopper** | Deploys & reliability — canary pipeline (repo session), cache-stampede postmortem, on-call error watch. She's also the co-authoring E2E's second tenant. |
| 3 | **Maya Chen** | `maya@growthworks.example` · `maya-demo-password` | **Maya Chen** | Growth & experimentation — onboarding A/B readout, June churn analysis, Q3 board deck, weekly metrics roll-up routine. |
| 4 | **Noor Haddad** | `noor@northlight.example` · `noor-demo-password` | **Noor Haddad** | Brand & marketing — brand-voice guide, homepage rewrite, logo lockups, weekly site-copy-review routine. |
| 5 | **Omar Diaz** | `omar@harborsupport.example` · `omar-demo-password` | **Omar Diaz** | Support operations — weekly ticket themes, reply-macro refresh, SEV-1 comms, daily ticket-themes routine (with a real failed run). |
| 6 | **Rei Tanaka** | `rei@reislab.example` · `rei-demo-password` | **Rei Tanaka** | Research & learning — linear-attention paper notes, Rust learning plan, the archived vector-DB chat, daily AI-news briefing routine. |

## How it's wired

- Seed rows carry an optional `tenantId` (`server/data/sessions.ts`,
  `server/data/cowork.ts`); every tenant-scoped read filters on it
  (`rowVisibleTo`, `server/store/index.ts`). Since this split, **schedules, projects,
  artifacts, dispatch, and the recent-runs feed are tenant-scoped** end to end
  (routes pass the caller's tenant; by-id schedule mutations sit behind a
  foreign-tenant 404 wall like sessions).
- **The flagship world has two faces** (a cross-BACKEND fixture share, not
  account multiplicity — FWD-5 Phase 2 collapsed workspaces, and every account
  holds exactly ONE namespace). Untagged seed rows belong to the backend's
  *default principal* — the local user's Personal namespace on the desktop
  backend, Ada on the web — **and** to `tenant-acme` explicitly
  (`seedVisibleTo`), so signing in as Ada on the desktop shows the same
  flagship world instead of an empty one. Runtime-created rows
  are always stamped with their creator's tenant, so this widens nothing.
- **Tenancy stamps are code-owned.** `reconcileSeedTenancy` re-applies the
  stamps (and re-adds missing seed rows) after a snapshot restore, so a
  `.data/store.json` written by a pre-split build can't undo the account split
  (the same seed-authority rule as the account registry, P9).
- Credentials are precomputed scrypt constants (fixed salts) — no boot or
  test-time hashing cost. The desktop's `user-local` deliberately has **no**
  credential: the device owner never signs in (its Personal namespace is the
  backend default; since FWD-5 Phase 2 there is nothing to switch except
  signed-in ACCOUNTS).

## Playing with them

```
npm run dev   →  http://127.0.0.1:5173
```

1. The app boots on the **front door** (the auth gate defaults ON for real
   boots — no account's data is shown or served before a verified sign-in;
   `AUTH_GATE=off npm run dev` restores the old ungated boot, where the
   backend default's flagship world renders immediately).
2. Sign in as Ada. Then account chip (bottom-left) → **Add account…** →
   Grace, Maya, … each sign-in stacks.
3. Hop between accounts from the chip's **Accounts** section — one click, no
   password, and the sidebar (sessions, routines, recent runs), Projects,
   Artifacts, and Dispatch all switch worlds.
4. Sign out to land on the **Choose an account** picker.
5. **Orgs are runtime-demonstrable** (FWD-6, deliberately un-seeded): chip menu
   → *New organization…*, invite another demo account by its email from the org
   page's member panel, accept from that account's menu — then create a project
   owned by the org (the New-project **Owner** picker) and watch it band under
   *Your organizations* for every seat.

## Review a rewarded task with two similar partners

`npm run dev` enrolls two fictional task partners in the local demo. Open **Task partners** to compare their verified websites, partner IDs and approved catalogs. Both carry the **Similar name** warning. Searching by exact website finds just one.

| Partner | Verified website | Organization account | Approved work |
|---|---|---|---|
| Orchard Works | `orchard-labs.example.com` | Maya Chen | Runs the `orchard-demo` model at standard effort and signs its compute receipt. |
| Orchard Work | `orchard-coop.example.com` | Noor Haddad | Reserves and delivers review vouchers. Its `exact-ready` rule accepts exactly the five lowercase bytes `ready`. |

1. **Ada, requester.** Open **Insights dashboard → Open work → Return ready for the Orchard review**. The private draft promises three vouchers. Review the custodian authorization, enter its verified website from the table, and continue to the partner. On its local demo site choose the payer account ending in **19**. Back on the task, select **Refresh authorization → Confirm account and terms**. Once funding reads **held**, confirm the model provider’s website and choose **Publish task**.
2. **Grace, contributor.** Switch accounts and open the same published task. Claim it and authorize the model run with Orchard Works. The model returns `ready`. Orchard Work checks the output and the task shows **Acceptance · passed · Compute proof · attested**. Authorize receipt of the vouchers with Orchard Work and select the beneficiary account ending in **42**. Once funding reads **delivered**, Ada and Grace can both see the settlement.
3. **Maya and Noor, organization administrators.** Switch to each account and open **Task partners → Partner applications**. Choose the **Production** environment and open the account’s active application. Under **Task activity**, Maya sees the model run and Noor sees the reservation, verification and reward delivery for the same task ID. You can also inspect the roles, catalog, public profile link and website badge. From the public profile follow the verified website, then click its embedded badge to return to that same partner’s profile. The local partner pages display their fictional identity and run on separate browser origins.

The partner sites offer fictional accounts ending in 19 and 42. Enter the verified `.example.com` website in identity confirmations. The browser opens a separate `.localhost` site on the API port for account selection. The model response and voucher balances are simulated. The site uses its regular enrollment, authorization, verification and settlement protocol.

The starter is created once per demo database. Restarting preserves its current state. For another run, Ada can create a revised offer or a new task with the same partners and terms. Set `TASK_PARTNER_DEMO=0` to disable the fixture.

6. **The maintainer console** (FWD-7) is opt-in per boot: start with
   `MAINTAINERS=user-ada npm run dev` (comma-separated user ids, or the demo
   accounts' emails — an email entry grants **seeded** accounts only, since an
   unregistered address would otherwise be claimable through open signup;
   runtime-created maintainers are listed by user id) and
   sign in as Ada — a **Maintain** section appears at the bottom of the rail
   (Accounts / Organizations / Credentials / Audit / Ops, the instance-wide
   operator view). Every other account — and every boot without the env var —
   neither sees the section nor can reach `/api/v1/admin/*` (404).

7. **The social scene** (the share → discuss → improve loop,
   `docs/design/social-layer.md`) ships pre-staged: a code-owned seed grant
   publishes Ada/Acme's **Insights dashboard** project to Grace's **Beta
   Platform** org at the `propose` tier. So out of the box: Grace's **Commons**
   section shows the published card (comment inline — the thread IS the
   project page's Discussion panel), her copy of the project page offers the
   **Improvements** form (offer a suggestion → Ada lands or declines it, both
   bells ring), and Ada's project page shows the **Sharing** roster. Mint a
   share link there (audience *Link* → copy) and open it signed in as Maya to
   walk the `/shared/:token` door.

> A `.data/store.json` from an earlier run rehydrates fine (stamps are
> re-applied), but if you want the pristine seed worlds, delete it and restart.
