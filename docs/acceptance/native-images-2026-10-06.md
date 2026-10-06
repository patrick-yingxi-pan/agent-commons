# Native image import and original download acceptance — 2026-10-06 UTC

## Scope and result

Actual macOS Files cancellation, local Files/Photos SVG selection, distinct
same-name images, native original-file downloads and source-absent relaunch
passed on the recorded unsigned Apple Silicon package. The model received only
the normalized PNG image blocks. Original SVG downloads matched their selected
source bytes exactly.

This is not signed/notarized, Intel, paid-provider, Photos-library, all-format or
complete multi-account manual acceptance. No product source, security settings
or normal user profile changed during the run. Existing automated account walls,
codec/admission matrices and served-image tests remain separate evidence.

## Artifact and isolation

- Source revision: `da395674161db62739ff606723f30e6cfe237fa2`.
- Agent Commons 0.1.0; Electron 44.0.0; macOS 26.5.2, build 25F84; arm64.
- Packaged app.asar SHA-256:
  `4597dd950e4ebce150e1352181e9c2b8b385c5e026965e591fea5eccb49e2cc5`.
  Selected native image modules, the contribution runtime guard, and all 159
  built UI/worker files byte-matched the source/build tree before launch.
- Three ordinary executable launches used one new mode-0700 disposable SQLite
  profile. Each reported secure credentials; each native-menu Quit exited zero.
  No debugging port, mock Keychain, dialog-result override, Playwright Electron
  launcher or renderer test bridge was used. Ambient model, credential and
  development-renderer overrides were unset.
- Two generated 480 × 320 SVGs had the same filename, native-original.svg, but
  different colors, geometry and text. Files and Photos each selected one through
  the actual macOS chooser. Both files were 389 bytes.
- A credential-free loopback Messages fixture was configured through the native
  provider form. Product writes and chooser actions used native UI controls;
  public read-only HTTP and captured fixture requests supplied exact comparisons.
  No paid or third-party model request was made.
- Generated sources were moved to holding names, not deleted. The test profile,
  sources and three native downloads were retained; the app and fixture endpoint
  were stopped. The shared development preview and demo accounts were untouched.

## Observed workflow

| Boundary | Evidence |
| --- | --- |
| Cancellation | Cancel in the actual Add files chooser returned to an empty draft without an attachment. |
| Files import | Selecting the generated Files SVG produced one saved 480 × 320 image; its first model turn delivered a PNG, not the SVG original. |
| First relaunch | The conversation, saved image and provider remained available. Download original opened the native Save dialog; the saved SVG exactly matched the Files source. |
| Photos import | Photos → This computer → the actual Add photos chooser selected the second SVG. Both same-name items remained distinct and previewed the correct designs. |
| Source independence | After both selected paths were moved aside, another turn delivered both exact saved PNGs. Downloading the Photos original still reproduced its exact source bytes. |
| Durable state | A full native Quit/relaunch with both selected paths absent preserved exact workspace, context and four-message hashes. The fresh draft did not automatically attach either image. |
| Relaunched model input | Reopening the conversation and sending again delivered the same pair of normalized PNG image blocks. |
| Relaunched original | The selected Photos original downloaded through the actual Save dialog again and matched the retained source byte-for-byte. Both original endpoints returned the expected source containers with no-store responses. |

Conversation: `sess-new-55bd1e1d722c9f69c6412418`.
Files asset: `img-6765e59998a43720b6054acb023588ff3d0d8f9e980f25ae6fe71727111adc63`.
Photos asset: `img-3b91a1624f850c0e1b1be40623fa83057de9d3f1b06f5576c6557509e3b2e187`.

| Bytes | SHA-256 |
| --- | --- |
| Files original, 389 bytes | `818b88791c10963f64633c2fd685da363182ab692539d2ab8c23a4b6a111abb5` |
| Photos original, 389 bytes | `7c9b0d8fe0d18324e1f44230bb268c922bfe2e896ffe8cb041167a946ffc781b` |
| Files normalized PNG, 15,587 bytes | `95503255f5568a38914dd5a571bf780df76355bbbb8c03c0b3c84d6a7a8b5602` |
| Photos normalized PNG, 15,951 bytes | `23dd4ef7f9c20de5cd0bf90bba27101291620b0e3bf753737fb67793c9758ded` |

Both model image blocks carried the PNG signature `89504e470d0a1a0a`. Captured
requests consisted of provider verification without images, one Files-image
turn, then two two-image turns (before and after the final relaunch).

Pre-Quit and post-relaunch SHA-256 values matched exactly for JSON-serialized
workspace (`4d63df1fbc419fb52def80fd6c6c28e8319ee646f588f79d4be16062c35e0414`),
contexts (`ccc603a9976c90c6b4b4318173ce75d09f87e875622986f9d6acd80298998c56`)
and messages (`bb0632121d6f730a9dfdf27a3b1b3165e3e27a38ebc75d039ae3cb4ae6afb6b7`).

## Control limitations and remaining gates

Native paste and Go to Folder controls intermittently returned stale state.
Explicit field values, a dismissed path sheet and then Recent Places plus the
exact generated sibling row provided verified selection. On the first launch,
the initial Photos navigation did not complete visibly and was not counted as a
pass. Accessibility and screenshots later lagged behind a completed model turn;
native-menu Quit and a fresh launch restored current controls. These observations
alone do not establish an application defect. The second-launch Photos selection
and both designs were visibly confirmed before counting that path as passed.

One launch attempt inside the restricted shell exited before startup; the
approved ordinary executable launch then succeeded. It is not counted among the
three successful lifecycle runs.

This record complements [packaged attachment smoke](../../desktop/attachmentSmoke.mjs)
and the CTX-FS-26 browser/persistence/account tests. It does not replace the
signed two-architecture release gate or live third-party provider acceptance.
