<!-- context-schema: v1 -->
# AGENTS.md — repository context map

## Scope

This repository is **Agent Commons**, an agents-collaboration platform where
people configure agents, work through adaptive conversations, and coordinate
shared projects, resources, routines, and proposals. The frontend, HTTP + SSE
backend, MCP access doors, model seam, and session-relay connector are real
boundaries; seeded data, the development model, and development connector/MCP
fulfilment remain deterministic fixtures. Release profiles fail closed at the
connector runtime until a real adapter is configured.
Read [`README.md`](README.md) for the engineering tour and
[`docs/spec/11-mock-boundary.md`](docs/spec/11-mock-boundary.md) for the explicit
mock boundary.

This file is a map. The disclosure model, category order, and rule-record schema
are defined in [`docs/context-system.md`](docs/context-system.md).

## Start and verify

Requires Node 26+.

```bash
npm install
npm run dev       # UI 127.0.0.1:5173 + API 127.0.0.1:8787
npm run typecheck
node --test
npm run verify    # typecheck + node suite + build + sharded E2E
```

The auth gate defaults on. Flagship credentials are
`ada@acme.example` / `ada-demo-password`; all six accounts are in
[`docs/demo-accounts.md`](docs/demo-accounts.md). Use `127.0.0.1`, not
`localhost`, because the account stack is origin-local.

## Rule index

These are the top-level design laws. Scoped contexts refine them and correlate
their local implementation and evidence.

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| ROOT-P1 | product | Agent Commons is one collaboration platform: conversations and resource pages are equal workspace surfaces. | [`src/App.tsx`](src/App.tsx) · [`src/components/MainSplit.tsx`](src/components/MainSplit.tsx) | [`tests/product-identity.test.ts`](tests/product-identity.test.ts) · [`e2e/main-split.spec.ts`](e2e/main-split.spec.ts) | root |
| ROOT-P2 | product | Mock behavior is explicit, deterministic, and distinguishable from built boundaries. | [`server/data/`](server/data/) · [`server/model/`](server/model/) | [`server/data/demo-accounts.test.ts`](server/data/demo-accounts.test.ts) · [`tests/spec-conformance.test.ts`](tests/spec-conformance.test.ts) | root |
| ROOT-A1 | architecture | Every concept has one authoritative description; other surfaces are generated or live projections. | [`server/routes/index.ts`](server/routes/index.ts) · [`src/lib/collectionProjection.ts`](src/lib/collectionProjection.ts) | [`tests/access-surface-parity.test.ts`](tests/access-surface-parity.test.ts) · [`src/lib/collection-projection.test.ts`](src/lib/collection-projection.test.ts) | root |
| ROOT-A2 | architecture | Build real, replaceable boundaries between UI, backend, model, connectors, and the native host. | [`contract/`](contract/) · [`server/generate.ts`](server/generate.ts) · [`connector/`](connector/) · [`desktop/`](desktop/) | [`tests/contract-boundaries.test.ts`](tests/contract-boundaries.test.ts) · [`server/model/generate.test.ts`](server/model/generate.test.ts) · [`desktop/runtime.test.ts`](desktop/runtime.test.ts) | root |
| ROOT-E1 | experience | Form follows function and surface follows entity nature; equal roles share one vocabulary. | [`src/lib/`](src/lib/) · [`src/components/ResourcePage.tsx`](src/components/ResourcePage.tsx) | [`src/lib/page-grammar.test.ts`](src/lib/page-grammar.test.ts) · [`src/lib/resource-nature.test.ts`](src/lib/resource-nature.test.ts) | root |
| ROOT-E2 | experience | Symmetric projections expose the same structure and capabilities while adapting density to context. | [`src/components/ResourcePage.tsx`](src/components/ResourcePage.tsx) · [`src/components/SectionTreeChildren.tsx`](src/components/SectionTreeChildren.tsx) | [`e2e/collection-symmetry.spec.ts`](e2e/collection-symmetry.spec.ts) | requires ROOT-A1 |
| ROOT-D1 | data-access | Absence and identity have fixed contract meaning; convenience never guesses mutable or privileged state. | [`contract/`](contract/) · [`server/http/router.ts`](server/http/router.ts) | [`tests/spec-conformance.test.ts`](tests/spec-conformance.test.ts) | requires ROOT-A2 |
| ROOT-D2 | data-access | UI, permitted in-session MCP, and authenticated remote MCP share semantic capabilities and authorization. | [`server/apiSurface.ts`](server/apiSurface.ts) · [`server/mcp.ts`](server/mcp.ts) | [`tests/access-surface-parity.test.ts`](tests/access-surface-parity.test.ts) · [`server/mcp-parity.test.ts`](server/mcp-parity.test.ts) | requires ROOT-A1; requires ROOT-D1 |
| ROOT-V1 | verification | A rule lives with its owner and names both implementation and a lock that has been watched fail. | [`tests/CLAUDE.md`](tests/CLAUDE.md) · [`docs/spec/`](docs/spec/) | [`tests/context-structure.test.ts`](tests/context-structure.test.ts) · [`tests/suite-paths.test.ts`](tests/suite-paths.test.ts) | root |
| ROOT-V2 | verification | Every proposed or pushed revision passes the complete local verifier before landing; GitHub Actions is manual-only optional diagnostics, never a delivery dependency. | [`docs/agent-workflow.md`](docs/agent-workflow.md) · [`.github/workflows/verify.yml`](.github/workflows/verify.yml) · [`scripts/verify.mjs`](scripts/verify.mjs) · [`scripts/verifyPlan.mjs`](scripts/verifyPlan.mjs) | [`tests/ci-workflow.test.ts`](tests/ci-workflow.test.ts) · [`tests/verify-plan.test.ts`](tests/verify-plan.test.ts) | requires ROOT-V1 |
<!-- context-rules:end -->

## Read path

| Working on | Load next |
|---|---|
| Shared wire types, reducers, capability contract | [`contract/CLAUDE.md`](contract/CLAUDE.md) |
| Backend, routes, store, auth, model, persistence | [`server/CLAUDE.md`](server/CLAUDE.md) |
| UI primitives, pages, rail, navigation, split workspace | [`src/CLAUDE.md`](src/CLAUDE.md) |
| Test placement, spec ledger, non-vacuous locks | [`tests/CLAUDE.md`](tests/CLAUDE.md) |
| Browser E2E stack and browser-only assertions | [`e2e/CLAUDE.md`](e2e/CLAUDE.md) |
| Session-relay connector | [`connector/CLAUDE.md`](connector/CLAUDE.md) |
| Electron lifecycle, security, and packaging | [`desktop/CLAUDE.md`](desktop/CLAUDE.md) |
| MCP capability symmetry | [`docs/mcp-access.md`](docs/mcp-access.md) |
| UI review and invariant ledger | [`docs/ui-invariants.md`](docs/ui-invariants.md) · [`docs/review-rulebook.md`](docs/review-rulebook.md) |
| Shipped vs mocked requirements | [`docs/spec/README.md`](docs/spec/README.md) · [`docs/spec/11-mock-boundary.md`](docs/spec/11-mock-boundary.md) |
| Delivery, signed-in review, MCP copy, landing | [`docs/agent-workflow.md`](docs/agent-workflow.md) |

Each layer index points to module contexts. Open only the module and decision
detail needed for the change; do not preload neighboring manuals.

## Delivery contract

- Preserve type identity: both UI and server import `contract/*.ts` verbatim.
- Every feature updates its automated locks and spec-ledger rows.
- Verify UI changes in the running app with demo accounts stacked; leave Ada
  signed in so the owner can continue testing.
- Review the diff after tests pass, fix findings, commit, and push straight to
  `main` over HTTPS. Preserve unrelated user changes.
- Keep the MCP door and quoted UI copy synchronized with the route-owned access
  model. Details and procedures live in
  [`docs/agent-workflow.md`](docs/agent-workflow.md).

## Repository map

```text
contract/   framework-free wire types and reducers
server/     mock backend, model boundary, routes, persistence, seed data
src/        React UI, API cache, controllers, primitives, rendered surfaces
connector/  self-contained session-relay connector
desktop/    secure Electron lifecycle and local-backend host
e2e/        rendered browser wiring
tests/      repository-owned doc and cross-layer locks
docs/       design rationale, operational guides, and the spec ledger
```
