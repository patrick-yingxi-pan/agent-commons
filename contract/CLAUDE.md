<!-- context-schema: v1 -->
# contract/ — shared wire-contract index

## Scope

Framework-free types and reducers imported verbatim by UI and server. The
always-on map is [`AGENTS.md`](../AGENTS.md).

## Read path

Read the contract module being changed, its sibling suite when present, and
[`docs/spec/05-portable-contract.md`](../docs/spec/05-portable-contract.md).
For cross-layer seams also read
[`tests/contract-boundaries.test.ts`](../tests/contract-boundaries.test.ts).

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| CONTRACT-A1 | architecture | UI and server import one framework-free wire contract verbatim. | [`index.ts`](index.ts) · [`api.ts`](api.ts) | [`tests/contract-boundaries.test.ts`](../tests/contract-boundaries.test.ts) | refines ROOT-A2 |
| CONTRACT-A2 | architecture | Shared reducers define graph behavior once for both sides. | [`graph.ts`](graph.ts) | [`shared-reducer.test.ts`](shared-reducer.test.ts) | refines ROOT-A1; requires CONTRACT-A1 |
| CONTRACT-D1 | data-access | Every optional request field has fixed absence semantics. | [`api.ts`](api.ts) · [`relations.ts`](relations.ts) | [`tests/spec-conformance.test.ts`](../tests/spec-conformance.test.ts) | refines ROOT-D1 |
| CONTRACT-D2 | data-access | Backend capabilities gate native-only UI behavior. | [`api.ts`](api.ts) | [`server/routes/capability-remote.test.ts`](../server/routes/capability-remote.test.ts) | refines ROOT-A2; requires CONTRACT-A1 |
| CONTRACT-V1 | verification | New boundary seams extend the cross-layer contract scan. | [`index.ts`](index.ts) | [`tests/contract-boundaries.test.ts`](../tests/contract-boundaries.test.ts) | refines ROOT-V1 |
<!-- context-rules:end -->

## Details

- **The locks live here too.** The suites that pin the contract's own behavior —
  the shared reducer, the roles/audit/runs/probe/proxy shapes, relation content
  previews — sit beside the modules they lock as `<module>.test.ts`, excluded
  from `tsconfig.json` like every other suite. The *cross-layer* scan that
  proves this directory imports nothing framework- or Node-shaped stays at
  `tests/contract-boundaries.test.ts`, because its subject is the boundary
  between layers rather than any one module here.
- **The contract is load-bearing.** `contract/*.ts` is imported *verbatim* by
  both the Vite UI and the Node server — that type-identity **is** the
  portability guarantee (spec pillar
  [`docs/spec/05-portable-contract.md`](../docs/spec/05-portable-contract.md)).
  Don't add framework or Node-only types to `contract/`, and keep the client
  and server reducers (`contract/graph.ts`) in agreement.
- **Capabilities gate native-only surface.** `GET /v1/capabilities` declares
  what a backend can do; a remote backend answers native-only endpoints with
  `409 capability_unavailable`. The UI must read the flags, never assume the
  mock backend's shape.
- **Absence has fixed meaning (INV-9).** When adding a request field, classify
  its absence (inherit / complete-set constant / minimal-risk none) or refuse
  it — full statement in
  [`docs/spec/09-design-invariants.md`](../docs/spec/09-design-invariants.md).
- **Boundary seams are tested.** New cross-component seams extend
  `tests/contract-boundaries.test.ts`.

## Verification

Run `npm run typecheck`, the changed module's sibling suite, and
[`tests/contract-boundaries.test.ts`](../tests/contract-boundaries.test.ts).
