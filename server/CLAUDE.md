<!-- context-schema: v1 -->
# server/ — backend layer index

## Scope

Cross-module backend laws. Detailed rationale lives in [`DESIGN.md`](DESIGN.md);
resource-specific behavior belongs to the module context and colocated suites.

## Read path

| Working on | Load next |
|---|---|
| Route registrations and capability classification | [`routes/CLAUDE.md`](routes/CLAUDE.md) |
| In-memory state and tenant projections | [`store/CLAUDE.md`](store/CLAUDE.md) |
| Transport, dispatch, responses, SSE | [`http/CLAUDE.md`](http/CLAUDE.md) |
| Anthropic-compatible model seam | [`model/CLAUDE.md`](model/CLAUDE.md) |
| Snapshots, migrations, durability | [`persistence/CLAUDE.md`](persistence/CLAUDE.md) · [`persistence/SPEC.md`](persistence/SPEC.md) |
| Deterministic demo worlds | [`data/CLAUDE.md`](data/CLAUDE.md) |
| Server test drivers | [`testkit/CLAUDE.md`](testkit/CLAUDE.md) |
| Why the backend rules exist | [`DESIGN.md`](DESIGN.md) |

Root modules such as `auth.ts`, `mcp.ts`, `relay.ts`, `turns.ts`, and
`generate.ts` keep their suites beside them. A suite belongs to what it locks,
not to the transport it happens to drive through.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| SERVER-A1 | architecture | Generation crosses the real Anthropic Messages/tool-use boundary; the local model is a wire-compatible endpoint. | [`generate.ts`](generate.ts) · [`model/`](model/) | [`model/generate.test.ts`](model/generate.test.ts) · [`model/model-server.test.ts`](model/model-server.test.ts) | refines ROOT-A2 |
| SERVER-A2 | architecture | The route table is the one capability catalog; UI, in-session tools, and remote MCP are generated projections. | [`routes/index.ts`](routes/index.ts) · [`apiSurface.ts`](apiSurface.ts) | [`mcp-parity.test.ts`](mcp-parity.test.ts) · [`model/api-tools.test.ts`](model/api-tools.test.ts) | refines ROOT-A1; requires ROOT-D2 |
| SERVER-A3 | architecture | Keep runtime dependencies few and intentional; the Anthropic SDK is the server's one runtime dependency. | [`package.json`](../package.json) · [`generate.ts`](generate.ts) | [`tests/contract-boundaries.test.ts`](../tests/contract-boundaries.test.ts) | refines ROOT-A2 |
| SERVER-D1 | data-access | Request absence has fixed meaning or is rejected; the core never guesses a mutable or privileged value. | [`http/router.ts`](http/router.ts) · [`routes/index.ts`](routes/index.ts) | [`tests/spec-conformance.test.ts`](../tests/spec-conformance.test.ts) | refines ROOT-D1; symmetric-with CONTRACT-D1 |
| SERVER-D2 | data-access | Authentication is a server wall: no protected data before a cookie or bearer session is established. | [`auth.ts`](auth.ts) · [`index.ts`](index.ts) | [`routes/auth-gate.test.ts`](routes/auth-gate.test.ts) · [`routes/auth-bearer.test.ts`](routes/auth-bearer.test.ts) | refines ROOT-D2 |
| SERVER-D3 | data-access | Browser UI, permitted in-session MCP, and authenticated remote MCP share semantic capabilities and policy. | [`mcp.ts`](mcp.ts) · [`model/apiTools.ts`](model/apiTools.ts) · [`http/dispatch.ts`](http/dispatch.ts) | [`tests/access-surface-parity.test.ts`](../tests/access-surface-parity.test.ts) · [`mcp-parity.test.ts`](mcp-parity.test.ts) | refines ROOT-D2; requires SERVER-A2 |
| SERVER-D4 | data-access | Persist exactly UI-owned durable state atomically; a mutation is acknowledged only after commit, and a failed commit walls the process until restart; invalid snapshots re-seed and genuinely transient state stays excluded. | [`persistence/`](persistence/) · [`store/index.ts`](store/index.ts) · [`routes/index.ts`](routes/index.ts) | [`persistence/snapshot.test.ts`](persistence/snapshot.test.ts) · [`persistence/acknowledgement.test.ts`](persistence/acknowledgement.test.ts) | refines ROOT-A1; requires CONTRACT-A1 |
| SERVER-D5 | data-access | Viewer presentation intent is keyed by user and resource, never stored on the shared entity or broadcast in event bodies. | [`sessionPreferences.ts`](sessionPreferences.ts) · [`routes/index.ts`](routes/index.ts) | [`sessionPreferences.test.ts`](sessionPreferences.test.ts) · [`routes/session-preferences.test.ts`](routes/session-preferences.test.ts) | refines SERVER-D4; requires CONTRACT-D4 |
| SERVER-V1 | verification | Code, requirements, and behavioral locks live with the module they govern; only cross-layer locks stay in `tests/`. | [`routes/`](routes/) · [`store/`](store/) · [`persistence/`](persistence/) | [`tests/suite-paths.test.ts`](../tests/suite-paths.test.ts) | refines ROOT-V1 |
| SERVER-O1 | operations | Demo fixtures are deterministic, tenant-complete declared mock worlds and use the real mutators. | [`data/`](data/) | [`data/demo-accounts.test.ts`](data/demo-accounts.test.ts) | refines ROOT-P2; requires SERVER-D4 |
<!-- context-rules:end -->

## Verification

Run `npm run typecheck` and the colocated server suites. Route or access changes
also run [`tests/access-surface-parity.test.ts`](../tests/access-surface-parity.test.ts).
Persistence changes update [`persistence/SPEC.md`](persistence/SPEC.md).
