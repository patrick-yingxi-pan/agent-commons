# F1 · Domain & data model

> **Foundation.** The entities the whole system manipulates, and the relation graph
> that binds them, as a real datastore — replacing the prototype's single-JSON
> snapshot (`server/persist.ts`) and in-memory store (`server/store.ts`). Serves spec
> REL-1..7, PERSIST-1..6, and underpins every other design doc.

## 1. Problem & scope

The prototype keeps all state in memory and snapshots a subset to one
`.data/store.json` (`PersistedState` in `server/persist.ts`), with the relationship
graph as a denormalized blob (`RelationGraph` in `contract/api.ts`) seeded from
fixtures and mutated by a pure reducer (`applyGraphOp` in `contract/graph.ts`). That
is correct *as a prototype* but conflates three things production must separate:
**system-of-record state**, **derived/projected views**, and **seed data**.

This doc defines the production domain model: the entities, their keys and
invariants, **the relation graph as normalized edges**, the durable-vs-derived split,
and the seed→DB transition. Tenancy keys are introduced here and detailed in
[F2](F2-identity-tenancy.md); storage mechanics in [F6](F6-persistence-ops.md).

**Shared vs deployment-specific.** The *schema* is shared. The *store* differs:
desktop sidecar runs an embedded single-tenant DB (e.g. SQLite) with `tenant_id`
fixed to the local user; the web server runs a shared multi-tenant DB (e.g. Postgres)
with `tenant_id` on every row (F2). The contract types the UI sees are identical.

## 2. Design

### 2.1 Entities (system of record)

Derived from `contract/entities.ts`, `contract/cowork.ts`, `contract/agents.ts`,
`contract/commission.ts`. Every row carries `id` (ULID), `tenant_id`, `created_at`,
`updated_at`; mutable user content carries `created_by`.

| Entity | Key fields (beyond the common ones) | Notes |
|--------|-------------------------------------|-------|
| `session` | title, caps[], preview, agent_id, status, environment, pinned | The conversation. `caps` is derived from attached contexts (see §2.3) but cached for list queries. |
| `message` | session_id, role, seq, content_ref, agent_id | Append-only; `seq` orders within a session. Large bodies + tool I/O in object storage (`content_ref`, F6). |
| `project` | name, description, instructions, commission_cap | The prototype's `extraProjects` and seed projects unify into one table — no "extra" distinction. |
| `artifact` | name, kind, meta, body_ref, source_context_id | `extraArtifacts` unify here too. `body_ref` → object storage; `kind` ∈ doc/email/image/slide/sheet. |
| `schedule` | name, prompt, cadence, trigger, enabled, timezone, model, delivery, steps | Runs are a child table (`schedule_run`). |
| `schedule_run` | schedule_id, status, started_at, duration, summary | Append-only; the live feed reads the tail. |
| `context` | session_id, type, label, scope, source(json) | The `SessionContext` attachment of record (`contract/contexts.ts`). One row per attached context. |
| `saved_context` | label, kind, status, detail, origin, connector_kind | Reusable connectors/MCP/repos (the Contexts page). Auth status lives here; secrets do **not** (F5/F6). |
| `provider` / `system_prompt` / `agent` / `commission` | the Agent Commons registries (`contract/*`) | Authority/budget grants stored as JSON columns; the D8 cascade is enforced at write (F5). |
| `audit_entry` | channel, commission_id, capability, target, outcome, at | Append-only (`contract/audit.ts`). |

### 2.2 The relation graph as typed edges (not a blob)

The prototype's `RelationGraph` is a denormalized snapshot. In production each
relationship from PROPOSAL §4.7 is a **typed edge**, enforced by FKs and uniqueness:

| Prototype field (`RelationGraph`) | Production edge |
|-----------------------------------|-----------------|
| `sessionProject` | `session.project_id` (nullable FK; a session is filed under ≤1 project) |
| `artifactProject` | `artifact.project_id` (FK) |
| `scheduleProject` | `schedule.project_id` (nullable FK) |
| `projectContexts` | `project_context(project_id, …)` rows |
| `projectInstructions` | `project.instructions` column |
| `artifactSource` | `artifact.source_context_id` (FK) |
| `scheduleArtifact` / `scheduleSession` | `schedule.delivers_artifact_id` / `delivers_session_id` |
| `scheduleExtraTools` | `schedule_tool(schedule_id, …)` rows |
| `standingApprovals` | `standing_approval(schedule_id, op_key, granted_by, granted_at)` rows |

The pure reducer `applyGraphOp` (`contract/graph.ts`) is **kept**, but its role
changes: it remains the client-side optimistic projection and the *validation* of a
proposed op, while the server applies the confirmed op as a **transaction** over these
tables (and emits `relation.applied`). The contract `RelationGraph` shape becomes a
**read projection** assembled from the edges for the UI cache — type-identity (PORT-1)
is preserved; only the storage behind it normalizes.

### 2.3 Derived / projected (not system of record)

Rebuilt from the entities, never the source of truth — so they can be cached,
invalidated, and recomputed:

- **Session `workspace`** — the materialized panels (`workspaceFromSeed` in
  `server/workspace.ts`); projected from the session's contexts.
- **`caps`** — derived from attached context types.
- **fs catalogs** (CTX-FS) — read live from the source (F-broker / [P2](P2-context-filesystem.md)).
- **usage windows**, **reservations/guardian ledger**, **live runner registry** —
  transient by design (the prototype already excludes these from `PersistedState`).

### 2.4 Seed → DB transition

`server/data/*` fixtures become **dev-only idempotent seeds** run through the same
write path (mirroring `scripts/snapshot.ts` `snapshot:build`, which already drives the
real mutators). Production starts empty per tenant; the demo/tour seed is a dev
profile. `STORE_VERSION` (`server/persist.ts`) is replaced by real, ordered,
forward-only schema migrations (F6).

## 3. Failure modes & edge cases

- **Concurrent relation edits** — two clients confirm conflicting ops. Resolve with
  optimistic concurrency on `updated_at`/row version; a lost write returns `409` and
  the client re-reads (PORT sync). Cross-entity ops run in one transaction so a
  half-applied graph can't exist.
- **Orphan references** — a context/source deleted while attached: FKs + soft-delete
  (tombstones) so a stale reference resolves to a "no longer available" state rather
  than a dangling id (the prototype already tolerates stale recents/ids gracefully).
- **Message ordering** — `seq` is server-assigned; a retried send is idempotent by
  client message key (PORT-7 already mints ids server-side).
- **Large content** — bodies over a threshold go to object storage; the row holds a
  `*_ref` + digest (F6).

## 4. Security & multi-tenancy

- `tenant_id` on every row; **all** queries are tenant-scoped (enforced at the data
  layer, not per-call) — the isolation wall F2 details.
- Authority/budget grants (provider/agent/commission) are validated by the D8 cascade
  at write time (F5); the store never persists an over-grant.
- Audit entries are append-only and immutable; soft-deletes preserve the audit trail.
- Secrets (connector tokens, provider keys) are **not** in these tables — only
  references to a secrets store (F5/F6), mirroring how the prototype keeps
  `ProviderConfig` server-only and off the contract.

## 5. Observability & ops

- Per-entity write counters + latency; migration version gauge; relation-op
  throughput; orphan/tombstone counts.
- Backups + point-in-time recovery on the system-of-record DB (F6); derived stores
  need none (rebuildable).

## 6. Open questions & decisions

See [`DECISIONS.md`](DECISIONS.md): **PD1** (relational system of record), **PD2**
(relation graph as typed edges, reducer kept as projection/validator), **PD3** (ULID +
`tenant_id` keying), **PD4** (append-only messages, bodies in object storage), **PD5**
(durable-vs-derived split), **PD6** (forward-only migrations replace `STORE_VERSION`),
**PD7** (soft-delete + immutable audit).
