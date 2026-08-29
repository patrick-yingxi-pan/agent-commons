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
| CONTRACT-D3 | data-access | A send retry is explicit: absent `retryLastUser` appends a new user turn; true may reuse only the matching unresolved final user row. | [`api.ts`](api.ts) | [`server/send-idempotency.test.ts`](../server/send-idempotency.test.ts) | refines CONTRACT-D1; requires CONTRACT-A1 |
| CONTRACT-D4 | data-access | Viewer conversation preferences preserve absent-default, explicit-close, and named-focus as distinct states; one shared validator decides whether a focus is attached. | [`entities.ts`](entities.ts) · [`api.ts`](api.ts) | [`server/sessionPreferences.test.ts`](../server/sessionPreferences.test.ts) · [`server/routes/session-preferences.test.ts`](../server/routes/session-preferences.test.ts) | refines CONTRACT-D1; requires CONTRACT-A1 |
| CONTRACT-D5 | data-access | Session context binding edits and the complete visible workspace form one idempotent transaction; operation absence is refused and attach scope alone defaults to the fixed `*` boundary. | [`contexts.ts`](contexts.ts) · [`api.ts`](api.ts) | [`../server/routes/session-contexts.test.ts`](../server/routes/session-contexts.test.ts) | refines CONTRACT-D1; requires CONTRACT-A1 |
| CONTRACT-D6 | data-access | A relation graph is a server-owned snapshot with a monotonic revision; pure graph reduction preserves that revision while server application advances it. | [`api.ts`](api.ts) · [`graph.ts`](graph.ts) | [`shared-reducer.test.ts`](shared-reducer.test.ts) · [`../server/routes/relations-commons.test.ts`](../server/routes/relations-commons.test.ts) | refines CONTRACT-A2; requires CONTRACT-A1 |
| CONTRACT-D7 | data-access | Conversation row metadata has a server-owned revision separate from transcript activity; a supplied expected revision is a compare-and-swap precondition, while absence retains the declared legacy unconditional-write meaning. | [`entities.ts`](entities.ts) · [`api.ts`](api.ts) | [`../server/routes/sessions.test.ts`](../server/routes/sessions.test.ts) · [`../src/controller/session-metadata-mutations.test.ts`](../src/controller/session-metadata-mutations.test.ts) | refines CONTRACT-D1; requires CONTRACT-A1 |
| CONTRACT-D8 | data-access | A routine's editable definition has a server-owned revision separate from run activity; a supplied expected revision is a compare-and-swap precondition, while absence retains the declared legacy unconditional-write meaning. | [`cowork.ts`](cowork.ts) · [`api.ts`](api.ts) | [`../server/routes/schedules.test.ts`](../server/routes/schedules.test.ts) · [`../e2e/schedule-mutations.spec.ts`](../e2e/schedule-mutations.spec.ts) | refines CONTRACT-D1; requires CONTRACT-A1 |
| CONTRACT-D9 | data-access | An artifact's editable body has a server-owned revision separate from metadata, filing, grants, and discussion activity; a supplied expected revision is compare-and-swap, while absence retains the declared legacy unconditional-write meaning. | [`content.ts`](content.ts) · [`api.ts`](api.ts) | [`../server/routes/artifact-content.test.ts`](../server/routes/artifact-content.test.ts) · [`../e2e/artifact-content-mutations.spec.ts`](../e2e/artifact-content-mutations.spec.ts) | refines CONTRACT-D1; requires CONTRACT-A1 |
| CONTRACT-D10 | data-access | Every newly offered applying proposal freezes the target domain revision it was reviewed against; the wire exposes only derived stale state and, for artifact diffs, the frozen reviewed pre-image. | [`social.ts`](social.ts) · [`api.ts`](api.ts) | [`../server/routes/proposals.test.ts`](../server/routes/proposals.test.ts) · [`../e2e/proposal-verdict-mutations.spec.ts`](../e2e/proposal-verdict-mutations.spec.ts) | refines CONTRACT-D1; requires CONTRACT-D6; requires CONTRACT-D8; requires CONTRACT-D9 |
| CONTRACT-D11 | data-access | Endpoint execution posture is a server-computed read annotation; endpoint and credential configuration remains write-only, and an unconfigured turn has fail-before-write meaning. | [`providers.ts`](providers.ts) · [`api.ts`](api.ts) | [`../server/routes/routes-providers.test.ts`](../server/routes/routes-providers.test.ts) · [`../server/routes/model-configuration.test.ts`](../server/routes/model-configuration.test.ts) | refines CONTRACT-D1; requires CONTRACT-A1 |
| CONTRACT-D12 | data-access | Plain-text document authoring has one bounded, lossless-within-limit canonical form shared by model proposals, consent previews, direct callers, and persisted editable blocks; save replay identity includes its server-stamped owner namespace. | [`content.ts`](content.ts) · [`relations.ts`](relations.ts) · [`graph.ts`](graph.ts) | [`content.test.ts`](content.test.ts) · [`relation-content-preview.test.ts`](relation-content-preview.test.ts) · [`shared-reducer.test.ts`](shared-reducer.test.ts) | refines CONTRACT-D1; requires CONTRACT-A1; requires CONTRACT-A2 |
| CONTRACT-D13 | data-access | Routine cadence has one framework-free timezone oracle shared by editor and scheduler; a scheduled run's optional fire time forms its durable idempotency identity with the routine id, while absence means manual run-now. | [`cadence.ts`](cadence.ts) · [`cowork.ts`](cowork.ts) · [`api.ts`](api.ts) | [`cadence.test.ts`](cadence.test.ts) · [`../server/scheduler.test.ts`](../server/scheduler.test.ts) | refines CONTRACT-D1; requires CONTRACT-A1 |
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
