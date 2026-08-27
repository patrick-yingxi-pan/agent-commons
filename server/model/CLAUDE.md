<!-- context-schema: v1 -->
# server/model/ — model-seam module index

## Scope

The layer's rules are [`server/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## Read path

Read [`../DESIGN.md`](../DESIGN.md) for the Messages/tool-use boundary and
[`docs/mcp-access.md`](../../docs/mcp-access.md) for in-session access parity.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| MODEL-A1 | architecture | The local model is a wire-compatible Anthropic Messages endpoint, not a backend shortcut. | [`index.ts`](index.ts) · [`tools.ts`](tools.ts) | [`model-server.test.ts`](model-server.test.ts) · [`model-tools.test.ts`](model-tools.test.ts) | refines SERVER-A1 |
| MODEL-A2 | architecture | Resource mutations travel as `tool_use`/`tool_result` through the generation loop. | [`tools.ts`](tools.ts) · [`../generate.ts`](../generate.ts) | [`model-tools.test.ts`](model-tools.test.ts) · [`generate.test.ts`](generate.test.ts) | refines ROOT-A2; requires MODEL-A1 |
| MODEL-D1 | data-access | In-session API tools are generated from route-owned product capabilities and intrinsic realizations. | [`apiTools.ts`](apiTools.ts) · [`../apiSurface.ts`](../apiSurface.ts) | [`api-tools.test.ts`](api-tools.test.ts) | refines SERVER-D3; requires SERVER-A2 |
| MODEL-V1 | verification | Mock intent/reply behavior and provider catalogs stay explicit and independently locked. | [`intents.ts`](intents.ts) · [`replies.ts`](replies.ts) · [`catalog.ts`](catalog.ts) | [`model-intents.test.ts`](model-intents.test.ts) · [`provider-models.test.ts`](provider-models.test.ts) | refines ROOT-V1; requires ROOT-P2 |
| MODEL-O1 | operations | Every model-emitted tool batch executes through one transport-neutral guard: declared names only, serial chaining, bounded call count, per-tool deadline, non-leaking structured failures, and terminal caller cancellation. | [`../toolExecution.ts`](../toolExecution.ts) · [`../generate.ts`](../generate.ts) · [`../relay.ts`](../relay.ts) | [`../toolExecution.test.ts`](../toolExecution.test.ts) · [`generate.test.ts`](generate.test.ts) · [`../relay.test.ts`](../relay.test.ts) | requires MODEL-A2 |
<!-- context-rules:end -->

## What lives here

The **dev mock of an Anthropic-compatible endpoint** — not an in-process fake
of the backend's own generation. `index.ts` serves `POST /v1/messages` speaking
the real Messages wire format (JSON + streaming SSE, `tool_use` blocks and all);
`intents.ts` decides which tools a message should call (fixed-string / keyword
matching); `replies.ts` wraps canned prose around them; `tools.ts` declares the
resource-manipulation tool surface; `apiTools.ts` is the in-app leg of access
parity; `connectorTools.ts` the session-relay leg; `catalog.ts` the provider /
model catalog.

Beside them, the suites that lock each. `server/generate.ts` — the *client* of
this endpoint — stays at the server root, and its suites sit next to it there:
the boundary is the point, so the two sides do not share a directory.

## Rules

- **This is a seam, not a shortcut.** Going live is `ANTHROPIC_BASE_URL` +
  `ANTHROPIC_API_KEY` and nothing more. Anything added here that the real API
  would not also do is a shortcut a production system would have to unwind —
  the one thing this repo's architecture is arguing against.
- **Tool calls are the protocol, not an overlay.** Resource manipulations reach
  the backend as Messages-API `tool_use` blocks that the backend executes and
  surfaces as consent-gated proposals. Never add a backend keyword branch that
  bypasses the tool loop.
- **Transport never changes execution policy.** Endpoint and Session providers
  both execute through `server/toolExecution.ts`; do not add a transport-local
  executor, timeout, limit, or error policy. Preserve serial same-turn chaining
  and the execute-vs-propose consent split when extending the seam.
- **The tool surface is GENERATED from the route table** (`server/apiSurface.ts`
  over `Router.list()`), so a new route is a new tool with no second list to
  update. Never hand-add a generated tool with its own logic. Non-product form,
  semantic alias, and session-intrinsic realizations are declared with a reason
  on the route itself (access parity, INV-11 —
  [`docs/mcp-access.md`](../../docs/mcp-access.md)); there is no model-private
  exclusion list.

## Verification

Run the changed model suite plus `server/model/generate.test.ts`; generated tool
changes also run the access-parity lock.
