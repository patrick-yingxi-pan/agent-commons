# server/persistence/ — snapshots & durability (loaded when working here)

The layer's rules are [`server/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md). The requirement rows this module owns are
[`SPEC.md`](SPEC.md) — local, because they are checkable here.

## What lives here

- `persist.ts` — the store-facing facade: `loadState` / `saveState`,
  `STORE_VERSION`, and the `PersistedState` shape. It moved down from the
  server root so the module holds its own entry point.
- `index.ts` — backend selection (JSON or SQLite) behind one interface.
- `json.ts` · `sqlite.ts` — the two backends. `format.ts` — the on-disk shape.
- `migrate.ts` — forward migration of an older snapshot.
- The suites that lock all of the above, beside them.

## Rules

- **Absent, malformed, or version-mismatched snapshots re-seed — never crash.**
  A file written by an older build must not be able to take a newer one down.
- **Writes are atomic** (temp file + rename), so a crash mid-write cannot leave
  a corrupt store.
- **The snapshot covers exactly the UI-owned slices.** Genuinely transient
  state — reservations, the live runner registry, usage windows — is excluded on
  purpose. Dispatch runs ARE included (P7): a run caught `running` mid-flight is
  swept to `failed` on rehydrate, which is what makes that status reachable.
- **Tests never touch disk.** Persistence is bypassed under `node --test`; what
  the suites here exercise is the format and the round-trip, in memory.
- **A new persisted slice is not done until `snapshot.test.ts`'s every-slice
  coverage invariant sees it** — that assertion is what stops a slice from being
  added to the store and silently forgotten by the snapshot.
