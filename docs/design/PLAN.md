# Design backlog (the worklist)

> Top-down, **foundations first**. Each item below becomes one design doc under
> `docs/design/`. Work the **first unchecked** item each pass; when its doc is
> written and self-reviewed, check it here and record any decisions in
> [`DECISIONS.md`](DECISIONS.md). Mark status in [`README.md`](README.md) is not
> required — this checklist is the source of truth for progress.

## Conventions for each design doc

Every `F*` / `P*` doc should contain, in order:
1. **Problem & scope** — what production concern it covers; the `docs/spec/` ids /
   pillars it serves; shared vs desktop-vs-web.
2. **Design** — components & responsibilities; data model / schema; key interfaces or
   wire shapes; sequence flows for the main paths; how it maps onto the current
   prototype seam (what's real already, what changes).
3. **Failure modes & edge cases** — what breaks and how it's handled (retries,
   idempotency, conflicts, partial failure, offline).
4. **Security & multi-tenancy** — authz, isolation, secrets, abuse, audit.
5. **Observability & ops** — metrics/logs/traces, SLOs, rollout/migration.
6. **Open questions & decisions** — each decision logged in `DECISIONS.md` (id `Dn`).

Keep each doc focused; cross-link rather than repeat. Cite real prototype files so
the design is anchored to the seam it would replace/extend.

## Foundations

- [x] **F1 — Domain & data model** (`F1-domain-model.md`). The entities (session,
  project, artifact, context, schedule, message, runner, provider/prompt/agent/
  commission) and the relation graph as a real store: production schema, invariants,
  identity, migrations, the seed→DB transition. Serves spec REL-*, PERSIST-*.
- [x] **F2 — Identity, auth & multi-tenancy** (`F2-identity-tenancy.md`). Users, orgs/
  tenants, auth (web sessions/tokens; desktop local identity), RBAC, tenant isolation
  boundaries, the desktop-single-user vs web-multi-tenant split. Serves PORT-*, COMMONS-2.
- [x] **F3 — API contract & sync at scale** (`F3-contract-sync.md`). Contract
  versioning/evolution, the read-through cache, SSE fan-out / reconnection /
  backpressure / multi-device, idempotency, rate limiting, pagination, the error
  envelope. Serves PORT-1..7.
- [x] **F4 — Capability broker & runner protocol** (`F4-broker-runners.md`). Runner
  enrollment / durable identity / auth (mTLS/tokens), transport, relay + co-located
  fast path, the journal as an event log, reservations/guardian at scale, cross-host
  coordination. Serves BROKER-1..5, BROKER-EXP-1/2.
- [x] **F5 — Security, consent & safety** (`F5-security-consent.md`). The consent
  boundary for irreversible effects, prompt-injection / tool-abuse defense, secrets
  management, the authority/budget attenuation cascade enforced server-side, audit &
  compliance, privacy/residency. Serves ESC-3, REL-2/4, COMMONS-1/2/4, MODEL-6.
- [x] **F6 — Persistence, storage & ops** (`F6-persistence-ops.md`). Real datastore
  choice + object storage for files/artifacts, the durable-vs-transient split, backup/
  restore, observability, deployment topology (desktop sidecar vs web), scaling, SLOs.
  Serves PERSIST-1..6, MOCK-5/6.

## Pillars (build on the foundations)

- [x] **P1 — Adaptive conversation UI** (`P1-adaptive-ui.md`). Responsive panel rules
  (FWD-3), per-conversation panel state (FWD-2), pre-attached entry shortcuts (FWD-1),
  accessibility, large-history performance/virtualization, offline/error states.
- [x] **P2 — Context & the filesystem sources** (`P2-context-filesystem.md`). The three
  sources at production scale: real fs permissions, large/binary files, the UI-host
  upload pipeline, cloud object storage, runner fs over the broker, indexing, watching/
  invalidation. Serves CTX-*, CTX-FS-*.
- [x] **P3 — Escalation & real tool execution** (`P3-escalation-tools.md`). Executing
  the model's tool calls for real, the consent gate, rollback/undo, audit. Serves ESC-*.
- [x] **P4 — Relationship graph & the standing-approval scheduler** (`P4-relations-scheduler.md`).
  The graph store + multi-user edits + conflict handling; the schedule daemon as real
  job infra (durability, retries, idempotency, the standing-approval grant). Serves REL-*.
- [x] **P5 — Model + tools production** (`P5-model-tools.md`). Real Anthropic
  integration, streaming/retries, context-window management + compaction (BROKER-EXP-3),
  cost/budget controls, the provider abstraction, prompt-injection defense. Serves MODEL-*.
- [x] **P6 — Connectors & MCP** (`P6-connectors-mcp.md`). Real OAuth connector
  framework, MCP server discovery/invocation, per-tenant secrets, the resources/tools a
  connector exposes. Serves CTX-5, MOCK-3.
- [x] **P7 — Automation: Scheduled & Dispatch** (`P7-automation.md`). The job scheduler/
  daemon, one-off dispatch runs, durability, retries, concurrency, observability.
  Serves ADAPT-8/9, REL-4.
- [x] **P8 — Agent Commons at scale** (`P8-agent-commons.md`). Multi-tenant
  authority/budget enforcement, the D8 cascade + D11–D16 in production, abuse/rate
  limits, reputation, audit. Serves COMMONS-1..5.

## Finish

- [x] **Final consistency pass** — cross-link foundations↔pillars, ensure every
  `docs/spec` gap (`📝`/`🟡`) and mock-boundary row has a production design here, update
  this README's index, confirm `npm run typecheck` + `node --test` still pass. Then
  emit the completion promise.
