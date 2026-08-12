# src/data/ — client-side derivations (loaded when working here)

The layer's rules are [`src/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

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
