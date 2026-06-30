# Production design — `docs/design/`

> **What this is.** The engineering design for a *production-ready* version of this
> system, derived top-down from the goal ([`PROPOSAL.md`](../../PROPOSAL.md)), the
> architecture ([`README.md`](../../README.md)), and the requirements ledger
> ([`docs/spec/`](../spec/README.md)). Where `docs/spec/` says *what the prototype
> does and what's still mocked*, this tree says *how the real thing would actually
> work* — components, data models, protocols, sequence flows, failure modes, and the
> decisions behind them.
>
> **We design, not build** *(superseded 2026-06-30)*. Originally these docs were a
> paper blueprint and the prototype stayed a prototype. The owner has since chosen to
> **implement the locked-in design in-repo**, incrementally and architecture-first —
> see [`IMPLEMENTATION.md`](IMPLEMENTATION.md) for the reversal, the constraints that
> still hold (few deps, framework-free contract, tests-with-every-step), and the
> build status per `PD*` decision. These docs remain the blueprint; `IMPLEMENTATION.md`
> tracks what's actually built.

## Target

Both deployments the architecture commits to, sharing one contract:

- **Native desktop** — the UI in an app shell over a **local sidecar** (single user,
  local resources: filesystem, git, OS pickers, a co-located runner).
- **Remote web** — the same UI over a **multi-tenant web server** (many users/orgs,
  isolation, scale, runners connecting from elsewhere).

Each design doc calls out what is shared vs deployment-specific.

## How to read it (progressive disclosure)

- **L0** — this page (purpose, target, the foundations-first order).
- **[`PLAN.md`](PLAN.md)** — the top-down backlog: the ordered set of design docs,
  foundations first, then per-pillar. This is the worklist.
- **Foundations (`F*`)** then **Pillars (`P*`)** — one doc each. Each opens with the
  problem it solves and the requirements it serves (linking the `docs/spec/` ids),
  then drills into the design and ends with its key decisions.
- **[`DECISIONS.md`](DECISIONS.md)** — every design decision, with rationale,
  alternatives, and a confirmation flag. **This is the review surface** — the loop
  runs autonomously and records its choices here for sign-off.

## Status legend

| Status | Meaning |
|---|---|
| ✅ drafted | Design doc written and self-reviewed. |
| 🚧 in progress | Partially designed. |
| ⏳ planned | In the backlog, not started. |

## Documents

Foundations first, then pillars (the backlog + progress live in [`PLAN.md`](PLAN.md)).

| Doc | Scope | Status |
|-----|-------|--------|
| [F1](F1-domain-model.md) | Domain & data model — entities + the relation graph as a real store | ✅ drafted |
| [F2](F2-identity-tenancy.md) | Identity, auth & multi-tenancy | ✅ drafted |
| [F3](F3-contract-sync.md) | API contract & sync at scale (SSE fan-out, idempotency, pagination) | ✅ drafted |
| [F4](F4-broker-runners.md) | Capability broker & runner protocol | ✅ drafted |
| [F5](F5-security-consent.md) | Security, consent & safety | ✅ drafted |
| [F6](F6-persistence-ops.md) | Persistence, storage & ops | ✅ drafted |
| [P1](P1-adaptive-ui.md) | Adaptive conversation UI (responsive, panel memory, a11y, perf) | ✅ drafted |
| [P2](P2-context-filesystem.md) | Context & the three filesystem sources | ✅ drafted |
| [P3](P3-escalation-tools.md) | Escalation & real tool execution | ✅ drafted |
| [P4](P4-relations-scheduler.md) | Relationship graph & the standing-approval scheduler | ✅ drafted |
| [P5](P5-model-tools.md) | Model + tools (gateway, compaction, budget, providers) | ✅ drafted |
| [P6](P6-connectors-mcp.md) | Connectors & MCP | ✅ drafted |
| [P7](P7-automation.md) | Automation — Scheduled & Dispatch | ✅ drafted |
| [P8](P8-agent-commons.md) | Agent Commons at scale | ✅ drafted |

## Gap & mock-boundary coverage

Every `docs/spec/` known gap — `📝` *planned* (specified, not yet built) or `🟡`
*partial* (built but incomplete) — and every declared fixture (`MOCK-*`, an intentional
mock) has a production design here, so "what would it take to make this real?" is
answered. These are **`docs/spec/` requirement-status** markers (full legend in the
[spec index](../spec/README.md)) — a different axis from this tree's *design-doc* status
(✅ drafted / 🚧 / ⏳) in the legend above.

| Spec item | What it is | Production design |
|-----------|-----------|-------------------|
| FWD-1 `🟡` | Pre-attached entry shortcuts (seam + launcher built; per-mode sidebar entries remain) | [P1](P1-adaptive-ui.md) (PD33) |
| FWD-2 `🟡` | Per-conversation panel memory | [P1](P1-adaptive-ui.md) (PD34) |
| FWD-3 `📝` | Responsive collapse-to-rail | [P1](P1-adaptive-ui.md) (PD35) |
| FWD-4 `🟡` | Cross-device sync | [F3](F3-contract-sync.md)/[F6](F6-persistence-ops.md) (PD13/PD34) |
| MOCK-1 | The model | [P5](P5-model-tools.md) (PD51) |
| MOCK-2 | Artifact content library | [P2](P2-context-filesystem.md) (PD42) |
| MOCK-3 | Connector / MCP detail | [P6](P6-connectors-mcp.md) (PD56/PD58) |
| MOCK-4 | Repo content + git | [P3](P3-escalation-tools.md)/[F4](F4-broker-runners.md) (PD44/PD18) |
| MOCK-5 | Seed entities | [F1](F1-domain-model.md)/[F6](F6-persistence-ops.md) (PD6/PD28) |
| MOCK-6 | Usage windows | [P5](P5-model-tools.md) (PD53) |

## Relationship to the spec

`docs/spec/` is the conformance ledger for the *prototype* (built vs mocked vs gap).
`docs/design/` is the blueprint for *production*. A spec requirement marked `📝`/`🟡`
(a known gap) should have its production design here; a spec `🟡` mock-boundary row
should have here the design for the *real* boundary that replaces the fixture.
