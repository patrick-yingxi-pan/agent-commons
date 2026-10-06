# Native Git review and update-menu acceptance — 2026-10-06 UTC

## Scope and result

The actual macOS chooser, remembered connection, explicit staged/unstaged review,
Dismiss, re-read, missing-source Retry, Disconnect and native Quit/relaunch were
exercised on PORT-25. The application menu and its unconfigured-update notice
were also opened and visually reviewed without intercepting their handlers.

This is unsigned Apple Silicon development evidence, not signed/notarized or
Intel acceptance. It does not cover signed update download/install consent,
two-version installation, paid-provider behavior, or a complete manual
multi-account/responsive matrix. The preceding automated browser and packaged
checks remain separate evidence; no product source or security policy changed.

## Artifact and isolation

- Source revision: `75e8a584ef1a37db17396253e8b3cdf9f9e576f8`.
- Agent Commons 0.1.0; macOS 26.5.2, build 25F84; arm64.
- Packaged app.asar SHA-256:
  `2b673839b125b0d0e329aee6d8fcac2645f735cfd7d7433e8d74b7a072e4cd84`.
  Nine native/contract modules and all 169 built UI/worker files byte-matched
  the verified source/build tree before launch.
- Three ordinary executable launches used a new mode-0700 disposable profile.
  Each reported secure credentials and exited zero through the native Quit
  menu. No debugging port, mock Keychain, dialog-result override, Playwright
  Electron launcher or renderer test bridge was used. Ambient model/credential
  and development-renderer overrides were unset.
- Only one generated repository was selected. No provider was configured and
  no model call was attempted. The source repository, profile and evidence were
  retained, not deleted. The application and acceptance launcher were stopped.
- UI interaction used the native macOS control surface. Public read-only session
  GETs and filesystem comparisons of the generated index supplied independent
  evidence. The shared demo preview and its account preferences were untouched.

## Observed workflow

| Boundary | Evidence |
| --- | --- |
| Selection and cancellation | Remember was initially unchecked. Cancel in the actual Connect repository chooser left no row. A subsequent explicit opt-in and selection produced a Remembered row for the exact generated repository. |
| No ambient content read | Opening the canonical page showed Review changes and no file comparison. The public session list remained empty. |
| Staged comparison | Explicit Review changes showed the generated `main` HEAD and exact committed text `Cobalt garden — committed baseline.` versus staged text `Violet harbor — staged revision.` |
| Unstaged comparison | The native Compare selector showed that staged text versus `Amber hill — working revision.` Only the tracked changed path appeared; untracked/ignored sentinels did not. |
| Explicit freshness | After the source changed to `Jade observatory — later working revision.`, the existing result remained unchanged. Read changes again alone adopted the later text and advanced the displayed read time while retaining the unstaged selection. |
| Privacy and Dismiss | The disclosure stated raw-byte/mode limits, exclusions, no model/saved-content authority and memory lifetime. Dismiss removed the comparison; a fresh explicit review reset selection to staged. |
| Relaunch | A result was visible before native Quit. The second ordinary launch restored the same remembered connection ID, but its page contained no previous result and required Review changes again. |
| Missing source | Moving only the generated repository to a holding name made explicit Review fail with path-free guidance and Retry review. Restoring the original directory and explicitly retrying recovered the exact comparison. |
| Disconnect | Disconnect removed the result and row and left an unavailable canonical page. A third native launch showed no local repository connections. The public session list was still empty. |
| Source preservation | Index and shared-index SHA-256 hashes and nanosecond modification times matched the pre-launch baseline after review, re-read, relaunch, retry and disconnect. |
| Native update notice | Check for Updates… was present in the actual application menu. Its readable one-button notice said updates are not configured for this build and explained the signed-release distinction. OK returned to the unchanged review. No update was downloaded or installed. |

The connection was `GIT_8CF72B628B3F1FECA3C24532A7804F4C`; the generated HEAD was
`89f4383d7c832d9b14e711ee75ad62d7d0bb91c5`. The comparison text retained its
trailing newlines. The unchanged `.gitignore` accounted for the one unchanged
path; the ignored file was never tracked, so zero ignored HEAD/index paths is
expected and is not a claim that the repository had no ignored working files.

## Limitations

Go to Folder did not visibly open through the control surface. Selection instead
used the chooser's real home/project/output column navigation and verified the
exact generated destination before Open. No chooser was bypassed.

The first Quit logged Electron's `CloseMessageBox called with nonexistent ID`
after the update notice had already been dismissed. The dialog returned to the
unchanged page, Quit exited zero, and subsequent launches succeeded. This warning
is retained as an observation, not evidence of a failed update or a proven
application defect.

The native UI was inspected at its ordinary desktop window size. Existing
five-viewport, account-wall, late-result and malformed-payload browser checks
are not repeated or relabeled as manual acceptance here. Attach/Refresh and
saved-only model input remain covered by the separate
[native Git connection record](native-git-2026-10-06.md) and
[packaged Git smoke](../../desktop/localGitSmoke.mjs).
