# The six demo accounts

> The system of record for the seeded account roster and its **data standard**
> (locked by `tests/demo-accounts.test.ts`). Sign in through the full-screen
> auth flow (chip menu → *Sign in…*, or *Add account…* to stack several and hop
> between them instantly — multi-account design §12/§13).

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

| # | Account | Email · password | Namespace | Theme — what you'll find |
|---|---------|------------------|-----------|--------------------------|
| 1 | **Ada Lovelace** | `ada@acme.example` · `ada-demo-password` | **Acme, Inc.** (org) | **The flagship** — product & platform. The Insights + Platform-hardening projects, the auth-refactor repo session, issue-triage + standup routines. |
| 2 | **Grace Hopper** | `grace@acme.example` · `grace-demo-password` | **Beta Platform** (org) | Deploys & reliability — canary pipeline (repo session), cache-stampede postmortem, on-call error watch. She's also the co-authoring E2E's second tenant. |
| 3 | **Maya Chen** | `maya@growthworks.example` · `maya-demo-password` | **Growthworks** (org) | Growth & experimentation — onboarding A/B readout, June churn analysis, Q3 board deck, weekly metrics roll-up routine. |
| 4 | **Noor Haddad** | `noor@northlight.example` · `noor-demo-password` | **Northlight Studio** (org) | Brand & marketing — brand-voice guide, homepage rewrite, logo lockups, weekly site-copy-review routine. |
| 5 | **Omar Diaz** | `omar@harborsupport.example` · `omar-demo-password` | **Harbor Support** (org) | Support operations — weekly ticket themes, reply-macro refresh, SEV-1 comms, daily ticket-themes routine (with a real failed run). |
| 6 | **Rei Tanaka** | `rei@reislab.example` · `rei-demo-password` | **Rei's Lab** (personal) | Research & learning — linear-attention paper notes, Rust learning plan, the archived vector-DB chat, daily AI-news briefing routine. |

## How it's wired

- Seed rows carry an optional `tenantId` (`server/data/sessions.ts`,
  `server/data/cowork.ts`); every tenant-scoped read filters on it
  (`rowVisibleTo`, `server/store.ts`). Since this split, **schedules, projects,
  artifacts, dispatch, and the recent-runs feed are tenant-scoped** end to end
  (routes pass the caller's tenant; by-id schedule mutations sit behind a
  foreign-tenant 404 wall like sessions).
- **The flagship world has two faces** (a cross-BACKEND fixture share, not
  account multiplicity — FWD-5 Phase 2 collapsed workspaces, and every account
  holds exactly ONE namespace). Untagged seed rows belong to the backend's
  *default principal* — the local user's Personal namespace on the desktop
  backend, Ada/Acme on the web — **and** to `tenant-acme` explicitly
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

1. The app boots as the backend default (the flagship world).
2. Account chip (bottom-left) → **Sign in…** → Ada. Then **Add account…** →
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

> A `.data/store.json` from an earlier run rehydrates fine (stamps are
> re-applied), but if you want the pristine seed worlds, delete it and restart.
