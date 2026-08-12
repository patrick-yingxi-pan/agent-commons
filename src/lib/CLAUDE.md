# src/lib/ — shared primitives & registries (loaded when working here)

The layer's rules are [`src/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## What lives here

The UI's shared vocabulary — the pure, framework-light half of `src/`: the
visual primitives every surface composes (`button`, `checkbox`, `popover`,
`scrim`, `spinner`, `formInput`, `pageHeader`, …), the **registries** that are
each a single source of truth (`sections.tsx`, `railPanes.ts`, `theme.ts`,
`urlRoutes.ts`), and the pure functions surfaces derive state from
(`splitFrame`, `mainSplit`, `paneHistory`, `replyTree`, `anchorLocus`).

Beside them, the ~52 suites that lock them. That density is the point: this
directory holds what everything else composes, so it is where a regression
travels furthest, and it is where the locks are cheapest to write (pure input →
output, no DOM needed).

## Rules

- **A registry has ONE home.** Sections, rail panes, palettes, URL routes — the
  rail, the body, the pickers and the docs all derive from the same table. A
  second hand-kept list is the drift, and several locks here exist because one
  appeared (`PROPOSAL.md`'s section list was derived from `sections.tsx` only
  after it had rotted).
- **Primitives are shared, not restyled.** A surface that wants a slightly
  different button extends the primitive; it does not hand-roll one. Suites here
  assert the import (`thread-composer` checks the composer sources the shared
  face) precisely because a local copy looks fine until the token changes.
- **Pure where it can be.** Anything expressible as a function of its inputs
  belongs here rather than inside a component, because `node --test` has no DOM:
  what lives here can be locked exactly, and what doesn't has to be verified in
  the running app or in `e2e/`.
- **Theming goes through the one funnel** (`theme.ts`) — it alone stamps
  `data-theme` / `data-palette`. Full rule + palette contract:
  [`src/CLAUDE.md`](../CLAUDE.md).
