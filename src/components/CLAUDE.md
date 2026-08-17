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
- **Every main page declares its resource nature.** Collection/hub/composite
  pages derive from `CompositeResourcePage`; leaf pages derive from
  `AtomicResourcePage`. Both compose `ResourcePageFrame`; only the composite
  template registers structural sections. Sessions select the atomic
  `workspace` layout for their transcript/fixed-composer behavior. Contract and equivalence test:
  [`docs/design/resource-page-templates.md`](../../docs/design/resource-page-templates.md).
- **A collection heading is a rail place when it structures the main page.**
  Artifacts, Contexts, and Models route their intermediate collection sections
  through `collectionSectionId`; both projections consume
  `lib/collectionSections.ts`, and each child keeps its canonical leaf page.
  The shell's Organize pane menu targets the main registry or strict descendants
  of the selected rail entry according to focus; collection rows do not redraw it.
- **Rail depth is a fixed-column grammar.** Every non-root row begins with the
  shared `RailEntryLead`: a branch puts its caret there and a leaf preserves an
  empty seat. Sessions, atomic leaves, empty/tail copy, and labeled filter lists
  may not skip the seat or hand-pick padding; a child without a caret must still
  sit to the right of its parent. All same-depth rows—including groups, items,
  views, state headings, tail actions, and empty copy—source one nested anatomy;
  semantic role may not alter inset, size, or resting weight. A mutable state
  heading's list takes one shared `RailTreeBranch` step, so the guide communicates
  containment without tag chrome or a canonical disclosure node.
- **Composite capabilities are mirrored, not duplicated.** The one
  `lib/compositeFeatures.ts` catalog declares each root's standing primary
  action, local search and bulk disclosure; applicable Filter & sort remains
  the shared live component. `CompositeRailControls` adapts the capabilities to
  one compact row menu, while the focused page's real `PageActionButton`, search
  field and `CompositePageControls` answer the command. The page reports its
  live fold work to shell chrome, including local dynamic bands;
  `persist={false}` still keeps their titles out of `uiPrefs`.
  Density may adapt, but a standing capability cannot disappear.
- **Organize/split/close is one focus-aware command surface.** `PaneActionButtons` is
  reused for main and rail. Main focus offers its existing row/column split;
  selecting any `[data-rail-entry]` changes the same cluster to vertical-only
  rail split. Close pane deletes only a rooted secondary rail view; the complete
  forest is a permanent recovery anchor and never exposes or accepts Close.
  Restoring a legacy tree that lost it prepends the complete forest without
  discarding the surviving projection. The selected node becomes the new view
  root: keep its descendants, remove visible ancestors and outside siblings,
  and preserve canonical identity/URL. `RailSplit` renders
  the generic binary tree; do not add rail-only split menus or per-pane close
  buttons. Presentation adapts to its host: the expanded rail groups the two
  split directions in one labeled menu so Close can remain the terminal direct
  action at the 208px minimum, while the unconstrained vertical MiniRail keeps
  the direct buttons. Fold all / Unfold all share one labeled Organize pane menu
  inside the cluster and act only on the focused main page or selected rail subtree.
- **An index entry is a synopsis, not a compressed detail page.** Ordinary
  addressable rows consume `ResourcePageSynopsisRow`: 13px identity, one 12px
  descriptor and one 11px state/count field in a frameless divider ledger.
  Configuration, history and primary lifecycle acts begin on the canonical
  page. Keep a box only when containment communicates a real independent body
  or function (post, editor, diff, form, metric tile), not merely more metadata.
- **The entity page is the shared surface** — owner and visitor render the same
  page, differing by the `own` flag, not by two components. Two components is
  how a visitor-only regression hides.
- **No component knows a URL.** Data comes from hooks; commands go to
  controllers ([`src/CLAUDE.md`](../CLAUDE.md)).
