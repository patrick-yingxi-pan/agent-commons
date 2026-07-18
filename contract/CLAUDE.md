# contract/ — the load-bearing types (loaded when working under contract/)

Scoped context for the shared wire contract. The always-on map is
[`AGENTS.md`](../AGENTS.md).

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
