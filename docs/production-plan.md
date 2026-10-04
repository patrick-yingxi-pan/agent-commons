# Desktop preview plan

Reviewed 2026-10-04 UTC. The standing goal remains production readiness for Agent
Commons, with desktop first and a hosted service later. Progress is judged by
complete user workflows and release evidence, not the number of hardened
mutation paths. Routine refactors and recovery work should support these
milestones or address a demonstrated defect.

## Decisions in force

- Electron, distributed directly as signed/notarized Apple Silicon and Intel ZIPs.
- Preserve sign-in and personal MCP tokens across relaunch using an encrypted
  device signing root protected by macOS Keychain (approved 2026-09-06).
- Keep the HTTP/SSE contract portable to the later hosted service.
- Verify, review, commit, and push each completed checkpoint directly to main.
- The complete local verifier is the delivery gate (owner decision 2026-10-04).
  GitHub Actions is manual-only optional diagnostics, not a prerequisite or a
  routine monitoring task. Earlier CI references below are historical evidence.
- Follow the approved desktop defaults below. Ask before materially widening
  the supported external integration scope or changing an approved policy.
- Sequencing is delegated: all planned core capabilities remain required;
  prioritize complete, verifiable workflows without dropping later milestones.

### Approved desktop defaults (2026-10-04)

The owner explicitly approved all six recommendations. These are target product
policies, not claims of shipped behavior; implementation and acceptance remain
required. Earlier checkpoint evidence does not establish these policies as built.

| # | Area | Approved default |
| --- | --- | --- |
| 1 | Folder/Git access after relaunch | Offer explicit “Remember this connection”; retain the selected read-only connection until disconnected only when the user opts in. Otherwise require selection again after relaunch. Remembered access does not authorize writes or automatic model input. |
| 2 | Remote context freshness | Use saved snapshots with explicit Refresh, not automatic reads on every model turn. |
| 3 | Artifact deletion | Use recoverable Trash; permanent deletion is a separate, explicitly confirmed action. |
| 4 | Spreadsheet organization | Represent a workbook as one artifact containing tabs, with shared permissions and revision history. |
| 5 | Desktop updates | Check automatically; require user approval to install and restart. |
| 6 | Unsafe macOS profile permissions | Refuse startup, preserve data, and explain repair steps rather than silently rewriting permissions, including unsafe ACLs. |

This approval does not grant access to a particular local folder, authorize a
real deletion or profile repair, waive external-tool consent, or supply release
credentials. Signing/notarization credentials, download hosting, and native Intel
acceptance remain release prerequisites. Feature implementation must retain the
existing local verification, UI/native acceptance, and spec-ledger requirements.

## Progress and next milestones

The current checkpoint adds the internal served-folder capture foundation:
streamed 500-entry admission, the existing local whole-text budgets and omission
policy, independently enforced list/read grants, and refusal after folder or
represented-authority changes during capture. The limits apply before filtering
or body reads, so hidden/unlisted entries cannot bypass the enumeration ceiling.
Failure-first tests cover the missing capability; deliberate cap, directory
version and runner-filter regressions each failed before restoration. Final
review then reproduced grant narrowing between the reader's final check and
its facade's await continuation; both boundaries now share the exact-output
authority predicate, with a failure-first microtask regression. This is
not yet a user-facing folder snapshot feature: intake, durable identity, model
projection, targeted Refresh and rendered recovery are the next integration
checkpoint. No new public route, UI behavior or filesystem permission is added.
The complete local verifier remains the landing gate; no GitHub CI is used.

The preceding checkpoint implements the approved saved-copy policy for individual
served cloud/runner text files. Explicit selection captures bounded whole text;
previews, reopened conversations and both model transports use that persisted
copy without new source reads. Owner-only Refresh replaces only its addressed
copy, pins the reviewed snapshot and keeps one durable request identity through
response loss or restart. Failed source reads preserve saved input; a read-only
recovery action reconciles current truth before releasing the send hold. Live
sync may expose a committed copy even when its HTTP acknowledgement is lost.
Ordinary stale workspace updates cannot rewind an existing copy. The strict
reader, source/path-bound response checks and former live-preview read each
have observed failing regression locks; fresh-process JSON and SQLite tests
prove saved-copy restoration and receipt replay without source reads.

The UI review exposed preview takeovers interrupting multi-add intake, wide
split changes remounting the picker, and portaled options escaping both busy
state and accessible button semantics. Shared presentation/overflow fixes retain
Done and cancellation without delaying saved attachment authority. The isolated
sweep passed 135/135 cells with no skips or violations; all 137 current sweep
captures and 42 focused saved-copy captures were inspected at original size.
Final code review also reproduced a delayed ambient Session read visibly
rewinding an acknowledged Refresh. Pane reads now carry session/context/order
receipts; stale responses cannot overwrite a newer copy or run panel/reattach
side effects, while transcript-only streaming and pagination retain their
separate lifecycle. A second failure-first browser walk caught a superseding
push read losing the startup reattach callback. Mount and push now share one
effect-scoped, one-shot obligation, retired by cleanup or an epoch change; this
does not add automatic discovery of later shared turns. All 26 focused browser
journeys pass, including saved copies, startup recovery, account switching,
panel preferences and Stop. The complete unsigned arm64 Electron gate also
passes: OS-backed credential recovery, native intake and source-absent relaunch,
MCP credentials, packaged schema isolation and exact backup/restore. Picker
smoke walks now await saved text/image acknowledgement before choosing Done;
their exact body, image-byte, model-input and relaunch assertions remain intact.
Complete local verification and packaged Electron acceptance remain mandatory
landing gates; no GitHub check substitutes for either. These are not signed,
notarized or Intel release receipts.

This is the file slice of approved policy 2, not completion of all remote
context. Folder snapshots with the same explicit Refresh policy are next;
remembered local/Git connections, workbook tabs, Trash, update consent and unsafe
profile refusal all remain required milestones under the approved defaults.

The preceding checkpoint repairs the conversation Stop workflow and its authority
wall. Failed cancellation previously disappeared into an empty catch. Shared
per-conversation state now distinguishes pending, acknowledged and failed Stop
requests, bounds each attempt to 30 seconds, and permits only deliberate
same-turn retry. Stream completion remains authoritative; account disposal and
turn replacement abort outstanding requests and fence late responses. The
failure-first controller suite exposed the missing lifecycle before repair.
The related route audit reproduced view/comment/propose grantees both appending
prompts and cancelling the owner's live turn. Send and cancel now share an
owner check before request parsing or replay; reading and stream attachment
remain grant-aware. The UI derives control from the server's ownership face,
keeps shared readers read-only, and offers accessible Stop recovery to owners.
Complete verification, five-viewport recovery and owner/reader/foreign review
remain landing gates. No new collaboration permission policy is introduced.
The corrected browser lock was watched fail when the Stop-state prop was
removed, then restored. Review also identified a separate existing freshness
gap: an already-open shared reader reconciles completed turns, but the live
attachment callback currently runs only on opening the conversation. The
permission regression verifies opening/reloading onto an active turn; automatic
discovery of a newly started turn remains follow-up work, not claimed here.
The production build caught the new cold graph at 800,686 bytes, above its
unchanged 800,000-byte cap. The existing low-frequency approval display is now
deferred with a local announced loading/failure boundary, preserving the
conversation and warning about unsent text before explicit Reload. Display
mounting and failure never invoke approval. Its dedicated browser checks cover
loading and failure at all five viewports, plus loaded Deny/Grant-access focus
and explicit reload recovery; budget and consent policy are unchanged.
The focused eight browser journeys passed; intentional removal of the loading
status and reload warning then failed both approval tests before exact source
restoration. The final isolated sweep covered 135/135 cells with no skips or
violations. Packaged unsigned Electron smoke passed. In the signed-in preview,
an explicit Stop preserved its partial through reload; Ada remains active with
all six demo accounts stacked. Complete repository verification remains the
final landing gate.

The preceding checkpoint `c7dbe4f2` addresses a demonstrated core authoring defect: after a
failed save, navigating away from a Document, Sheet or Slides page erased its
visible draft while the shell still promised recovery. All three failure-first
browser walks reproduced the missing editor. One account-scoped memory store now
owns body drafts across navigation and duplicate panes, including ordinary
unsaved edits. Save acknowledgement and explicit Cancel clear the draft; Dismiss
keeps it editable. Account changes clear it and fence late outcomes. Existing
revision checks and exact-key Retry remain unchanged, with no browser-storage or
server draft persistence. Structural Document editing still awaits the separate
block-identity/comment-anchor decision; this repair does not select that policy.
Review also reproduced a reconciled Document losing its edited block. Its exact
draft now remains available to copy or Cancel with Save disabled; no replacement
block is guessed. A deliberately removed account-disposal hook failed both
source locks before restoration. The signed-in preview retained an unsaved Sheet
note across navigation, then Cancel preserved the saved body; all six accounts
remain stacked with Ada active. Complete verification and the isolated visual
sweep remain this checkpoint's landing gates.
The isolated sweep completed 135/135 cells with no skips or violations, and all
142 screenshots plus 114 focused artifact captures were visually reviewed.
Focused recovery review exposed 3.58:1 dismissal guidance; the new WCAG 2.2 AA
checks failed in Document, Sheet and Slides before both editor surfaces adopted
the shared readable danger-text token. Recovery states are rechecked at all five
viewports after that repair. The preceding `304388de` checkpoint is also green
in GitHub run `37200291313`.

The preceding checkpoint `304388de` fixes a relay deadline defect exposed by Linux CI on
`60d4255c`: a whole-turn-clamped tool timer could expire while wall time still
reported a millisecond remaining, dispatching a sibling call or delivering an
unusable continuation. The shared executor now returns sticky whole-turn expiry
and the relay stops before another offer. Shorter per-tool timeouts remain
recoverable; budgets, retries and authority are unchanged. Deterministic
lagging-clock locks failed against the old code at both boundaries before the
fix. Complete repository and packaged verification remain the landing gates.

That checkpoint also closes actual native-dialog acceptance for the selected
XLSX worksheet workflow on `60d4255c`. The [native workbook record](acceptance/native-workbook-2026-10-04.md)
documents real Open/Save dialogs, cancellation, visible worksheet choice,
missing-cache refusal, header mapping, explicit adoption, canonical creation,
editing and byte-identical export. After the source path was removed by moving
only the generated input aside, a full app relaunch retained exact identity,
literal body, revision and export. This uses a clean disposable profile and an
unsigned arm64 package; generated XLSX input does not prove Excel-application
or corpus compatibility, rich Office fidelity, signing, notarization or Intel.
The native acceptance itself changed no implementation or permission policy.

The preceding checkpoint `60d4255c` extends the existing Sheet review/adopt/Create workflow
to XLSX. A separate bounded worker result preserves visible worksheet identity
and sparse literal cells. Users choose one worksheet and header mapping; its
used rectangle is checked before allocation, with no clipping. Missing formula
caches refuse adoption; cached values are disclosed as potentially stale. Styles,
merges, media, hidden content and calculation are not imported. The ordinary
artifact body, creation, editing, permissions and export remain authoritative.
Focused browser acceptance passed all 11 Sheet/import-recovery/XLSX-attachment
tests; the isolated UI sweep covered 135/135 cells without skips or violations.
Packaged unsigned arm64 acceptance imported a selected worksheet through real
native bytes and IPC, then preserved the exact saved body after source removal
and a full relaunch. The live preview was reviewed with all six demo accounts
stacked and left on Ada's saved Sheet. Failure-first locks caught missing-cache
adoption, name collisions and accidental use of the flattened attachment mode.
A final Unicode probe caught rejection of leading BOM cell text; failure-first
contract/package locks now preserve that literal character without accepting
lossy lone surrogates, and the native fixture includes it in the exact body.
The complete repository verifier remains the landing gate; actual Excel corpus,
signed/notarized binaries and Intel acceptance are not claimed by these fixtures.

The preceding checkpoint `3d1d5ac5` closes the demonstrated desktop POSIX-mode gap: startup
admits and, if needed, tightens the owned profile directory to 0700 before
application credentials or SQLite open. Repair operates on a no-follow directory
descriptor and preserves existing work; wrong owners, symlinks, broad paths and
aliases, unsuccessful repair and changed identity stop startup without offering
an unrelated database restore. Failure-first locks cover these boundaries, and
ordinary packaged startup/relaunch checks use only a generated 0755 profile and
an exact preservation sentinel. Those post-readiness checks also passed the prior
package because later MCP reconciliation already tightens mode; they do not prove
the early boundary. The separate source-order lock failed an unawaited guard, and
filesystem locks failed unsafe permission/identity mutations.
This is not complete local filesystem isolation:
extended macOS ACLs are neither audited nor removed, parent directories must be
trusted, Windows retains OS-managed ACL policy, and earlier Chromium/session or
instance-lock writes are outside this startup-order guarantee. ACL-managed macOS
profiles remain a separate release-review gap; no administrator/same-user defense
is claimed. A subsequent disposable-directory probe confirmed that an explicit
macOS `everyone` list/search ACL remains after the current guard admits mode
0700. The fixture stayed inside its own private temporary parent; no other
account access or normal profile was tested. The owner has since approved the
refuse-and-preserve policy in default 6 above; implementation and ACL acceptance
remain open. The earlier mode-only pass is not ACL evidence or acceptance of the
new policy.

The preceding checkpoint `4802b9fa` fixes a defect observed while reviewing native recovery:
editing a document changed its body and Edited time, but left its index preview
showing the creation text. Automatic previews now follow the exact saved body
for Documents, Sheets and Slides, including granted readers. Explicit summaries
remain independent; legacy direct-create identities upgrade because their
creation contract never accepted a synopsis, while ambiguous older consent
saves retain theirs. The preview oracle is shared with authoring and does not
change edit/rename ordering, grants or save identity.

The actual native recovery walk created a disposable profile, saved a baseline
document and backup, added distinguishable later work, and proved picker
cancellation preserved both documents, the process and the backup list. Actual
restore/relaunch remains awaiting owner approval; no normal workspace was used
or restored. The test app exited normally and its generated profile is retained.
The review also found the permissive user-data directory addressed by the current
mode guard; effective access additionally depends on parent permissions and ACLs.

The preceding checkpoint `1a2ce9e2` closes the missing packaged backup-restore acceptance
path. Rendered controls reach the real trusted IPC, pre-restore safety copy,
backend shutdown, ASAR worker and SQLite replacement. Exact before/after
Documents, Sheets, Slides and conversations distinguish restoration from a
restart that does nothing; restoring the safety copy recovers the newer work.
Cancellation and malformed-snapshot refusal preserve current data. The existing
pre-backup provider vault, device auth root and personal token remain intact.
Only generated throwaway profiles are used. Dialog answers and relaunch spawning
are controlled by the test, so this does not claim actual OS-dialog interaction,
automatic OS relaunch, rotated/deleted credential recovery, or signed/Intel
release acceptance. The ordinary executable smoke retains its separate real
OS-storage gate. An isolated package whose restore worker acknowledged success
without writing data was rejected by the new exact-workspace assertion.

The fresh packaged gate also exposed a separate source-picker defect: at phone
width, the horizontal source scrollport intercepted clicks on its own visible
buttons. Retained screenshot/geometry evidence reproduced the failure. Files,
Photos and Folder now share wrapping, width-bounded source choices; long-name
browser coverage failed on the old overflow before the layout correction.
The complete packaged desktop gate passes, including the native folder path and
all new restore scenarios. The separate UI sweep covers 135/135 cells with no
skips or violations. The Files picker at short landscape uses its existing
vertical scroll; an ordinary Done click remains reachable and is locked in the
new five-viewport walk alongside WCAG 2.2 AA checks.

The preceding checkpoint `b46fddec` removes fictional context inventory exposed by the clean
native review. The shared estimate now sums only supplied categories and keeps
the snapshot's own deferred rows through live-message/model overlays. Base-tool
estimates follow the Agent allowlist and transport capability; the popover names
the four-character approximation, omitted runtime inputs and local-only limits.
This is honest partial accounting, not a full request tokenizer or provider bill.
Failure-first contract/store and five-viewport browser locks cover the defect.
Its final complete verifier passed all five lanes and 384 browser tests in
281.7 seconds; the separate UI review passed 135/135 cells without skips or
violations. The reviewed checkpoint is published on main.

The preceding checkpoint `af66da4e` completes the unfinished native CSV/TSV Sheet workflow
checks. Actual OS selection, explicit header mapping/adoption, canonical save,
editing and native XLSX download are now backed by exact body/export comparisons.
Both saved Sheets survive a full app relaunch with the generated source paths
absent; IDs, literal values, notes and revision-one bodies remain unchanged.
The [native Sheet acceptance record](acceptance/native-sheet-2026-10-04.md)
names the two runtime revisions and download hashes. This is unsigned arm64
evidence, not signed/notarized, Intel, Excel-application or rich-workbook acceptance.
The read-only workflow audit found no concrete code defect; no new product policy
was inferred. The complete verifier and final diff review remain the push gate.

The preceding checkpoint `d3753db2` fixes a demonstrated clean-install content leak found
during actual native CSV artifact acceptance: an empty registry still exposed
the global demo body library through the artifact-content API. Bodies now require
current artifact/session read authority; compatibility names must be unambiguous
and cannot replace exact IDs. Renames and revocation withdraw aliases too.
Failure-first store/clean-boot and authenticated HTTP/MCP tests reproduce the
defect. The rebuilt unsigned arm64 app returns an empty library on a fresh SQLite
profile and only the exact saved Sheet plus its unique alias after relaunch of
the existing CSV review profile. The [scoped acceptance record](acceptance/artifact-content-2026-10-04.md)
records the package and limitations. Its initially unfinished TSV/source-absent
cells are completed by the native follow-up above. The complete five-lane
verifier passed all 383 browser tests in 261.7 seconds before publication;
no new artifact identity or removal policy was inferred.

The preceding checkpoint `057d5fe4` completes the four previously unverified native context
removal cases. The [2026-10-04 acceptance record](acceptance/native-context-2026-10-04.md)
uses a fresh unsigned arm64 package of `2abc976d`, actual macOS Files/Photos/Folder
dialogs, and a credential-free local model fixture. XLSX, PPTX, PNG and folder
imports and previews passed; each independent detach preserved exact siblings
and prior messages. The final native-composer request supplied no attachment
document or image blocks. This does not repeat the prior source-absent relaunch
matrix or constitute signed/notarized, Intel or paid-provider acceptance.

The preceding checkpoint `2abc976d` is published on main and closes a demonstrated backend gap in served-file intake:
directory enumeration failure was still acknowledged as an empty catalog or
workspace, despite the picker's recovery states. Missing/replaced roots and
failed root/folder scans now remain unavailable through cloud and mapped-runner
reads; unknown child counts are never fabricated as zero. Genuinely empty
directories still succeed. Failure-first reader tests reproduced the false-empty
responses; route and journal tests cover refusal, recovery and no successful
effect. Restoring the empty fallback, zero-count recount fallback, and missing
runner refusal each made the new route lock fail before restoration. The
complete verifier and diff review gate this checkpoint. No new
model input, source lifetime or native authority is inferred.
The first complete run passed all five lanes and 383 browser tests. Final review
then reproduced root replacement during child inspection publishing a partial
catalog; a final anchor check now refuses it, with a failure-first regression.
The final immutable-tree verifier passed all five lanes and 383 browser tests
in 300.9 seconds; adversarial diff review found no remaining scoped findings.

The preceding five checkpoints are published through `fc42d8f` on main; the
owner's renewed push instruction resolved the private-repository upload gate.
The final picker verifier passed all five lanes and 383 browser tests, and the
separate responsive review passed 135/135 cells without violations or skips.
GitHub run `35867243830` did not start its jobs because of account billing or
spending-limit annotations. The newer run `37185242103` has started all jobs and
passed Checks; its browser lanes were still executing at 07:35 UTC on October 4.
The historical billing failure is not the current run's observed blocker; no
full CI success is claimed while those lanes remain pending. Remote-source
input now follows approved default 2 above; the approval is not implementation
evidence.

The picker checkpoint repaired served-file intake recovery before extending
remote-source model input. Failed source/catalog reads must not appear empty or
silently select the local disk, and a failed folder read must not create an empty
workspace. One shared read-state/retry face, bounded reads and source/account/
picker lifetime fences cover the three filesystem pickers. Approved default 2
now selects the remote-input policy; no model authority was introduced by this
recovery work. Seven focused browser walks cover retry,
404, stale cached rows, served close/source cancellation and local leave-return
cancellation. The restored false-empty behavior was watched fail in both the
pure policy and rendered 404 checks; removing a read deadline also failed.
Browser acceptance and the full verifier remain required before committing.
The first full run passed all four browser lanes but caught the new spec's
nested test declarations falling outside the verifier's top-level manifest.
The tests now follow the repository's existing declaration convention; no
verifier check, assertion or coverage expectation was relaxed.
The next full run passed all 3,527 node tests and all browser lanes but exceeded
the unchanged 800 KB startup graph budget by 961 bytes. Files and Photos now
share one intake component, and the local drop zone joins the existing lazy
admission boundary before file selection. Review also caught cached success on
the first render before passive revalidation: a failure-first render lock and
held-response browser walk now require loading from that first render onward.
The final focused browser walk passed all ten recovery/loading tests. The
separate responsive sweep covers 135/135 cells with zero violations or skips;
the static/build lane is green after the image-boundary lock followed its
extracted chooser. The final immutable-tree verifier subsequently passed,
without changing the startup budget or adding retries.

The preceding checkpoint `36a50ef` passed the complete verifier in 249.2 seconds,
including all 375 browser tests, and is published on main. It closes a pre-existing runner grant bypass found during
the filesystem review: revoking both advertised filesystem capabilities still
left known catalog/folder/text/content URLs returning 200. Source routes and
mediated invokes now share one fixed logical/physical binding and one cached
reader; current list/read grants govern their respective operations. Narrowing
a grant filters the same tree, not a newly re-rooted tree; browse projections
omit unrelated entries and counts, retaining only the navigation branch needed
to reach an explicit list grant. This is not a new enrollment, tenant storage,
native filesystem grant, or live-folder/model-input feature.
The new route lock first failed with four unauthorized 200 responses. Replacing
the actual grant predicate, removing folder filtering, flattening the fixed
nested path and recreating a root reader per call each failed the new locks
before restoration. Denial tests keep a readable live fixture until those
assertions finish; root-replacement tests run afterward so missing data cannot
make permission assertions pass vacuously.

The preceding checkpoint `47c05ee` passed the complete verifier in 257.8 seconds,
including all 375 browser tests, and is published on main. Its earlier publishing
block was resolved by the owner's renewed push instruction.
That checkpoint repaired the shared served-filesystem boundary before
extending remote-source input. Failure-first tests reproduced outside bytes via
a descendant symlink, an outside folder listing and a catalog crash on a broken
link. Readers now pin their configured canonical root, accept exact visible
relative handles, omit descendant links/special files and use identity/version-
checked bounded descriptors (256 KiB text; 32 MiB raw). Cloud and runner route
tests exercise real isolated roots and preserve unavailable/404 responses.
A mapped runner's missing read also reproduced a false mock success; mapped
read/list refusals now fail before a successful effect is journaled.
This does not introduce remote model input, new picker authority, hosted tenant
storage or OS-level isolation from a hostile local process. Directory-cardinality
and slow-filesystem bounds remain work for the production storage boundary.
The final revision must pass the complete verifier and adversarial diff review.
Removing the raw-byte ceiling, descriptor cleanup and post-read integrity check
each failed the new locks before restoration. Removing the mapped subfolder
refusal likewise failed its route test. The byte-response integration check also
caught a Buffer-to-Uint8Array compatibility regression in router re-entry; the
bounded reader now preserves the existing Buffer runtime representation.
The first complete run passed all four browser lanes but found four older
invoke/journal tests that expected successful mapped reads of nonexistent files.
They now use actual committed runner fixture files, preserving success, cursor,
permission and coordination assertions; no refusal was changed back to success.

The preceding SVG checkpoint is published as `2be75d3`; its final full
verifier passed all 375 browser tests, unsigned arm64 packaged smoke passed and
the separately run rendered review covered all 135 cells without violations.
Both it and `f398685` were subsequently published with explicit owner approval.

That checkpoint added self-contained static SVG local image input through
the existing Photos workflow. XML is admitted in the shared isolated parser
worker under 8 MiB/8,000 px/32 megapixel and 10,000-node/64-depth/50,000-expanded-use
bounds, then decoded as a detached image and normalized under the existing
15-second total deadline and 2,000 px/3 MiB PNG limits. Scripts, animation,
external resources, malformed geometry and recursive reuse fail visibly;
static embedded PNG/JPEG share a 32-megapixel aggregate budget, and local
gradients/clipping/styles remain supported.
No original SVG or inline markup is retained and no native authority/API is added.
Malformed percentage geometry was watched fail before correction. Removing the
actual closed-result validation, worker termination and object-URL cleanup each
failed the new locks before restoration. Acceptance requires the frozen-tree
browser, full verifier, responsive and unsigned arm64 runs, including real colored
SVG pixels, durable/model references, rejection without external requests, and
native relaunch after the source files are deleted. Manual OS-dialog, paid-provider,
signed/notarized and Intel release evidence remain distinct external gates.
The first native SVG run caught a stale three-image readiness assertion after
the batch grew to four; the harness now derives readiness and expected model
copy from its fixture list, without weakening reference or byte checks.
The first full verifier caught two source-lock false positives: active-SVG test
data used a dialog function name, and an MCP identity regex consumed unrelated
later SVG copy. The fixture now uses an inert marker and the MCP lock names the
actual external/legacy mapping branches; mutating the real external ID mapping
was watched fail before restoration. The embedded-pixel aggregate guard likewise
has a failure-first structural-header test, distinct from real codec acceptance.
The provider-form viewport walk also sampled before the existing resize/observer
geometry update; it now waits for the same 7 px panel/footer bounds before
measuring, with unchanged test budgets and no retries.

The preceding BMP/ICO checkpoint is published as `f398685`. Publishing
was initially rejected by the automated permission gate; the owner's renewed
instruction resolved that upload gate. The existing remote
CSV/TSV CI failure remains the billing gate described below, not SVG acceptance.

That checkpoint added bounded BMP/ICO local image attachments through
the existing browser and Electron picker, preview, durable upload and model
input workflow. It recognizes CORE RGB depths 1/4/8/24, INFO/V2/V3/V4/V5 RGB
depths 1/4/8/16/24/32 and 16/32-bit BITFIELDS, plus ICO files with disjoint PNG/DIB
entries and deterministic largest-area/depth/file-order selection. Inputs remain
transient and durable image snapshots remain PNG/JPEG/GIF/WebP after the
existing ≤2,000 px/≤3 MiB normalization. The 8 MiB raw, 24 MiB selection,
8,000 px, 32 megapixel and 15-second abort/decode bounds are unchanged. Focused
tests cover malformed/truncated, mask/palette, directory, overlap, cursor and
selection cases. The browser codec matrix decodes 86 real BMP/ICO cases and
checks normalized dimensions and colored pixels. Reversing the actual ICO
area, depth and directory-order choices was watched fail before restoration,
as was reading the V5 linked-profile marker from the wrong header field.
Microsoft's header confirms the existing color-space field and numeric marker;
the implementation needed no change for that review concern. The complete
five-lane verifier passed all 374 browser tests, the complete Node suite,
type checking and the production build under unchanged budgets. The frozen-tree
responsive sweep passed 135/135 cells with zero violations or skips. All 137
fresh sweep originals and 25 focused PNG/BMP/ICO, shared-view and error originals
were individually reviewed at full resolution with no remaining findings.
Unsigned arm64 packaging and every executable smoke phase passed. A single
native PNG/BMP/ICO batch proves real selected-file reads and IPC, normalization,
exact authorized model bytes, full relaunch after deleting all source files,
exact asset-reference preservation, restored previews and independent detach.
Native results still simulate the OS dialog; manual dialog, signing/notarization,
Intel and paid-provider acceptance remain separate gates. The new harness was
corrected to pass dimensions into its browser callback and use the actual
grouped Photos menu as the batch shrinks; no product behavior or budgets changed.
The shared light desktop preview has all six demo accounts stacked, with Ada
active on the local Photos intake surface.
No Image-artifact retention or original-image persistence decision is made.
Workbook identity is now resolved by approved default 4 above. Image original
retention and document-edit CAS remain pending owner decisions.

The preceding checkpoint adds CSV/TSV-to-Sheet import through the existing bounded
local reader and shared review/adoption ceremony. Quoting and literal values are
preserved; first-row column names versus generated headers are an explicit review
choice. Malformed, ragged or oversized input is rejected without partial adoption.
Only normal keyed Create saves; canonical correction, sharing and XLSX export
remain the same workflow. This is progress on file-based spreadsheet authoring,
not a replacement for required XLSX workbook tabs, formulas or rich Office fidelity.
Intentionally breaking doubled-quote handling, the Create-during-review guard,
and real draft adoption each failed their locks before restoration. The final
complete five-lane verifier passed all 373 browser tests, the complete Node
suite, type checking and the production build under unchanged byte budgets.
The frozen-tree responsive sweep passed 135/135 cells with zero violations or
skips. All 137 fresh sweep originals and 40 focused import/replacement/error
and owner/reader/foreign originals were individually reviewed at full resolution
with no remaining findings. Focused review also proves keyboard horizontal scrolling inside the
named sheet preview at 320 px without page or dialog overflow; a partly visible
last column was not a clipping defect. Header-error copy now quotes the actual
checkbox label. The shared preview remains on Artifacts in light desktop mode,
with all six demo accounts stacked and Ada active.

Unsigned arm64 packaging and every executable smoke phase passed. The new
native CSV/TSV checks cover real text reading and IPC, explicit header mapping
and adoption, exact saved identities/bodies, and a full app relaunch after the
source files are deleted. Native picker results are still simulated by this
harness; actual OS-dialog, signing/notarization, Intel and paid-provider
acceptance are not claimed.

The CSV/TSV checkpoint is recorded at `e9f8dc4`. GitHub run `34465411546`
failed before workflow steps because of account-billing annotations; that is an
external gate failure, not a code failure in the checkpoint.

The first complete run exposed two existing test races: a 50 ms credential
test timeout competed with `setImmediate`, and a read-only MCP proxy could
close its page while `route.fetch` was unfinished. Protocol send/start/ack
signals now replace scheduler waits in that credential test. The MCP proxy
unroutes and drains pending handlers before page closure, preserving errors
and always closing the reader. Deliberately removing that drain failed its
new regression test immediately; restoration passed. These repairs changed no
product policy, retries or timeout budgets.

The preceding runtime-admission checkpoint closes a demonstrated New artifact
failure: the form now waits for both the lazy dialog module and the actual
shared creation runtime before mounting fields, so a rejected runtime remains
closeable/reloadable and cannot start a mutation during admission. The new
failure-first browser lock observed the old path fail (opening the form made
zero runtime requests where one was required); the source lock also failed
when the preparation call was removed. Focused type and Node tests passed.
Final acceptance passed the complete five-lane verifier: all 369 browser tests,
the complete Node suite, type checking and the production build under unchanged
byte budgets. The frozen-tree responsive sweep passed 135/135 cells with zero
violations or skips. All 137 fresh sweep originals and 15 focused loading,
failure and recovered-form originals were individually reviewed at full
resolution with no remaining findings. Live keyboard checks confirmed that
short-screen form fields scroll fully above the persistent footer; clipped
offscreen content was not an overlap defect. Unsigned arm64 packaging and every
executable smoke phase passed, including creation, Office downloads, credentials,
relaunch, managed backup, input and MCP schema checks. Native picker results
remain simulated where recorded by the harness; actual OS-dialog, signed/
notarized, Intel and paid-provider acceptance are not claimed.
Workbook organization now follows approved default 4 above; account/workspace
versus device appearance persistence remains an owner decision. No
production-ready claim is made here.

The preceding checkpoint added Download Word beside Markdown for saved Documents
and email artifacts. A fresh exact-ID read snapshots current saved content,
preserves ordered title/headings/prose/lists/code/email text in editable DOCX,
and rechecks visibility after serialization. Both actions share edit and
in-flight holds; missing/foreign/revoked content remains hidden. Markdown stays
the omitted-format default. This does not reproduce imported rich Word layout.

Independent rendering exposed incomplete local ZIP headers: generic archive
readers accepted the files, but LibreOffice could not open DOCX/PPTX. All three
Office exporters now share deterministic stored ZIP finalization with complete
local sizes. A header-descriptor mutation was watched fail, as were bypassing
the DOCX post-serialization access check and losing email-label separator spaces.
The actual generated DOCX renders through bundled LibreOffice; its fontconfig
must be selected explicitly for installed Japanese font fallback. All four
rendered pages were individually inspected for text, wrapping and pagination.
All eight focused browser export checks passed. The final complete five-lane
verifier passed all 368 browser tests, the complete Node suite, type checking
and the production build on Node 26 under unchanged byte budgets. The frozen-tree
responsive sweep passed 135/135 cells with zero violations or skips. All 137
fresh sweep originals, 35 focused Office-export originals and 15 provider-dialog
originals were individually reviewed at full resolution with no remaining
findings. Manual foreign-account denial also passed at all five canonical sizes.
Unsigned arm64 packaging and all executable smoke phases passed, including an
actual Word download whose disk bytes match a fresh authenticated descriptor.
Existing credential, relaunch, backup, input and schema checks remain green.
Picker results are simulated where recorded by the native harness; this is not
actual OS-dialog, signing/notarization, Intel or paid-provider acceptance.
The Word checkpoint at `1ce88ca` passed GitHub run `34453295428`.
The runtime-admission checkpoint at `fa59100` passed GitHub run `34458055885`.

The first complete plan passed all 368 browser tests but caught a source-lock
literal being interpreted as a real suite-relative import; the assertion now
matches the serializer import as syntax. Live UI review found adjacent identical
download glyphs, so both document choices use a captioned shared SectionAction
variant. Ordinary icon-only header verbs keep their existing quiet presentation.
The new visible-label constraint and geometry lock belong to UI-154. Both source
locks and the browser test failed when captions were intentionally hidden.
The next full pass exposed an immediate provider-dialog geometry sample during
a viewport resize. Its helper now waits for the same strict panel/footer bounds
under the existing assertion deadline. Disabling the real resize updates was
watched fail this stabilized lock; no production dialog rule or budget changed.
Five diagnostic repetitions and the final complete verifier passed afterwards.

The preceding checkpoint added structural PowerPoint-to-Slides import. It preserves
real visible slide boundaries rather than interpreting flattened attachment
text, including explicitly numbered empty slides. First nonblank paragraphs
become titles, remaining paragraphs/table rows become bullets, and the complete
outline must fit the existing authoring limits. Read-only review explains the
mapping and omitted fidelity before explicit Use/Replace; normal keyed Create
alone saves. A common import lifetime and review frame now serve Document and
Slides, retaining cancellation, account/format fencing, draft/name preservation,
focus recovery and actual lazy-loader failure recovery without widening native
authority. Rich Word, workbook tabs/formulas and rich presentation fidelity
remain required; workbook artifact identity now follows approved default 4 above.

The first complete gate caught a section-navigation graph of 505,847 bytes,
above its unchanged 500,000-byte limit. Artifact creation is now a separate
on-demand form behind a shared bounded loading/error ceremony, loaded before
draft input exists. The existing resource FormDialog/FormField primitives move
to their own module without changing layout or behavior. A real module refusal
requires explicit reload with unsent-workspace guidance, never an automatic
retry of the browser's rejected URL.
The shared shell has an explicit independent chunk so the lazy form cannot
pull section navigation back in through a shared-module dependency. Physical,
cold, async and worker byte gates remain unchanged. The shell's default Node
was 24; final verification explicitly uses the installed required Node 26.

Focused parser, contract, mapping, UI-host and browser checks have passed.
Intentional dropped-bullets, no-op adoption and no-op Reload mutations failed
their respective pure/browser locks before restoration. Browser checks prove review/adoption, editing, reload, ownership,
sharing/foreign denial and actual PPTX download bytes and XML; the existing
Document import/recovery and PPTX attachment paths also pass. The frozen-tree
responsive sweep passed all 135 cells with zero violations or skips. All 137
fresh originals (excluding five historical captures) and 70 focused import,
review, failure, loading and owner/shared/foreign originals were individually
reviewed at full resolution with no remaining findings. The complete five-lane
verifier passed: all 367 browser tests, the complete Node suite, type checking
and the production build under unchanged byte budgets. Unsigned arm64 packaging
and all executable smoke phases passed
on Node 26, including exact imported slide identity, revision and body surviving
a full relaunch after the source PPTX was removed. Native picker results are
simulated; selected-file reads, IPC, emitted workers, review/adoption, saving and
relaunch are real. This does not claim actual OS-dialog interaction, signing,
notarization or Intel acceptance. The previous Document checkpoint's GitHub run
`34438685229` is confirmed successful.
The Slides checkpoint at `21bbd8a` also passed GitHub run `34446360264`.

Acceptance also exposed stale source-owner checks after the form extraction and
an MCP browser fixture teardown race. The former now read the shared form owner;
all MCP proxy consumers drain their page-owned handlers before closing servers.
A held-acknowledgement browser lock was watched fail when draining was disabled.
The first responsive sweep was rejected because concurrent test/package edits
triggered Vite reloads; the accepted sweep above ran without edits. The first-run
setup fixture now keeps its release-shaped registry projection until the whole
conversation completes, then drains routes in finally. Artifact cancellation
checks use layout-stable scrolling after viewport changes; eight consecutive
five-viewport diagnostic walks passed with unchanged assertions and budgets.

The preceding checkpoint added a reviewed file-to-Document workflow to New artifact.
One text, PDF or DOCX file is read through the existing bounded UI-host/native
reader; only explicit adoption changes the draft, and only normal keyed creation
saves it. Text-only conversion discloses omitted formatting, images, layout and
OCR; PDF/Word extraction details remain visible during review. Unsupported or
multiple selections are rejected before parsing, oversized source is rejected
before the authoring clamp, and cancellation, format change, closure and account
switch fence late work. A typed name is never replaced by a filename suggestion.
That checkpoint did not include structured Office import; the current Slides
mapping above extends it without claiming rich Word or multi-sheet workbooks.

The full five-lane verifier passed, including 362 browser tests, the complete
Node suite, type checking and production build under unchanged startup budgets.
The responsive sweep covered 135/135 cells with zero violations or skips; all
137 fresh originals were individually reviewed at full resolution. Another 35
originals cover import review, error, loading failure, in-flight reads and the
owner/shared/foreign saved-document faces at every canonical viewport. Live
review caught crowded shared resource-form fields: UI-153 moves spacing to
the actual fieldset and locks the rendered gaps. Intentional admission,
source-limit, cancellation, Create-guard and adoption regressions were observed
failing their locks; the restored adoption path passed again in the browser.
Unsigned arm64 packaging and the complete executable smoke passed. The new
native-dialog-result fixture keeps selected-file reads, trusted IPC, emitted
workers, explicit review/adoption and keyed creation real; exact saved bodies
are checked before all three source files are removed, then their identities
and rendered bodies survive a full app relaunch. The existing separate
OS-backed auth/provider/MCP credential, managed-backup, input/export and schema
worker checks also passed. This does not claim actual macOS dialog interaction,
signing, notarization, native Intel or paid-service acceptance. The preceding
provider-onboarding revision's GitHub CI run `34434648778`
is also confirmed successful; the new revision requires its own complete gate.

The preceding checkpoint completed the provider-onboarding failure path needed
for a reliable first conversation. The form now loads its saving/recovery
controller before accepting intent. A real browser module failure previously
stranded Create; consolidating the queue removes that late dependency.
Each activation freezes its user, tenant and account generation before native
credential provisioning. The native continuation, HTTP create/recovery and
ordinary provider-registry refresh all retain that source. Server-side source
checks precede collection/by-ID reads, registration and one-time-secret replay, so a
cookie changed in another tab cannot redirect intent or populate an old viewer's
cache with the new viewer's private registry.

Credential cleanup now distinguishes a never-submitted key from a possibly
committed submission. After any uncertain attempt, even a later definitive
refusal cannot prove the earlier request did not use the key; startup
reconciliation retains that responsibility. Failure-first tests exposed both
the delayed-native account-switch POST and this refused-retry cleanup defect.
Shared form/secret-dialog layout also reserves the live workspace below shell
notices and scrolls only its body, keeping titles and footer actions reachable.
The browser locks observed the short-window footer overflow and narrow recovery
banner overlap before their fixes.

That checkpoint's acceptance passed the complete five-lane verifier: 3,396 Node
tests and 356 browser tests, type checking and production build, with startup
budgets unchanged. The final frozen-tree responsive sweep covered 135/135 cells
with zero violations or skips. Its 137 fresh originals are distinct from five
historical captures; fifteen provider-state and ten search-state originals cover
the additional ceremonies at every canonical viewport. All 162 current originals
were individually inspected at full resolution with no remaining visual findings.
Search display now sits behind a local announced loading/failure boundary to
make room for the ready safety path. Failure initially focused Reload; a
failure-first browser lock now requires safe Close focus, trapped Tab, dismissal
and actual full-navigation recovery from a rejected module URL.
Unsigned arm64 packaging and executable smoke passed again on the final code,
including OS-encrypted credential lifecycle, personal defaults/sign-in/token
recovery across a different-origin relaunch, managed backups, artifact creation
and exports, native-reader/IPC input fixtures, and the isolated MCP schema worker.
These fixture-driven native checks do not replace actual OS-dialog acceptance.
Earlier browser/sweep runs were rejected for coverage gaps or extra document
reloads during edits. The final unchanged run passed without retries or extended
budgets; the harness now retains bounded reload/navigation diagnostics and waits
for the canonical artifact subject under its existing readiness deadline.
Artifact-removal policy is now approved in default 3 above; this checkpoint did
not implement deletion. Signing, notarization, native Intel,
external-service and paid-provider acceptance gates remain open below.

The preceding checkpoint closed a desktop first-conversation continuity defect:
the native host deliberately selects a fresh loopback origin on relaunch, while
personal model defaults previously lived only in that origin's browser storage.
Provider, model, effort and mode choices now belong to one revisioned user-and-
workspace server record, persisted through both JSON and SQLite. Setup waits
for that exact acknowledgement before returning to the draft; Customize and
the composer share the same held choice and explicit recovery. Saved sessions
retain their own routing, and tenant-wide registry defaults remain a separate
concept. Unowned legacy browser preferences are not automatically imported.
Sparse Retry preserves unrelated newer settings, and account-scope mismatches
cannot silently write another viewer's defaults. The workspace waits for its
own preference read and offers a full Reload when the initial identity crosses.
This is required desktop workflow continuity, not cross-device polish; live
hosted preference synchronization remains future work. The model catalog loads
on demand under the unchanged bundle budgets. Preference saving is ready with
the workspace: browser failure injection proved that resetting a lazy-import
Promise could not clear the browser's rejected module URL. Removing that extra
boundary avoids accepting edits that depend on a failed code download.
The same real-browser failure-injection audit remains required for other lazy
action runtimes: resetting a JavaScript Promise in unit tests alone does not
prove recovery from a rejected browser module URL.

That checkpoint's acceptance on 2026-09-10 passed the complete five-lane verifier,
including 353 browser tests under unchanged startup bundle budgets. The final
responsive sweep covered 135/135 cells with zero violations or skips; timestamps
distinguished its 137 fresh captures from five historical files. An additional
31 individually reviewed captures cover model preferences, held/error/recovered
choices and lazy catalog loading/failure. This review caught recovery notices
covering the top of a picker on narrow and short screens. The shared popover
funnel now measures the available workspace below shell notices and observes
its live size; source and browser locks were watched fail before the fix.
Unsigned arm64 packaging and executable smoke passed, including exact personal
default recovery and a usable fresh draft after a full relaunch on a deliberately
different loopback origin. Existing OS-backed credential, backup, artifact
export, input and MCP schema-worker checks also passed. This is not signing,
notarization, native Intel, paid-provider or complete actual OS-dialog evidence.

Current shared-browser handoff leaves all six demo accounts stacked with Ada
active on Artifacts in a desktop/light viewport. The New artifact form was
reviewed and cancelled without saving sample content; Ada's Acid Plum palette
and three overrides remain intact. The admission states are account-neutral;
existing isolated creation and download tests cover Ada's owner, Grace's
shared-reader and Maya's foreign-account faces. That earlier review could not
perform a fresh actual OS-dialog ceremony while the Mac was locked. Native
controls were available for the October 4 review below; Excel-application
acceptance remains a separate unverified check.

The [2026-09-10 native-context review](acceptance/native-context-2026-09-10.md)
used the unsigned arm64 packaged app and actual macOS Files, Photos, and Folder
dialogs. Cancellation, text/PDF/DOCX/XLSX/PPTX/image/folder import and preview,
model delivery, and full relaunch with the original input paths absent passed.
Exact stored identities/content and the model's text/image payload survived.
Independent native detach passed for Markdown, DOCX, and PDF in that review.
The [October 4 follow-up](acceptance/native-context-2026-10-04.md) freshly imported
and independently detached XLSX, PPTX, PNG and folder snapshots and verified a
final attachment-free model request. These dated, revision-scoped records are
qualified development-artifact evidence, not every native acceptance cell on
one current artifact, a paid-provider pass, or a signed two-architecture release.
No dialog policy was changed to accommodate the automation surface.

Shared editor review resumed on 2026-09-09 after the Mac became available. A
fresh tab preserves all six stacked accounts with Ada active, a desktop/light
viewport, and the edited `production-review.Q1.slides` artifact. Save and the
updated PowerPoint download were exercised. The review caught a split-line Add
bullet glyph/label; the shared inline-action style and failure-first UI-147 locks
now cover every structural add control.

Direct-authoring review on 2026-09-09 inspected the shared New artifact form and
slide fields with Ada active. The preview safety gate refused a persistent test
save, so the unsaved review form was cancelled and no sample row was added to
that workspace. Ada remains signed in on Artifacts with all six accounts
stacked; isolated browser and packaged tests provide creation/relaunch evidence.

| Milestone | Evidence and remaining work |
| --- | --- |
| Trustworthy local host | Sandboxed Electron, clean first run, SQLite, managed backups/restore, provider-key lifecycle, and native recovery are built. The signing root now persists separately from product data; packaged acceptance covers sign-in, token recovery, and a completed conversation across a full restart. |
| Useful first conversation | Provider onboarding and the Messages transport are built. Local text reaches both endpoint and Session transports as whole files (64 KiB per file, 128 KiB total, first 24 items), with shared-plan UI and one input snapshot reused through the tool loop. Browser/native intake shares source/configuration recognition and strict whole UTF-8 decoding. Bounded top-level folder snapshots (CTX-FS-11), direct-file PDF text extraction (CTX-FS-12), bounded DOCX text extraction (CTX-FS-14), bounded XLSX visible-value extraction (CTX-FS-15), bounded PPTX slide-text extraction (CTX-FS-16), and the bounded image path now extend the same input plan. DOCX is limited to 8 MiB/file, 24 MiB/selection, 512 entries, 4 MiB parts, 16 MiB expanded content, 128 XML depth, 128 attributes/tag, 100,000 nodes and 64 KiB body text; it excludes images/layout and legacy or macro-enabled Word files. Images accept PNG/JPEG/GIF/WebP up to 8 MiB raw, normalize the first frame to PNG at a 2,000 px maximum edge and ≤3 MiB, retain durable tenant-scoped asset references, and deliver at most 8 images/8 MiB per turn alongside the shared 24-item plan. OCR, other document formats, live folder/Git and remote-source input remain the FWD-9 gap. Targeted text/PDF/DOCX/image tests and XLSX acceptance, packaged executable smoke and the 135/135-cell responsive sweep cover this bounded path. Shared interactive preview handoff is restored as recorded above. Provider proof is deterministic protocol evidence, not paid-model acceptance. |
| Useful external work | Tenant-owned HTTPS MCP lifecycle, inspection receipts, Contexts setup and OS-encrypted desktop credentials now compose with isolated schema admission, exact attachment and per-call owner approval on both model transports. The running receipt precedes one outbound attempt; bounded inert results, known failures and restart-safe uncertainty retain honest history without automatic replay. Deterministic browser protocol fixtures and JSON/SQLite tests prove the portable workflow; packaged OS-storage and schema-worker checks are separate from combined real-service/native acceptance. Legacy development connectors remain mocked and other release adapters remain unconfigured. OAuth, local transports, standing trust, MRTR and third-party acceptance remain required. Repository content/git and some imported artifact renderers remain declared fixtures. |
| Distributable preview | The paired release verifier is built; both architecture candidates still need actual signing/notarization credentials, native execution evidence, and an authenticated download destination. A green browser CI run does not prove a signed release exists. |
| Hosted service | Preserve the boundary now; defer anonymous indexing, broad cross-device polish, and deployment-specific tenancy operations until the desktop preview's core workflows pass. |

## Earlier checkpoint evidence

The next routine-output increment first closes a demonstrated queued-intent
defect: execution froze the routine definition but read standing artifact and
extra-tool choices from the live graph. New runs now persist those choices
before dispatch; additional approvals apply only to future runs, and changed
approvals fail before execution and again at publication. Legacy queued work
cannot infer standing authority from a newer graph. JSON/SQLite restart and
direct store tests preserve the last good document; intentional bypasses of
the approval fence and snapshot admission each failed their new locks.
Final review also found deletion leaving standing graph approvals behind.
Deleting a routine now clears those choices and detaches only its write binding
from saved artifacts, preserving their content, names, sharing and original run
provenance. Same-ID recreation cannot inherit the old approvals or overwrite
retained output; restart coverage observes the cleanup before invalidation.
Startup also prunes orphan approvals and retired write bindings left by older
versions, persisting that recovery before request admission; live routines and
saved report content remain intact.
Structured routine output now extends that boundary to Document, Sheet and
Slides. The existing conversation approval names the format and output; queued
runs freeze both. Documents retain the bounded prose path, while sheets/slides
submit one validated literal body through the existing guarded model loop.
Failed, missing, duplicate or revoked output cannot replace the last good body.
Same-format refresh preserves identity, independent sharing/filing and user
names. Changing an already-published output's format refuses before altering
the grant until the outstanding identity-policy decision is resolved; the
conversion workflow remains required, not dropped. Browser acceptance uses a
test-owned Messages endpoint and is not paid-provider or signed-release proof.
Final review tightened current queue snapshots to object-or-null output specs;
bare names remain compatible only at the explicit legacy graph/snapshot doors.
The 135-cell responsive sweep passed without violations or skips. The additional
three-format owner/reader review exposed a misleading Workflow edit affordance
for shared readers; the owner-only rendering and browser absence/presence locks
now complement the existing server authorization wall. Shared preview review
left all six demo accounts stacked with Ada active and added no test artifacts
to that workspace. All ten targeted routine browser tests passed, including
all three output formats, owner/reader live refresh, and acknowledged editing.
Unsigned arm64 packaging and executable smoke passed with OS-backed credential
and authentication relaunch, managed backups, direct artifact creation/exports,
native attachments and packaged MCP schema checks. The complete repository
verifier remains mandatory before push; this is not signed/notarized or native
Intel release evidence.
The additional 120-capture output matrix was individually reviewed; regenerated
owner/reader workflow and list captures close the reader edit finding and the
short-viewport capture-readiness gap. The full browser run passed all 344 tests,
but its coverage guard rejected a dynamic three-case declaration counted as one.
Those cases now use three explicit declarations over one shared test body, so
the manifest remains exact without weakening the verifier.

The dependency audit is no longer blocked: on 2026-09-09 the development-only
Browserslist and baseline-browser-mapping findings were resolved with compatible
lockfile updates. Both production-only and full dependency audits reported zero
vulnerabilities, and a clean Node 26 install completed. The complete verifier and
native packaging remain the checkpoint gates; an audit does not substitute for
runtime evidence or guarantee the absence of undisclosed vulnerabilities.

CI on the preceding MCP revision exposed a test-isolation defect: the in-process
MCP browser router did not inherit the shard's model endpoint, so a shared local
development model masked its fallback to port 8788. The fixture must pin its
test-owned endpoint independently of ambient configuration, with a deliberately
invalid ambient endpoint proving that regression. Increasing retries or timing
budgets is not a remedy; the corrected complete verifier remains a release gate.
The same review exposed a responsive capture race: pane controls were selected
from the previous layout immediately after resize. MCP captures now await the
requested overlay tier (or its absence on desktop) before choosing Close.

The direct-authoring checkpoint extends New artifact to Document, Sheet,
and Slides. All three create real content without requiring a model proposal;
structured creation reuses the saved editor fields and keeps per-format drafts
independent. Direct creation has an account-scoped durable request identity,
allowing distinct same-name artifacts without weakening model-save replay.
One held form and shell recovery keep the submitted request until exact server
truth; a late result cannot navigate an unmounted originating form. The source
account is frozen at activation and checked before effects, including when a
different tab changes the shared sign-in cookie. The full verifier passed all
five lanes, including 337 browser tests, with first-attempt trace retention.
The responsive sweep covered 135/135 cells with zero violations or skips;
all 142 sweep, 15 creation-form and 84 saved-editor captures were individually
reviewed, with no confirmed visual findings after exact-file rechecks.
Packaged unsigned arm64 acceptance passed exact document/sheet/slides creation,
same-name identity separation, malformed-payload retry, and canonical-body
recovery across a full relaunch, alongside the existing vault/input/export
checks. Signing/notarization and native Intel acceptance remain separate gates.

The current core checkpoint builds one remote HTTPS MCP tool called from an
interactive conversation through explicit owner approval, stable catalog and
argument identity, and a durable bounded result/uncertain-execution receipt
(MODEL-36). Both model transports share exact attachment, schema declarations,
argument validation and inert outcome history. Every call requires approval;
the running receipt commits before credential or network work, and an interrupted
call becomes durable uncertainty on restart rather than being replayed. Catalog
schemas compile in bounded, cancellable workers; no remote references are fetched.
Unsupported tools remain inspectable but cannot become model capabilities.
Conversation lifecycle preserves unresolved external work: deletion waits for a
running call, while summarization and copied fork history require proposed or
running calls to be resolved first. These guards protect the original durable
receipt instead of creating a second execution or an orphaned approval card.
Focused protocol, model, route-race and persistence tests accompany the workflow.
Checkpoint acceptance requires the complete verifier, responsive surface/account
matrix, packaged executable smoke and adversarial final diff review. The native
schema phase exercises the actual ASAR validator, including deadlines,
cancellation and capacity recovery; it is not combined third-party execution
acceptance. Broader trust, local transports and standing execution remain required
later work, not omissions. A real third-party acceptance target and any policy
that waives per-call approval require an explicit owner decision.

Structured artifact authoring now uses the same save proposal and exact-ID body
store as documents. Sheets carry literal rectangular values; slides carry ordered
titles and bullets. One strict shared parser bounds shape, counts and 20,000 total
UTF-16 characters before consent or persistence; invalid content is rejected as a
whole. Consent and saved pages share one renderer, including keyboard-scrollable
wide tables and wrapping long text. The HTTP/MCP read wall, rename/replay identity,
JSON/SQLite restart and portable-state validation preserve these actual bodies.
Owners can now correct a saved sheet or slide deck on its canonical page. One
local draft holds literal headers/cells/note or ordered titles/bullets, including
structural add/remove and slide reorder controls. Save replaces the complete
body against the revision reviewed when editing opened; Cancel leaves saved
content unchanged. Conflicts keep the draft beside the latest saved version:
explicit Retry replaces that version, while Dismiss keeps the draft editable.
Readers remain read-only, account changes clear held intent, and downloads wait
for the edit to finish. Prose and structured edits update the existing Edited
timestamp through one body commit, without advancing independent name ordering.
JSON/SQLite preserve edited bodies, timestamps and revisions without changing
names, grants or immutable save provenance. New slides begin without invented
blank bullets; explicitly authored blank values remain lossless. Spreadsheet calculation
and arbitrary layout/styling remain required. Structured standing-routine output
is implemented and verified under REL-13 / MODEL-29; the older wording here had
incorrectly continued to list it as missing.

Adversarial review closed two follow-on gaps: accepted body acknowledgements
refresh artifact metadata even when ambient sync is unavailable, and all new
authored names share the metadata validation boundary. Older invalid names stay
readable and can be renamed; edits and proposal landing cannot synthesize an
invalid metadata row that would prevent the next JSON/SQLite restart.

Saved slides now export editable PowerPoint files through explicit `format=pptx`
on the same read-authorized artifact export door. The fixed 16:9 design uses
native title and bullet objects, 32-point headings and 24-point body text. Dense
content continues onto marked pages instead of shrinking or dropping words;
no cover, images, external relationships or macros are invented. Source order,
literal Unicode and whitespace remain, with CR/CRLF mapped to native line breaks.
XML-illegal control units refuse the complete export without changing saved text.
The shared Office decoder now has separate XLSX (2 MiB) and PPTX (8 MiB) ceilings;
maximum accepted hard-break content exercises the PPTX size bound. Empty run
redundancy was removed after that limit test failed on unnecessarily large XML.
Independent package/layout validation and six individually reviewed imported
renders supplement behavioral and browser locks. These checks do not establish
native PowerPoint application acceptance or fidelity to arbitrary imported decks.
Arbitrary slide styling/layout, spreadsheet calculation, external execution and
signed-release acceptance remain required, not replaced by these export paths.

Saved sheets now have a real XLSX download through the existing artifact export
read. Explicit `format=xlsx` selects a values-only workbook; omission retains
Markdown compatibility. Headers, rows, empty strings, leading zeros, Unicode,
formula-looking text and the optional note retain literal string meaning, without
type inference or formula execution. Shared strings, wrapped cells, fitted widths,
a frozen header and filtering keep ordinary workbooks readable; Excel's own
409-point row ceiling can limit visible text without truncating stored cells.
Exact identity and current access are checked before serialization and again
after its async work. Browser and packaged downloads use the same portable API.
Independent workbook import/render supplements ZIP/XML and HTTP/MCP locks.
The bundled renderer does not faithfully display Xstring escapes or numeric-looking
literal text. A separate openpyxl read verifies the exact values, string types,
text formatting, frozen header and filter; contract tests cover all UTF-16 edge
cases. Actual Excel application acceptance remains unverified.

This checkpoint passes the complete five-lane verifier (324 browser tests), real
unsigned packaged-Electron acceptance, and the separate 135/135-cell responsive
sweep with zero violations or skips. The packaged download is compared byte for
byte with the authenticated API export; this is not evidence of a signed release.

Artifact renaming is an owner-only metadata workflow. Names have independent
revision ordering, while IDs, document bodies, links, filing, grants and immutable
save provenance remain stable. A routine refresh preserves the owner's display
name without changing its standing configuration. Original save proposals remain
recognized after renaming, including restart replay. Exact read/PATCH doors share
the HTTP/MCP wall, and late acknowledgements cannot rewind newer name or source
data. The inline editor holds its draft through conflict or transport loss and
uses the existing explicit Retry/Dismiss recovery. JSON/SQLite and portable-state
locks cover the additive metadata slice; deletion retention remains undecided.

The saved-document export checkpoint adds a fresh authorized Markdown download
to the canonical Content section for documents and draft emails, including
standing routine reports. It exports the latest saved revision, not an unsaved
editor or retained body cache. Browser retry/revocation checks and an actual
packaged Electron download complement serializer, identity and HTTP/MCP locks.
Addressed body/proposal readers now use exact IDs, preventing metadata-only rows
from borrowing demo text through a matching filename. Rich sheet/slide layout,
external tools and signed release remain required.
Legacy demo workspace previews receive explicit code-owned seed-ID projections
behind the live session read wall, never a generic filename fallback.
Artifact removal now follows approved default 3 above. Implementation must
preserve shared review history and define routine report regeneration behavior;
this earlier export checkpoint did not implement deletion.

Packaged acceptance exposed a send/detach race: the next turn could snapshot
old attachments while an earlier context update was still unacknowledged.
The shared composer now holds during pending/failed context intent, retaining
typed text; the transport boundary independently refuses overtaking sends and
keeps their logical retry. Delayed-detach browser and same-tick core tests lock
this ordering without hiding the defect behind a test-only wait.

The routine document-delivery checkpoint replaces metadata-only standing saves
with bounded model-authored report bodies. One stable routine binding preserves
the document across runs and renames, under the routine's actual tenant. Body
revision, synopsis, latest-run provenance and terminal status commit together;
empty/failed output preserves the last good document. Readers refresh metadata
and body through the artifact read wall without receiving private relation
payloads. The accompanying authorization fix walls every routine relation write
and filters foreign routine bindings from the graph. Direct store, route,
JSON/SQLite restart, failure-publication and live two-reader browser locks cover
this slice. Rich sheet/slide authoring, external tool execution and signed release
acceptance remain required, not replaced by this checkpoint.

The Project registry checkpoint extends the canonical discovery boundary to
authored Projects. The HTTP/MCP list and graph acknowledgements now share one
viewer projection, including current public prose and distinct org-member /
org-owner controls. Search includes directed grants without duplicate hits, and
the directory reflects description edits. Project and artifact UI merges use
one opaque-ID union. Model aliases distinguish owner edits from shared-project
commissioning; granting read access is not granting either write authority.
Shared-list guidance reflects that distinction. The visual sweep selects an
explicitly owned Project for owner-only sharing checks, never the first visible
row; independent reader walks still prove those controls are absent.
The follow-on live Project checkpoint adds an id-only scoped invalidation for
effective sharing, public-description, default-role and commission-cap changes.
Unsharing reaches former public readers; private hints use current read authority
on delivery and replay. Private relation payloads remain private. Canonical and
dependent Project reads refresh instead of trusting event content, and publication
follows durable commit. This does not change durable membership storage.
Store, HTTP/MCP wire, persistence and cache locks cover these boundaries; the
browser walk exercises already-open owner, granted-reader and public-directory
views through sharing, prose edits/clears, unsharing and revocation. Independent
discussion pages withdraw and reappear with their Project; the shared cache
clears authoritative API not-found results without erasing data on transient
failures. Project grant events reuse the same dependent-read refresh, so a
directed revocation also withdraws an independently opened discussion.
Checkpoint acceptance includes the complete verifier and responsive
sweep alongside these focused locks.
The full production goal and all remaining integration/release milestones stay
in force; shared interactive review still requires an unlocked Mac.

The authored-artifact discovery checkpoint closes a gap masked by the UI's
relation-graph merge: `GET /artifacts` and remote MCP now list actual authored
documents alongside fixtures. Current filing/unfiling is projected, same-name
IDs remain distinct, grant-only rows omit raw owner tenant identity, and the
model's filing catalog includes owned targets only. One ID union keeps UI and
body-cache projections duplicate-free while acknowledged creation stays
immediate. Grant/revoke refreshes already-open list and body reads. Focused
store/route/MCP locks and the five-viewport owner/shared/foreign browser walk
cover these boundaries; duplicate concatenation and omitted grant invalidation
were deliberately restored and observed failing. This is not a new rich-format
authoring engine or paid-model acceptance. Shared interactive preview review
still needs an unlocked Mac.

Each milestone records its implementation and behavioral locks in the spec
ledger, proves a relevant regression fails, runs the full verifier, and reviews
the diff before landing. Native changes additionally run the packaged executable
smoke; UI changes receive signed-in live review. Real-provider acceptance must
be identified separately from tests using the deterministic Messages fixture.

Revisit this order when a core journey reveals a blocker or the owner changes a
product direction. Do not treat the remaining partial cross-device requirement
as an instruction to harden every mutation before shipping useful desktop work.

The completed local-text checkpoint (`b31570a`) removes basename-based attachment loss:
same-named selected files now keep independent snapshots through preview,
reload, model input, and removal. Adapter regression tests were observed failing
before the fix, and a browser chooser walk verifies the complete text journey.
At that checkpoint, the full verifier passed all five lanes (277 browser tests), and packaged
Electron verification passed. Packaged attachment acceptance now crosses the
native reader and IPC into the actual renderer, endpoint transport, durable
conversation, and independent removal. Two same-name files retain their exact
IDs and bodies across relaunch after both source files are deleted. This phase
fixtures only the native dialog result and model response; the actual OS dialog
still needs manual review. It uses a separate profile because Playwright's
Electron launcher adds mock-keychain switches; real OS-backed storage acceptance
remains in the unchanged ordinary executable smoke. An intentional mutation of
the packaged native text return was observed failing at the rendered preview.
At the local-text checkpoint the shared preview was available, with all six demo
accounts stacked. Interactive OS-dialog review remains unverified: browser
file selection failed when the control tool lost the input node, and native
window actions were unavailable. These are limits of the review evidence, not
confirmed product defects; the packaged dialog-result-fixture acceptance above
must not be described as a manual OS-dialog pass.

The owner delegated sequencing on 2026-09-07: all planned core capabilities
remain required. Bounded local folder snapshots and direct-file PDF text imports
are built. The live-folder/Git read-access lifetime now follows approved default
1 above; remembered connections are not yet claimed as implemented. Image OCR, other
document formats, live access and remote inputs remain required; sequencing is
not a scope reduction. Signing/notarization credentials
and a download destination remain separate release prerequisites. Dependency
advisory checking also awaits permission to send dependency names and versions
to npm's advisory service; an attempted audit was denied and was not retried.

The DOCX increment adds the pinned `@zip.js/zip.js` 2.12.0 archive decoder and
its XML companions `saxes` 6.0.0 / `xmlchars` 2.2.0. They are required to keep
ZIP/XML parsing bounded and isolated in the renderer worker; their exact
third-party notices are emitted into both distributions. The saxes npm tarball
omits its license, so the exact v6.0.0 upstream text is vendored with a strict
version gate rather than silently reused for a future upgrade. Any dependency
upgrade requires a deliberate notice and bundle-budget review.

## Open verification follow-ups

Read-only MCP inspection now recovers once when a legacy peer expires its
initialized session during catalog listing. It retires the old private ID,
initializes without it, and restarts the catalog without old pages or cursors.
The deadline, page attempts, processed tools and catalog bytes remain cumulative;
stateless/modern/authentication failures never renew, and no tool call is replayed.
HTTP peers cover all supported legacy versions and bare/correlated 404s. Focused
tests cover cancellation, concurrent calls, replacement metadata and cleanup;
intentional regressions in renewal, both size budgets and metadata each failed
their locks before restoration. This completes a discovery recovery path, not
MODEL-33's schema semantics, trust policy, durable execution receipts or actual
third-party acceptance. Production loopback and the new validator dependency
still await owner decisions.

The first complete gate caught the shared PPTX contrast scan accepting the old
phone overlay during a phone-to-tablet resize. The three Office walks now share
one readiness helper that proves the exact rendered tier, full ancestor opacity
and stable geometry across paints before the unchanged WCAG scan. A traced full
run also exposed a relay image test accepting its deliberately short parking
window's idle sentinel as a prompt; that test now follows the protocol's
argument-free wait before inspecting the complete image-bearing content. Neither
repair changes product colors, motion, relay behavior or acceptance thresholds.
The wrong-tier assertion and bypassed idle wait were each observed failing at
their exact rendered-tier/image-content locks before restoration.
The previous accounting checkpoint `f820afd` is green in GitHub run `34246731218`.

The per-call accounting checkpoint closes a demonstrated loss of usage when a
completed model response was followed by cancellation, failed compaction, or a
later provider error. Reply, routine and compaction drivers now persist each
completed call before tools or more model work; returned totals cannot be
recorded again. Session-provider counts remain character-based estimates, now
accumulated per completed response rather than only the last round. Failed
accounting stops the loop and cannot trigger an automatic routine retry.
Endpoint, route and routine failure-first tests expose the old missing reports
and retry behavior. JSON and SQLite process-restart tests preserve an exact
completed-call count after a subsequent provider refusal. Partial streams with
no complete response, provider invoices and concurrent reservations remain
separate accounting gaps; subscription ceilings and access policy are unchanged.

The PPTX increment extends direct-file input to bounded slide-text snapshots
using the existing Office ZIP/XML worker and dependencies. Presentation order
and original slide numbers are retained; within each slide the import follows
file order, not guaranteed visual reading order. Ordinary text boxes and table
cells contribute text; hidden slides/shapes, speaker notes, comments, master or
layout text, charts, images and animations do not. This is not a slide renderer
or presentation editor. The file/selection/archive/XML/text limits remain those
of the shared Office path, with a separate 128-slide ceiling and no partial
success. Browser and native intake now each use one format-adapter table and
one bounded read path, keeping admission checks consistent as formats expand.
Manual signed-in preview and OS-dialog review still require an unlocked Mac;
deterministic provider fixtures are not paid-model acceptance.
The targeted 13-test browser gate covers all four document types, including
PowerPoint owner/shared previews at all five viewports, the foreign-tenant wall,
exact model-text parity, reload and detach. Review tightened ordinary text
recognition to exact XML paths: extension/compatibility branches cannot import
familiar-looking text tags, and hidden owner flags mask the complete subtree.
An intentional path-admission regression leaked the test's extension marker
and failed the new lock before restoration. Shared intake overread, native
PPTX admission and model/copy locks also have observed failure-first evidence.

The XLSX checkpoint extends the first-conversation path with bounded visible
worksheet values, exact sparse cell addresses and explicit cached-formula
labels. It never calculates formulas, reveals hidden sheet/row/column content,
or retains archive bytes or file access. Dates and formatted numbers may remain
raw stored values; this is not a spreadsheet editor or calculation engine.
It uses the existing pinned ZIP/XML dependencies, with one shared Office worker
and package reader for DOCX/XLSX. Limits remain 8 MiB/file, 24 MiB combined
document selection and 64 KiB output; workbook structure additionally caps
32 sheets and 10,000 cells/shared strings. The existing bundle budgets remain
unchanged. Parser regression checks caught empty cached strings being reported
as absent and zero dimensions being missed under alternative numeric spellings;
both now have failure-first locks. Acceptance exercises preview/model parity,
shared read-only views, the tenant wall, persistence, relaunch and detach.
The Mac remains locked, so shared signed-in preview and manual OS-dialog
handoff are still unverified; isolated automation is separate evidence.
The browser review also exposed two recovery/copy gaps: failed module imports
are cached, so the local picker now offers an explicit reload with unsent-text
guidance; a resolved provider registry missing a shared conversation's private
model must report unavailable access instead of an endless checking state.

The usage checkpoint replaces restart-reset plan meters with tenant-owned
durable counters and original period anchors. Existing ceilings and demo gauges
are unchanged; clean/new accounts start at zero, and older snapshots acquire
their world-appropriate baseline once. JSON/SQLite restart locks cover exact
spend, independent five-hour/weekly resets, tenant isolation, invalid-state
refusal and failed-write fencing. Packaged acceptance now compares a real
completed fixture-provider turn's exact counters and anchors across relaunch.
These are local operational counters: provider invoicing, unreported in-flight
spend and concurrent-call reservations remain separate accounting work, and an
explicit older backup restores its recorded counters along with other data.
Intentional regressions proved that removing the usage commit, retaining stale
tenant meters on rehydrate, admitting malformed usage, or dropping the packaged
restart assertion each fails its corresponding lock; all were restored.
Review also removed read amplification: checking a new tenant's gauge or gate
does not retain an empty meter; its first reported spend establishes the period.
The store-level lock also failed when read-time retention was reintroduced.
A second failure-first lock caught rejected first-turn counts retaining an empty
tenant. Registry recording now validates before publishing any new tenant meter.

Live native MCP inspection/replacement acceptance still needs an approved public
HTTPS test endpoint. Production loopback remains disabled; the existing native
MCP smoke's offline seeded catalog is not live discovery evidence.

The legacy SSE resumption increment keeps one logical request through bounded
read-only GET recovery: at most eight connections, one original deadline and
cumulative response-byte budget, exact private cursor/session/audience, and no
POST replay. Server retry intervals are honored; cancellation during backoff or
an active GET keeps the original request's uncertainty and exact cancellation
identity. Local peers cover all supported legacy versions, initialization and
stateless streams, while modern requests remain non-resumable. This advances
the protocol substrate only; schema semantics, attachment, approval, durable
call receipts, execution-specific expiry recovery and actual service acceptance remain.
Intentional mutations proved the GET cap, shared byte budget, modern no-resume,
complete-event cursor and server retry locks fail before restoration. The prior
cancellation checkpoint `ddd2217` is green in GitHub run `34225716157`.
The resumption checkpoint `cd55070` is green in GitHub run `34228524077`.
The durable-usage checkpoint `976a142` is green in GitHub run `34232137832`.
The XLSX checkpoint `f968958` is green in GitHub run `34238430612`.

The explicit MCP cancellation increment notifies a legacy peer of the exact
submitted tool/list request when user cancellation wins. The control POST is
limited to one second inside the original deadline, cannot replay a tool, and
cannot replace the original outcome even if notification delivery fails or the
deadline expires. Completed responses and unsent requests never trigger it.
This removes a protocol gap; it does not establish remote rollback, enable
execution, or resolve the pending schema/trust/network choices. Its deadline
and outcome-preservation regressions were observed failing under intentional
mutations before restoration.

The MCP session increment shares protocol negotiation, the absolute deadline,
and private legacy cleanup between read-only discovery and one tool attempt.
It keeps known tool outcomes when cleanup fails and prevents scope reuse or
implicit call replay. Review found and fixed a late-cancellation race that
discarded an already-complete transport response; its regression was watched
fail first. This remains an unconfigured execution substrate, not a completed
external-work journey. Execution-specific session-expiry recovery, schema
semantics, approval, durable receipts and actual service acceptance remain.

The single-call MCP increment adds bounded request/result parsing and modern
body-derived parameter headers behind an unconfigured protocol boundary. Local
HTTP/SSE peers cover supported modern/legacy replies, tool errors, malformed
results, cancellation before/after submission, and refusal without replay or
continuation. Full schema semantics, per-call approval, durable uncertainty,
execution-specific session-expiry recovery and actual model execution remain required. No
third-party account or new dependency is involved in this increment.
Independent review found that the older HTTP request snapshot invoked caller
serialization hooks. The same strict JSON helper now owns that transport path;
the new regression was observed executing two hooks before the fix and none
afterward. Intentional mutations also proved the depth, result-admission,
static-header-path and post-submission uncertainty locks fail.

The native MCP acceptance increment now covers replacement-token reconciliation
after an offline binding switch, real vault-publication failure during a durable
disconnect, explicit cleanup Retry, unrelated provisional preservation, and
removal/orphan cleanup through relaunch. The rebuilt complete desktop verifier
passes, including this real Electron/OS-encryption phase. A focused filesystem regression was
observed failing when in-memory state advanced before durable publication, then
passing after restoring the runtime. No production policy or runtime behavior
was changed. Live inspection/replacement and interrupted acknowledgements remain
combined acceptance gaps; the offline catalog fixture does not prove them.
The exactly pinned, backend-only JSON Schema validator dependency decision has
been requested; it has not been treated as approval to install a dependency.
The first complete gate caught a native-smoke link in a context field reserved
for test/spec files, plus a browser fixture healed while inspection was still
pending. The latter's saved page already showed a successful catalog, not a
missing product Retry. A held-request reproduction fails when the peer heals
early; the repaired walk proves pending has no Retry, then waits for actual
failure before healing the peer. Both MCP form/layout tests pass unchanged
timing/retry limits. Prior main `fffb678` is also green in GitHub run `34214623391`.

The current lifecycle review closes stale list/detail acknowledgements, exact
removed-row recovery while native cleanup is pending, dismissible upstream
inspection refusals, and account-switched form admission. Project context
sources now retain their opaque identities through both page and rail doors;
foreign/phantom source admission is refused and label/source action keys cannot
alias. Shared-project owner-context redaction was already correct and gained a
behavioral lock, not a speculative runtime change. The new dialog, recovery,
empty/error catalog and same-label project browser tests exercise real routes
with test-owned protocol peers; production loopback policy is unchanged.

Focused packaged acceptance now runs inside the complete desktop verifier and
the extracted-release smoke, with its helpers excluded from ASAR. The frozen
unsigned arm64 artifact passes real authentication/Keychain, provider lifecycle,
text/folder/PDF/DOCX/image, and MCP credential acceptance. Its runtime and emitted
UI byte-match that checkpoint's workspace. Its full Node suite passed 2,854 tests. The frozen
responsive sweep passes all 135 cells with zero violations or skips; its first
run lost a navigation context and covered only 120/135 cells, so that run is not
a pass. The first combined single-shard gate passes checks and 295/300 browser
tests. Retained traces prove the five refusals hit the shared seeded tenant's
exhausted model quota before generation. History, image, PDF and responsive
send walks now own independent usage partitions, while the phone panel walk
explicitly returns to its separate seeded fixture. Production quotas, assertions,
timeouts and retries are unchanged. The follow-up single-shard run passes all
five repaired tests and 299/300 overall; its sole failure is an accessibility
scan interrupted by a concurrent documentation edit. The saved Vite websocket
message names `docs/mcp-client.md` as the full-reload trigger. This is workflow
interference, not a backup-panel defect or a reason to weaken the scan. The
entire workspace, including documentation, must remain quiescent during the
final complete verifier. The final frozen rerun passed all five lanes and all
300 browser tests before `fffb678` landed. The shared Mac remains locked.

Final credential review added two fail-first locks: a connected native channel
must reject startup synchronization errors rather than acknowledge ordinary
storage unavailability, and the renderer must validate the exact tenant/server
binding before provisioning a token. Credential-only validation stays on the
lazy native ceremony path, within the unchanged startup bundle budget.

GitHub run `34201856978` at `9caa11a` failed the live-pane pruning test after
the shared five-hour model quota was exhausted. The test now forks a completed
seeded exchange through the actual API, verifies its persisted messages, and
keeps the same split/delete assertions. Deletion-layout acceptance no longer
depends on unrelated model quota; this does not retroactively pass the old run.

The active core workflow is a real external MCP connection (MODEL-33). Saving,
inspecting, refreshing, disconnecting/reconnecting, and removing a connection
now cross real tenant-scoped routes and the UI. Desktop startup and provision-only
credential wiring are implemented; focused native acceptance proves real OS
storage, relaunch binding reconciliation, ordinary-read secret exclusion, and
disconnect cleanup without contacting an external service. The full
[MCP client plan](mcp-client.md) retains semantic schema validation, attachment,
explicit trust, durable uncertain-call recovery, and combined real-service
acceptance as required work. The owner has been asked
about per-call approval before explicit server trust; no answer has been
assumed. No real third-party account was contacted during these tests.
The preceding transport/discovery checkpoint passed the full five-lane verifier with all 292
browser tests. Focused regressions were observed failing for unsafe resolved
addresses, mismatched response IDs, success-shaped HTTP errors, CRLF byte-budget
undercounting, and environment-disabled TLS verification before their fixes.
The CI coverage-output test executes both intact and deliberately degraded
temporary runner copies; no real browser failure is claimed repaired by it.

Word revision `809274a` passed the full local verifier, but GitHub run
`34188381547` failed its browser coverage gate at 145 passes against 146 expected
in partition 1/2; checks and partition 2/2 passed. The successful Playwright exit
caused the runner to hide its output, and no browser artifacts were retained.
A retry-only pass is a plausible cause, not a proved one. CI now explicitly
fails flaky tests, keeps first-attempt traces and uploads only failed browser
artifacts for three days; coverage mismatch also prints the affected lane tails.
This fixes missing evidence, not the unknown underlying browser failure.

The next run, `34190219926` at `4a10c03`, retained the missing evidence:
partition 1 failed because the real Word-import journey passed only on retry;
checks and partition 2 passed. Its first-attempt trace shows a document reload
while the lazy DOCX worker discovers ZIP/XML dependencies. The optimized React
dependency hash changes across that reload, and no attachment write occurs.
The final page has neither a picker nor an attachment. A new cold-cache Vite
scan regression independently fails because the worker's ZIP dependency is
absent from the initial scan. The cold-cache browser reproduction also logged
the optimizer's explicit reload and failed the no-reload assertion. The
repaired Vite scan includes `index.html` and all source worker entries. Its
cold-scan lock and the browser journey now pass; the journey always owns a
fresh cache and a strict, shard-derived UI port. Runtime parser loading remains
lazy. No timeout or retry policy was widened.

The preceding MCP transport increment added a read-only discovery transaction with the
current metadata flow and three supported legacy initialization versions. It
uses one deadline, bounded pagination and an inert catalog snapshot, and closes
legacy sessions when possible. Wrong-id modern errors cannot trigger a false
legacy fallback; cancellation closes live sockets. These are tested protocol
boundaries, not evidence of tool execution. The current lifecycle increment
adds routes, user inspection and native vault wiring; semantic schema validation,
approval and execution remain required. Release fulfilment is still unconfigured.

GitHub run `34193269086` at `ea27486` completed with checks and E2E1 passing
and E2E2 failing. Its account-switch trace proves a different race: the session
read still names an active turn, that turn finishes before the stream reattach,
and the 404 recovery settles the controller before the authoritative session
refresh. The saved assistant reply exists but the UI retains a false interruption.
The repair makes that handoff one bounded, identity-fenced truth read before
releasing the composer or exposing Retry. A deterministic browser lock exercises
the missing real stream handle at all five canonical viewports; controller
locks additionally cover held reads, failed reads and history continuity.
This does not retroactively make the failed CI run healthy.

The associated review also found two concrete recovery risks: a delayed HTTP
body could cross an account switch after the header-time identity check, and
an indefinitely stalled reconciliation read could keep the composer busy.
The repair fences body completion and session-cache publication, and gives the
read a 30-second abortable deadline without retrying the send. Late and failed
reads cannot clear recovery or restore an outgoing account's session.

Packaged validation during this increment observed the PDF-detach reply missing
after the preceding authentication/Keychain, text, folder and Word phases passed.
A diagnostic run completed every packaged phase, but did not establish a cause.
The smoke now retains private, bounded best-effort failure evidence for that
exact handoff. A later packaged run recurred and captured an empty composer,
an acknowledged empty attachment list, and no new message/model request. A
held-acknowledgement browser regression then proved that removing a context
could remount the composer and erase unsent input. The repair keeps memory-only
text in the existing account-scoped conversation state and reconstructs its
multiline height after remount; it does not add browser or server persistence.
Explicit reset, submission and account disposal still clear that private text.
The rebuilt packaged executable now passes authentication/Keychain, text,
folder, Word, PDF and image acceptance, including the previously failing
PDF-detach send. The browser walk also exposed a 20px revealed rail filter
target; its shared owner is raised to the existing 24px accessibility minimum.
The five-viewport browser regression now passes multiline draft restoration,
single-send behavior and WCAG 2.2 AA checks, including same-document desktop
navigation. The full responsive sweep also passes all 135 cells with zero
violations or skips. The complete repository verifier remains the final gate
after review corrections; the locked shared Mac still prevents interactive
preview handoff.

The checkpoint's first complete gate caught the component index crossing its
line budget and a credential-channel test depending on a 10ms wall-clock race
under suite load. Redundant context prose was condensed without removing rules.
Credential timeout/order tests now advance the test clock explicitly; removing
the stale-completion identity guard still makes the request-ID-reuse lock fail.
Production deadlines and retry policy are unchanged.
Final review also caught coercive enum/ID admission in the MCP registry. Array
and boxed-string regressions were observed failing; scalar-only validation now
rejects those malformed records without replacing the saved registry.

The combined discovery/cold-import checkpoint passed all five verifier lanes in
147.1 seconds: 2,727 Node tests, typechecking, the production build and all 292
browser tests. The 47 focused MCP checks also pass. Regression proofs included
malformed modern JSON/SSE error recognition, version selection, cursor loops,
legacy cleanup, and the actual cold-cache browser reload. An initial full run
caught the added context rule exceeding its index budget; the historical prose
was condensed without removing rules, and the complete gate was rerun green.
Hosted CI confirmation belongs to the new pushed revision; the preceding failed
run is not retroactively marked healthy.

The PDF text increment uses exactly pinned PDF.js as a renderer-only lazy
parser, rather than hand-parsing an adversarial document format. It saves
bounded extracted text and explicit outcomes, never original PDF bytes. The
existing 500,000-byte UI chunk/async and 800,000-byte initial-graph gates remain
unchanged; emitted worker JavaScript has a separate aggregate 1,400,000-byte
gate (PDF.js worker baseline 1,220,555 bytes). Splitting workers cannot bypass
the aggregate gate. Closing intake cancels attachment and parsing, and releases
unattached image previews in mixed selections. OCR/layout/images and PDFs
inside folder imports remain outstanding, not claimed by this increment.
The build carries the installed PDF.js license and upstream notice into both
distributions; its renderer-only package is not copied into the native backend.
The rendered PDF walks cover Unicode and compressed text, genuine password
protection, empty/invalid/oversized documents, limits, cancellation and a stalled
worker. Packaged acceptance covers actual native bytes, the worker, exact model
text/metadata, relaunch without the original PDF and detach. Review caught and
locked stream-cancellation errors and unacknowledged cancellation; the complete
responsive sweep passes 135/135 cells with no violations or skips.

The DOCX increment follows the same path with a dedicated ZIP/XML worker: only
paragraphs, table cells, tabs and line breaks become bounded text; images,
layout, headers/footers, notes/comments and revision history, `.doc` and `.docm` remain
explicitly unsupported. Its archive, expansion, XML-depth/node, selection and
UTF-8 text limits are locked in pure extraction, browser/native picker, model
input and packaged smoke tests. The combined worker budget is now 1,400,000 B
(measured DOCX+PDF total: 1,309,617 B); the 500,000 B physical chunk and
800,000 B initial-graph limits remain unchanged.

Word acceptance now covers owner/shared/foreign views, 15 ready/omitted/shared
viewport states with WCAG scans, cancellation, the actual worker deadline, and
the packaged native reader/IPC/model/relaunch/detach journey. Source-file removal
before relaunch proves the saved body is durable. Exact-byte, moved-revision,
worker-loader, termination, strict-outcome and distribution-notice regressions
were observed failing before repair/restoration. The responsive review also
found a 2.54:1 grouped-chip count: its shared style now retains full contrast,
locked as UI-132. These are bounded document-text claims, not OCR, page-layout,
paid-model, manual native-dialog, or signed two-architecture release acceptance.
Final diff review also caught the new DOCX ledger row replacing the existing PDF
row. A reference-integrity lock was observed failing on the missing CTX-FS-12
before restoring the PDF row; both formats now retain their own requirement.

The bounded image-input path is implemented but is not a claim of overall
production readiness. It accepts PNG/JPEG/GIF/WebP in the browser/Electron
boundary (8 MiB raw), normalizes the first frame at a maximum 2,000 px edge to
PNG (≤3 MiB), and stores immutable tenant-scoped asset references durable in
SQL and portable backups. A turn may carry at most 8 images and 8 MiB, in
addition to the shared 24-item attachment plan. Endpoint requests carry
first-class image blocks; Session relay negotiates `images=1`, while old relays
omit images and receive honest metadata. Owner-context walls and shared-view
image reads are enforced. Packaged executable image smoke and the full
135/135-cell responsive sweep pass, including explicitly opened removal
confirmations. Ready, rejected, and shared image previews were reviewed at all
five canonical sizes. The review also corrected clipped Commons mention help,
complete-selection queueing, image containment, and error-text contrast, with
lasting source and browser locks. The complete repository verifier gates
landing. The shared preview cannot be handed back interactively while the Mac
is locked; unlocking has been requested. OCR, SVG/BMP/ICO, other document formats, live folder/Git and
remote-source input, paid-provider acceptance, manual OS-dialog review, and
signing remain outstanding.

The folder checkpoint imports real, bounded top-level text snapshots through
the same native/browser policy and model-input plan. Equal-named folders keep
independent identities through reload and removal. Hidden files and subfolders
are excluded; unsupported, oversized and unavailable content is explained rather
than replaced with demo bodies. Packaged acceptance proves native reading, IPC,
model delivery and relaunch after the source folder is removed, while retaining
the existing separate OS-backed storage smoke. Dialog results and model replies
are test fixtures; actual OS-dialog and paid-provider acceptance remain manual.
The initial-bundle lock rejected this increment at 803,567 bytes. Deferring rich
workspace rendering restored the unchanged 800,000-byte ceiling; chunk failure
stays within the workspace and offers an explicit reload. Five-viewport folder
review added first-line and omission-notice visibility locks and corrected the
short-window file-list height. No release signing or dependency-advisory gate is
claimed complete by this checkpoint.

The five-viewport UI review exposed a semantic coverage defect: the cell named
`thread-demo` captured a blank draft, while the `draft` cell could restore the
previous repo conversation. The sweep now must discover a populated non-repo
conversation and await its exact heading/transcript, and explicitly open a fresh
draft before measuring it. Missing subjects count as coverage failures. The
conversation check closes covering panels before capture; executable detection
tests distinguish a closed zero-width tablet dock from a live one. A duplicate
UI invariant identifier was also corrected, with a structural lock against
recurrence. On 2026-09-07, the corrected sweep passed all 135 cells across five
viewports with zero violations and zero skips; all ten corrected conversation
and draft captures were visually checked. The regression locks were watched fail
before restoration. Live account switching was also checked, and the shared
preview was returned to Ada with the six-account roster stacked.

The earlier Commons mention-help clipping refinement was resolved in the image
checkpoint described above; it is no longer an open direction or prerequisite.

One full local run of `e2e/agent-proposal-verdict.spec.ts` observed a Review
button click without its dialog remaining open. Ten focused traced walks passed;
the cause is unconfirmed, not fixed by that repetition. First-failure tracing
(`E2E_TRACE=1 npm run verify`) is now available to capture a recurrence without
adding retries or extending timeouts. Keep this observation open until evidence
identifies its cause.

A traced full run also observed the phone drawer stop accepting a session-row
click while the main pane intercepted it. Five focused walks with explicit
drawer-state assertions and the next complete run passed, but no runtime cause
or fix has been established. Keep this observation open too. The diagnostic run
separately proved that parallel Playwright processes shared trace scratch space;
each shard now owns its output directory, and the subsequent traced full run
completed without artifact collisions.

During the Word checkpoint, one full run observed the sharing-guidance node
detach during `scrollIntoViewIfNeeded`, after filling its associated note.
The failure did not capture a trace; no runtime cause or product fix is claimed.
Keep this observation open for first-failure tracing rather than masking it
with retries, a longer timeout, or an accessibility exclusion.
