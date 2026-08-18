<!-- context-schema: v1 -->
# connector/ — session-relay connector index

## Scope

The self-contained connector distributed by the product. The always-on map is
[`AGENTS.md`](../AGENTS.md).

## Read path

Read [`docs/session-relay-primer.md`](../docs/session-relay-primer.md) first,
then the connector source and the relevant relay route/store context.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| CONNECTOR-A1 | architecture | The served connector and checked-in source are one self-contained Node program. | [`relay-connector.ts`](relay-connector.ts) · [`server/routes/index.ts`](../server/routes/index.ts) | [`server/routes/connector-serve.test.ts`](../server/routes/connector-serve.test.ts) | refines ROOT-A2 |
| CONNECTOR-D1 | data-access | Relay onboarding, serving, freshness, and delegation use the authenticated mailbox protocol. | [`relay-connector.ts`](relay-connector.ts) · [`server/relay.ts`](../server/relay.ts) | [`server/relay.test.ts`](../server/relay.test.ts) · [`server/routes/relay-connector.test.ts`](../server/routes/relay-connector.test.ts) | refines ROOT-D2 |
| CONNECTOR-V1 | verification | Primer claims are derived from source and update with behavior. | [`relay-connector.ts`](relay-connector.ts) · [`docs/session-relay-primer.md`](../docs/session-relay-primer.md) | [`tests/relay-primer.test.ts`](../tests/relay-primer.test.ts) | refines ROOT-V1 |
| CONNECTOR-O1 | operations | Served bytes run on Node 18+ with only `node:` imports. | [`relay-connector.ts`](relay-connector.ts) | [`server/routes/connector-serve.test.ts`](../server/routes/connector-serve.test.ts) | requires CONNECTOR-A1 |
<!-- context-rules:end -->

## Details

- **Read first:** [`docs/session-relay-primer.md`](../docs/session-relay-primer.md)
  — the from-zero explainer of the whole relay (mailbox, onboarding, the
  serving handshake, delegate-by-default, freshness). Its facts are pinned to
  this source by `tests/relay-primer.test.ts` — **update the primer when
  behavior here changes.**
- **The design log** (six passes, each with the ruling and the rejected
  alternative): [`docs/delegated-cognition-provider.md`](../docs/delegated-cognition-provider.md).
  Spec rows MODEL-10/-11/-14/-18/-19/-21/-22/-23/-24 in
  [`docs/spec/06-model-and-tools.md`](../docs/spec/06-model-and-tools.md).
- **Locks:** `server/relay.test.ts`, `server/persistence/relay-migrate.test.ts`,
  `server/routes/relay-connector.test.ts`, `server/routes/connector-serve.test.ts`.
- The connector is served type-stripped by `GET /api/v1/connector` and must
  stay a single self-contained script runnable on any Node ≥ 18 — no imports
  beyond `node:` built-ins (`server/routes/connector-serve.test.ts` runs the served
  bytes under plain `node`).
- The agent-facing setup guide it pairs with is `server/connectorSetup.ts`
  (`GET /connector/setup`).

## Verification

Run the connector, relay, and primer suites named above. Any protocol change
updates both the primer and its source-derived lock.
