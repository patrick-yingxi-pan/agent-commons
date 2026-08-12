# src/components/ — the rendered surfaces (loaded when working here)

The layer's rules are [`src/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## What lives here

Every React surface: the shell (`Sidebar`, `PanelShell`, `OverlayPanelDock`),
the thread, the section views, the entity pages, the dialogs and controls.
These compose [`../lib/`](../lib/CLAUDE.md) primitives and read data through
[`../api/`](../api/CLAUDE.md) hooks — never a URL or an SSE event directly.

## What the suites here can and cannot do

`node --test` has **no DOM**, so a suite beside a `.tsx` file cannot render it.
What these suites do instead is **scan the source** for the structural facts a
render would otherwise have to prove — that a control sources the shared
primitive, that a panel is out of flow, that a dock reserves its space. That is
a real lock (it fails when someone hand-rolls a copy) and a partial one (it
cannot see what the browser computes).

So the division is deliberate:

- **Pure logic → [`../lib/`](../lib/CLAUDE.md)**, where it is locked exactly.
  If a rule here is hard to assert, that is usually a sign the logic wants to
  move rather than that the assertion wants to be cleverer.
- **What only a browser can prove → [`e2e/`](../../e2e/CLAUDE.md)**: layout,
  focus, scroll, overlay stacking, keyboard.
- **What neither can → the running app**, verified by hand and *said so*, per
  the honesty rule in [`tests/CLAUDE.md`](../../tests/CLAUDE.md).

A source-scan lock must read the implementation, never a second copy of the
fact — the whole point is that it fails when the implementation moves away from
what the document or the sibling component claims.

## Rules

- **Form follows function; surface follows the entity.** What an entity IS
  decides its surface (lifecycle → timeline, change → diff, relation →
  ref-link). Method: [`docs/design/surface-from-nature.md`](../../docs/design/surface-from-nature.md).
- **The entity page is the shared surface** — owner and visitor render the same
  page, differing by the `own` flag, not by two components. Two components is
  how a visitor-only regression hides.
- **No component knows a URL.** Data comes from hooks; commands go to
  controllers ([`src/CLAUDE.md`](../CLAUDE.md)).
