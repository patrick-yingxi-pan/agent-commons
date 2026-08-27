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
must survive a restart — snapshotted to the filesystem on each mutation and
rehydrated on boot. Transient state (reservations, the live runner registry) is
deliberately *not* persisted. The format is the simplest viable one (a single
JSON snapshot, atomic write). Tests run in-memory.

## Requirements (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| PERSIST-1 | When the real server runs, UI-owned state is snapshotted to `.data/store.json` on each mutation and rehydrated on boot, so it survives a restart. | `server/persistence/persist.ts`, `server/store/index.ts` | `server/persistence/persist.test.ts` | ✅ |
| PERSIST-2 | The snapshot covers exactly the UI-owned slices (+ id counters); genuinely transient state (reservations, the live runner registry, usage windows) is deliberately excluded. **Dispatch runs joined the snapshot (P7)** — a live run survives a restart, and one caught `running` mid-flight is swept to `failed` on rehydrate. **Viewer session preferences join as a nested user→session slice** so presentation intent survives a restart without becoming shared Session state. | `PersistedState` in `server/persistence/format.ts`, `server/store/index.ts`, `server/sessionPreferences.ts` | `server/persistence/persist.test.ts`, `server/persistence/dispatch-durability.test.ts`, `server/persistence/snapshot.test.ts` | ✅ |
| PERSIST-3 | An absent / malformed / version-mismatched snapshot is ignored and the store re-seeds — an incompatible older file can't crash a newer build. | `server/persistence/persist.ts` | `server/persistence/persist.test.ts` | ✅ |
| PERSIST-4 | The snapshot is written atomically (temp file + rename) so a crash mid-write can't leave a corrupt store. | `server/persistence/persist.ts` | `server/persistence/persist.test.ts` | ✅ |
| PERSIST-5 | Snapshot tooling: save / restore / list, plus a comprehensive playground generator that exercises **every** persisted slice once via the real mutators + reducer, asserted by an every-slice coverage invariant. | `scripts/snapshot.ts` | `server/persistence/snapshot.test.ts` | ✅ |
| PERSIST-6 | Tests drive the store fully in-memory (persistence off), never touching disk. | `server/store/index.ts`, `server/testkit/http.ts` | `server/persistence/persist.test.ts`, `server/persistence/snapshot.test.ts` | ✅ |
