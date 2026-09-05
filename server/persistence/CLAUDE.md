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
| PERSIST-D2 | data-access | Snapshot coverage equals durable UI-owned state and excludes truly transient state. Viewer Contexts rows retain server-owned tenant stamps and connection revisions; legacy/default recents and non-default tenant partitions round-trip without duplication. Dispatch timer rows fail closed after restart; execution-aware routine rows preserve their attempt cursor for worker recovery; keyed open-work, embedded comment, private retraction identities, and Contribution landing/effect/crystallization/envelope-approval/envelope-proposal receipt anchors round-trip with current lifecycle/thread truth; removed keyed Sessions and Agents retain retirement identities so late Retry cannot resurrect direct creation, branching, forking, or Agent Card import. | [`format.ts`](format.ts) · [`migrate.ts`](migrate.ts) · [`../contextRegistry.ts`](../contextRegistry.ts) · [`../store/index.ts`](../store/index.ts) | [`snapshot.test.ts`](snapshot.test.ts) · [`persist-backend.test.ts`](persist-backend.test.ts) · [`dispatch-durability.test.ts`](dispatch-durability.test.ts) · [`routine-durability.test.ts`](routine-durability.test.ts) | requires PERSIST-A1; refines ROOT-A1 |
| PERSIST-D3 | data-access | Backend commit failure or an ambiguous partial compound mutation propagates across the acknowledgement boundary; the store becomes unready and product-walled until restart, existing sync streams close, and liveness/diagnostics remain available. | [`persist.ts`](persist.ts) · [`../store/index.ts`](../store/index.ts) · [`../routes/index.ts`](../routes/index.ts) | [`acknowledgement.test.ts`](acknowledgement.test.ts) · [`persist-backend.test.ts`](persist-backend.test.ts) · [`../routes/proposals.test.ts`](../routes/proposals.test.ts) | refines SERVER-D4; requires PERSIST-D1 |
| PERSIST-D4 | data-access | Only genuine first boot may seed. Existing unreadable, malformed, invalid, unrecognized, or incompatible storage stops startup before persistence is enabled or live state is replaced. | [`json.ts`](json.ts) · [`sqlite.ts`](sqlite.ts) · [`persist.ts`](persist.ts) · [`../store/index.ts`](../store/index.ts) | [`startup-integrity.test.ts`](startup-integrity.test.ts) · [`persist.test.ts`](persist.test.ts) · [`persist-backend.test.ts`](persist-backend.test.ts) | refines SERVER-D4; requires PERSIST-A1 |
| PERSIST-D5 | data-access | First boot records its demo/clean world; later boots obey that stored discriminator and never reinterpret established data from the environment. | [`format.ts`](format.ts) · [`../initialWorld.ts`](../initialWorld.ts) · [`../store/index.ts`](../store/index.ts) | [`initial-world.test.ts`](initial-world.test.ts) | refines PERSIST-D4; requires PERSIST-D2 |
| PERSIST-D6 | data-access | CLI and desktop managed backups share one safe-name funnel over the canonical portable format; atomic replacement creates private files, and backup reads never expose backend-private bytes or OS-vault secrets. | [`backup.ts`](backup.ts) · [`portable.ts`](portable.ts) · [`atomicFile.ts`](atomicFile.ts) | [`snapshot.test.ts`](snapshot.test.ts) · [`portable.test.ts`](portable.test.ts) · [`../../desktop/dataProtocol.test.ts`](../../desktop/dataProtocol.test.ts) | refines PERSIST-A1; requires PERSIST-D1 |
| PERSIST-D7 | data-access | Automatic desktop recovery is one idempotent snapshot per UTC day with the newest seven retained. Cleanup matches only the exact reserved recovery namespace and runs before a new write; manual save rejects that namespace, so manual backups are never pruned or replaced. | [`backup.ts`](backup.ts) | [`snapshot.test.ts`](snapshot.test.ts) · [`../../desktop/dataProtocol.test.ts`](../../desktop/dataProtocol.test.ts) | refines PERSIST-D6 |
| PERSIST-D8 | data-access | Desktop replacement selects only exact managed backup names and runs with the live backend proven stopped. Healthy restore first creates a fresh manual safety copy; startup recovery declares that it cannot. Both use canonical validation, migration, atomic/transactional replacement, read-back proof, and a mandatory process restart while OS-vault secrets remain untouched. | [`backup.ts`](backup.ts) · [`portable.ts`](portable.ts) · [`../../desktop/restoreProtocol.mjs`](../../desktop/restoreProtocol.mjs) · [`../../desktop/restoreLifecycle.mjs`](../../desktop/restoreLifecycle.mjs) · [`../../desktop/restoreWorker.mjs`](../../desktop/restoreWorker.mjs) | [`snapshot.test.ts`](snapshot.test.ts) · [`../../desktop/restoreProtocol.test.ts`](../../desktop/restoreProtocol.test.ts) · [`../../desktop/restoreLifecycle.test.ts`](../../desktop/restoreLifecycle.test.ts) · [`../../desktop/restoreWorker.test.ts`](../../desktop/restoreWorker.test.ts) | refines PERSIST-D6; requires PERSIST-D1 |
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
- `backup.ts` — the shared safe-name, managed-directory save/list/restore funnel
  used by both the CLI and the desktop utility process, including the exact
  daily-recovery namespace and retention policy.
- The suites that lock all of the above, beside them.

## Rules

- **Only genuine first boot seeds.** An absent JSON file or SQLite database just
  created by this backend receives the baseline. Existing unreadable, malformed,
  structurally invalid, unrecognized, newer, or un-migratable storage fails startup
  without a seed write; recovery bytes remain in place. A supported older version
  migrates forward before rehydrate.
- **First boot chooses once.** Development defaults to the authored demo; release
  profiles request a clean baseline. The snapshot records that choice and owns it
  thereafter, so a changed environment can neither clean a demo store nor re-seed
  a clean/user store.
- **Writes are atomic** (temp file + rename), so a crash mid-write cannot leave
  a corrupt JSON/export file; SQLite replaces its snapshot in one transaction
  and uses WAL recovery.
- **No durable commit, no acknowledgement.** Backend save errors throw. The
  originating route returns `503 storage_unavailable`; the store latches unready
  and all later product reads/writes fail until restart, even if disk access
  recovers. Existing ambient streams close so clients reconnect through that
  wall. A process whose memory may have advanced past disk never self-heals.
- **Exports contain canonical `PersistedState`, never backend-private bytes.** A
  backup made from JSON must restore into SQLite and vice versa. Restore validates
  + migrates before mutation and fails unless backend read-back matches.
- **The snapshot covers exactly the UI-owned slices.** Genuinely transient
  state — reservations, the live runner registry, usage windows — is excluded on
  purpose. Dispatch runs ARE included (P7): a run caught `running` mid-flight is
  swept to `failed` on rehydrate, which is what makes that status reachable.
  Routine attempt cursors are durable: only legacy timer-era running rows sweep;
  execution-aware rows remain recoverable work for the routine worker.
- **Ordinary store tests never touch product storage.** Persistence suites use
  memory databases or explicit throwaway paths; they never use `.data/store.*`.
- **A new persisted slice is not done until `snapshot.test.ts`'s every-slice
  coverage invariant sees it** — that assertion is what stops a slice from being
  added to the store and silently forgotten by the snapshot.

## Verification

Run all persistence suites and update [`SPEC.md`](SPEC.md) for any format,
backend, migration, or durable-slice change.
