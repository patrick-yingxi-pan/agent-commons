# Native context acceptance — 2026-09-10 UTC

## Scope and result

The unsigned Apple Silicon development app passed actual macOS Files, Photos,
and Folder selection, cancellation, preview, model-delivery, and source-absent
relaunch checks. This was not the automated dialog-result fixture. Independent
native removal passed for Markdown, DOCX, and PDF; the remaining removal cells
are **unverified**, because native controls became unavailable again. This is
partial acceptance, not a signed-release receipt or a complete native matrix.

The production-readiness goal and all remaining integration/release work remain
required. No production code or native dialog policy was changed for this review.

## Artifact and isolation

- Source revision: `231d319ad8868f284e2c000262dab373805313cb`.
- Agent Commons 0.1.0; Electron 44.0.0; macOS 26.5.2, build 25F84; arm64.
- Packaged app.asar SHA-256:
  `07bedf20ee8621516bc433efdf610643edb29c435057076c454691e7e104818c`.
- Direct executable launch with a new temporary user-data directory; startup
  reported secure credentials. No Playwright Electron launcher, mock-Keychain
  switch, dialog override, renderer test bridge, or paid provider was used.
- A generated, credential-free loopback Messages fixture was explicitly
  configured through the native app's provider form. The clean local Personal
  workspace was used; the shared development workspace and stacked demo accounts
  were not modified. This review does not add multi-account authorization proof.
- The successful selection/relaunch runs unset development-renderer and ambient
  model endpoint/key overrides. A loopback diagnostic port was present, but it
  was not used to drive the UI. Native interactions used the macOS control surface;
  HTTP GETs supplied read-only state comparisons.

## Observed matrix

Every input below was generated specifically for this review. Native dialogs
were addressed through macOS path navigation, and Open was used only after the
exact selected item was observed. DOCX, PDF, and XLSX also passed one three-file
native multi-selection. The fixed desktop window was reviewed visually; no
responsive UI or viewer-relative behavior changed in this checkpoint.

| Input | Actual native import and preview | Model delivery before/after relaunch | Independent native detach |
| --- | --- | --- | --- |
| Markdown, brief.md | Exact amber-lighthouse text | Identical ready text | Passed; all other inputs and history preserved |
| Word, notes.docx | Exact coral-meadow text and Word extraction disclosure | Identical ready text and DOCX metadata | Passed; all other inputs and history preserved |
| PDF, notes.pdf | Exact violet-harbor text, page marker, and no-OCR disclosure | Identical ready text and one-page metadata | Passed; all other inputs and history preserved |
| Excel, table.xlsx | Visible worksheet/cell values, jade-observatory marker, and no-calculation disclosure | Identical ready text and XLSX metadata | Unverified |
| PowerPoint, deck.pptx | Exact indigo-orchard slide text and excluded-content disclosure | Identical ready text and PPTX metadata | Unverified |
| PNG, image.png | Actual two-color 160 × 80 saved image and image-send disclosure | One first-class PNG block; exact saved image bytes identical after relaunch | Unverified |
| Folder | Only visible.md; exact cobalt-garden text and read-only snapshot disclosure | Identical top-level text; hidden and nested sentinels absent | Unverified |

Files, Photos, and Folder each passed a real Cancel action without adding an
input or changing the previously attached set. The selected-content disclosure
ultimately reported six text files and one saved image, matching the model's
seven-item input document with zero omitted items.

After a clean Quit, the entire generated input directory was moved to a retained
alternate location. The original selected paths were verified absent before
relaunching the same profile. The public conversation's messages, workspace, and
context records compared exactly equal before and after relaunch, including all
opaque IDs, text, extraction metadata, folder provenance, and image reference.
All seven previews were inspected again. Another native-composer turn delivered
the identical input document and PNG bytes from durable state.

The recorded model requests contained neither absolute test paths nor hidden or
nested sentinels. Public attachment records held opaque identities and image
metadata, not original archive bytes, native handles, or image data URLs. Each
completed detach was followed by an exact read-only comparison proving that only
the named attachment left the set and prior messages remained unchanged.

## Incomplete cells and reproduction notes

An initial native-control attempt showed a selected file but a disabled Open
button, followed by disagreement between accessibility state and screenshots.
A clean app restart resolved that observation problem and the real import
matrix then passed. Later controls again returned `noWindowsAvailable` or
`elementHasNoFrame`; no successful action was inferred from those attempts.
XLSX, PPTX, image, and folder native detach plus a final post-detach model turn
remain to be completed with reliable native control. These observations are not
enough to classify an application defect. The production attached-sheet policy
was not weakened or replaced to accommodate the control surface.

This record complements, rather than replaces, the executable tests in
[attachmentSmoke.mjs](../../desktop/attachmentSmoke.mjs), the native reader locks
in [contextPicker.test.ts](../../desktop/contextPicker.test.ts), and the model
fixture in [attachmentSmokeFixture.mjs](../../desktop/attachmentSmokeFixture.mjs).
The same-name, error/limit, authorization, and all-format automated detach cases
remain automated evidence. Real paid-provider behavior, native Intel execution,
OS storage security, signing/notarization, and the final extracted release ZIPs
require their own acceptance evidence.
