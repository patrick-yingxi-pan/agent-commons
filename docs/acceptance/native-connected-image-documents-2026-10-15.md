# Native connected-image Document acceptance — 2026-10-15 UTC

## Scope and result

The unchanged unsigned arm64 app passed the real macOS Folder and Repository
chooser Cancel/selection flow, followed by captured-image OCR review, explicit
adoption, editing and ordinary Document creation. Folder, tracked Git and
explicitly opted-in untracked Git each produced a separate saved Document.
Every original PNG was moved out of its selected source path after preview but
before OCR; all three Documents rendered after normal Quit and full relaunch
with those source paths still absent. Both temporary connections expired.

This is bounded native evidence for CTX-FS-38 and its CTX-FS-30/32/33 input
boundaries. It is not a new five-viewport/account matrix, recognition-accuracy
study, or signed/Intel release gate. The walk used one fresh desktop-local
Personal account, the native wide window and generated files only. No provider
was configured, no real credentials were entered, and no Attach, Send, Share or
external-service action was performed. Existing automated matrices remain
separate evidence.

## Artifact and isolation

- Source revision: `c2175a4d1cfe0c20d7af507fb9e550a4617f5226`.
- Agent Commons 0.1.0; macOS 26.5.2, build 25F84; arm64 executable.
- Packaged app.asar SHA-256:
  `d83e98879285bb246a59c5dd0e27093cd768287b41b362d51883622843dabf15`.
  All 724 packaged files across desktop, contract, server, connector, scripts
  and dist byte-matched the checkout, with no missing or extra files. The ASAR
  digest was unchanged after the walkthrough and final Quit.
- Two ordinary executable launches used the same new disposable profile under
  `/private/tmp/ac-native-image-review-q5LJSF`. Both reported secure credentials
  and exited zero through the native Quit menu. Their owned loopback ports,
  58355 and 58921, refused connections afterward.
- No debugging port, test bridge, substituted dialog answer, mock Keychain,
  development renderer or source edit was used. The repository stayed clean
  throughout native acceptance. The normal owner app profile was untouched.
- The disposable directory, generated sources, checker and screenshots were
  retained, not deleted. This is machine-local evidence, not shipped content.

## Observed workflow

| Boundary | Observed result |
| --- | --- |
| Folder and Repository Cancel | Remember was unchecked. Cancel in each actual chooser left its connection list empty. |
| Exact native selection | Direct-path navigation selected only the generated Folder and Repository directories. Each canonical page disclosed that access ends when the app closes. |
| Explicit browsing | Folder and tracked Git each required List paths, then selection of a PNG. Untracked browsing started unchecked, showed its secrets warning after opt-in, and still required List untracked paths before selection. |
| Captured-image recognition | Each preview disclosed its path, capture time and 1000 × 240 normalized PNG. The tester moved that exact original aside before Extract text to new document; OCR still completed from the captured preview. |
| Review is not adoption | Imported text was read-only, Content remained empty and Create document was disabled. Folder Discard import left Content empty; Cancel saved nothing and returned to the retained preview. Reopening explicitly started another recognition review. |
| Explicit adoption and editing | Use imported text filled editable Content while retaining the entered name. Each draft was corrected/extended with a second paragraph before Create document. |
| Ordinary save | Create opened the exact named canonical Document with both edited paragraphs. Nothing was attached to a conversation or shared. |
| Full relaunch | After native Quit, relaunch used a different loopback port and still had no model endpoint. Each of the three exact canonical Documents rendered its expected two paragraphs without source selection or another OCR action. |
| Temporary authority | Contexts showed empty local-folder and local-repository lists after relaunch; saved Documents remained available independently. |

The generated untracked PNG itself clipped the final `3` of its requested
fixture string at the right edge. Inspection of the retained PNG confirmed
that input limitation; OCR displayed `Untracked image review 95`. The review
was deliberately corrected to `Untracked image review 953` before saving.
This is evidence of editable review, not a claim that OCR recovered missing
pixels or that the app introduced the clipping.

## Exact persistence and source evidence

A read-only SQLite check before Quit, after relaunch and after the final Quit
found exactly three Document bodies, zero image assets and zero persisted
conversation entities. Complete stored body JSON, including title, block IDs
and revision 0, was identical across restart. None of those bodies contained
the private fixture-root path.

| Document and exact artifact ID | Saved paragraphs | Stored body JSON SHA-256 |
| --- | --- | --- |
| Native Folder OCR — `artifact-new-cc64080b3f46421b2fddb031` | `Folder image review 731`; `Reviewed and corrected locally.` | `acf504341733705bf4325fbc71a6a19de23aad26abcce6bcd5ace5fd7ecdfbd0` |
| Native Tracked OCR — `artifact-new-0ced1b29809890ebccfaa82d` | `Tracked image review 842`; `Reviewed tracked snapshot, independent of Git.` | `5ab1fb335d90ede9f26021033cb9c83ec23edd9976257bb4b83ddb76d20185a0` |
| Native Untracked OCR — `artifact-new-d37b8e1c8fd8bb8ee81f76e3` | `Untracked image review 953`; `Reviewed untracked snapshot, explicitly opted in.` | `db727a5c85de1a55f3e7e64964ac00c23252442aa6869077dbf5bdd4501bbe9f` |

Source PNG SHA-256 values before moving them aside:

- Folder: `b2a4c57f39fb2aa6f42b9e52537244394fae7d64db24206492be1a4313db2fe6`.
- Tracked: `02a51dc132f2af1b6bd8f92f3d3af3f44c5c1ce848af3fde09ceab206d960962`.
- Untracked: `dc412e0e555072ae56f91dfbfae02b9de5a669aa2b5ab010a9eea12fccdb5d19`.

The generated Git index retained SHA-256
`02c87fc758aded004efb566640f7a00c522ff62eb9d752c6560c4d2bea47a59e`
before browsing, after creation, after relaunch and after final Quit. Only the
tester's explicit moves changed the generated working-tree paths; this is not
evidence about every Git layout or filesystem race.

## Review artifacts and limitations

Screenshots in the retained directory are `folder-ocr-review.png`,
`folder-document.png`, `untracked-ocr-review.png`, `relaunched-document.png`
and `temporary-connections-cleared.png`. The review and relaunched Document
were visually checked for legibility and layout; this native wide-window walk
does not replace the existing five-size screenshots and 135-cell sweep.

The choosers initially opened in Downloads; no personal item there was selected.
Keyboard/Return attempts did not reliably navigate the native Go to Folder
sheet. Typing into the ready path field, verifying the exact result, and
double-clicking that result did. No attempted action was counted as selection.
The temporary SQLite comparison initially compared null-prototype query rows
to ordinary JSON objects and failed on prototypes despite identical values.
Normalizing only the outer row objects fixed that checker; exact stored JSON,
identity, source-index and ASAR comparisons then passed without changing the
app, profile or saved baseline.

Remembered connections, multiple accounts, Project/conversation picker
projections, nested Escape, negative/race cases, other image formats and OCR
languages, connected Office native selection, signed/notarized downloads,
native Intel, real updates and external services were not accepted by this
walk. Paid-provider testing remains deferred, not passed.
