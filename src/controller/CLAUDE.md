# src/controller/ — command issuers (loaded when working here)

The layer's rules are [`src/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## What lives here

The half of the "one door" rule that WRITES. Components read through
[`../api/`](../api/CLAUDE.md) hooks; controllers here own the sequences that
change things — sending a turn, escalating a session into a workspace or repo
panel, driving the draft, resolving what a consent card does when confirmed.

Beside them, the suites that lock those sequences (`conversation-store`,
`draft-core`).

## Rules

- **A controller sequences; it does not decide policy.** Whether an act is
  allowed is the server's answer, and the UI renders that answer. A permission
  branch that exists only here is a wall the API does not have.
- **Escalation is consent-gated and in place.** A workspace, a repo panel, a
  project — each appears in the SAME conversation after the user confirms a
  card; nothing switches modes behind them. The funnel's shape is locked in
  [`../data/`](../data/CLAUDE.md) (`escalation-funnel`).
- **Optimistic state is a promise the server keeps.** Anything applied locally
  before the ack must reconcile with what comes back, including the id.
