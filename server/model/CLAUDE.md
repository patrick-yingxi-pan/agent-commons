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
| MODEL-D2 | data-access | A Project prose proposal freezes the live description or instructions it was authored against, so delayed consent cannot silently overwrite later text. Owner-only aliases reject viewer-relative foreign targets; commissioning additionally accepts explicitly shared Projects without widening private grant authority. | [`tools.ts`](tools.ts) · [`../routes/index.ts`](../routes/index.ts) | [`model-tools.test.ts`](model-tools.test.ts) · [`../routes/routes-messages.test.ts`](../routes/routes-messages.test.ts) | refines MODEL-A2; requires CONTRACT-D21 |
| MODEL-D3 | data-access | Endpoint and Session generation capture the authorized conversation's current direct-file, local-folder, and (when supported) immutable image snapshot input once per turn and reuse it through tool continuations. Text and image metadata are untrusted reference data; image bytes use first-class provider blocks and never enter prose. Detaching excludes future input without erasing earlier conversation history; unsupported or missing images remain honest metadata. | [`../attachmentInput.ts`](../attachmentInput.ts) · [`../generate.ts`](../generate.ts) · [`../relay.ts`](../relay.ts) | [`../attachmentInput.test.ts`](../attachmentInput.test.ts) · [`provider-endpoint.test.ts`](provider-endpoint.test.ts) · [`../relay.test.ts`](../relay.test.ts) · [`../../tests/contract-boundaries.test.ts`](../../tests/contract-boundaries.test.ts) | refines SERVER-D3; requires CONTRACT-D74; requires CONTRACT-D78 |
| MODEL-D4 | data-access | External reserved MCP connection ids never derive deterministic development fixture tools, even when their label, type, or standing approval resembles a fixture; only explicit non-external fixture rows receive fixture bindings. | [`connectorTools.ts`](connectorTools.ts) | [`connectorTools.test.ts`](connectorTools.test.ts) | refines SERVER-D3; requires ROOT-P2 |
| MODEL-D5 | data-access | Document, sheet and slide saves use one consent-only tool. Structured kinds are explicit, the advertised recursive schema reflects shared bounds, and malformed content cannot enter a proposal or mutate state. | [`tools.ts`](tools.ts) · [`../../contract/artifactAuthoring.ts`](../../contract/artifactAuthoring.ts) | [`model-tools.test.ts`](model-tools.test.ts) · [`generate.test.ts`](generate.test.ts) | requires MODEL-A2; requires CONTRACT-D85 |
| MODEL-V1 | verification | Mock intent/reply behavior and provider catalogs stay explicit and independently locked. | [`intents.ts`](intents.ts) · [`replies.ts`](replies.ts) · [`catalog.ts`](catalog.ts) | [`model-intents.test.ts`](model-intents.test.ts) · [`provider-models.test.ts`](provider-models.test.ts) | refines ROOT-V1; requires ROOT-P2 |
| MODEL-O1 | operations | Every model-emitted tool batch executes through one transport-neutral guard: declared names only, serial chaining, bounded call count, per-tool deadline, non-leaking structured failures, and terminal caller cancellation. | [`../toolExecution.ts`](../toolExecution.ts) · [`../generate.ts`](../generate.ts) · [`../relay.ts`](../relay.ts) | [`../toolExecution.test.ts`](../toolExecution.test.ts) · [`generate.test.ts`](generate.test.ts) · [`../relay.test.ts`](../relay.test.ts) | requires MODEL-A2 |
| MODEL-O2 | operations | Endpoint and Session-provider turns may execute repeated dependent tool batches through one shared bounded document loop; the first over-budget batch executes nothing and ends in an explicit fallback. | [`../toolExecution.ts`](../toolExecution.ts) · [`../generate.ts`](../generate.ts) · [`../relay.ts`](../relay.ts) | [`model-server.test.ts`](model-server.test.ts) · [`generate.test.ts`](generate.test.ts) · [`../relay.test.ts`](../relay.test.ts) | requires MODEL-O1 |
| MODEL-O3 | operations | Development mock fulfilment is explicit; release endpoint readiness is server-computed, forge-proof, and fail-before-write. | [`endpointExecution.ts`](endpointExecution.ts) · [`../runtimeProfile.ts`](../runtimeProfile.ts) · [`../routes/index.ts`](../routes/index.ts) | [`endpoint-execution.test.ts`](endpoint-execution.test.ts) · [`../runtimeProfile.test.ts`](../runtimeProfile.test.ts) · [`../routes/model-configuration.test.ts`](../routes/model-configuration.test.ts) | refines ROOT-P2; requires SERVER-O2 |
| MODEL-O4 | operations | The shared endpoint loop supports unattended execution without a second model stack: the caller may pass effort and standing-approved contexts, receives typed endpoint/loop failure causes, and standing connector writes can complete only when that exact context was pre-approved and the shared connector runtime accepts the effect. | [`../generate.ts`](../generate.ts) · [`connectorTools.ts`](connectorTools.ts) · [`../connectorRuntime.ts`](../connectorRuntime.ts) · [`../routineRunner.ts`](../routineRunner.ts) | [`generate.test.ts`](generate.test.ts) · [`provider-endpoint.test.ts`](provider-endpoint.test.ts) · [`connectorTools.test.ts`](connectorTools.test.ts) · [`../connectorRuntime.test.ts`](../connectorRuntime.test.ts) · [`../routineRunner.test.ts`](../routineRunner.test.ts) | requires MODEL-O1; requires SERVER-O6; requires SERVER-O7 |
| MODEL-O5 | operations | Conversation reduction uses the selected provider through bounded hierarchical calls with one injection-resistant system frame, no tools, no local fallback, and no silent source truncation. Full receipt JSON stays intact and the shared receipt frame makes settled status authoritative over stale proposal prose; endpoint replies also receive the active history document that reduction produces. | [`../compaction.ts`](../compaction.ts) · [`../toolActivityHistory.ts`](../toolActivityHistory.ts) · [`../generate.ts`](../generate.ts) · [`index.ts`](index.ts) · [`replies.ts`](replies.ts) | [`../compaction.test.ts`](../compaction.test.ts) · [`generate.test.ts`](generate.test.ts) · [`../routes/compaction.test.ts`](../routes/compaction.test.ts) | requires MODEL-A1; requires SERVER-O8 |
| MODEL-O6 | operations | Completed reply/routine/compaction calls synchronously record validated usage before tools, continuation or acknowledgement. Detached return totals are informational, earlier reports survive later failure/cancellation, Session counts remain estimates, and recorder failures stop work without provider fallback or automatic routine retry. | [`../modelUsage.ts`](../modelUsage.ts) · [`../generate.ts`](../generate.ts) · [`../relay.ts`](../relay.ts) · [`../routineRunner.ts`](../routineRunner.ts) · [`../routes/index.ts`](../routes/index.ts) | [`../model-usage.test.ts`](../model-usage.test.ts) · [`generate.test.ts`](generate.test.ts) · [`../relay.test.ts`](../relay.test.ts) · [`../routineRunner.test.ts`](../routineRunner.test.ts) · [`../routes/turns.test.ts`](../routes/turns.test.ts) · [`../routes/compaction.test.ts`](../routes/compaction.test.ts) · [`../persistence/usage-durability.test.ts`](../persistence/usage-durability.test.ts) | requires SERVER-O14; refines MODEL-O2; requires MODEL-O5 |
| MODEL-O7 | operations | Endpoint and Session transports declare only attached caller-owned external MCP tools admitted under the current schema policy, with opaque provider-safe names and unchanged input schemas. Every valid call becomes an exact-argument owner proposal regardless of remote hints or standing grants; host-owned consent identities cannot inherit a reused provider call id, while wire results retain their original correlation. Later turns share bounded receipt truth and never reinterpret uncertainty as permission to replay. | [`connectorTools.ts`](connectorTools.ts) · [`../generate.ts`](../generate.ts) · [`../relay.ts`](../relay.ts) · [`../toolActivityHistory.ts`](../toolActivityHistory.ts) | [`external-mcp-tools.test.ts`](external-mcp-tools.test.ts) · [`provider-endpoint.test.ts`](provider-endpoint.test.ts) · [`../relay.test.ts`](../relay.test.ts) · [`../tool-activity-history.test.ts`](../tool-activity-history.test.ts) | requires MODEL-D4; requires SERVER-O15 |
| MODEL-O8 | operations | A queued Sheet or Slides routine receives one server-owned body-only tool whose schema shares the authored-artifact bounds; name and kind remain frozen outside model authority. The guarded executor publishes a detached candidate only after settlement, poisons malformed or repeated submissions including repeats refused by its call/deadline budget, and creates no relation, activity, or persistent effect. The routine worker alone decides whether a complete successful turn may commit it; Documents remain final prose. | [`../routineArtifact.ts`](../routineArtifact.ts) · [`../toolExecution.ts`](../toolExecution.ts) · [`../generate.ts`](../generate.ts) · [`tools.ts`](tools.ts) | [`../routineArtifact.test.ts`](../routineArtifact.test.ts) · [`../toolExecution.test.ts`](../toolExecution.test.ts) · [`generate.test.ts`](generate.test.ts) · [`model-tools.test.ts`](model-tools.test.ts) | requires MODEL-O1; requires MODEL-O4; requires CONTRACT-D85 |
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
  and the execute-vs-propose consent split when extending the seam. Repeated
  batches share `MODEL_MAX_TOOL_ROUNDS`; its value means batches actually
  executed, not model calls attempted or mailbox entries offered.
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
