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
| CONTROLLER-E2 | experience | Retrying an interrupted turn preserves its one user row and logical key, discards only unpersisted assistant output, reattaches a known server turn before any regeneration, and reruns draft materialization when durability was never established; authoritative reconciliation clears Retry only when the captured pre-send transcript boundary proves that turn completed. | [`conversationCore.ts`](conversationCore.ts) · [`../components/ConversationPane.tsx`](../components/ConversationPane.tsx) | [`conversation-store.test.ts`](conversation-store.test.ts) · [`../../e2e/turn-controls.spec.ts`](../../e2e/turn-controls.spec.ts) | refines UI-E6; requires API-D8 |
| CONTROLLER-E3 | experience | Panel writes serialize per account/session; dirty local intent wins stale reads, matching acknowledgements alone clear it in the account scope that began the request, newly attached focuses wait for workspace persistence, and later authoritative reads retry failure without a hot loop. | [`panelPreferencesCore.ts`](panelPreferencesCore.ts) · [`panelPreferences.ts`](panelPreferences.ts) · [`usePaneConversation.ts`](usePaneConversation.ts) | [`panel-preferences.test.ts`](panel-preferences.test.ts) · [`../../e2e/panel-preferences.spec.ts`](../../e2e/panel-preferences.spec.ts) | refines UI-E11; requires API-D9 |
| CONTROLLER-E4 | experience | Context mutations are FIFO per session: the head plans from the latest acknowledgement, binding operations and the complete workspace share one request, failure blocks later intent behind explicit Retry, account switches drop late acknowledgements, and draft retries reuse the session row already minted. | [`contextMutationsCore.ts`](contextMutationsCore.ts) · [`contextMutations.ts`](contextMutations.ts) · [`draftCore.ts`](draftCore.ts) | [`context-mutations.test.ts`](context-mutations.test.ts) · [`draft-core.test.ts`](draft-core.test.ts) | refines UI-E12; requires API-D10 |
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
