<!-- context-schema: v1 -->
# src/lib/ — primitive and projection module index

## Scope

The layer's rules are [`src/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## Read path

Read [`../DESIGN.md`](../DESIGN.md) only for the relevant visual, interaction,
navigation, or workspace category. Rendered consumers live under
[`../components/CLAUDE.md`](../components/CLAUDE.md).

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| UILIB-A1 | architecture | Every registry—sections, routes, panes, palettes, capabilities—has one authoritative table. | [`sections.tsx`](sections.tsx) · [`urlRoutes.ts`](urlRoutes.ts) · [`theme.ts`](theme.ts) | [`url-routes.test.ts`](url-routes.test.ts) · [`theme.test.ts`](theme.test.ts) | refines UI-A2; refines ROOT-A1 |
| UILIB-A2 | architecture | Collection identity, groups, order, roles, presentation, and emptiness live in one projection model. | [`collectionProjection.ts`](collectionProjection.ts) | [`collection-projection.test.ts`](collection-projection.test.ts) | refines UI-A2; symmetric-with ROOT-E2 |
| UILIB-E1 | experience | Shared primitives own equal roles; consumers compose or extend them rather than restyling copies. | [`button.ts`](button.ts) · [`formInput.ts`](formInput.ts) · [`popover.ts`](popover.ts) | [`button.test.ts`](button.test.ts) · [`form-input.test.ts`](form-input.test.ts) · [`popover.test.ts`](popover.test.ts) | refines UI-E2 |
| UILIB-E2 | experience | Theme and palette application passes through one token funnel. | [`theme.ts`](theme.ts) · [`../index.css`](../index.css) | [`theme.test.ts`](theme.test.ts) · [`contrast.test.ts`](contrast.test.ts) | refines UI-E1 |
| UILIB-V1 | verification | Pure derivations live here so behavior can be locked exactly without a DOM. | [`paneHistory.ts`](paneHistory.ts) · [`replyTree.ts`](replyTree.ts) · [`railSplit.ts`](railSplit.ts) | [`pane-history.test.ts`](pane-history.test.ts) · [`reply-tree.test.ts`](reply-tree.test.ts) · [`rail-split.test.ts`](rail-split.test.ts) | refines UI-V1 |
<!-- context-rules:end -->

## What lives here

The UI's shared vocabulary — the pure, framework-light half of `src/`: the
visual primitives every surface composes (`button`, `checkbox`, `popover`,
`scrim`, `spinner`, `formInput`, `pageHeader`, …), the **registries** that are
each a single source of truth (`sections.tsx`, `railSplit.ts`, `theme.ts`,
`urlRoutes.ts`), and the pure functions surfaces derive state from
(`splitFrame`, `mainSplit`, `paneHistory`, `replyTree`, `anchorLocus`).

Beside them, the ~52 suites that lock them. That density is the point: this
directory holds what everything else composes, so it is where a regression
travels furthest, and it is where the locks are cheapest to write (pure input →
output, no DOM needed).

## Rules

- **A registry has ONE home.** Sections, rail panes, palettes, URL routes — the
  rail, the body, the pickers and the docs all derive from the same table. A
  second hand-kept list is the drift; projection locks exist because a prose
  inventory once diverged from `sections.tsx` and hid missing sections.
- **Primitives are shared, not restyled.** A surface that wants a slightly
  different button extends the primitive; it does not hand-roll one. Suites here
  assert the import (`thread-composer` checks the composer sources the shared
  face) precisely because a local copy looks fine until the token changes.
- **Pure where it can be.** Anything expressible as a function of its inputs
  belongs here rather than inside a component, because `node --test` has no DOM:
  what lives here can be locked exactly, and what doesn't has to be verified in
  the running app or in `e2e/`.
- **A collection has one runtime projection model.**
  `collectionProjection.ts` is the typed bridge between the main-page and rail
  templates. Group identity, order, role, presentation and emptiness belong in
  that model; rail density reduction is a pure, non-mutating projection that
  preserves named groups and the addressed item. Components may specialize a
  row payload, never rebuild the group grammar.
- **Theming goes through the one funnel** (`theme.ts`) — it alone persists and
  derives the composable recipe, writes the palette token set, and stamps
  `data-theme` / `data-palette` / finish. Full rationale and contract:
  [`src/DESIGN.md`](../DESIGN.md).

## Verification

Run the changed primitive/projection suite and its consuming source lock. Any
new registry or primitive must add an enumeration lock that catches local copies.
