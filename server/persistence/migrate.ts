/** ── Forward-only data migrations (design F1 PD6 / F6 PD28) ───────────────────
 *  Replaces the prototype's "version mismatch ⇒ discard and reseed" with an upgrade
 *  path: a loaded snapshot at an older `version` is transformed, one version at a
 *  time, up to the current `STORE_VERSION` — so a store upgrade preserves data
 *  instead of dropping it. Both persistence backends route their `load()` through
 *  `migrateState`, so the rule is identical across JSON and SQLite.
 *
 *  The v2/v3/v4 historical bumps were intentionally discard-and-reseed (no path
 *  registered, so those still reseed). The v5 bump is the first to migrate in place:
 *  it backfills the `AuditEntry.tenantId` added for tenant-scoped audit (F5/PD9). On
 *  the *next* `STORE_VERSION` bump, append one more `DataMigration` here. */
import { STORE_VERSION, type PersistedState } from './format.ts'

/** Transforms a snapshot from version `to - 1` to version `to`. The engine stamps
 *  `version = to` after `migrate` runs, so a migration only reshapes the data. */
export interface DataMigration {
  to: number
  migrate: (state: PersistedState) => PersistedState
}

/** Ordered, forward-only migrations. APPEND ONLY — never edit a shipped migration
 *  (a deployed store may already have run it). One entry per `STORE_VERSION` step.
 *  Migrations bake in literal values (not imports) so a frozen transform can't shift
 *  if a constant elsewhere later changes. */
export const DATA_MIGRATIONS: DataMigration[] = [
  // v4 → v5: AuditEntry.tenantId became required (tenant-scoped audit, F5/PD9). Legacy
  // entries predate tenancy = the single personal tenant, so stamp them 'tenant-personal'
  // (the value of LOCAL_IDENTITY.tenant.id when this migration was written).
  {
    to: 5,
    migrate: (state) => ({
      ...state,
      auditLog: state.auditLog?.map((e) =>
        e.tenantId ? e : { ...e, tenantId: 'tenant-personal' },
      ),
    }),
  },
]

/** Bring a loaded snapshot up to `target` (default `STORE_VERSION`), or return null
 *  when it can't be used — absent/garbage, newer than this build (no downgrade), or
 *  missing a migration step (a gap ⇒ discard, safe). A snapshot already at `target`
 *  passes straight through. Pure (the `migrations`/`target` params are injectable for
 *  tests). */
export function migrateState(
  state: PersistedState | null,
  migrations: DataMigration[] = DATA_MIGRATIONS,
  target: number = STORE_VERSION,
): PersistedState | null {
  if (!state || typeof state.version !== 'number') return null
  if (state.version > target) return null // newer than this build — can't downgrade
  let cur = state
  while (cur.version < target) {
    const step = migrations.find((m) => m.to === cur.version + 1)
    if (!step) return null // no path to the next version — discard (reseed)
    cur = { ...step.migrate(cur), version: step.to }
  }
  return cur.version === target ? cur : null
}
