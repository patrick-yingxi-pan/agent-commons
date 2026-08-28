<!-- context-schema: v1 -->
# server/persistence/ — persistence module index

## Scope

The layer's rules are [`server/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md). The requirement rows this module owns are
[`SPEC.md`](SPEC.md) — local, because they are checkable here.

## Read path

Read [`SPEC.md`](SPEC.md), then the backend/format being changed and its sibling
suite. Store-shape changes also require [`../store/CLAUDE.md`](../store/CLAUDE.md).

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| PERSIST-A1 | architecture | JSON and SQLite implement one store-facing persistence interface and versioned state; portable exports never expose backend-private bytes. | [`index.ts`](index.ts) · [`format.ts`](format.ts) · [`persist.ts`](persist.ts) · [`portable.ts`](portable.ts) | [`persist-backend.test.ts`](persist-backend.test.ts) · [`portable.test.ts`](portable.test.ts) · [`snapshot.test.ts`](snapshot.test.ts) | refines SERVER-D4 |
| PERSIST-D1 | data-access | Live writes are atomic/transactional; explicit restore validates and migrates before mutation, then read-back proves it landed. | [`atomicFile.ts`](atomicFile.ts) · [`json.ts`](json.ts) · [`sqlite.ts`](sqlite.ts) · [`portable.ts`](portable.ts) | [`persist.test.ts`](persist.test.ts) · [`portable.test.ts`](portable.test.ts) · [`snapshot.test.ts`](snapshot.test.ts) | refines SERVER-D4 |
| PERSIST-D2 | data-access | Snapshot coverage equals durable UI-owned state and excludes truly transient state. | [`format.ts`](format.ts) · [`migrate.ts`](migrate.ts) | [`snapshot.test.ts`](snapshot.test.ts) · [`dispatch-durability.test.ts`](dispatch-durability.test.ts) | requires PERSIST-A1; refines ROOT-A1 |
| PERSIST-V1 | verification | Every new durable slice updates local requirements, round-trip coverage, and migration behavior. | [`SPEC.md`](SPEC.md) · [`migrate.ts`](migrate.ts) | [`snapshot.test.ts`](snapshot.test.ts) · [`persist-migrate.test.ts`](persist-migrate.test.ts) | refines SERVER-V1; requires PERSIST-D2 |
<!-- context-rules:end -->

## What lives here

- `persist.ts` — the store-facing facade: `loadState` / `saveState`,
  `STORE_VERSION`, and the `PersistedState` shape. It moved down from the
  server root so the module holds its own entry point.
- `index.ts` — backend selection (JSON or SQLite) behind one interface.
- `json.ts` · `sqlite.ts` — the two backends. `atomicFile.ts` — their shared
  cross-platform atomic-file primitive. `format.ts` — the on-disk shape.
- `migrate.ts` — forward migration of an older snapshot. `portable.ts` —
  backend-neutral, validated export/restore with atomic files and read-back proof.
- The suites that lock all of the above, beside them.

## Rules

- **Absent, malformed, or version-mismatched snapshots re-seed — never crash.**
  A file written by an older build must not be able to take a newer one down.
- **Writes are atomic** (temp file + rename), so a crash mid-write cannot leave
  a corrupt JSON/export file; SQLite replaces its snapshot in one transaction
  and uses WAL recovery.
- **Exports contain canonical `PersistedState`, never backend-private bytes.** A
  backup made from JSON must restore into SQLite and vice versa. Restore validates
  + migrates before mutation and fails unless backend read-back matches.
- **The snapshot covers exactly the UI-owned slices.** Genuinely transient
  state — reservations, the live runner registry, usage windows — is excluded on
  purpose. Dispatch runs ARE included (P7): a run caught `running` mid-flight is
  swept to `failed` on rehydrate, which is what makes that status reachable.
- **Ordinary store tests never touch product storage.** Persistence suites use
  memory databases or explicit throwaway paths; they never use `.data/store.*`.
- **A new persisted slice is not done until `snapshot.test.ts`'s every-slice
  coverage invariant sees it** — that assertion is what stops a slice from being
  added to the store and silently forgotten by the snapshot.

## Verification

Run all persistence suites and update [`SPEC.md`](SPEC.md) for any format,
backend, migration, or durable-slice change.
