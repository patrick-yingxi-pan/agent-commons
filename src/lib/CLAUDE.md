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
| UILIB-A2 | architecture | Collection identity, groups, order, roles, presentation, and emptiness live in one projection model. Acknowledged Project/artifact creations and complete registry reads join by opaque ID exactly once, never by display name, through one shared UI/body-cache union. | [`collectionProjection.ts`](collectionProjection.ts) · [`registryRows.ts`](registryRows.ts) | [`collection-projection.test.ts`](collection-projection.test.ts) · [`artifact-registry.test.ts`](artifact-registry.test.ts) · [`registry-rows.test.ts`](registry-rows.test.ts) · [`../../e2e/artifact-registry.spec.ts`](../../e2e/artifact-registry.spec.ts) · [`../../e2e/project-registry.spec.ts`](../../e2e/project-registry.spec.ts) | refines UI-A2; symmetric-with ROOT-E2 |
| UILIB-E1 | experience | Shared primitives own equal roles; consumers compose or extend them rather than restyling copies. Anchored popovers clamp vertically to the nearest live workspace body below global notices and react when either body or popover resizes. Readable chip counts inherit their full-contrast tone without opacity weakening. Bounded form and credential ceremonies share one dynamic-viewport layer/panel/body funnel, with `useBoundedDialog` observing the live workspace bound below notices: the panel stays contained and the body alone scrolls. | [`button.ts`](button.ts) · [`formInput.ts`](formInput.ts) · [`popover.ts`](popover.ts) · [`usePopoverShift.ts`](usePopoverShift.ts) · [`dialog.ts`](dialog.ts) · [`useBoundedDialog.ts`](useBoundedDialog.ts) · [`../App.tsx`](../App.tsx) · [`chipStyle.ts`](chipStyle.ts) | [`button.test.ts`](button.test.ts) · [`form-input.test.ts`](form-input.test.ts) · [`popover.test.ts`](popover.test.ts) · [`dialog.test.ts`](dialog.test.ts) · [`capabilities.test.ts`](capabilities.test.ts) · [`../../e2e/model-preferences.spec.ts`](../../e2e/model-preferences.spec.ts) · [`../../e2e/docx-input.spec.ts`](../../e2e/docx-input.spec.ts) | refines UI-E2 |
| UILIB-E2 | experience | Theme and palette application passes through one token funnel. | [`theme.ts`](theme.ts) · [`../index.css`](../index.css) | [`theme.test.ts`](theme.test.ts) · [`contrast.test.ts`](contrast.test.ts) | refines UI-E1 |
| UILIB-E3 | experience | Share-link syntax, failure classification, and post-redemption destinations are pure and total; canonical resource paths reuse the existing social-kind, pane-seed, and URL funnels. | [`sharedLink.ts`](sharedLink.ts) · [`anchorLocus.ts`](anchorLocus.ts) · [`paneNav.ts`](paneNav.ts) · [`urlRoutes.ts`](urlRoutes.ts) | [`shared-link.test.ts`](shared-link.test.ts) · [`anchor-locus.test.ts`](anchor-locus.test.ts) | refines UI-E4; requires UILIB-A1 |
| UILIB-E4 | experience | Conditional section availability is declared once with section metadata, and main-tree pruning removes an unavailable page from both live leaves and every surviving Back stack. | [`sections.tsx`](sections.tsx) · [`paneHistory.ts`](paneHistory.ts) | [`sections.test.ts`](sections.test.ts) · [`pane-history.test.ts`](pane-history.test.ts) | refines UI-E95; requires UILIB-A1 |
| UILIB-E5 | experience | Local file, photo and folder controls share lazy bridge and drop-zone runtime admission before user activation. Loading/failure are visible, unmount fences late resolution, and a cached module failure offers explicit reload with unsent-text guidance, never automatic reload or an inert same-import retry. | [`useUiHostFs.ts`](useUiHostFs.ts) · [`../components/AddContextButton.tsx`](../components/AddContextButton.tsx) · [`../components/UiHostDropZone.tsx`](../components/UiHostDropZone.tsx) | [`../components/attachment-input-ui.test.ts`](../components/attachment-input-ui.test.ts) · [`../../e2e/local-picker-loading.spec.ts`](../../e2e/local-picker-loading.spec.ts) | refines UI-E26; requires UILIB-D1 |
| UILIB-E6 | experience | Artifact document intake is a bounded local review, not a save. One supported text/PDF/DOCX selection must be whole and below the authoring ceiling; unsupported/multiple selections are rejected before parsing. The shared import lifetime uses operation identity, active format, abort and account generation to fence both extraction and explicit adoption; cancellation never replaces a draft. | [`artifactDocumentImport.ts`](artifactDocumentImport.ts) · [`useArtifactDocumentImport.ts`](useArtifactDocumentImport.ts) · [`useArtifactFileImport.ts`](useArtifactFileImport.ts) · [`uiHostFs.ts`](uiHostFs.ts) | [`artifact-document-import.test.ts`](artifact-document-import.test.ts) · [`ui-host-fs.test.ts`](ui-host-fs.test.ts) · [`../../e2e/artifact-import-recovery.spec.ts`](../../e2e/artifact-import-recovery.spec.ts) | requires UILIB-D1; requires UI-E22 |
| UILIB-E7 | experience | PPTX authoring maps each visible source slide to one title-and-bullets outline, never guesses boundaries from flattened text, and discloses hidden/empty slides and text-only losses. The complete mapping must fit every ordinary authoring bound without clipping. It shares the document import lifetime and retains existing one-shot native authority. | [`artifactPresentationImport.ts`](artifactPresentationImport.ts) · [`useArtifactPresentationImport.ts`](useArtifactPresentationImport.ts) · [`useArtifactFileImport.ts`](useArtifactFileImport.ts) · [`presentationImport.ts`](presentationImport.ts) · [`uiHostFs.ts`](uiHostFs.ts) | [`artifact-presentation-import.test.ts`](artifact-presentation-import.test.ts) · [`presentation-import.test.ts`](presentation-import.test.ts) · [`ui-host-fs.test.ts`](ui-host-fs.test.ts) · [`../../e2e/artifact-presentation-import.spec.ts`](../../e2e/artifact-presentation-import.spec.ts) | requires UILIB-E6; requires CONTRACT-D92; requires CONTRACT-D85 |
| UILIB-E8 | experience | Same-glyph alternative section actions carry short visible captions through the shared auto-width variant. Ordinary icon-only verbs retain their existing appearance; caption text stays inside each button at every viewport. | [`sectionAction.ts`](sectionAction.ts) · [`../components/SectionAction.tsx`](../components/SectionAction.tsx) · [`../components/artifactPreview.tsx`](../components/artifactPreview.tsx) | [`sectionAction.test.ts`](sectionAction.test.ts) · [`../components/artifact-download-ui.test.ts`](../components/artifact-download-ui.test.ts) · [`../../e2e/artifact-docx-export.spec.ts`](../../e2e/artifact-docx-export.spec.ts) | requires UILIB-E1 |
| UILIB-E9 | experience | CSV/TSV and selected XLSX worksheet authoring preserve bounded literal data. XLSX keeps sparse coordinates, crops the visible used rectangle before bounded allocation, discloses saved cache and fidelity limits, and refuses missing formula caches. Worksheet and header interpretation are explicit review choices; malformed or oversize input is refused without clipping, and only account/operation-fenced adoption changes the draft. | [`artifactSheetImport.ts`](artifactSheetImport.ts) · [`useArtifactSheetImport.ts`](useArtifactSheetImport.ts) · [`useArtifactFileImport.ts`](useArtifactFileImport.ts) · [`uiHostFs.ts`](uiHostFs.ts) | [`artifact-sheet-import.test.ts`](artifact-sheet-import.test.ts) · [`ui-host-fs.test.ts`](ui-host-fs.test.ts) · [`../components/artifact-creation-ui.test.ts`](../components/artifact-creation-ui.test.ts) · [`../../e2e/artifact-sheet-import.spec.ts`](../../e2e/artifact-sheet-import.spec.ts) | requires UILIB-E6; requires CONTRACT-D85; requires CONTRACT-D95 |
| UILIB-D3 | data-access | Raw local raster admission recognizes bounded RGB BMP and ICO containers without widening durable image snapshots: BMP CORE RGB depths 1/4/8/24 and INFO/V2/V3 (52/56-byte)/V4/V5 RGB depths 1/4/8/16/24/32, with BITFIELDS at 16/32 bits, and ICO entries limited to validated PNG/DIB frames with disjoint ranges and deterministic largest-area/depth/file-order selection. Unsupported compression/embedded payloads and malformed bounds fail closed before browser normalization. | [`localRasterInput.ts`](localRasterInput.ts) · [`imageImport.ts`](imageImport.ts) · [`uiHostFs.ts`](uiHostFs.ts) | [`local-raster-input.test.ts`](local-raster-input.test.ts) · [`image-import.test.ts`](image-import.test.ts) · [`ui-host-fs.test.ts`](ui-host-fs.test.ts) · [`../../e2e/image-input.spec.ts`](../../e2e/image-input.spec.ts) | requires UILIB-D1; requires CONTRACT-D78 |
| UILIB-D4 | data-access | Local SVG is transient static image input, never inline markup or a durable SVG MIME. The isolated XML worker rejects scripts, animation, external resources and recursive use, bounds raw bytes/root pixels and 10,000 nodes/64 depth/50,000 expanded nodes, and admits only static embedded PNG/JPEG within one aggregate 32-megapixel budget. Detached image decoding shares the existing 15-second overall cancellation deadline and bounded PNG normalization; worker results are closed and workers/object URLs are released. | [`svgInput.ts`](svgInput.ts) · [`svgExtraction.ts`](svgExtraction.ts) · [`svgImport.ts`](svgImport.ts) · [`svgImage.ts`](svgImage.ts) · [`imageImport.ts`](imageImport.ts) | [`svg-extraction.test.ts`](svg-extraction.test.ts) · [`svg-import.test.ts`](svg-import.test.ts) · [`svg-image.test.ts`](svg-image.test.ts) · [`image-import.test.ts`](image-import.test.ts) · [`../../tests/contract-boundaries.test.ts`](../../tests/contract-boundaries.test.ts) · [`../../e2e/image-input.spec.ts`](../../e2e/image-input.spec.ts) | requires UILIB-D1; requires CONTRACT-D78 |
| UILIB-D2 | data-access | Project context doors resolve opaque source IDs in the viewer's own registry; a missing source cannot fall back to a same-label fixture, and legacy labels must resolve uniquely. Page and rail use the same resolver. | [`savedContextIdentity.ts`](savedContextIdentity.ts) · [`../components/SectionView.tsx`](../components/SectionView.tsx) · [`../components/SectionTreeChildren.tsx`](../components/SectionTreeChildren.tsx) | [`saved-context-identity.test.ts`](saved-context-identity.test.ts) · [`../components/mcp-connection-ui.test.ts`](../components/mcp-connection-ui.test.ts) · [`../../e2e/mcp-project-identity.spec.ts`](../../e2e/mcp-project-identity.spec.ts) | requires CONTRACT-D80; refines ROOT-D1 |
| UILIB-D1 | data-access | User-selected text uses the shared filename and strict UTF-8 policy; browser reads are bounded before allocation, unsupported content remains unavailable, and the native bridge supplies the same one-shot preview shape. Each selected file/photo snapshot receives one opaque identity at intake, retained through attach/retry: equal basenames and later selections cannot silently replace or suppress each other, and no path or reusable handle is inferred. | [`uiHostFs.ts`](uiHostFs.ts) · [`../../contract/localTextFile.mjs`](../../contract/localTextFile.mjs) | [`ui-host-fs.test.ts`](ui-host-fs.test.ts) · [`../../e2e/attachment-input.spec.ts`](../../e2e/attachment-input.spec.ts) | requires CONTRACT-D75; requires DESKTOP-S3 |
| UILIB-V1 | verification | Pure derivations live here so behavior can be locked exactly without a DOM. | [`paneHistory.ts`](paneHistory.ts) · [`replyTree.ts`](replyTree.ts) · [`railSplit.ts`](railSplit.ts) | [`pane-history.test.ts`](pane-history.test.ts) · [`reply-tree.test.ts`](reply-tree.test.ts) · [`rail-split.test.ts`](rail-split.test.ts) | refines UI-V1 |
<!-- context-rules:end -->

## Filesystem source layout

Files, Photos and Folder use `fsSourceLayout.ts` through the shared
`SourceSwitcher`. Source choices wrap; a bounded label can truncate without
putting the buttons under a horizontal scrollbar. The source enumeration in
`fs-source-layout.test.ts` and five-viewport `e2e/fs-source-layout.spec.ts`
lock this layout (UI-158 / CTX-FS-19).

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
