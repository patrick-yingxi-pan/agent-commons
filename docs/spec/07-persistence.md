# 07 · Server-owned state & persistence

> **Intent.** The frontend is a cache of the backend, so the state the UI owns
> (sent messages, created sessions, attached context + its panels, schedules,
> recents, relation edits, the Agent Commons registries) is the *server's*, and it
> must survive a restart — snapshotted to the filesystem on each mutation and
> rehydrated on boot. Transient state (reservations, the live runner registry) is
> deliberately *not* persisted. The format is the simplest viable one (a single JSON
> snapshot, atomic write). Tests run in-memory. (AGENTS "Created state is persisted to
> the filesystem"; README repo map.)

## Requirements (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| PERSIST-1 | When the real server runs, UI-owned state is snapshotted to `.data/store.json` on each mutation and rehydrated on boot, so it survives a restart. | `server/persist.ts`, `server/store.ts` | `tests/persist.test.ts` | ✅ |
| PERSIST-2 | The snapshot covers exactly the UI-owned slices (+ id counters); transient state (reservations, the live runner registry, dispatch, usage windows) is deliberately excluded. | `PersistedState` in `server/persist.ts`, `server/store.ts` | `tests/persist.test.ts` | ✅ |
| PERSIST-3 | An absent / malformed / version-mismatched snapshot is ignored and the store re-seeds — an incompatible older file can't crash a newer build. | `server/persist.ts` | `tests/persist.test.ts` | ✅ |
| PERSIST-4 | The snapshot is written atomically (temp file + rename) so a crash mid-write can't leave a corrupt store. | `server/persist.ts` | `tests/persist.test.ts` | ✅ |
| PERSIST-5 | Snapshot tooling: save / restore / list, plus a comprehensive playground generator that exercises **every** persisted slice once via the real mutators + reducer, asserted by an every-slice coverage invariant. | `scripts/snapshot.ts` | `tests/snapshot.test.ts` | ✅ |
| PERSIST-6 | Tests drive the store fully in-memory (persistence off), never touching disk. | `server/store.ts`, `tests/helpers/http.ts` | `tests/persist.test.ts`, `tests/snapshot.test.ts` | ✅ |
