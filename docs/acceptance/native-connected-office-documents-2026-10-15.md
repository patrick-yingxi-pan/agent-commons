# Native connected PDF/Office acceptance — 2026-10-15 UTC

## Scope and result

The unchanged unsigned arm64 app passed actual macOS Folder and Repository
chooser Cancel/selection, followed by selected XLSX, PPTX and scanned-PDF review,
editing and ordinary artifact creation. Folder, tracked Git and explicitly
opted-in untracked Git each produced one Sheet, Slides and Document artifact.
All nine canonical pages rendered their edited content after normal Quit and
full relaunch, with every original source path still absent. Both temporary
source connections expired independently of the saved artifacts.

This is bounded native evidence for CTX-FS-35/36/37, using one desktop-local
Personal account, one native wide window and generated files only. It is not a
new account/viewport matrix, an Office-fidelity or OCR-accuracy study, or a
signed/native-Intel release result. No provider was configured, no credentials
were entered, and no conversation Attach, Send, Share or external-service action
was performed. Existing automated coverage remains separate evidence.

## Artifact and isolation

- Source revision: `bbc89058fbfef46e5bbc20220cffa6e5b5b5a14b`.
- Agent Commons 0.1.0; macOS 26.5.2, build 25F84; arm64 executable.
- Packaged app.asar SHA-256:
  `d83e98879285bb246a59c5dd0e27093cd768287b41b362d51883622843dabf15`.
  An independent read-only audit byte-matched all 724 expected packaged files
  across desktop, contract, server, connector, scripts and dist against the
  clean checkout, with no missing, unexpected or mismatched files.
- The disposable profile and fixtures are retained under
  `/private/tmp/ac-native-office-review-p3USGF`. The owner profile and browser
  preview were not used or changed. The checkout stayed clean and unchanged
  throughout native acceptance; only afterward was this evidence recorded.
- The two acceptance launches used the same isolated profile and a minimal
  environment, with loopback ports 61946 and 62459. Both reported secure
  credentials and exited zero through the native Quit menu. Both ports refused
  connections afterward; the earlier warm-up port 61673 also refused connections.
- No debugging port, test bridge, chooser substitution, mock Keychain,
  development renderer, local model peer or source patch was used.

## Observed workflow

| Boundary | Observed result |
| --- | --- |
| Native chooser Cancel | Remember remained unchecked. Cancel in each actual chooser left that source type's connection list empty. |
| Exact selection | Go to Folder resolved only the generated Folder and Repository directories. Opening each created a read-only connection whose page disclosed expiry when the app closes. |
| Listing versus preview | Folder and tracked Git required List before selecting one file. Untracked browsing began unchecked, showed its secrets warning after opt-in, and still required a separate List untracked paths action. |
| Captured sources | After each selected preview completed, the tester moved that exact source outside its connected directory, before Office adoption or PDF recognition. Original bytes were retained, not deleted. |
| XLSX review | Only visible worksheet values appeared, including the cached formula result 42 and the hidden-content/cached-value warning. The one-row fixture initially refused Use with first-row headers enabled. Unchecking that option produced a read-only one-row preview; Create remained disabled until explicit adoption. |
| Discard and Cancel | Folder Sheet Discard removed the import without filling Content; Cancel returned to the retained source preview and saved no artifact. Reopening review worked despite the original file being absent. |
| Sheet adoption and editing | Explicit Use retained the entered artifact name. The tester changed the second cell from 42 to literal 43 and added a source-specific note before Create. |
| PPTX review and editing | Review showed one visible slide title and table-row bullet, with layout/media/notes omissions disclosed. Explicit Use alone filled the editable draft. The tester replaced the bullet before Create. |
| PDF recognition and editing | Each two-page scanned PDF first reported no embedded text. Separate Recognize scanned text completed on-device after the source move. Both page markers and recognized strings appeared; separate Use text in new document seeded editable Content. The tester added a third paragraph before Create. |
| Ordinary save and relaunch | Each Create opened its exact canonical artifact. Following normal Quit and full relaunch, all nine pages rendered the expected edited bodies without selecting a source, rerunning OCR or configuring a provider. |
| Temporary authority | The relaunched Contexts page showed no local Folder or Repository connection. Saved artifacts remained available independently. |

The generated Git repository contained only the three tracked fixture files in
its original commit. The three files under Untracked were never staged. The
native walk used an ordinary index, not a split-index layout. Only the tester's
explicit source moves changed the generated working-tree paths.

## Exact persistence evidence

A read-only SQLite checker captured an exclusive baseline after all nine saves.
After relaunch and after final Quit, it verified exactly nine identities and
body rows, zero image assets and zero persisted sessions. Full body JSON and
serialized identity records matched the baseline exactly, including revision 0
and each Document's nonempty, per-document unique block IDs. Saved bodies
contained no private fixture-root path.

All Sheets have columns `Column A`, `Column B`, one row containing their
source-specific workbook marker and literal `43`, and note
`Reviewed <Folder|Tracked|Untracked> capture; source absent.` All Slides have
their source-specific slide marker as title and one edited bullet,
`Reviewed <Folder|Tracked|Untracked> slide; source absent.` Each PDF-derived
Document has its artifact name as title and three paragraphs: `[Page 1] Scan
Alpha 427`, `[Page 2] Scan Bravo 813`, and `Reviewed
<Folder|Tracked|Untracked> PDF; source absent.` Paragraph whitespace is normalized
by the ordinary Document save path.

| Artifact | Exact ID | Stored body JSON SHA-256 |
| --- | --- | --- |
| Native Folder Sheet | `artifact-new-943421f6b67e9ee39c21a2e7` | `ac8e4f93cb3833c048e7999b8d6354ab554fcb299db16bc9aeccdb9e79605262` |
| Native Folder Slides | `artifact-new-7d510d0ddf3e1790911f9f7e` | `911b75457a1c9f85b8871bd9b76226f634e0abd936fea938dc2ef299b0b94e96` |
| Native Folder PDF | `artifact-new-9eb102624269d88c9225b776` | `402f20049a2a89274fed97e39acddcf06fd2d8119ab99693b731d3195290b6df` |
| Native Tracked Sheet | `artifact-new-36ddade33eba635e576c1db9` | `8cf002c843cd97e6fa2d39762a4afc9607db565fa6534bff587ba306cc9baa82` |
| Native Tracked Slides | `artifact-new-2211fa2a7732ae3367fbc834` | `cc57217e8abed8606f6cc60bd46b83fc665838953d50f2ceb234349f876d8833` |
| Native Tracked PDF | `artifact-new-3f273532bba81495145205aa` | `39d45941d1bceb2eb7dbd41d2530644ac9322c2b9a365a3a3c3a752b8e8b9ea7` |
| Native Untracked Sheet | `artifact-new-bb5627a3bdf6c6ba0bd7ca82` | `aea940bd44da61d91cb9a1c4b3f12e8fa107c0b71279f791dd94ab966d3dcd2d` |
| Native Untracked Slides | `artifact-new-f9967eaf0ba795792f59a2f3` | `efadfab26d481f6b9bb7fb326c4fe30bf9ceefd5eb4f038a3a3141e279314b0b` |
| Native Untracked PDF | `artifact-new-cf3cd12096b798375e426b4b` | `73a6cfc44c133da759ed83719688601002a202c5f92a12ed30c257d9bad9e0b6` |

Every original source remained absent; retained copies matched the original
SHA-256 values in the fixture manifest. The Git index retained SHA-256
`239150b26140403a63b53d5ce9c4130ca57da712093acc596bf2ad575e7a1f84`
and nanosecond mtime `1792096796409051031`. The ASAR digest also stayed unchanged.

## Review artifacts and limitations

Retained evidence includes the fixture manifest, checker, exclusive baseline,
nine relaunch screenshots and UI result records. Additional screenshots show
Folder Sheet review, the saved Untracked Sheet, Untracked Slides review,
Untracked PDF draft and cleared temporary connections. All nine relaunch
screenshots were visually reviewed: expected text was legible without clipping
or overlap, with distinct Sheet, Slides and Document layouts. Long import forms
scroll; no screenshot claims all controls are visible simultaneously.

The initial warm-up window's accessibility and captured pixels disagreed; it
was normally quit before any source was connected. One command-sandbox launch
then aborted in macOS application registration before backend startup. The
permitted ordinary launch and relaunch above succeeded. Neither unsuccessful
observation is counted as acceptance, and no product fix is inferred from it.
The temporary checker initially compared absent JSON fields with JavaScript
`undefined` properties. Omitting those optional fields fixed the checker; the
stored data and exclusive baseline were not changed or regenerated.

Remembered grants, multiple accounts, Project/conversation picker projections,
DOCX/embedded-text PDF, other Office structures, negative/race cases, OCR
languages, recognition accuracy, native Intel, signed/notarized downloads,
updates and live external services remain outside this walk. Paid-provider
testing remains deferred, not passed. Complete local verification is still
required before landing this evidence-only revision.
