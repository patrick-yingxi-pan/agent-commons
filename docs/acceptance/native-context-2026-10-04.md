# Native context removal acceptance — 2026-10-04 UTC

## Scope and result

The four unfinished native removal cells from the
[2026-09-10 review](native-context-2026-09-10.md) now pass: XLSX, PPTX, PNG,
and a top-level folder snapshot. Each was freshly imported with the actual macOS
chooser, previewed, delivered to a local model fixture, then independently
detached through the packaged app. A final native-composer turn supplied no
attachment document or image blocks. This is unsigned Apple Silicon development
acceptance, not a signed release, Intel execution, or paid-provider receipt.

No production code, permissions, dialog policy, or test override was changed.
This run does not repeat the earlier all-format cancellation and source-absent
relaunch matrix; that evidence remains tied to its recorded revision.

## Artifact and isolation

- Source revision: `2abc976d496c779f3ea5f106aabd27a681006ab4`.
- Agent Commons 0.1.0; Electron 44.0.0; macOS 26.5.2, build 25F84; arm64.
- Packaged app.asar SHA-256:
  `f0740ff9638e4968cd79b297c03307ab28c4aabec9fcdfba7e44e4487e7c525a`.
- Fresh package, directly launched with an isolated temporary user-data directory.
  Startup reported secure credentials. No Playwright Electron launcher,
  mock-Keychain switch, debug port, dialog-result override, or renderer test
  bridge was used. Development renderer and ambient model overrides were unset.
- A generated credential-free loopback Messages endpoint was configured through
  the native provider form. Only generated disposable inputs and the clean local
  Personal workspace were used. Shared demo state and account preferences were
  untouched; this is not a multi-account or responsive UI review.
- All UI actions used the macOS control surface. Public session GETs and the
  loopback fixture's read-only report supplied exact state/payload comparisons.

## Observed matrix

| Input | Actual native import and preview | Baseline model input | Independent native detach |
| --- | --- | --- | --- |
| Excel, table.xlsx | Files chooser; visible cell addresses/values and no-calculation disclosure | Exact jade-observatory worksheet text; ready XLSX metadata | Passed; PPTX, image, folder and prior messages exactly preserved |
| PowerPoint, deck.pptx | Files chooser; slide text and excluded-content disclosure | Exact indigo-orchard slide text; ready PPTX metadata | Passed; image, folder and prior messages exactly preserved |
| PNG, image.png | Photos chooser; actual two-color 160 × 80 saved image and send disclosure | One first-class PNG block and image-ready metadata | Passed from the photo preview; folder and prior messages exactly preserved |
| Folder | Folder chooser; only visible.md and read-only/re-attach disclosure | Exact cobalt-garden text; hidden and nested sentinels absent | Passed; empty context/attachment/workspace sets and prior messages preserved |

Each chooser showed the exact selected file or folder before its enabled Open
action was used. The selected-content disclosure reported three text files and
one saved image; the endpoint received those four inputs with zero omitted
items. Public state retained opaque selected identities, extracted text and
format metadata, folder provenance, and the saved image reference—not native
paths or archive bytes. Captured model requests contained no absolute fixture
paths or hidden/nested sentinels.

Excel and PowerPoint were removed separately using their context controls;
the image used its preview's Remove photo action; the folder used its context
control. Where presented, the named removal confirmation was accepted without
changing the confirmation preference. After each action, an exact public-state
comparison checked the remaining workspace, contexts and original messages.
Folder removal also removed the now-empty workspace, leaving all four arrays
(workspaces, repos, connectors, attachments) empty.

The final request retained the original plain conversation history and added
the new user message. It contained neither an attached_files document nor any
image blocks, and the fixture replied “No supplied attachment text.” Detach does
not erase historical assistant prose; no such erasure is claimed.

## Control limitations and remaining gates

The macOS Go to Folder shortcut did not respond during this run. Native folder
controls and Recent Places worked after the generated inputs were moved into
the ignored build-output directory. No chooser was bypassed, and no successful
action was inferred from an unchanged accessibility tree.

These four cells complement the earlier Markdown/DOCX/PDF removal evidence and
the executable [packaged attachment smoke](../../desktop/attachmentSmoke.mjs).
They do not certify every format/error case on one current artifact. Native
Intel execution, actual signed/notarized extracted ZIPs, paid-provider behavior,
other image-format dialogs, and the separate release acceptance gates remain.
