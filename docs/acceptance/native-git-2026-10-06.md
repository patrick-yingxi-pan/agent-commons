# Native Git connection acceptance — 2026-10-06 UTC

## Scope and result

Actual macOS repository selection/cancellation, temporary and opt-in remembered
access, explicit Attach/Refresh, saved-only model input, missing-source recovery,
Disconnect and native Quit/relaunch were exercised on CTX-FS-25. Both generated
repositories used split indexes. Their index/shared-index hashes and nanosecond
modification times remained unchanged throughout.

This is unsigned Apple Silicon development evidence, not signed/notarized,
Intel, paid-provider, linked-worktree or complete multi-account manual acceptance.
No product source, picker policy, security setting or normal user profile changed
during the run. The existing automated matrices remain separate evidence.

## Artifact and isolation

- Source revision: `a421273162607be6c3b9186dd4bc73be77ba4885`.
- Agent Commons 0.1.0; Electron 44.0.0; macOS 26.5.2, build 25F84; arm64.
- Packaged app.asar SHA-256:
  `4224e402dfd61afe3283b638bfb316ca14f4aeada782fffa5c34fde52a718943`.
  Five native workflow modules and all 157 built UI/worker files byte-matched
  the source/build tree before launch.
- Four ordinary executable launches used one new mode-0700 disposable SQLite
  profile. Every launch reported secure credentials and every native-menu Quit
  exited zero. No debugging port, mock Keychain, dialog-result override,
  Playwright Electron launcher or renderer test bridge was used. Ambient model,
  credential and development-renderer overrides were unset.
- Only generated Temporary and Remembered repositories were selected. A
  credential-free loopback Messages fixture was configured through the native
  provider form. Product writes and chooser actions used native UI controls;
  public read-only HTTP and captured fixture requests supplied exact comparisons.
- Test data was retained. The Remembered source was moved to a holding name,
  not deleted. The app and fixture endpoint were stopped after acceptance.

## Observed workflow

| Boundary | Evidence |
| --- | --- |
| Default/cancellation | Remember was unchecked. Cancel in the actual Connect repository chooser left no connection. |
| Selection only | Temporary showed Until app closes; Remembered showed Remembered on this device after explicit opt-in. Selecting both left the session registry empty and captured no model document. |
| Explicit Attach | Both Attach actions produced independent saved snapshots containing exactly the generated files .config/tracked.md, .gitignore and src/nested.md. Unstaged edits made after staging were captured; ignored/untracked sentinels were excluded. |
| Saved-only send | Changing Remembered after Attach did not change the first model input. The same saved text was sent after relaunch while the changed source remained present. |
| Private persistence | The mode-0600 Git connection file had only version/ciphertext fields, with no plaintext path, source name or fixture text. Relaunch restored the exact remembered opaque ID; Temporary was absent. Fresh drafts had no automatically attached context. |
| Expired temporary access | Explicit Refresh refused the expired Temporary connection. Exact saved workspace, contexts and messages stayed unchanged; a subsequent app relaunch restored a usable composer and both saved copies. |
| Explicit Refresh | Refresh of Remembered created a new receipt/timestamp and previewed the exact second text. A third source edit stayed out of the next model request. Temporary's receipt and content were unchanged. |
| Missing source | Moving Remembered away made Refresh fail with path-free guidance. Use saved state restored the writable composer; exact workspace, contexts and messages were unchanged. |
| Disconnect | Its canonical page became unavailable and its navigation row disappeared. Exact saved content was unchanged, and another model turn still received the second saved version. |
| Durable disconnection | A fourth independent launch showed no local repository connections. Saved workspace, contexts and all eight messages exactly matched the pre-Quit record, with the original Remembered path still absent. |

Conversation: `sess-new-4c8f98417d2e4d61bad1d569`.
Temporary: `GIT_06FA94A3188BDC0D4FCB48DA6F1D409A`, snapshot
`cd51f386-2759-4f03-b8cd-b6f55f4a8af3`.
Remembered: `GIT_C19C2030D98875EC86D7959606D1943D`, initial snapshot
`f6b5ccd0-d990-49ec-b347-ff27e39f787d`, refreshed snapshot
`2cf86be6-7ed8-45d0-8f09-9a77052d80a7`.

All four captured model-input documents were compared exactly against the saved
file names, status, text and zero omissions: the initial pair twice, then the
refreshed pair twice. No absolute fixture path, ignored/untracked sentinel or
third-version text appeared in the captured requests. The separate provider
verification request contained no attachment document.

## Control limitations and remaining gates

Go to Folder accessibility state lagged behind navigation; clearing/dismissing
the path sheet exposed the correct generated directory in column view. Subsequent
selection used Recent Places and the exact generated sibling row. No pass was
inferred until the selected destination and resulting app row were visible.

On the second launch the control surface returned stale frames and eventually
reported no available window despite a live backend. The expired-Temporary
Use saved state click was therefore not counted as a pass. Native-menu Quit and
a fresh launch restored control. The later missing-Remembered Use saved state
ceremony did complete visibly and preserved exact saved state. These observations
alone do not establish an application defect.

An initial fixture URL incorrectly included a trailing `/v1` and was rejected
with a 404; correcting it to the fixture origin completed native provider setup.
No feature or release claim relies on that failed attempt.

This record complements the bounded reader, identity/race, malformed storage,
linked-worktree, account-wall and browser matrices and
[packaged Git smoke](../../desktop/localGitSmoke.mjs). It does not add live Git
diff/terminal/write authority or replace signed two-architecture release and
paid-provider acceptance.
