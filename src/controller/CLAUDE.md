<!-- context-schema: v1 -->
# src/controller/ — command-sequence module index

## Scope

The layer's rules are [`src/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## Read path

Read [`../api/CLAUDE.md`](../api/CLAUDE.md) for the write door and
[`../data/CLAUDE.md`](../data/CLAUDE.md) for presentation state machines.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| CONTROLLER-A1 | architecture | Controllers sequence commands and reconciliation but do not own data or policy. | [`conversationStore.ts`](conversationStore.ts) · [`useSessionWorkspace.ts`](useSessionWorkspace.ts) | [`conversation-store.test.ts`](conversation-store.test.ts) | refines UI-A1 |
| CONTROLLER-A2 | architecture | Cursor pages merge by stable message id; overlapping live-tail refreshes preserve loaded history, while complete/invalidated histories replace it rather than fabricating continuity. | [`conversationCore.ts`](conversationCore.ts) · [`usePaneConversation.ts`](usePaneConversation.ts) | [`conversation-store.test.ts`](conversation-store.test.ts) | refines UI-E6; requires CONTROLLER-A1 |
| CONTROLLER-E1 | experience | Workspace/repo/project escalation stays in the same conversation and lands only after consent. | [`useSessionEscalation.ts`](useSessionEscalation.ts) · [`../data/liveSession.ts`](../data/liveSession.ts) | [`../data/consent-state.test.ts`](../data/consent-state.test.ts) · [`../data/escalation-funnel.test.ts`](../data/escalation-funnel.test.ts) | refines ROOT-P1 |
| CONTROLLER-D1 | data-access | Authorization is the server's answer; no controller-only permission wall exists. | [`conversationStore.ts`](conversationStore.ts) · [`../api/commands.ts`](../api/commands.ts) | [`../../tests/access-surface-parity.test.ts`](../../tests/access-surface-parity.test.ts) | refines ROOT-D2; requires CONTROLLER-A1 |
<!-- context-rules:end -->

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

## Verification

Run controller suites and the relevant API/store route lock for every changed
sequence.
