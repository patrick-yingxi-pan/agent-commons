<!-- context-schema: v1 -->
# e2e/ — browser E2E index

## Scope

Rendered browser wiring that `node --test` cannot prove. The always-on map is
[`AGENTS.md`](../AGENTS.md).

## Read path

Read the affected spec, [`tests/CLAUDE.md`](../tests/CLAUDE.md) for evidence
discipline, and the owning UI module context. The stack is isolated from any
running preview.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| E2E-V1 | verification | E2E proves rendered layout, focus, scroll, accessibility wiring, and cross-tenant walks—not store logic already locked below. | [`../src/components/`](../src/components/) · [`social-helpers.ts`](social-helpers.ts) | [`responsive.spec.ts`](responsive.spec.ts) · [`keyboard-resize.spec.ts`](keyboard-resize.spec.ts) | refines ROOT-V1 |
| E2E-V2 | verification | Assertions target the rendered subject structurally and state every precondition; no textarea mirrors, vacuous counts, or clean-store assumptions. | [`social-helpers.ts`](social-helpers.ts) | [`social-sharing.spec.ts`](social-sharing.spec.ts) · [`project-page.spec.ts`](project-page.spec.ts) | refines ROOT-V1 |
| E2E-V3 | verification | Core pages, their shared chrome, narrow projections, and creation dialogs pass one exclusion-free WCAG 2.2 AA scan after finite entrance motion settles. | [`accessibility-helpers.ts`](accessibility-helpers.ts) · [`../src/lib/theme.ts`](../src/lib/theme.ts) · [`../src/components/ResourcePage.tsx`](../src/components/ResourcePage.tsx) | [`accessibility-audit.spec.ts`](accessibility-audit.spec.ts) | refines E2E-V1; requires UI-E28 |
| E2E-V4 | verification | A rendered two-device Agent conflict proves the held sparse form, disabled draft, public recovery action, stable logical retry key, revision rebase, and preservation of an untouched remote field. | [`../src/components/SectionView.tsx`](../src/components/SectionView.tsx) · [`../src/components/AgentMutationNotice.tsx`](../src/components/AgentMutationNotice.tsx) | [`agent-mutations.spec.ts`](agent-mutations.spec.ts) | refines E2E-V1; requires UI-E29 |
| E2E-V5 | verification | A rendered two-device provider conflict proves the held sparse form, disabled draft, public recovery action, stable logical retry key, definition rebase, and preservation of an untouched remote family. | [`../src/components/SectionView.tsx`](../src/components/SectionView.tsx) · [`../src/components/ProviderDefinitionMutationNotice.tsx`](../src/components/ProviderDefinitionMutationNotice.tsx) | [`provider-definition-mutations.spec.ts`](provider-definition-mutations.spec.ts) | refines E2E-V1; requires UI-E30 |
| E2E-O1 | operations | E2E boots an isolated remote-backend stack on 5183/5184 with a pinned local model endpoint. | [`../playwright.config.ts`](../playwright.config.ts) · [`wipe-store.mjs`](wipe-store.mjs) | [`../tests/verify-plan.test.ts`](../tests/verify-plan.test.ts) | requires E2E-V1 |
<!-- context-rules:end -->

## Details

`npm run e2e` needs the browser once: `npx playwright install chromium`. It
drives the **rendered UI** (the layer `node --test` can't — no DOM), booting
its **own** stack on dedicated ports (UI 5183 / API 5184 — it never reuses a
running dev server, whose mode and store can't be trusted) with an isolated
store (`DATA_FILE=.data/e2e-store.json`), `BACKEND=remote` (so Playwright
browser contexts impersonate **tenants** via the identity headers), and a
pinned local `ANTHROPIC_BASE_URL` (an ambient one would stand the mock model
down). The store/route suites lock the logic; the E2E locks the wiring.

Anchor specs:

- `e2e/co-author-article.spec.ts` — the two-tenant multi-tenancy regression.
- `e2e/account-switch.spec.ts` — the switch-mid-generation crux of
  `docs/design/multi-account-ui.md`; the in-app account switcher is live.
- `e2e/auth-wizard.spec.ts` + `e2e/onboarding.spec.ts` — the §12 front door:
  the full-screen sign-up wizard and the multi-account stack.
- `e2e/responsive.spec.ts` — the viewport ladder at phone/tablet/landscape
  sizes: the narrow-tier rail drawer, the full-viewport panel takeover, and
  the `short:` chrome compression (spec ADAPT-11).
- `e2e/panel-preferences.spec.ts` — two isolated browser contexts prove the
  reader's close/open intent comes from the server and reconciles live, not
  from shared localStorage.
- **The social layer — three specs, one walk each**, sharing setup through
  `e2e/social-helpers.ts`. They were one 1,611-line file until it measured 26%
  of the whole E2E suite; because a lane can never be shorter than its longest
  spec, that one file set a floor no sharding could beat (see
  `scripts/verifyPlan.mjs`). The tests are unchanged and were already
  independent — no constant was shared between any two of them.
  - `e2e/social-sharing.spec.ts` — publish → the audience's Commons card → one
    root thread across card and entity page → an offered change landing as L1
    in the merged Changes panel; the `/shared/:token` link-redeem door; the
    shared CONVERSATION, ROUTINE and ARTIFACT faces.
  - `e2e/social-anchors.spec.ts` — a discussion anchored to a POSITION: the
    **turn gutter** (minted from a turn's hover gutter, resolved back by the
    thread page's anchor chip — spec pillar 12), the same gutter on a routine's
    run and on an artifact's **block** (SOCIAL-6c: hover-revealed opener,
    marker-only-once-a-thread-exists, the chip's landing — all DOM, none of it
    visible to `node --test`), the turn fork, and the reply chain. The turn walk
    sets a SHORT viewport on purpose: a conversation opens at the bottom, so the
    earliest turn must be off-screen or "landed on the turn" passes vacuously.
  - `e2e/social-square.spec.ts` — the Commons lenses and the empty world, follow
    → the Following lens, and the **mention picker** completing a multi-word
    display name with the server resolving what it inserted: on the reply
    composer (roster = the thread's voices) and on the **square**, where a post
    has no thread yet so the roster is the viewer's follows plus the feed
    bylines, and where the walk also holds the list's PORTAL (it escapes its
    composer to `document.body` and takes its position from the field).

Spec gotchas: the app **opens on a fresh draft** (sending materializes a new
session), and the sidebar is an `<aside>` (role `complementary`) — only its
nav buttons carry a `navigation` role.

- **Never assert a posted body with `getByText`.** React mirrors a controlled
  `<textarea>`'s value into its `defaultValue`, and a textarea's `defaultValue`
  IS its text content — so `getByText(BODY)` matches the still-OPEN composer
  holding the draft. "The reply is visible" then goes green *before* the reply
  exists, and whatever runs next races a write nothing waited for (found
  2026-08-11: two assertions passed and the structural check after them read a
  half-rendered thread). Assert on the rendered body element —
  `locator('p', { hasText: BODY })` — which only the posted post can be.
- **The e2e store PERSISTS across runs** (`.data/e2e-store.json`, gitignored),
  and accumulated state eventually shows up as *locator timeouts in unrelated
  specs* — two consecutive full runs failed in two different walks
  (`keyboard-resize`, then `co-author-article`), each passing in isolation.
  Deleting the file restored all 72. So: before blaming a change for a flaky
  full-suite run, clear the store and re-run — and remember the flip side that
  `tests/CLAUDE.md` already warns about, that a precondition only true on a
  clean store is a precondition true exactly once.
- **Prefer containment over counting for structural claims.** The reply-chain
  walk measured nesting by counting a `ul`'s `UL` ancestors; it was off by one
  and said nothing about *which* post had landed where. `parentRow.locator('li')
  .filter({ has: page.locator('p', { hasText: X }) })` states the claim
  directly and fails on a flat render.
- **A definition mutation needs a test-owned entity.** Shards may mutate the
  same seeded routine concurrently, and the E2E store also survives later runs.
  Create the routine/project/artifact through its real product route when the
  walk revises it; a unique row locator cannot prevent competing base revisions.

## Verification

Run the affected spec first, then `npm run e2e` or `npm run verify`. Clear only
the isolated E2E store when diagnosing accumulated-state flakiness; never make a
test depend on that cleanup.
