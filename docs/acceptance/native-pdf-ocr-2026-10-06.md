# Native PDF text review acceptance 2026-10-06

## Scope and result

Actual macOS PDF chooser cancellation, blank-PDF refusal, scanned-PDF recognition,
explicit review and adoption, correction, ordinary Document creation, and a full
source-absent relaunch passed on the recorded unsigned Apple Silicon package.
The corrected saved body matched exactly before and after relaunch.

This evidence covers one generated two-page image-only PDF, not corpus accuracy,
signed/notarized or Intel acceptance. The protected-PDF manual selection did not
complete and is not counted as a pass; its automated native/package refusal
coverage remains separate. No normal user profile or product source changed.

## Artifact and isolation

- Source revision: `1d53e352911b368fc61546772d8c1db1b929f9fa`.
- Agent Commons 0.1.0; macOS 26.5.2, build 25F84; arm64.
- Packaged app.asar SHA-256:
  `460d48a255b32c97c10abfc86d501d6a1aa66d2d184f56b2afdbd7e1386f24f3`.
  Main, preload, native picker, PDF runner, shared OCR runner, PDF contract and
  SQLite replacement modules byte-matched the source tree before launch.
- Three ordinary executable launches shared one new mode-0700 isolated profile.
  Each reported secure credentials and exited zero through native-menu Quit.
  No debugging port, inspector, mock Keychain, dialog-answer fixture, renderer
  test bridge or Playwright Electron launcher was used.
- Ambient model, provider, development-renderer and persistence overrides were
  unset. No provider was configured and no model request was initiated.
- The generated scanned PDF was 66,216 bytes with SHA-256
  `36b3cdc8a5a0a1091dd5dcf46d01170b83dc9b64774b0704f870d88b972a95f3`.
  The blank fixture had two pages. All chosen inputs were generated test files.
- Product writes used native UI controls. Public read-only artifact endpoints
  supplied exact body comparisons, not application mutations or test injection.
- The scanned source was moved to a holding filename, not deleted. Its selected
  path was confirmed absent before the final comparison. The generated profile
  and fixtures remain available; the test app is stopped. The shared development
  preview and demo-account stack were untouched.

## Observed workflow

| Boundary | Evidence |
| --- | --- |
| Cancellation | Cancel in the actual Extract PDF text chooser preserved the typed name and exact draft. |
| Blank PDF | The app reported no readable text on either of two pages; the name and draft stayed unchanged. |
| Recognition | The native chooser selected the generated scanned PDF. Review showed all two pages processed, text on both pages, and the exact page-labeled Alpha/Bravo text. |
| Review boundary | Imported text was read-only, the original draft remained separate, and Create document was disabled until an explicit adoption or discard. |
| Adoption and correction | Replace content adopted the candidate. Editing Alpha to Alpine changed the editable draft; the typed document name remained intact. |
| Save | Create document produced one ordinary Document with two paragraph blocks, containing the corrected text and no PDF bytes. |
| Source independence | Native-menu Quit exited zero. After moving the selected PDF aside, an independent launch reopened the same document and exact corrected body. |

The saved artifact identity is `artifact-new-dbb951e42f16c6e0159317b4` and its name
is native-pdf-review.md. Its canonical body is:

```json
{"type":"doc","title":"native-pdf-review","blocks":[{"p":"[Page 1] Scan Alpine 427"},{"p":"[Page 2] Scan Bravo 813"}],"revision":0}
```

The JSON-serialized body SHA-256 was identical before Quit and after relaunch:
`f626ea3201ce61096fb7cfa6d2daefc0ae128689a6477187139db93c3d7f3871`.
Native accessibility and the final screenshot also showed both corrected blocks.

## Control limitations and release gates

The native control layer intermittently retained stale busy/picker state. During
the first process, selecting protected.pdf and then scanned.pdf left Open
reported disabled; a coordinate action reported no available window. Those
attempts were cancelled and did not count as completed imports. A normal Quit
and fresh launch restored the scanned-PDF path, which then completed visibly.
Focusing the unchanged name field also refreshed a stale recognition view.
These observations alone do not establish a product defect or a protected-PDF
refusal. No security setting, picker implementation or timeout was changed.

This record complements [packaged PDF import acceptance](../../desktop/artifactPdfOcrSmoke.mjs)
and [native sandbox tests](../../desktop/pdfOcrSandbox.test.ts). It does not replace
the protected/malformed/limit matrices, independent confinement checks, broader
language and document corpus review, or signed two-architecture release gates.
