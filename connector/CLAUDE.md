# connector/ — the session-relay connector (loaded when working here)

The always-on map is [`AGENTS.md`](../AGENTS.md).

- **Read first:** [`docs/session-relay-primer.md`](../docs/session-relay-primer.md)
  — the from-zero explainer of the whole relay (mailbox, onboarding, the
  serving handshake, delegate-by-default, freshness). Its facts are pinned to
  this source by `tests/relay-primer.test.ts` — **update the primer when
  behavior here changes.**
- **The design log** (six passes, each with the ruling and the rejected
  alternative): [`docs/delegated-cognition-provider.md`](../docs/delegated-cognition-provider.md).
  Spec rows MODEL-10/-11/-14/-18/-19/-21/-22/-23/-24 in
  [`docs/spec/06-model-and-tools.md`](../docs/spec/06-model-and-tools.md).
- **Locks:** `tests/relay.test.ts`, `tests/relay-migrate.test.ts`,
  `tests/relay-connector.test.ts`, `tests/connector-serve.test.ts`.
- The connector is served type-stripped by `GET /api/v1/connector` and must
  stay a single self-contained script runnable on any Node ≥ 18 — no imports
  beyond `node:` built-ins (`tests/connector-serve.test.ts` runs the served
  bytes under plain `node`).
- The agent-facing setup guide it pairs with is `server/connectorSetup.ts`
  (`GET /connector/setup`).
