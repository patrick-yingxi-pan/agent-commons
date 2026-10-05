# Native Folder connection acceptance — 2026-10-05 UTC

## Scope and result

Actual macOS folder selection, opt-in remembered access, explicit Attach and
Refresh, native-menu Quit/relaunch, missing-source recovery, and durable
Disconnect were exercised on the built CTX-FS-22 workflow. Saved text remained
independent of device access throughout. No product source, picker policy,
security setting, or normal user profile was changed during acceptance.

This is unsigned Apple Silicon development evidence, not a signed release,
Intel execution, paid-provider acceptance, or a complete multi-account matrix.
The temporary connection was selected and expired after Quit, but its saved-copy
attachment journey was not completed in this manual run. Automated coverage of
that journey remains separate.

## Artifact and isolation

- Source revision: `14f20c02ede26ef094acfa0ba5b8fb9913ca09d6`.
- Agent Commons 0.1.0; Electron 44.0.0; macOS 26.5.2, build 25F84; arm64.
- Packaged app.asar SHA-256:
  `4d52eaea8046e962ae44b46907832cf8c18a42f7f3f2568718db825018876272`.
  The five relevant native modules and all 140 built UI/worker files byte-matched
  the verified source/build tree before launch.
- Four ordinary executable launches used one newly generated disposable SQLite
  profile. Each reported secure credentials. There was no Playwright Electron
  launcher, mock Keychain, debugging port, dialog-result override, or renderer
  test bridge. Development-renderer and ambient model endpoint/key overrides
  were unset.
- Only generated folders were selected. A credential-free loopback Messages
  fixture was configured through the native provider form. Product writes and
  chooser actions used the macOS control surface; public read-only HTTP requests
  and the fixture's captured requests supplied exact comparisons.
- Every launched app exited through the native Quit menu with exit code zero.
  The generated endpoint was stopped after acceptance. Test data was retained;
  the source folder was moved to a holding name, not deleted.

## Observed workflow

| Boundary | Evidence |
| --- | --- |
| Default and cancellation | Remember was unchecked. Cancel in the actual chooser left no connection. |
| Temporary selection | The exact generated Temporary folder was selected with Remember off. Its row said Until app closes; no session or attachment was created. The row was absent after native Quit and independent relaunch. |
| Remembered selection | The exact generated Remembered folder was selected with explicit opt-in. Its canonical page said Remembered on this device. Selection alone left the session registry empty. |
| Device storage | The mode-0600 connection file contained only version and ciphertext fields; neither source path, folder name nor source text appeared in plaintext. Relaunch restored the same opaque connection identity through normal OS-backed storage. |
| Explicit Attach | Attach saved exactly visible.md, excluding the hidden file and nested directory. Its preview and first fixture turn contained the literal first snapshot. |
| Relaunch | Exact saved workspace, contexts and messages survived a full Quit/relaunch. The fresh draft had no automatically attached folder, and Contexts retained the same remembered ID. |
| Saved-only reads | After editing the generated source, opening the saved conversation and sending another turn still used the first snapshot. |
| Explicit Refresh | Refresh created a new snapshot ID and timestamp, and the preview showed the exact second text. |
| Missing source | Moving the generated root away made Refresh fail visibly. Use saved state restored the writable composer. Exact workspace, contexts and messages were unchanged. |
| Disconnect | Disconnect removed the connection and made its canonical page unavailable while preserving the exact saved snapshot. A subsequent fixture turn still received the second text. |
| Durable disconnection | Another native Quit/relaunch left Contexts empty while exact saved workspace, contexts and messages persisted with the original source path absent. |

The remembered connection was
`LOCAL_0FC8F502EE7DAD782BA64F1C4CF8D0F7`, used by conversation
`sess-new-d1d117514472e9160a24023e`. Its first saved receipt was
`0ec7664e-6790-4044-af64-ac0e017a5395`; explicit Refresh replaced it with
`39c581ab-9606-4455-9496-15151e34a8ae`.

The three captured model-input documents each contained exactly one ready file
and zero omitted items: twice `Remembered cobalt garden — snapshot one.`, then
`Remembered violet harbor — snapshot two.`, each with its original trailing
newline. No absolute native path, hidden-file sentinel or nested-file sentinel
appeared anywhere in the captured model requests. Historical assistant prose
was preserved, not rewritten when the attachment was refreshed.

## Control limitations and remaining gates

The first launch developed disagreement between accessibility state and an old
screenshot; some controls returned elementHasNoFrame or noWindowsAvailable.
The backend remained live. Native-menu Quit completed normally, and a fresh
ordinary launch restored controls for the remembered workflow. No pass is
inferred from an unresponsive action, and these observations alone do not
establish an application defect. Go to Folder did not respond; chooser column
navigation and Recent Places worked without bypassing the chooser.

The missing-source recovery message included Electron's IPC error wrapper in
addition to the safe product message; recovery remained usable and the source
path was not exposed. This is not evidence of polished failure copy.

This record complements the bounded-reader, account-isolation, late-result,
unchanged-byte Retry and encrypted-store regression suites, the rendered browser
matrix, and [packaged attachment smoke](../../desktop/attachmentSmoke.mjs).
It does not repeat every source replacement, malformed store, cancellation race,
viewport, or shared-reader case. Real Git, recursive capture, signed/notarized
two-architecture release acceptance and paid-model behavior remain required.
