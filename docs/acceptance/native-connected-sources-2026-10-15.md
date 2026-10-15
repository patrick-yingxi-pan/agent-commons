# Native connected-source chooser acceptance — 2026-10-15 UTC

## Scope and result

The real macOS Folder and Repository choosers passed cancellation and exact
generated-directory selection. The unchanged unsigned arm64 application then
displayed exact selected folder text, tracked working text, explicitly opted-in
untracked text, and one unstaged single-file comparison. Both temporary
connections disappeared after normal Quit and a full relaunch.

This is bounded native evidence for CTX-FS-29/30/32 and PORT-35, not a complete
manual matrix or signed release acceptance. No provider was configured, no
credentials were entered, and no conversation Attach, Send or external service
call was performed. Remembered access, Disconnect, document/image formats,
saved-copy durability, staged deletion, account switching and richer repository
layouts were not retested in this walk; their prior automated and dated native
evidence remains separate.

## Artifact and isolation

- Source revision: `76e78b47800cddec754c533dadab1c6d6c6f6799`.
- Agent Commons 0.1.0; macOS 26.5.2, build 25F84; arm64.
- Packaged app.asar SHA-256:
  `8801351ce9f0d7e110c29273eac3f144ff78c82703f478367185efcd05be71ba`.
  It matched the preceding passing desktop verifier artifact and was unchanged
  after both launches. All 717 corresponding packaged source/build files across
  desktop, contract, server, connector, scripts and dist byte-matched the checkout.
- Two ordinary executable launches used one new disposable profile under a
  generated temporary directory. Both reported secure credentials and exited
  zero through native Quit. Both owned backend ports were closed afterward.
- No debugging port, test bridge, simulated dialog answer, mock Keychain or
  development renderer was used. Only the generated Folder and Repository were
  selected; the user's normal app profile and repositories were untouched.
- The temporary directory and its evidence were retained, not deleted:
  `/private/tmp/ac-native-chooser-WgbaO7`. The final screenshot is
  `temporary-connections-cleared.png` inside it. This machine-local evidence is
  not a shipped or repository-owned artifact.

## Observed workflow

| Boundary | Observed result |
| --- | --- |
| Repository consent and Cancel | Remember was unchecked. Cancel in the real Connect repository dialog left the repository list empty. |
| Exact repository selection | Go to Folder selected only the generated Repository. Its canonical page disclosed that access ends when the app closes and required a separate List tracked paths action. |
| Tracked preview | Listing showed only `.gitignore` and `tracked.txt`; selecting the latter displayed the exact 65-byte working text, not its original indexed text. |
| Untracked consent | Browse untracked files started unchecked. Checking it disclosed the secrets warning but still required List untracked paths. The listing showed only `nested/untracked.txt` and reported one ignored candidate excluded. |
| Untracked preview retirement | Explicit selection displayed the exact 52-byte generated text. Unchecking the opt-in removed its listing and preview. |
| Single-file comparison | Entering `tracked.txt`, choosing Unstaged and pressing Compare file displayed one removed original line and one added working line, with capture time and a not-live disclosure. No whole-repository review was needed. |
| Folder consent and Cancel | Remember was unchecked. Cancel in the real Connect folder dialog left the folder list empty. |
| Exact folder selection and preview | Go to Folder selected only the generated Folder. Separate List folder paths and selection of `nested/notes.txt` displayed its exact 81-byte text. |
| Temporary lifetime | Native Quit exited zero. Relaunch on a new loopback port showed empty local-folder and local-repository lists, with no model endpoint configured. The second native Quit also exited zero. |

The generated repository index had SHA-256
`26761ace98ec84cccddf4ccad53c6c97b0641689b81f5da31673995bbe84e134`
before explicit browsing, after comparison and after the final Quit. Its size
remained 225 bytes and its reported modification/change times remained
1792030272 seconds. This walk did not use a split index or claim a nanosecond
timestamp comparison.

## Control and release limitations

The chooser initially opened in Downloads; no item there was selected. The
review used direct-path navigation to the generated directories and did not
capture that personal-directory view. A first Go to Folder shortcut issued
during dialog opening had no effect; it succeeded after the dialog was visibly
ready. No pass was inferred from an attempted action alone.

Signing/notarization, native Intel, hosted update installation, live providers
and third-party MCP acceptance remain open. Broader selected document/image
manual coverage and the full negative/race matrices are not implied by this
successful text-only chooser walk.
