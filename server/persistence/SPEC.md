# SPEC — server/persistence/

> The requirement rows this module owns, local to the code that satisfies them
> and the suites that lock them. The pillar
> [`docs/spec/07-persistence.md`](../../docs/spec/07-persistence.md) keeps the
> *Intent* and indexes here; the rows themselves live in one place — this one.
> Ledger conventions (status legend, ID scheme, L0/L1/L2 layering):
> [`docs/spec/README.md`](../../docs/spec/README.md).

**Intent.** The frontend is a cache of the backend, so the state the UI owns
(sent messages, created sessions, attached context + its panels, schedules,
recents, relation edits, the Agent Commons registries) is the *server's*, and it
must survive a restart — committed through a selected local backend on each
mutation and rehydrated on boot. Transient state (reservations, the live runner
registry) is deliberately *not* persisted. JSON remains the development default;
embedded SQLite is the desktop production store. Both share one versioned state
contract and portable export format.

## Requirements (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| PERSIST-1 | When the real server runs, UI-owned state is committed through the configured backend (`.data/store.json` for JSON or `.data/store.db` for SQLite) on each mutation and rehydrated on boot, so it survives a restart. | `server/persistence/persist.ts`, `server/persistence/json.ts`, `server/persistence/sqlite.ts`, `server/store/index.ts` | `server/persistence/persist.test.ts`, `server/persistence/persist-backend.test.ts` | ✅ |
| PERSIST-2 | The snapshot covers exactly the UI-owned slices (+ id counters); genuinely transient state (reservations, the live runner registry, usage windows) is deliberately excluded. **Dispatch runs joined the snapshot (P7)** — a live run survives a restart, and one caught `running` mid-flight is swept to `failed` on rehydrate. **Viewer session preferences join as a nested user→session slice** so presentation intent survives a restart without becoming shared Session state. | `PersistedState` in `server/persistence/format.ts`, `server/store/index.ts`, `server/sessionPreferences.ts` | `server/persistence/persist.test.ts`, `server/persistence/dispatch-durability.test.ts`, `server/persistence/snapshot.test.ts` | ✅ |
| PERSIST-3 | Only genuinely absent storage seeds. An existing malformed, structurally invalid, unrecognized, newer, or un-migratable JSON/SQLite store stops startup before persistence is enabled or state is replaced; supported older state migrates forward, and explicit restore rejects unusable input before mutation. | `server/persistence/json.ts`, `server/persistence/sqlite.ts`, `server/persistence/migrate.ts`, `server/persistence/portable.ts`, `server/persistence/persist.ts`, `server/store/index.ts` | `server/persistence/startup-integrity.test.ts`, `server/persistence/persist.test.ts`, `server/persistence/persist-backend.test.ts`, `server/persistence/persist-migrate.test.ts`, `server/persistence/portable.test.ts` | ✅ |
| PERSIST-4 | JSON and portable export files share cross-platform atomic temp-file replacement (including bounded Windows rename retries); SQLite replaces the full snapshot transactionally under WAL. Orderly server exit closes/checkpoints the active backend. | `server/persistence/atomicFile.ts`, `server/persistence/json.ts`, `server/persistence/sqlite.ts`, `server/persistence/portable.ts`, `server/index.ts` | `server/persistence/persist.test.ts`, `server/persistence/persist-backend.test.ts`, `server/persistence/portable.test.ts` | ✅ |
| PERSIST-5 | Snapshot tooling saves, restores, and lists canonical portable exports across JSON and SQLite. Restore validates + migrates before touching live storage and read-back proves the write landed. The comprehensive playground generator exercises **every** persisted slice once via the real mutators + reducer. | `scripts/snapshot.ts`, `server/persistence/portable.ts` | `server/persistence/snapshot.test.ts`, `server/persistence/portable.test.ts` | ✅ |
| PERSIST-6 | Ordinary store/route tests run in memory; persistence suites use only memory databases or explicit throwaway paths, never product `.data/store.*`. | `server/store/index.ts`, `server/testkit/http.ts` | `server/persistence/persist.test.ts`, `server/persistence/snapshot.test.ts`, `server/persistence/persist-backend.test.ts` | ✅ |
| PERSIST-7 | A product mutation is acknowledged only after its backend commit succeeds. Any JSON/SQLite commit failure propagates as `503 storage_unavailable`, permanently marks the process unready, closes existing ambient sync streams, and walls every later product read/write until restart; liveness/readiness/metrics remain available for supervision. | `server/persistence/persist.ts`, `server/store/index.ts`, `server/http/router.ts`, `server/routes/index.ts` | `server/persistence/acknowledgement.test.ts`, `server/persistence/persist-backend.test.ts` | ✅ |
