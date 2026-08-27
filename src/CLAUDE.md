<!-- context-schema: v1 -->
# src/ — UI layer index

## Scope

Cross-module UI laws only. Detailed rationale and decision history live in
[`DESIGN.md`](DESIGN.md); module-local rules live in each module's context.

## Read path

| Working on | Load next |
|---|---|
| Shared primitives, registries, pure projection models | [`lib/CLAUDE.md`](lib/CLAUDE.md) |
| Rendered pages, rail, dialogs, controls | [`components/CLAUDE.md`](components/CLAUDE.md) |
| Cache, events, hooks, API paths | [`api/CLAUDE.md`](api/CLAUDE.md) |
| Mutating command sequences | [`controller/CLAUDE.md`](controller/CLAUDE.md) |
| Presentation derivations and state machines | [`data/CLAUDE.md`](data/CLAUDE.md) |
| Visual, interaction, navigation, and workspace rationale | [`DESIGN.md`](DESIGN.md) |
| Browser-only behavior | [`e2e/CLAUDE.md`](../e2e/CLAUDE.md) |

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| UI-P1 | product | Agent Commons has one collaboration workspace; conversations and resource pages compose in the same split surface. | [`main.tsx`](main.tsx) · [`components/MainSplit.tsx`](components/MainSplit.tsx) | [`tests/product-identity.test.ts`](../tests/product-identity.test.ts) · [`e2e/main-split.spec.ts`](../e2e/main-split.spec.ts) | parent ROOT-P1 |
| UI-A1 | architecture | Components read hooks, controllers issue commands, and no other UI code knows backend URLs or SSE names. | [`api/`](api/) · [`controller/`](controller/) | [`tests/contract-boundaries.test.ts`](../tests/contract-boundaries.test.ts) | refines ROOT-A1; requires CONTRACT-A1 |
| UI-A2 | architecture | Registries, collections, and page/rail projections have one runtime description and shared templates. | [`lib/collectionProjection.ts`](lib/collectionProjection.ts) · [`components/ResourcePage.tsx`](components/ResourcePage.tsx) | [`lib/collection-projection.test.ts`](lib/collection-projection.test.ts) · [`e2e/collection-symmetry.spec.ts`](../e2e/collection-symmetry.spec.ts) | refines ROOT-A1; symmetric-with ROOT-E2 |
| UI-A3 | architecture | Every page is an equal split-workspace pane; focus determines navigation and the address bar. | [`components/MainSplit.tsx`](components/MainSplit.tsx) · [`lib/splitFrame.ts`](lib/splitFrame.ts) | [`lib/split-frame.test.ts`](lib/split-frame.test.ts) · [`e2e/main-split.spec.ts`](../e2e/main-split.spec.ts) | refines ROOT-P1; requires UI-E4 |
| UI-A4 | architecture | The shell and conversation path are the cold graph; section pages form one on-demand boundary, and production budgets measure complete initial/async graphs rather than filenames alone. | [`components/MainSplit.tsx`](components/MainSplit.tsx) · [`../scripts/bundleBudget.ts`](../scripts/bundleBudget.ts) · [`../vite.config.ts`](../vite.config.ts) | [`components/code-splitting.test.ts`](components/code-splitting.test.ts) · [`../tests/bundle-budget.test.ts`](../tests/bundle-budget.test.ts) · [`../e2e/section-loading.spec.ts`](../e2e/section-loading.spec.ts) | refines ROOT-P1; requires UI-A3 |
| UI-E1 | experience | Theme, palette, type, ledger, focus, elevation, and solid-fill seats come from shared tokens and primitives. | [`index.css`](index.css) · [`lib/theme.ts`](lib/theme.ts) · [`lib/ledger.ts`](lib/ledger.ts) | [`lib/theme.test.ts`](lib/theme.test.ts) · [`lib/ledger.test.ts`](lib/ledger.test.ts) · [`lib/type-scale.test.ts`](lib/type-scale.test.ts) | refines ROOT-E1 |
| UI-E2 | experience | Form follows function: equal roles share one component, cue, behavior, and review handle. | [`lib/`](lib/) · [`components/ResourcePage.tsx`](components/ResourcePage.tsx) | [`lib/page-grammar.test.ts`](lib/page-grammar.test.ts) · [`lib/button.test.ts`](lib/button.test.ts) | refines ROOT-E1 |
| UI-E3 | experience | Surface follows entity nature; an addressable resource has one canonical page shared by every viewer. | [`lib/resourceNature.ts`](lib/resourceNature.ts) · [`components/ResourcePage.tsx`](components/ResourcePage.tsx) | [`lib/resource-nature.test.ts`](lib/resource-nature.test.ts) · [`e2e/project-page.spec.ts`](../e2e/project-page.spec.ts) | refines ROOT-E1; requires UI-E4 |
| UI-E4 | experience | Rail, URL, history, and split views are projections of one navigation ontology. | [`lib/sections.tsx`](lib/sections.tsx) · [`lib/urlRoutes.ts`](lib/urlRoutes.ts) · [`lib/paneHistory.ts`](lib/paneHistory.ts) | [`lib/url-routes.test.ts`](lib/url-routes.test.ts) · [`lib/pane-history.test.ts`](lib/pane-history.test.ts) | refines ROOT-E2; requires UI-A2 |
| UI-E5 | experience | A composite capability remains available in both main-page and rail projections, adapting only its density. | [`lib/compositeFeatures.ts`](lib/compositeFeatures.ts) · [`components/CompositeRailControls.tsx`](components/CompositeRailControls.tsx) | [`lib/composite-features.test.ts`](lib/composite-features.test.ts) · [`e2e/collection-symmetry.spec.ts`](../e2e/collection-symmetry.spec.ts) | symmetric-with ROOT-E2; requires UI-A2 |
| UI-E6 | experience | A conversation opens on a bounded newest tail, mounts at most one shared message window per pane, and keeps older history, direct-turn focus, consent, live updates, context accounting, and a persistent in-viewport jump-to-latest path coherent. | [`api/sessionPaging.ts`](api/sessionPaging.ts) · [`lib/messageWindow.ts`](lib/messageWindow.ts) · [`controller/conversationCore.ts`](controller/conversationCore.ts) · [`components/ConversationView.tsx`](components/ConversationView.tsx) | [`lib/message-window.test.ts`](lib/message-window.test.ts) · [`controller/conversation-store.test.ts`](controller/conversation-store.test.ts) · [`data/consent-state.test.ts`](data/consent-state.test.ts) · [`e2e/history-pagination.spec.ts`](../e2e/history-pagination.spec.ts) | refines ROOT-P1; requires UI-A1 |
| UI-D1 | data-access | The frontend is a live cache of server-owned state; local data describes presentation, never fixture entities. | [`api/cache.ts`](api/cache.ts) · [`data/`](data/) | [`api/connectivity-freshness.test.ts`](api/connectivity-freshness.test.ts) · [`data/escalation-funnel.test.ts`](data/escalation-funnel.test.ts) | refines ROOT-A1; requires SERVER-D3 |
| UI-D2 | data-access | Every shipped UI capability passes through declared API paths so access parity can be derived. | [`api/keys.ts`](api/keys.ts) · [`api/hooks.ts`](api/hooks.ts) | [`tests/access-surface-parity.test.ts`](../tests/access-surface-parity.test.ts) | refines ROOT-D2; requires UI-A1 |
| UI-V1 | verification | Put pure logic in `lib`, structural source locks beside components, and browser facts in E2E. | [`lib/`](lib/) · [`components/`](components/) · [`e2e/`](../e2e/) | [`tests/suite-paths.test.ts`](../tests/suite-paths.test.ts) · [`tests/verify-plan.test.ts`](../tests/verify-plan.test.ts) | refines ROOT-V1 |
<!-- context-rules:end -->

## Verification

Run `npm run typecheck` and the colocated suites for changed modules. UI changes
also follow [`docs/agent-workflow.md`](../docs/agent-workflow.md) and the signed-in
review procedure. A rule whose implementation or lock changes must update its
row and, when rationale changes, the relevant category in [`DESIGN.md`](DESIGN.md).
