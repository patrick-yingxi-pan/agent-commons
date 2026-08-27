<!-- context-schema: v1 -->
# src/components/ — rendered-surface module index

## Scope

The layer's rules are [`src/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## Read path

Read [`../DESIGN.md`](../DESIGN.md) for the governing category,
[`../lib/CLAUDE.md`](../lib/CLAUDE.md) for primitives/projections, and
[`e2e/CLAUDE.md`](../../e2e/CLAUDE.md) when the claim requires a browser.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| COMPONENT-A1 | architecture | Atomic and composite pages compose one resource frame; collection bodies instantiate shared page/rail templates. | [`ResourcePage.tsx`](ResourcePage.tsx) · [`SectionTreeChildren.tsx`](SectionTreeChildren.tsx) | [`../lib/page-grammar.test.ts`](../lib/page-grammar.test.ts) · [`../../e2e/collection-symmetry.spec.ts`](../../e2e/collection-symmetry.spec.ts) | refines UI-A2; requires UILIB-A2 |
| COMPONENT-E1 | experience | Rendered roles use shared primitives and entity-appropriate surfaces. | [`ResourcePage.tsx`](ResourcePage.tsx) · [`PublicFace.tsx`](PublicFace.tsx) | [`../lib/page-grammar.test.ts`](../lib/page-grammar.test.ts) · [`../lib/public-face.test.ts`](../lib/public-face.test.ts) | refines UI-E2; refines UI-E3 |
| COMPONENT-E2 | experience | Rail rows use one fixed-depth anatomy; role changes semantics, never inset, type, or resting weight, and contextual row actions share one resting-display funnel. | [`Sidebar.tsx`](Sidebar.tsx) · [`SectionTreeChildren.tsx`](SectionTreeChildren.tsx) · [`FilterMenu.tsx`](FilterMenu.tsx) · [`RowMenu.tsx`](RowMenu.tsx) | [`../lib/rail-refinement.test.ts`](../lib/rail-refinement.test.ts) · [`../lib/sidebar.test.ts`](../lib/sidebar.test.ts) · [`../../e2e/collection-symmetry.spec.ts`](../../e2e/collection-symmetry.spec.ts) | refines UI-E4 |
| COMPONENT-E3 | experience | Composite actions, search, filters, and bulk disclosure are symmetric main/rail projections. | [`CompositeRailControls.tsx`](CompositeRailControls.tsx) · [`ResourcePage.tsx`](ResourcePage.tsx) | [`../lib/composite-controls.test.ts`](../lib/composite-controls.test.ts) · [`../../e2e/collection-symmetry.spec.ts`](../../e2e/collection-symmetry.spec.ts) | refines UI-E5 |
| COMPONENT-E4 | experience | Organize, split, and close share one focus-aware command surface; one fold pair targets the main page, selected rail subtree, or whole rail according to focus, and the complete forest is permanent. | [`Sidebar.tsx`](Sidebar.tsx) · [`RailSplit.tsx`](RailSplit.tsx) | [`../lib/rail-split.test.ts`](../lib/rail-split.test.ts) · [`../../e2e/own-profile.spec.ts`](../../e2e/own-profile.spec.ts) · [`resize-handle.test.ts`](resize-handle.test.ts) | refines UI-A3; requires COMPONENT-E2 |
| COMPONENT-E5 | experience | Index rows are quiet synopses; configuration, lifecycle, and rich bodies begin on canonical pages. | [`ResourcePage.tsx`](ResourcePage.tsx) · [`SectionView.tsx`](SectionView.tsx) | [`../lib/index-synopsis.test.ts`](../lib/index-synopsis.test.ts) · [`../lib/artifact-index-preview.test.ts`](../lib/artifact-index-preview.test.ts) | refines UI-E3 |
| COMPONENT-E6 | experience | Conversation panes render one bounded chronological window with explicit earlier navigation and persistent in-viewport newer/latest chrome; only the live edge owns typing, compaction, and current consent. | [`ConversationView.tsx`](ConversationView.tsx) · [`ConversationPane.tsx`](ConversationPane.tsx) | [`../lib/message-window.test.ts`](../lib/message-window.test.ts) · [`../../e2e/history-pagination.spec.ts`](../../e2e/history-pagination.spec.ts) | refines UI-E6 |
| COMPONENT-E7 | experience | A lazy section page keeps its pane, shell, siblings, and accessible orientation: loading and failure are announced page-shaped states, never a blank workspace or global blocker; failure offers an explicit document retry without an automatic loop. | [`MainSplit.tsx`](MainSplit.tsx) · [`SectionPane.tsx`](SectionPane.tsx) | [`code-splitting.test.ts`](code-splitting.test.ts) · [`../../e2e/section-loading.spec.ts`](../../e2e/section-loading.spec.ts) | refines UI-A4; requires COMPONENT-E1 |
| COMPONENT-E8 | experience | Ambient-sync degradation has one non-blocking, in-flow shell notice—not one warning per pane—and clears only when the API health projection returns live. | [`SyncHealthNotice.tsx`](SyncHealthNotice.tsx) · [`../App.tsx`](../App.tsx) | [`sync-health-notice.test.ts`](sync-health-notice.test.ts) · [`../../e2e/sync-health.spec.ts`](../../e2e/sync-health.spec.ts) | refines UI-E7; requires API-D5 |
| COMPONENT-E9 | experience | Before the app can truthfully choose auth or workspace, one identity-neutral full-viewport surface communicates loading or an actionable failure using the shared spinner and solid-action cues. | [`AppBootstrapScreen.tsx`](AppBootstrapScreen.tsx) · [`../App.tsx`](../App.tsx) | [`app-bootstrap-screen.test.ts`](app-bootstrap-screen.test.ts) · [`../../e2e/bootstrap-recovery.spec.ts`](../../e2e/bootstrap-recovery.spec.ts) | refines UI-E8; requires API-D6 |
| COMPONENT-E10 | experience | Every canonical detail deep link keeps one page-shaped identity while its reads settle: loading is announced, hidden/missing shares one terminal face, and transport failure is announced separately with one in-place shared-primary retry. | [`ResourcePage.tsx`](ResourcePage.tsx) · [`SectionView.tsx`](SectionView.tsx) | [`../lib/page-grammar.test.ts`](../lib/page-grammar.test.ts) · [`../../e2e/project-page.spec.ts`](../../e2e/project-page.spec.ts) | refines UI-E9; requires API-D7 |
| COMPONENT-V1 | verification | Source scans prove shared structure, pure logic moves to `lib`, and browser-computed facts live in E2E. | [`ResourcePage.tsx`](ResourcePage.tsx) · [`MainSplit.tsx`](MainSplit.tsx) | [`pane-safe-layout.test.ts`](pane-safe-layout.test.ts) · [`../../e2e/project-page.spec.ts`](../../e2e/project-page.spec.ts) | refines UI-V1 |
<!-- context-rules:end -->

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
- **Every collection body is an instantiation, not local markup.** A collection
  root declares one typed `CollectionProjection` (ordered runtime groups and
  rows, flat/static/foldable presentation, partition/section role, empty copy)
  and passes it to `MainCollectionTemplate`; its rail branch passes the same
  description shape to `RailCollectionTemplate`. The templates alone choose
  `ResourcePageSection` / `ResourcePageListPartition` and
  `RailListPartition` / structural tree rows, including disclosure, density
  caps, lead columns, empty answers and review stamps. Consumers only render a
  resource row or the content of an explicitly resource-free structural group.
  Never map groups into those primitives locally
  or add a one-list wrapper such as “Threads.” The shell's Organize pane menu
  targets the main registry, selected rail subtree (root included), or whole
  rail background according to focus. Scope never creates extra commands, and
  list rows do not redraw the menu.
- **Rail depth is a fixed-column grammar.** Every non-root row begins with the
  shared `RailEntryLead`: a branch puts its caret there and a leaf preserves an
  empty seat. Sessions, atomic leaves, empty/tail copy, and labeled filter lists
  may not skip the seat or hand-pick padding; a child without a caret must still
  sit to the right of its parent. All same-depth rows—including groups, items,
  views, state headings, tail actions, and empty copy—source one nested anatomy;
  semantic role may not alter inset, size, or resting weight. A mutable state
  heading is an accessible disclosure row when the corresponding main-page list
  folds. Its list takes one shared `RailTreeBranch` step, so the caret and guide
  communicate posture and containment without tag chrome or a canonical
  navigation node.
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
  inside the cluster. Main focus addresses the page, an entry focuses its whole
  subtree, and empty rail header/background focus addresses the entire panel.
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

## Verification

Run colocated source locks and the browser spec for computed behavior. Perform
the signed-in UI review in [`docs/agent-workflow.md`](../../docs/agent-workflow.md).
