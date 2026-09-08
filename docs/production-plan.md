# Desktop preview plan

Reviewed 2026-09-07. The standing goal remains production readiness for Agent
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

## Progress and next milestones

| Milestone | Evidence and remaining work |
| --- | --- |
| Trustworthy local host | Sandboxed Electron, clean first run, SQLite, managed backups/restore, provider-key lifecycle, and native recovery are built. The signing root now persists separately from product data; packaged acceptance covers sign-in, token recovery, and a completed conversation across a full restart. |
| Useful first conversation | Provider onboarding and the Messages transport are built. Local text reaches both endpoint and Session transports as whole files (64 KiB per file, 128 KiB total, first 24 items), with shared-plan UI and one input snapshot reused through the tool loop. Browser/native intake shares source/configuration recognition and strict whole UTF-8 decoding. Bounded top-level folder snapshots (CTX-FS-11), direct-file PDF text extraction (CTX-FS-12), bounded DOCX text extraction (CTX-FS-14), and the bounded image path now extend the same input plan. DOCX is limited to 8 MiB/file, 24 MiB/selection, 512 entries, 4 MiB parts, 16 MiB expanded content, 128 XML depth, 128 attributes/tag, 100,000 nodes and 64 KiB body text; it excludes images/layout and legacy or macro-enabled Word files. Images accept PNG/JPEG/GIF/WebP up to 8 MiB raw, normalize the first frame to PNG at a 2,000 px maximum edge and ≤3 MiB, retain durable tenant-scoped asset references, and deliver at most 8 images/8 MiB per turn alongside the shared 24-item plan. OCR, other document formats, live folder/Git and remote-source input remain the FWD-9 gap. Targeted text/PDF/DOCX/image tests, packaged executable smoke and the 135/135-cell responsive sweep cover this bounded path. Shared interactive preview handoff still awaits an unlocked Mac. Provider proof is deterministic protocol evidence, not paid-model acceptance. |
| Useful external work | Connector/MCP execution has a real consent and authorization boundary but release fulfilment remains unconfigured. Select and deliver one real adapter and discovery workflow before broadening the catalog. Repository content/git and some imported artifact renderers remain declared fixtures. |
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

The next core workflow is a real external MCP connection (MODEL-33). Its
bounded HTTP/DNS/TLS/JSON/SSE substrate is implemented and tested against local
protocol peers, but is not exposed through routes or model execution. The full
[MCP client plan](mcp-client.md) retains negotiation, discovery, secret lifecycle,
explicit trust and durable uncertain-call recovery as required work. The owner
has been asked about per-call approval before explicit server trust; no answer
has been assumed. No real third-party account was contacted during these tests.
This substrate checkpoint passed the full five-lane verifier with all 292
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

Filed visual refinement (S4): at 375×812 in Commons, the empty post composer's
long mention-help placeholder wraps beneath its one-row textarea and is partly
clipped. Reproduce via Commons with an empty post composer. The accessible name
remains present; shorten the placeholder or expose mention help outside the
field when this surface is next revised. This does not block the core desktop
integration milestone.

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
