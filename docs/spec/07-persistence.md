# 07 · Server-owned state & persistence

> **Intent.** The frontend is a cache of the backend, so the state the UI owns
> (sent messages, created sessions, attached context + its panels, schedules,
> recents, relation edits, the Agent Commons registries) is the *server's*, and it
> must survive a restart — committed through the configured local backend on each
> mutation and rehydrated on boot. Transient state (reservations, the live runner
> registry) is deliberately *not* persisted. JSON and embedded SQLite implement one
> versioned state contract; canonical portable exports cross that backend boundary and
> restore only after validation + migration. A write acknowledgement means the selected
> backend committed; commit failure makes the process unready and product-walled until
> restart. At boot, only genuine absence may seed; existing unusable storage stops the
> process before any replacement write. (AGENTS "Created state is persisted to
> the filesystem"; README repo map.)

## Requirements (L2) → [`server/persistence/SPEC.md`](../../server/persistence/SPEC.md)

This pillar's leaf requirements — **PERSIST-1 … PERSIST-7** — live next to the
code that satisfies them and the suites that lock them, in
[`server/persistence/SPEC.md`](../../server/persistence/SPEC.md). One module,
one home: rows, implementation, and locks are all readable without leaving the
directory, and there is no second copy here to drift out of date.

The *Intent* stays here because it is the cross-cutting claim — what the rest of
the system assumes about durability — so it is stated where the argument is
read, not only where the code is edited. That split is the rule this pillar is
the first to follow: **pillars keep the claim, modules keep the rows.**
