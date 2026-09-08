# Desktop preview plan

Reviewed 2026-09-08. The standing goal remains production readiness for Agent
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
- Ask before selecting an updater policy or materially widening the supported
  external integration scope.
- Sequencing is delegated: all planned core capabilities remain required;
  prioritize complete, verifiable workflows without dropping later milestones.

## Progress and next milestones

| Milestone | Evidence and remaining work |
| --- | --- |
| Trustworthy local host | Sandboxed Electron, clean first run, SQLite, managed backups/restore, provider-key lifecycle, and native recovery are built. The signing root now persists separately from product data; packaged acceptance covers sign-in, token recovery, and a completed conversation across a full restart. |
| Useful first conversation | Provider onboarding and the Messages transport are built. Local text reaches both endpoint and Session transports as whole files (64 KiB per file, 128 KiB total, first 24 items), with shared-plan UI and one input snapshot reused through the tool loop. Browser/native intake shares source/configuration recognition and strict whole UTF-8 decoding. Bounded top-level folder snapshots (CTX-FS-11), direct-file PDF text extraction (CTX-FS-12), bounded DOCX text extraction (CTX-FS-14), bounded XLSX visible-value extraction (CTX-FS-15), bounded PPTX slide-text extraction (CTX-FS-16), and the bounded image path now extend the same input plan. DOCX is limited to 8 MiB/file, 24 MiB/selection, 512 entries, 4 MiB parts, 16 MiB expanded content, 128 XML depth, 128 attributes/tag, 100,000 nodes and 64 KiB body text; it excludes images/layout and legacy or macro-enabled Word files. Images accept PNG/JPEG/GIF/WebP up to 8 MiB raw, normalize the first frame to PNG at a 2,000 px maximum edge and ≤3 MiB, retain durable tenant-scoped asset references, and deliver at most 8 images/8 MiB per turn alongside the shared 24-item plan. OCR, other document formats, live folder/Git and remote-source input remain the FWD-9 gap. Targeted text/PDF/DOCX/image tests and XLSX acceptance, packaged executable smoke and the 135/135-cell responsive sweep cover this bounded path. Shared interactive preview handoff still awaits an unlocked Mac. Provider proof is deterministic protocol evidence, not paid-model acceptance. |
| Useful external work | Bounded MCP transport/discovery now composes with tenant-owned lifecycle routes, a Contexts setup/catalog/recovery workflow, exact inspection receipts, and provision-only OS-encrypted desktop credentials. Startup reconciles persisted bindings before admission; disconnect/removal cleanup is independently retryable. Browser protocol fixtures and focused packaged OS-storage acceptance prove these boundaries, not third-party tool execution. Schema semantics, attachment, approval, call receipts, and model execution remain required; release fulfilment is still unconfigured. Repository content/git and some imported artifact renderers remain declared fixtures. |
| Distributable preview | The paired release verifier is built; both architecture candidates still need actual signing/notarization credentials, native execution evidence, and an authenticated download destination. A green browser CI run does not prove a signed release exists. |
| Hosted service | Preserve the boundary now; defer anonymous indexing, broad cross-device polish, and deployment-specific tenancy operations until the desktop preview's core workflows pass. |

## Checkpoint criteria

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
are built. The live-folder/Git read-access lifetime decision awaits the owner:
remember a read-only connection until disconnected, or select
it again after each relaunch. No answer has been inferred. Image OCR, other
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
