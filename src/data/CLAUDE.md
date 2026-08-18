<!-- context-schema: v1 -->
# src/data/ — presentation-derivation module index

## Scope

The layer's rules are [`src/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## Read path

Read the consuming controller/component context. Entity fixtures belong under
[`server/data/CLAUDE.md`](../../server/data/CLAUDE.md), never here.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| UIDATA-A1 | architecture | This module owns pure presentation shape and state machines, not server entities. | [`liveSession.ts`](liveSession.ts) · [`contextOptions.ts`](contextOptions.ts) | [`focusForAdded.test.ts`](focusForAdded.test.ts) | refines UI-D1 |
| UIDATA-E1 | experience | Escalation application and consent-card state derive from one shared funnel. | [`liveSession.ts`](liveSession.ts) | [`escalation-funnel.test.ts`](escalation-funnel.test.ts) · [`consent-state.test.ts`](consent-state.test.ts) | refines ROOT-P1; requires UIDATA-A1 |
| UIDATA-D1 | data-access | Every escalation requires a confirmed card before server-owned state changes. | [`liveSession.ts`](liveSession.ts) · [`../controller/useSessionEscalation.ts`](../controller/useSessionEscalation.ts) | [`consent-state.test.ts`](consent-state.test.ts) | refines ROOT-D1; requires UIDATA-E1 |
<!-- context-rules:end -->

## What lives here

The tables the UI derives its *shape* from — the escalation funnel's steps, the
consent-card states, what a newly added pane focuses. Pure data + pure
functions over it, with the suites that lock them beside.

## The line this directory must not cross

**This is not a fixture store.** The frontend is a cache of the backend: every
entity the UI shows comes from the server, and an inline entity here would be a
second source of truth that survives no reload and no other client. What
belongs here is *how the UI presents* server-owned state — the funnel's ordering,
a card's state machine — never the state itself.

Seed data lives in [`server/data/`](../../server/data/CLAUDE.md) and reaches the
UI the same way real data does.

## Rules

- **The funnel is one table.** Escalation steps and consent-card copy derive
  from it, so a new step is a row, not a new branch in a component.
- **Every escalation asks first.** A step that lands without a confirmed card
  contradicts the whole argument the prototype is making.

## Verification

Run the derivation suite and the consuming controller suite. Reject any entity
fixture or authoritative status introduced here.
