# Desktop preview plan

Reviewed 2026-10-16. The standing goal remains production readiness for Agent
Commons, with desktop first and a hosted service later. Progress is judged by
complete user workflows and release evidence, not the number of hardened
mutation paths. Routine refactors and recovery work should support these
milestones or address a demonstrated defect.

Current implementation checkpoint: the receiving owner can answer an Agent
request directly, without first running an unrelated MCP call or configuring
a model provider. The reply-first page mounts private tool inspection only
after explicit Use a tool. Reply review freezes both exact text and request
revision; a changed request requires fresh review. Pending tool/model work,
cancellation and stale/person-mismatched decisions cannot share. Direct replies
persist with explicit private provenance and no fabricated execution receipt;
legacy post-call rows keep their existing shape. Restored waiting requests may
receive text without reopening execution, subject to exact history capacity
instead of retroactively reserving new bytes on old snapshots. No model-written
reply, automatic tool use or cross-person credential authority is added.
Focused state/route/persistence and UI locks, rendered five-viewport owner /
requester / unrelated-person walks, the separate UI sweep, complete local
verification and unsigned packaged relaunch acceptance are required before
landing this checkpoint. Focused browser review caught a private-request 404
being presented as a connection failure; the direct by-id page now opts into
the shared existence-hiding unavailable face. Both the source and rendered
regressions failed before that fix. An earlier screenshot wait was corrected to
measure the enabled editor, not an intentionally dimmed empty Review button;
its disabled-state assertion remains. The expanded stale-review capture then
caught 3.58:1 alert contrast. All request-page validation/stale errors now use
the existing semantic danger-text token, with a source enumeration lock and
unchanged WCAG assertions. The pre-correction complete unsigned arm64 desktop
run passed, including direct reply/no model or tool I/O and exact signed-in
relaunch; final gates below remain required after the color correction.
Paid-provider tests remain deferred. The owner-preview
handoff remains unavailable under the existing in-app browser URL policy.

Previous implementation checkpoint: the provider-priority audit found permanent
authentication/configuration refusals being described as outages and retried by
Routines. Shared generation now emits safe status-specific recovery advice and
a terminal provider-rejected cause for 4xx except 408/409/429, plus unavailable
local connection settings. Both Messages and Responses preserve prior prose,
usage and tool proposals after a refused continuation. No raw provider error
body, credential or private URL is reflected. Routines fail without a retry
deferral; the existing bounded transient policy is unchanged. Authored loopback
tests reproduced the old classification and retry defect before repair.
The 141 focused protocol/Routine/documentation checks and complete unsigned
arm64 desktop acceptance passed. The first browser attempt exposed a test
selector using the raw model ID after catalog refresh supplied a display name;
the corrected selector uses that rendered name and verifies the exact saved ID.
The next rendered assertion caught literal underscore emphasis in the new note;
it now uses the renderer's supported asterisk syntax, keeping the exact browser
text assertion as the lock. The focused browser walk now passes, including exact
stored text, reload, one generation request and five-viewport captures reviewed
without further visual findings. Complete local and unsigned desktop verification
on the final revision are required before landing; paid
provider tests stay deferred. The owner-preview handoff remains unavailable
under the existing in-app browser URL policy.

Previous implementation checkpoint: provider connections expose a bounded per-call
Reply output limit shared by Claude/DeepSeek Messages and native OpenAI Responses.
New setup explicitly starts at 8,192; legacy absence retains former protocol
defaults. The private value is revisioned and persisted, with a server-derived
safe read annotation and connection-only cache merges. Protocol edits pin the
reviewed value; unrelated sparse edits preserve it. Both wire fixtures retain
the cap through continuations. Exhaustion records usage, preserves prior effects,
rejects tools from the incomplete response and offers actionable guidance with
no automatic retry. Dedicated tool-free operations retain their own task limits;
the cap is neither catalog capability nor total-spend control. Restoring the old
hardcoded limits and generic truncation note failed the new runtime locks. Route
bounds, cache-domain and malformed-snapshot locks also failed before repair.
JSON/SQLite/restart fixtures preserve the exact value and ignore forged stored
read annotations. First browser acceptance caught the field help being folded
into its accessible name; the shared explicit-label/description pattern now
keeps the short name separate, with the exact-label browser assertion as a lock.
The focused browser checks passed 10/10, the UI sweep passed 135/135 with no
violations or skips, the full local verifier passed all five lanes and 754
browser tests, and the unsigned arm64 desktop gate passed. Revision `10d86238`
landed on main. Paid-provider acceptance
remains deferred, and the owner-preview handoff remains unavailable under the
existing in-app browser URL policy.

Previous implementation checkpoint: configured endpoints remain usable for explicit
Agent and conversation model choices when model listing is unavailable. One
framework-free selection projection uses the authoritative catalog when present,
or only the available endpoint's exact server-stamped configured model otherwise.
It invents no catalog, capabilities, price or token limits. Dispatch, Project work
and MCP argument drafting, Commission MCP approval, and the shared conversation /
Routine / Customize picker consume it. Server admission derives the same choice
from private connection truth; model-only rotations clear obsolete session picks,
and queued explicit Routine choices fail closed if their model disappears.
Catalog-less owner pages expose the existing revisioned Refresh recovery.
No new persisted field, routing fallback, or tool authority is introduced.
The stale queued-model regression was watched fail before repair; restoring
catalog-only server admission or bypassing the shared picker projection also
fails the new locks. Focused protocol/store/source checks and all 16 affected
browser checks pass. Fifteen five-viewport setup/Dispatch/picker screenshots were
reviewed without actionable visual findings. The build caught an 82-byte startup
budget overrun; display-only model/effort descriptions now load with the deferred
picker and provider page instead of the eager selection projection. The boundary
lock was watched fail before extraction; the size limits are unchanged. The
isolated UI sweep passed 135/135 cells, the complete local verifier passed all
five lanes and 754 browser tests, and unsigned arm64 desktop verification passed.
Revision `767cf3bb` landed on main. Paid-provider acceptance stays deferred; the owner-preview
account-stack handoff remains blocked by the in-app browser URL policy.

Previous implementation checkpoint: multi-provider conversations distinguish the
driving Agent from the recorded model. Composer/live-turn/typing chrome is vendor-
neutral; each ordinary assistant turn shows its exact recorded provider/model,
decorated only by that viewer's exact connection label. Loading registries,
failed registry reads, and unavailable private/deleted connections are distinct;
all preserve the recorded model ID, and a readable cached exact connection label
survives a failed registry read. Missing legacy stamps remain unknown without
guessing from today's Agent binding, catalog or default. The default Agent uses
its registered label, and role-only SectionView conversation excerpts say
Assistant without inventing provenance. This is a presentation correction, not
automatic model routing or new model authority. Existing placeholder-based
harness locators now use the composer's stable accessible name. The
wrong-connection and guessed-legacy mutations were watched fail. A 320px capture
also found that a long provider label could push Usage beyond the composer's
local right bound (332.125px versus 308px) while shell clipping hid it from the
document-wide width check. The layout correction constrains the model label to
the shared control group's available width, without a viewport breakpoint, and
adds a local Usage-bounds lock; the old layout was watched fail that assertion.
All ten focused browser checks and the 135/135-cell UI sweep pass, with no sweep
violations or skips. Five-viewport long-label captures were visually reviewed.
The first full verifier passed all 6,599 unit tests but caught a 36-byte startup
graph overrun and an independent Sheet-save assertion matching two disabled
editor textareas. A shared assistant avatar removes duplicate markup and passes
the unchanged build budget. The Sheet test now holds the accepted save response,
proves the disabled editor, then awaits its removal and reads the exact rendered
cell; the old ambiguous assertion was watched fail under that hold.
The final focused conversation and structured-artifact browser run passes 12/12.
Revision `45da1bcf` passed the complete frozen-tree local verifier (all five lanes,
753 browser tests), the 135/135 UI sweep and unsigned arm64 desktop verifier,
then landed on main. Paid-provider acceptance and the owner-preview account-stack
handoff remain deferred/unverified respectively.

Previous implementation checkpoint: ordinary packaged verification now includes
native OpenAI Responses acceptance on the original executable, without patched
ASAR or mock keychain. Rendered OpenAI setup/canonical catalog, an explicitly
bound Agent Dispatch, streamed read-tool continuation and exact opaque reasoning
replay pass against a bounded loopback peer with synthetic credentials. A failed
HTTP-200 replacement probe preserves the prior private connection, encrypted key
and usage. Full signed-in relaunch retains exact SQLite conversation/counters,
then a fresh turn authenticates with the original key. Secrets stay outside
product data and provider request bodies; opaque reasoning stays in its one
intended continuation. Packaging exclusions and workflow locks were watched fail
before integration; the SQLite observer is locked to the authoritative slice
manifest. The complete unsigned arm64 desktop verifier passed, including this
ordinary acceptance path. Final diff review added guaranteed fixture cleanup;
the following complete local run exposed an independent image-OCR browser
locator that matched both file-access loading and recognition status. A held
module response now reproduces their overlap deterministically: the old locator
was watched fail, and recognition is scoped to its exact import-region status.
Revision `2bf931ab` passed the complete local verifier (all five lanes, 748
browser tests) and full unsigned arm64 desktop verifier, then landed on main.
No paid-provider call or signed/Intel acceptance is implied.

Previous implementation checkpoint: local protocol fixtures reproduced false
success in provider setup. HTTP 200 with a failed response or invalid usage
could publish a new connection or replace a working one. Both the tool-bearing
probe and its request-shape-only no-tools fallback now require valid assistant
content, terminal status and usage. Failed/nonterminal/invalid replies stop
without another capability attempt and expose no provider body or error cause.
The deliberately small probe still accepts valid token exhaustion, including
OpenAI's explicit `incomplete` / `max_output_tokens` result with no visible prose,
as described in the [official reasoning guide](https://developers.openai.com/api/docs/guides/reasoning).
Probe tool requests remain inert and never run or continue. New protocol and
create/replacement locks were watched fail against the previous implementation;
the status-mapping and wrong-role regressions were separately demonstrated.
The first completed full verifier exposed three browser model fixtures that
always sent SSE to non-streaming probes; those peers now honor the requested
transport instead of weakening production validation or test timing budgets.
Revision `43b3ac8e` passed the complete frozen-tree local verifier (all five lanes
and 748 browser tests) and full unsigned arm64 desktop verifier, then landed on
main. This does not resume paid-provider testing or close release gates.

Previous implementation checkpoint: the approved official filesystem MCP review
exposed and fixed a desktop-only legacy initialization failure. The bridge now
admits its dedicated initialized notification without widening ordinary requests
or inspection authority. Both new regression locks failed before correction;
an allowlist-widening mutation also failed before restoration. The
[third-party review](acceptance/third-party-filesystem-mcp-2026-10-15.md) passed
actual native Cancel/fresh Allow, catalog inspection and separately approved
generated-file list/read calls on unsigned arm64. Exact private receipts survive
source-absent relaunch and remain hidden on loaded requester pages. No paid model,
write tool, public service, sandbox, signed or Intel acceptance is claimed.
Revision `e6c5fa53` passed the complete local verifier (all five lanes and 748
browser tests) and the full unsigned arm64 desktop verifier, then landed on main.

Previous implementation checkpoint: provider setup offers Claude/Anthropic, OpenAI,
DeepSeek and Custom connections, with explicit protocol selection and protected
desktop API-key custody. Native OpenAI Responses feeds the same usage, consent
and bounded tool loop as Anthropic Messages (including DeepSeek's official
compatible endpoint). Tool-free model workflows share that connection as well.
Local wire fixtures, provider lifecycle and browser locks are the acceptance
boundary for this change; paid-provider acceptance remains deferred. Revision
`9c9eb6f1` passed the complete local verifier (all five lanes, 748 browser tests),
the 135-cell UI sweep and the complete unsigned arm64 desktop verifier, and was
pushed to main. The owner-preview account-stack handoff remains unverified while
its in-app browser tab is on an inaccessible error page.

Previous local checkpoint: the [native PDF/Office review](acceptance/native-connected-office-documents-2026-10-15.md)
passed actual Folder/Repository chooser Cancel and exact selection, then XLSX,
PPTX and scanned-PDF review/edit/Create for Folder, tracked Git and opted-in
untracked Git. Each original was moved aside after preview, before adoption or
recognition. All nine independent Sheet/Slides/Document artifacts rendered after
normal Quit and full relaunch with those sources absent; exact saved identities,
bodies, revisions and Document block IDs matched the exclusive baseline.
Temporary connections expired, while the ordinary Git index digest/mtime and
unchanged unsigned arm64 ASAR digest were preserved. Nine relaunch screenshots
were visually reviewed. This is one desktop-local account and native wide
window, not a new account/viewport matrix or general format-accuracy claim.
No runtime/UI behavior changed. Complete local verification remains mandatory
before landing; signed/native-Intel, real updates and live-service gates below
remain open. Paid-provider tests remain deferred.

Previous local checkpoint: packaged untracked Git PDF/Office acceptance now uses
the same captured-preview workflow as Folder and tracked Git. Explicit off/on
consent still leaves paths unlisted until List; metadata listing exposes no
body text or model request. A separate generated untracked directory is never
staged. The source PDF is replaced before native scanned-text recognition, and
Office sources before explicit adoption/edit/Create. Six distinct tracked and
untracked Document/Sheet/Slides identities and exact bodies survive full relaunch
with both source directories absent. Index and shared-index names, bytes and
nanosecond mtimes stay unchanged throughout the untracked phase and restart.

The focused smoke locks pass 20/20, with directory-alias, skipped-consent and
missing-relaunch regressions watched fail before restoration. The desktop suite
passes 956/956 with no skips, and complete unsigned arm64 `npm run desktop:verify`
exits zero. Thirty untracked screenshots were visually reviewed: XLSX/PPTX
disclosure/text, PDF OCR text and the adopted Document form at all five sizes.
Short surfaces scroll; the separate captures do not claim every control is
simultaneously visible. No renderer or production runtime behavior changed.
Complete local verification remains mandatory before landing. This uses
generated profiles, substituted chooser results and local model peers; actual
Office/PDF chooser interaction, signed/native-Intel and live-service acceptance
remain separate. Paid-provider tests remain deferred.

Previous local checkpoint: selected Folder, tracked Git and opted-in untracked
Git images offer **Extract text to new document** only when the existing native
on-device OCR boundary is available. OCR starts from the already captured
normalized PNG, then presents a read-only Imported text review; explicit Use
copies it into the editable ordinary Document and explicit Create alone saves.
Current source-receipt/account guards, held-creation precedence, cancellation,
format/discard and child Escape behavior remain part of the flow. It adds no
source reread/write, image upload/original retention, autosave, sharing or model
call. Focused browser acceptance, the 135/135-cell UI sweep and the complete
unsigned arm64 desktop gate pass. Complete local verification is mandatory
before landing. The [native connected-image review](acceptance/native-connected-image-documents-2026-10-15.md)
additionally passed actual Folder/Repository chooser Cancel/selection and
Folder/tracked/untracked PNG OCR review, editing, Create and exact source-absent
relaunch on the unchanged unsigned arm64 artifact. Temporary connections expired;
saved Documents remained. This is one desktop-local account and native wide
window, not broader OS-dialog, signed/Intel or live-service acceptance.

Previous local checkpoint: selected Folder, tracked Git and opted-in untracked
Git XLSX/PPTX previews seed separate ordinary Sheet or Slides authoring reviews.
One parse yields exact attachment text and a detached bounded import; review,
explicit Use and ordinary Create remain distinct. The Document path is
preserved. No raw Office bytes are kept in state, and the flow adds no source
reread/write, autosave, sharing or model call. Focused browser acceptance passed
5/5, the UI sweep passed 135/135 with no violations/skips, and the complete
unsigned arm64 desktop verifier passed. Packaged Folder/Git checks replace the
source before adoption and verify exact edited bodies after source-absent
relaunch. Complete local verification remains mandatory before landing.
Actual OS-dialog, signed/Intel and live-service acceptance remain separate.

On 2026-10-11 the owner delegated future product and architecture recommendations
for autonomous selection and implementation. Record consequential choices here
and proceed without routine approval pauses. This does not authorize paid or
public-service calls, release publication, real credential use or destructive
actions on the owner's data. Local verification, review and direct main delivery
remain mandatory; GitHub CI is not a dependency.

## Current release-readiness review

The 2026-10-12 audit at `863628b1` found no new demonstrated defect in the
clean-install workflow. The browser first-run test exercises the model-setup
handoff, durable preference acknowledgement, reconstruction without browser
storage and a completed first conversation. The ordinary packaged smoke also
covers clean onboarding, encrypted provider-key custody and signed-in relaunch.
These are implemented-boundary checks against a local model peer, not evidence
of a successful paid-provider call.

The landed runtime-security revision `3287b73e` passed the complete
frozen-tree verifier: all five lanes and 737 browser tests in 837.2 seconds.
Its separate 135-cell shell sweep and unsigned arm64 desktop verifier also
passed; the earlier failed/interrupted attempts remain failure evidence only. Actual native
local-MCP Cancel/Allow and the complete authored-peer workflow are separately
accepted on the artifact named in the [native review](acceptance/native-mcp-stdio-2026-10-12.md).
Neither result closes the following gates:

| Next evidence | Required input or work |
| --- | --- |
| Signed/notarized Apple Silicon and Intel downloads | Complete the owner's individual Apple Developer enrollment, obtain explicit authorization for the signing identity and notary Keychain profile, and run the candidate lane on each native architecture. Intel hardware availability is not yet confirmed. No completed release receipts were present in this checkout during the audit. |
| Real update installation and relaunch | Select an approved HTTPS download base, verify both signed candidates and the pair manifest, then test an actual two-version installation. Publication needs separate authorization; an example URL is not configured hosting. |
| Live model workflows | Deferred by the owner on 2026-10-15, not waived or accepted. Do not make paid-provider calls. A later resumption requires an approved provider/model, dedicated test credentials and a spend limit before real conversation, Dispatch, Routine and review/judgment acceptance. Local counters do not guarantee a provider billing ceiling. |
| Real external MCP workflows | The approved official filesystem 1.0.0 generated-file list/read workflow has bounded native acceptance, documented below. Public HTTPS/OAuth services, other peers and effectful tools still require exact peer/resource/call approval; one local package is not general compatibility or safety certification. |
| Remaining product scope | Preserve the declared [forward-looking requirements](spec/10-forward-looking.md) and [mock boundaries](spec/11-mock-boundary.md), including legacy standing simulation and Agent-proxy work, broader source/document capabilities and the later hosted-service phase. They are not implicitly completed by desktop preview acceptance. |

Provider API readiness and bounded local acceptance for the supported protocols
landed in `9c9eb6f1`; actual paid-provider acceptance remains deferred.
Prioritize actual release and approved live-service evidence next, not
another speculative recovery refactor or expansion of the formula language. The owner
has chosen individual/sole-proprietor enrollment and requested mainland-China
enrollment guidance on 2026-10-15; membership is not yet active. The current
[Apple instructions](https://developer.apple.com/cn/help/account/membership/enrolling-in-the-app/)
were provided. Identity verification, agreements and payment stay with the owner
in Apple's app; the route must match the owner's actual enrollment details.
No secrets, membership purchase, paid-provider call or public publication is
authorized by this review. The bounded third-party MCP review below now names
the approved peer, disposable resources and read-only operations; it remains
separate from provider implementation. Paid-provider acceptance is deferred
while unsigned release preparation continues. The complete local verifier
remains mandatory before landing.

### Provider API and third-party MCP sequence (2026-10-15)

Configured model support has explicit Anthropic Messages and native OpenAI
Responses protocols; DeepSeek is an official Anthropic-compatible endpoint
preset. The existing seeded OpenAI catalog row remains a deterministic demo
fixture, not a connected or authenticated account. Protocol/configuration
plumbing and provider UI review are locally verified in `9c9eb6f1`.
Do not make live paid-provider calls: real conversation,
Dispatch, Routine and review/judgment checks still require the previously stated
provider/model, dedicated credentials and spend-limit approval.

A bounded third-party MCP acceptance run is now recorded:
official `@modelcontextprotocol/server-filesystem@1.0.0`, locked dependencies in
a disposable directory, generated test files only, discovery plus
`list_directory` and `read_text_file`. No real files, credentials, paid calls or
write tools are authorized. The program has normal OS access, not a sandbox.
Provider API support landed before that separate acceptance task. The
[filesystem review](acceptance/third-party-filesystem-mcp-2026-10-15.md) records
the initial bridge failure, corrected native execution and loaded receipt review.
This does not claim paid-provider or public-service acceptance.

## Previous checkpoint: exact external-tool text

The 2026-10-15 static interoperability audit found a concrete result-admission
gap: a valid file-text result containing a form feed, NUL or another Unicode
control was treated as malformed. The shared parser had applied display-label
restrictions to body data. Inspection of the official filesystem server archive
and [MCP text schema](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2025-11-25/schema.ts)
motivated a local-authored reproduction; no third-party package was installed or
executed and no service call was made.

The result funnel now separates well-formed body Unicode from printable metadata.
Text and embedded-resource bodies remain exact, while names, titles, URIs, MIME
types and annotation timestamps retain their prior restrictions. Malformed
surrogates, the aggregate escaped-JSON byte bound and all execution/consent gates
remain unchanged. Controls never acquire terminal or HTML execution semantics.
Both provider history projections retain their existing JSON data framing.

The parser, authored legacy stdio call, JSON/SQLite compaction/restart and history
regressions failed against the previous parser. Deliberately removing metadata
restrictions or widening the JSON budget also failed the new locks before
restoration. The complete frozen-tree local verifier remains the landing gate;
its result belongs in the delivery handoff. This fixes one demonstrated
compatibility issue, not the pending live third-party acceptance gate. Paid
provider tests remain deferred. Native observation is unavailable while the Mac
is locked; no new native or signed/Intel acceptance is claimed.

## Previous checkpoint: native release-host enforcement

The 2026-10-15 release review found that the candidate command used Node's
process architecture without checking translation. An actual x64 Node running
under Rosetta reached the missing-signing-identity gate; it was not refused as
non-native. This was a demonstrated release-evidence gap, not a startup fix.

The candidate command now compiles a small temporary native probe, forces it
to the exact Node architecture and checks `sysctl.proc_translated` before
packaging or credential use. Compilation/probing have 30/5-second deadlines,
bounded output and a minimal environment. Only Intel admits Apple's documented
ENOENT result; Rosetta, other errors, invalid sizes/values and mismatched output
fail closed. Probe sources and tooling are excluded from the shipped app.
Schema-v4 receipts bind matching untranslated host evidence; finalization rejects
older receipts and missing, translated or mismatched host records. This remains
operator audit metadata, not hardware attestation or Apple signature trust.

Actual Node 26.3.0 arm64 inspection returned native evidence and proceeded only
to the empty-credentials refusal. The verified disposable x64 Node on the same
Apple Silicon host now refused Rosetta before credentials or packaging. Neither
run used Keychain credentials, built a candidate or accessed an app profile.
Controlled regressions were watched fail the translation parser, exact C errno
classification, receipt/finalizer, early orchestration and package-exclusion
locks before restoration. Native Intel hardware, signed/notarized candidates,
real update installation and deferred paid-provider acceptance remain open.

## Unsigned Intel cross-build preflight

On 2026-10-15, the unchanged `3287b73e` source produced an unsigned macOS x64
application using Electron 44.7.2 on an Apple Silicon host. An interrupted
download was resumed from the official Electron release URL and validated by
Electron's downloader against the checksum shipped in its npm package; the
normal package path independently retained the same checksum verification.

Read-only inspection found 20 Mach-O files, each exactly `x86_64`, including
the Electron frameworks, bundled Git and every native helper. Bundled Git's
pinned source/licenses/recipe and system-library dependencies passed inspection
without executing Intel code. The PDF OCR broker, transport and service have
ad-hoc signatures; strict broker/service seal verification passed, and the
service's embedded peer requirement matches the transport's exact cdhash.
Only the service has the App Sandbox entitlement; the broker/transport have
no entitlement grants. PDF helper Info.plists and Mach-O load commands retain
macOS 13.0. Custom helpers link canonical system-library paths only, with no
CoreGraphics/Vision dependency in the unsandboxed PDF broker/container.

The Intel and previously accepted arm64 packages contain the identical
`app.asar` SHA-256
`94c075751af00ff6ae7791f2fe8b80400d13548b3f8f4af21654eedfdf61f410`.
The arm64 main executable's architecture and restored development-helper
architectures were independently checked. This is a cross-build/static
inspection result, not native Intel or Rosetta execution, Developer ID signing,
notarization, Gatekeeper acceptance, a distribution ZIP or a release receipt.
No release requirement has been closed or weakened by this preflight.

### Follow-up: translated Intel startup remains unaccepted

The subsequent [Rosetta diagnostic](acceptance/intel-rosetta-startup-2026-10-15.md)
executed the same x64 package on this Apple Silicon Mac. Bundled Git, image OCR
and sandboxed PDF OCR checks passed, but the unchanged ordinary smoke failed its
25-second missing-profile startup deadline. A separate 60-second observation
also never reached readiness; a process sample showed the main thread waiting
inside macOS Keychain access. The exact permission/prompt cause is not yet
established, and this is not evidence that signing alone will fix it.

Do not extend the acceptance deadline, replace the authentication root, enable
mock/plaintext storage, or infer Intel acceptance from the earlier helper checks.
The next startup evidence must preserve real OS-backed storage and existing
data, distinguish owner-mediated Keychain interaction from unattended launch,
and keep native Intel and Developer ID/notarization gates separate. A change to
the encryption API requires explicit ciphertext-compatibility and fail-closed
evidence first; an asynchronous method name alone is insufficient.

Disposable follow-up probes established synthetic sync/async `v10` compatibility
on arm64. A minimal x64 entry point kept its event loop responsive during async
Keychain initialization, but initialization never completed and a timed
`app.exit()` did not finish before the diagnostic parent's deadline. That is not
a startup or shutdown fix. Production encryption, existing stored records and
the ordinary acceptance deadline remain unchanged; owner-mediated Keychain
observation and signed/native acceptance are still needed.

## Implemented milestone: runtime and build dependency security

The 2026-10-15 advisory audit found four affected npm dependency entries:
runtime `fast-uri` 3.1.7 and build-only `brace-expansion` 5.0.9,
`source-map-js` 1.2.1 and npm `undici` 7.29.0. Compatible updates lock them to
3.1.8, 5.0.12, 1.2.2 and 7.29.1 respectively. The full npm audit then reported
zero known vulnerabilities; this does not prove the absence of undisclosed
issues or replace runtime acceptance.

Electron 44.0.0 separately embedded Node 24.18.1 with Undici 7.29.0. Updating
the downloader's npm dependency does not change that runtime. The compatible
Electron 44.7.2 update is therefore included, and packaged acceptance now reads
the actual utility process's embedded Undici version and requires the 7.29.1
security fixes. The old executable was watched fail that check. The existing
official archive-checksum verification remains unchanged.
Review also caught an overly broad newer-major allowance: the embedded check
now admits only the reviewed 7.x line at or above 7.29.1. Behavioral boundaries
reject older, malformed and unreviewed-major versions; the initial predicate
was watched fail the 8.0.0 refusal. A future major update requires a fresh
advisory review rather than assuming a larger number includes the same fixes.

The [fast-uri maintainer advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj)
describes inconsistent host normalization. Direct parse/normalize/equality and
packaged-ASAR checks were watched fail on 3.1.7. The schema integration fixture
uses an explicit root URI, an encoded embedded identifier, valid/invalid
instances and a refused unregistered reference. An initial fixture omitted its
root URI and failed even after the dependency patch; that was a test correction,
not evidence of a product exploit. This dependency resolves local schema
identities, not outbound endpoint authority; the separate HTTPS/DNS/address
policy is unchanged, and no endpoint-authority bypass has been demonstrated.

The complete local verifier and unsigned arm64 desktop verifier are mandatory
before landing; the handoff records their final-tree results. Signed/notarized,
Intel, two-version update, live-provider and third-party-service gates remain
open. The release audit found no candidate receipts or configured download
destination, so owner enrollment/configuration remains the next release input.

## Implemented milestone: a reviewed local file becomes a Document

Autonomous direction (2026-10-15): connect source browsing to ordinary resource
authoring, removing a second chooser/read from a common collaboration workflow.
**Use text in new document** adopts a reviewed text/PDF/DOCX preview from Folder,
tracked Git or explicitly opted-in untracked Git into the existing editable
artifact form. Canonical, conversation and Project browsers offer the same act.
The adoption itself does not attach context, create a resource or share
anything. Explicit Create uses the existing account-owned acknowledgement and
recovery path; the saved Document is independent of the source and can be
shared normally. These are separate authoring actions, not context Attach: the
conversation picker does not acquire the image or recognized text as context.

The existing complete-text importer and authored-document source limit are
reused. Connected paths use their leaf filename for format admission while the
full relative path remains the disclosure provenance and the reviewed text
remains exact. No clipping, structured workbook/deck flattening, new file read,
native bridge, source write, model call or paid-service permission is introduced
by this text/PDF/DOCX path; selected-image OCR has its separate CTX-FS-38 path.
Existing source receipt/pending guards apply before adoption; account changes
clear the private unsaved draft. A held creation retains its own payload and
never borrows the new source's provenance. The shared modal shell isolates
dismissal from an underlying picker while retaining ordinary editing,
cancellation and focus. CTX-FS-36 owns this text/PDF/DOCX feature; CTX-FS-37
owns the separate structured Sheet/Slides authoring path.

Targeted acceptance passed: focused source-adoption E2E 6/6; the separate UI
sweep 135/135 with zero violations or skips; and the complete unsigned arm64
`npm run desktop:verify` exited 0. Five-viewport source-action captures and ten
packaged Folder/Git document-form captures were reviewed. The packaged walk
created an edited Document, removed its source, relaunched, and verified the
exact saved Document. The rebuilt app.asar SHA-256 was
`d63068e516e788126445acd904769f36858edd6586651c327af67dbd879cdc36`.

The complete final-tree verifier is required before landing; the delivery handoff
records its result.
An initial full run passed all browser lanes but timed out in the verifier's
own five-second coverage-diagnostic fixture. The fixture now uses a fixed host
profile, removing irrelevant CPU calibration; a deliberate calibration failure
proves that boundary. Production calibration, coverage, deadlines and retries
are unchanged. The timeout alone does not establish calibration as its sole
cause; the complete frozen-tree gate must still pass.
This evidence does not establish signed or Intel acceptance, an actual OS-dialog
walk, live-service acceptance, or public hosting. No release gate is waived.

## Implemented milestone: extract selected local-image text into a Document

Folder, tracked Git and opted-in untracked Git previews expose a separate
**Extract text to new document** action only when the existing on-device image
OCR boundary is available. It passes the already captured, normalized PNG into
the existing image-text OCR review; it does not reread the selected path or
offer another chooser. The read-only Imported text candidate remains separate
from the Document Content field until explicit **Use imported text**, after
which the ordinary editable Document form still requires explicit **Create
document**.

The current source-receipt and account-generation guards apply. A held artifact
creation retains precedence; one-shot image seeds use the existing review
cancellation/format/discard lifecycle and are not reseeded after dismissal or
discard. Child Escape remains isolated from an underlying picker. The OCR seed
contains only normalized PNG data and a leaf name, not source authority or the
private original. This authoring path adds no source reread/write, image upload,
original retention, autosave, sharing or model call. The resulting Document is
ordinary editable content; this is not context Attach, including when launched
from conversation or Project browsing. CTX-FS-38 owns the feature.

Implementation and focused locks are present in `localPreviewImageImport.ts`,
`local-preview-image-import.test.ts`, `local-preview-image-ui.test.ts` and
`local-source-image-create.spec.ts`. Packaged Folder/Git helpers now cover
source replacement before OCR and exact edited Document content after
source-absent relaunch via `localImageBrowseSmoke.mjs`,
`localFolderBrowseSmoke.mjs` and `localGitSmoke.mjs`, with source-level smoke
locks in `localImageBrowseSmoke.test.ts`. Acceptance passed: final focused E2E
3/3, related import E2E 17/17, UI sweep 135/135 with zero violations/skips, and
the complete unsigned arm64 `npm run desktop:verify` (exit 0). Ten five-viewport
source-action/review screenshots were inspected. Packaged Folder, tracked Git
and opted-in untracked Git each prove real on-device recognition after source
replacement and exact edited Document persistence after source-absent relaunch.

Removing the seed's image-text mode was watched fail in rendered acceptance.
The first desktop run exposed a harness assumption that reopening a Folder
picker clears its listing; its existing account-local listing is retained.
The corrected harness checks that retained listing, with a fail-first source
lock, and the complete desktop rerun passed. No production-code workaround,
retry or timeout increase was added. Complete frozen-tree local verification
is still mandatory before landing. Signed/Intel, actual OS-dialog and
live-service acceptance remain separate; paid-provider tests remain deferred.

## Implemented milestone: recognize selected connected-source PDFs

Autonomous direction (2026-10-15): close a core source-intake gap without
requiring a temporary Document. Folder, tracked Git and explicitly opted-in
untracked Git previews offer a separate **Recognize scanned text** action on
supported macOS desktop builds. It uses the already captured bounded bytes,
not another source read or chooser. Recognition replaces the preview for
review; the existing separate conversation-only Attach saves exact text and
OCR provenance. Canonical and Project views offer no context Attach; CTX-FS-36
separately offers independent Document-draft adoption there.

The existing sandboxed native recognizer keeps its 8 MiB, 100-page, 2,000-pixel,
64 KiB and 120-second bounds. Failure/cancellation preserves the prior preview;
disposal fences late results. Transient PDF bytes are discarded on success or
preview disposal and never enter saved context, model input or original-file
storage. No automatic OCR, richer conversion, source write or live service is
introduced. CTX-FS-35 owns this refinement; broader FWD-9 remains open.

Focused state/provenance/byte-retention locks pass, including deliberate
regressions watched fail for source identity, detached bytes, model provenance
and raw-byte exclusion from saved copies. Six rendered browser tests pass:
Folder/tracked/untracked recognition, canonical/Project no-context-Attach behavior,
explicit retry, cancellation/disposal, account walls and shared saved copies.
Twenty captures cover pending, success, failure and canonical pending at five
viewports. The separate shell sweep passes all 135 cells with zero violations
or skips. Earlier fixture-ID and sidebar-mount failures were repaired; they
are not passing evidence, and no timeout or retry policy was relaxed.

The complete unsigned arm64 `npm run desktop:verify` passes. Both Folder and
tracked Git use the real sandboxed recognizer on a generated image-only PDF
after the source is replaced, then preserve exact page-labeled text and OCR
metadata through Attach, explicit local-model Send and source-absent full
relaunch. Twenty new native OCR captures were reviewed; scanned/embedded PDF
capture names are distinct so neither evidence set overwrites the other.
Untracked OCR has browser coverage, not a new packaged-native claim. Chooser
answers in this suite remain fixtures; actual chooser evidence is separate.
Signed, Intel, live-provider and broader recognition-accuracy acceptance stay
open. The complete frozen-tree local verifier remains required before landing.

Local evidence: `/private/tmp/ac-connected-pdf-ocr-desktop.log` and
`/private/tmp/ac-connected-pdf-ocr-ui-sweep.log`; native capture directories
`agent-commons-folder-document-browse-oEyUM7` and
`agent-commons-git-document-browse-Iul2di` under the OS temporary directory.
The tested unsigned ASAR SHA-256 is
`715ad0efec32d634da533c4c6eee4a01e09039a55c4f14eaa2b080824cb701d8`.

Review found synchronous pending-state observers could start a competing read
or dismiss before operation registration. The common browser now claims its
slot before notifying observers (UI-236), and the new behavioral locks failed
before repair. The bundle gate also exposed extraction-only PDF streaming code
in the eager shared policy graph. It is separated into its worker-consumed
module rather than raising the existing startup budget; legacy status copy is
locked byte-for-byte.

## Completed checkpoint: actual connected-source chooser and text review

Fresh owner unlock input enabled the [2026-10-15 native walk](acceptance/native-connected-sources-2026-10-15.md)
on the unchanged unsigned arm64 artifact from `76e78b47`. Real Folder and
Repository cancellation, exact generated-directory selection, unchecked
Remember defaults, nested folder/tracked text previews, explicit untracked
opt-in/preview retirement and one unstaged single-file comparison passed.
Normal Quit/relaunch cleared both temporary connections. The source ASAR and
repository index hash/timestamps stayed unchanged; both isolated backends
stopped. No model was configured and no Attach, Send or external call occurred.

This supersedes the earlier locked-screen blocker for these tested paths only.
It does not close remembered-access, document/image, saved-copy, account-wall,
signed/Intel or live-service acceptance as a whole. Those evidence boundaries
remain explicit in the native record. No product change was needed. The
complete local verifier remains required before landing this evidence update.

## Completed milestone: owner-reviewed Agent requests with optional argument drafting — local implementation

Autonomous direction (2026-10-14): finish D15 as a real request/consent/reply
workflow. The new Agent Requests path now has a private durable registry and
store host, bounded executor, authenticated routes, event invalidations, and
requester/history and owner-inbox UI. A request asks for an outcome in ordinary
prose; it never names or borrows another person's private connection. The
receiving owner selects and reviews one exact MCP call under their Agent's
current authority, explicitly runs it, then separately reviews the text to
share. Raw results, arguments and connection identity remain owner-private. A
tool result is not automatically a safe reply. Shared Project work still
belongs to the Guardian channel.

The strict private request kernel uses exact person/namespace anchors, bounded
input, one immutable call receipt, owner-only Run/Share, either-party
cancellation, and explicit restart uncertainty. The registry, host and executor
add strict JSON/SQLite joins, exact keyed replay, commit-before-I/O, live
authority checks across waits, and capacity held until physical settlement.
Ordinary restart interrupts pending work without replay. Explicit portable
restore fences old waiting work without inventing a human denial/cancellation;
fresh approval cannot run that restored request. Cancellation closes sharing
without discarding an in-flight call or a late known result. The strict parser
and hash detect malformed/mixed state, not tampering by a privileged host.

This revision adds an optional owner-initiated model draft for arguments to the
already selected tool. The prompt contains only the task, Agent instructions,
and selected tool name, description and input schema; no MCP discovery or
execution, prior model-written reply, private raw result or connection secret
enters the drafting call. A single durable pending attempt precedes model I/O;
interruption becomes uncertain and cannot automatically retry. The draft is
private and only seeds editable JSON after a separate explicit Use action.
Review and Run remain required, and Share remains a distinct manual act. Draft
and MCP work in the request-worker pool share 4/process, 2/paying-tenant and
1/Agent physical capacity limits, with model reservation and late-settlement accounting. Draft receipt metadata
is owner-only; requester and history projections omit it. This is optional
tool-free argument advice, not autonomous Agent reasoning. The draft binding
is durably recovered with request state, and a retained suggestion is usable
only while its Agent, model and selected-tool binding still matches. Suggested
JSON is exposed in a named keyboard-readable region and requires explicit Use
before editing and Review.

Upgrade review found that reserving optional draft space on every old waiting
row could refuse a previously valid near-capacity history. Draft headroom is
instead admitted with the explicit pending attempt, before model I/O; existing
waiting rows remain readable and can still use their previously reserved Run
capacity. A full history can refuse a new draft without changing the request.

The legacy `/agents/:id/proxy` route remains release-refused. The workflow has
no autonomous Agent reasoning or model-written reply; the optional argument
draft is an explicit tool-free model call. Do not report that an Agent reasoned
unless an actual model call ran.
At the pure-kernel checkpoint, the fifteen focused state tests were each watched
fail across two deliberate negative-control runs, then pass after restoration.
That evidence covers the state kernel only. Complete local and desktop
verification remain mandatory pre-landing gates; neither substitutes for
feature-specific rendered and packaged acceptance.
Review also found that a regex dependency lock missed multiline imports. The
replacement uses TypeScript syntax parsing and was watched reject an actual
multiline filesystem import; side-effect imports, dynamic loads and runtime
re-exports are negative controls too. The earlier full-verifier attempt was
cleanly interrupted before this test edit and is not passing revision evidence.

Private person provenance now has an integrated creation/persistence boundary:
verified-session and trusted desktop-device create, fork and import atomically
stamp a separate sidecar with the exact person and tenant. Desktop provenance
requires the explicit desktop profile, local default identity, disabled header
impersonation and its credential-less auth posture. A fork belongs to its forker,
not its source owner; keyed replay cannot transfer or retroactively add a binding. Live membership is
checked again after import/body waits. Legacy, system-created and loose dev-header
Agents stay unbound. Hosted/default fallbacks cannot acquire provenance.
Deletion retains retired provenance, and strict JSON/SQLite and portable joins
preserve it without exposing person IDs in Agent/event rows.
This changes neither tenant configuration rights nor execution consent. The new
request workflow relies on these person anchors; legacy adoption still needs an
explicit controlled owner opt-in, not a first-member claim.

The provenance checkpoint's first full verifier exposed late rejection handling
in two native directory-mutation tests. Their expected-refusal assertions now
attach before fixture awaits; a controlled scheduling delay reproduced the old
unhandled rejection and passed with early attachment. The diagnostic delay was
removed, with native behavior, bounds and assertions unchanged. That interrupted
verifier is failure evidence, not a passing revision.

Focused acceptance and delivery gates:

1. Keep the complete two-person workflow locked: same-organization privacy,
   revocation during waits, cancellation, response loss, relaunch and no replay.
   Focused route, executor, persistence and client tests cover these boundaries;
   the browser walk covers explicit Run/Share, requester redaction, lost-create
   acknowledgement and GET-only recovery. Requests and human consent remain
   separate from any Agent-generated prose.
2. Focused browser acceptance passed the complete request lifecycle and the
   delayed/failed Agent form, request-history and decision-module paths. The
   five-viewport review covers narrow/wide WCAG AA, exact accessible field names,
   private receipts and separate Run/Share consent. The initial feature review
   exposed captures taken while the rail was still closing; captures now await
   the shared settled-rail and painted-geometry checks. The separate shell sweep
   passed all 135 cells with no violations or skips.
3. The unsigned arm64 Agent Requests package walk passed in an isolated profile:
   real authenticated people, OS-backed custody, an authored local child, exact
   private result, separately shared reply, shutdown/relaunch uncertainty and no
   repeated child call. Its default disposable source-hash-checked ASAR
   substitutes setup dialog answers only. The separate
   [native Agent Requests review](acceptance/native-agent-requests-2026-10-15.md)
   passed actual Cancel/fresh Allow on the unchanged original app, then explicit
   argument Draft/Use/Review/Run, private results, separate Share and full
   signed-in model/tool uncertainty recovery without replay. Both modes retain
   their distinct evidence under `.data/desktop-agent-requests-smoke/`.
4. Code review found that an imported unbound Agent could borrow default-provider
   connection reach. A regression test reproduced it; request execution now
   requires an explicit current provider binding, and the same test verifies
   zero discovery before binding and successful execution after binding.
   Bundle review also separated deferred request history and the shared Agent
   form, with a dedicated prompt-policy chunk; existing graph limits remain
   unchanged. Loading/error states retain explicit read-only recovery.
   Full-suite integration checks also caught stale source-owner/route manifests
   and loop-generated tests omitted by the browser manifest. Their ownership
   records now follow the extracted form, portable limits and human-only routes;
   all six loading tests are explicit top-level cases. The native helper remains
   package-excluded and forbidden from creating or opening launch authority.
5. Feature-specific pure, model, worker, route and persistence locks have been
   exercised, along with a preliminary 30-cell browser pass. The complete local
   verifier, separate shell sweep and desktop verifier on the exact delivered
   revision remain mandatory. Keep third-party peer, signing/notarization,
   Intel and actual native-dialog evidence separate. Unsupported
   connector/payment actions remain unavailable.

MOCK-9 remains open: the legacy proxy route is still release-refused, and the
broader legacy collaboration automation remains fixture-only. The bounded
argument-drafting workflow and focused locks are exercised locally; complete
verification on the exact delivered revision remains mandatory. Authored-peer
evidence does not establish live-provider, unrestricted third-party or signed
release acceptance.

## Completed checkpoint: images inside connected sources

Autonomous direction (2026-10-13): extend the existing explicit selected-file
workflow to images in connected Folders, tracked Git and opted-in untracked Git.
People should not need to reopen a second file chooser to use an image already
visible in their source. Canonical detail and Project context stay browse-only;
conversation Attach saves the exact reviewed image without rereading its path.

The native host transports one detached source container up to 8 MiB and never
decodes it. The renderer reuses the existing PNG/JPEG/GIF/WebP/BMP/ICO/static-SVG
normalizer and displays only its bounded first-frame PNG (largest ICO image),
at most 2,000 pixels per edge and 3 MiB. No upload, OCR or model call occurs on
listing or preview. Explicit Attach reuses private original-image retention and
the ordinary durable photo-attachment boundary. Shared views and conversation image input use
the normalized copy; the exact original remains owner-download-only.

Pre-context upload belongs to the account, connection and preview receipt.
Dismiss, uncheck, Disconnect, selecting a replacement and account disposal fence
late publication. A picker remount does not cancel an explicit pending Attach;
the existing byte-free target-qualified receipt coalesces it. Once the context
mutation is submitted, its ordinary acknowledgement/retry owner takes over.
Bulk Folder/Git text snapshots and change-review scope remain unchanged.

Acceptance matrix: Folder/tracked/untracked preview in canonical detail,
conversation intake and descriptive Project context at all five canonical
viewports; ordinary saved photo previews with shared-reader/foreign walls;
invalid/oversized inputs, late native results and pre-context cancellation;
real unsigned packaged image read, exact frozen Attach, source-absent relaunch,
private original download and normalized model input. The complete local
verifier, separate 135-cell shell sweep and desktop verifier remain mandatory.
Actual OS-dialog, signed/notarized, native Intel and live-service evidence remain
separate gates. The Mac was still unavailable to native UI control when the
owner's unlock notification was checked; no actual chooser pass is inferred.

First-pass acceptance found stale rendered consent allowing an untracked upload
to attach after Dismiss, and a responsive pane collapse remounting the next
picker after an earlier photo preview. Live receipt checks and an all-tier
intake hold address these at shared boundaries. Review also caught acknowledgement
replacing a pending receipt and permanent acknowledgement blocking reattachment;
the receipt's current represented state must preserve both settlement and a
later explicit reattach. These fixes require the same final frozen-tree gates,
not an exemption based on the earlier partial passes.

The frozen checkpoint at `4bcf5a98` passed the complete browser verifier (713
E2E tests), the separate 135/135-cell responsive sweep, and the desktop
verifier. This closes the connected-source image workflow for that checkpoint;
actual OS-dialog and signed/Intel release evidence remain separate.

## Completed checkpoint: explicit single-file Git comparison

Landed as `a9aa70b3` after all five complete local verifier lanes (717 browser
tests), the separate 135/135-cell shell sweep and unsigned arm64 desktop verifier
passed on the frozen final tree. Native control still reported the Mac locked
when the owner's unlock reply was checked; actual OS chooser acceptance remains
pending and will not be polled again without fresh owner input.

The next complete workflow is explicit staged or unstaged comparison of one
selected tracked path, including a HEAD-only staged deletion. Browsing already
supports 10,000 paths, but whole-repository review has a separate 500-path cap
and shared text budget. A selected comparison must not read unrelated file
bodies first or claim that the whole repository is clean. Existing whole-repo
capture/review limits and the ordinary bounded saved-comparison copy remain.

PORT-34 is the native prerequisite: a narrow baseline transaction validates the
copied index within browse metadata bounds, then resolves only the selected HEAD
path. It retains the existing source-version, cancellation and private-store
fences, denies unrelated blob/working reads and distinguishes sparse ancestry
from a deleted index entry. Real generated repositories and the packaged Git
smoke cover this boundary. File/directory transitions retain conservative
ignore matching without granting descendant reads; both transition regressions
were watched fail before the fix. The prerequisite landed as `e65f12ce` after
the complete local verifier and unsigned arm64 desktop verifier.

The current implementation connects that boundary to a closed path/direction
result, account-bound cancellable IPC and explicit Compare file controls.
Controls remain reachable when whole-review capture is unavailable. Readable
change labels must agree with exact bytes/modes/presence; missing, empty,
unsupported, ignored, sparse and conflicted outcomes cannot be called clean.
Only the selected HEAD/index or index/working sides are read, each ≤64 KiB.
Conversation Attach serializes the captured sides into the existing ordinary
64 KiB saved-file funnel, without a reread or model call. Canonical and Project
surfaces remain read-only. Input edits, Dismiss, disconnect and account changes
abort and fence reads; remount alone preserves account-memory state. Native
capacity remains occupied until cancelled work actually settles.

Review caught unstable external-store idle snapshots and insufficient
change/side coherence in the first result parser; focused regressions cover
both. Acceptance covers the conversation picker and canonical detail across
five viewports, read-only Project context, account disposal, late replies,
exact Attach after source edits and saved-only Send. The packaged Git walk
adds a real >500-path repository, staged deletion, missing-index refusal,
selected unstaged Attach, unchanged index bytes/mtime and full source-absent
relaunch. Complete local, separate UI and desktop gates must pass on the frozen
final tree before landing. Native UI control still reports the Mac locked;
the actual chooser, signed/notarized, Intel and live-service gates remain open.

## Completed checkpoint: explicitly attach a captured Git comparison

Landed as `81c0c383` after the complete local verifier (715 browser tests),
separate 135/135-cell responsive sweep and unsigned arm64 desktop verifier.
Actual OS-dialog, signed/notarized and native Intel evidence remain separate.

Policy change: passive staged/unstaged review stays account-scoped and
transient, but a separate explicit conversation **Attach this comparison** act
may save the selected already-captured comparison as an ordinary JSON text
file. It preserves repository/capture metadata, comparison direction, paths,
change kind and exact before/after sides (including distinct missing, empty and
omitted states); a possible rename remains labeled as a suggestion. The
complete serialized UTF-8 file must fit the ordinary 64 KiB text-file limit.
Oversize or unavailable selections are refused. No Git reread/write, server or
native operation, new wire kind or model call is added; the resulting saved
file follows ordinary conversation context and input limits. Canonical and
Project views remain read-only.

The focused browser journeys pass exact saved/model text, oversized refusal
and same-identity context Retry. Visual review found a cramped connection name
beside the growing action row, plus a shared-preview screenshot captured during
its responsive transition. Folder and Git pickers now share a full-width
identity above wrapping actions (UI-232); five-viewport geometry checks and
settled shared-preview capture cover those findings. Pure serializer and byte-free receipt locks include
watched regressions; Disconnect retires captured review before native
acknowledgement and fences pre-context preparation. Packaged Git smoke follows
one captured comparison through saved JSON and explicit model input while
checking the source index remains unchanged. Native review also exposed
resize/scroll timing and synthetic text entry into an outgoing composer. The
acceptance helpers now wait for frame-stable scrollport geometry and a hit-tested
current composer, preserving strict full-visibility checks, exact text, existing
deadlines and zero retries. Their source locks were watched fail before repair.
Landing requires the complete
frozen-tree local verifier, UI sweep and desktop verifier; their final results
are recorded in the checkpoint handoff. Real OS-dialog and signed/Intel
acceptance remain separate.

## Completed checkpoint: explicit untracked Git intake

The complete user workflow landed as `be623c7e` after all five local verifier
lanes and 707 browser tests passed in 725.3 seconds. The separate 135/135-cell
UI sweep and unsigned arm64 desktop verifier passed on the same frozen tree.
Native dialog review remains pending; deterministic packaged selection is not
evidence of the actual OS chooser.

Autonomous direction (2026-10-13): complete repository intake with a separate,
unchecked untracked-file browser. New files should be reviewable and attachable
without staging them in Git or reconnecting the repository as a Folder. Existing
tracked browsing, whole-repository Attach/Refresh and staged/unstaged review keep
their current admission rules. Project context remains browse-only; the later
conversation Attach must preserve exactly the reviewed text and fidelity data.

The first implementation checkpoint is the internal native boundary, not a
shipped UI feature. A one-directory, no-follow metadata primitive enables ignore
pruning before descent, including ignored trees too large to enumerate. Discovery
subtracts all current index paths, does not enter Git metadata, submodules,
sparse/indexed directories or nested repositories, and includes ordinary dotfiles
only under the future explicit untracked action. Each selected preview repeats
admission against a fresh copied index, current ignores and pinned directory
metadata before reading that one supported regular file. Directory and file
versions are rechecked before publication. No Git command runs in the source
worktree. Only the existing bounded copied-config probe may read
`extensions.objectformat`, with includes disabled; source configuration is never
applied to commands. Neither listing nor preview writes to the source.

Limits are explicit: 10,000 total raw entries across visited directories, 1,024
visited directories including the root, depth 64 and 1 MiB aggregate candidate
path bytes. Ignore evaluation remains private and bounded; copied index/ignore
metadata shares the existing 16 MiB limit and the transaction retains its
30-second deadline. Ignored directories count as one excluded candidate rather
than claiming a count of unseen descendants. Overflow fails without partial
results. Selected text/document bounds reuse the existing portable contracts.

The following user-workflow checkpoint adds distinct owner-bound IPC with closed
untracked scope and per-operation cancellation, an unchecked transient browser,
and conversation-only exact saved-copy attachment. Opt-in and previews belong to
the current account and connection, so reopening another pane can inspect the
same in-memory review without another read; target-qualified receipts still
require a separate Attach in each conversation. Uncheck, Dismiss, Disconnect and
account disposal clear pending results; reload removes the opt-in. Tracked and
untracked receipts cannot collide. A fresh preview after app restart intentionally
creates a new copy identity rather than deduplicating by a mutable path.

Cancellation must retire queued as well as active native work, and a cancelled
reader retains its capacity until it actually settles. Browser acceptance covers
canonical detail, conversation intake and Project browse-only at all five tiers,
plus exact saved content, shared/foreign account walls and late-result refusal.
Packaged acceptance uses generated dotfile/text and DOCX sources, changes them
after preview and removes them before relaunch; saved text/fidelity and model
input must remain exact while split-index bytes/mtime stay unchanged. Complete
local, shell and unsigned native gates plus adversarial review remain mandatory
before landing; final outcomes accompany the handoff. This adds no source writes,
unattended intake, external calls or authority to the existing tracked channels.

The foundation landed at `1a5930a6` after the final local verifier passed all five
lanes and 702 browser tests in 770.1 seconds. On 2026-10-13 the actual native Folder
chooser (including Cancel, unchecked Remember and exact generated directory) and
all four canonical document previews passed on its unchanged unsigned arm64
package in an isolated profile. The Mac locked again before the Git chooser;
that native check and this new untracked UI's native review remain pending. The
test app exited cleanly and its backend stopped. This is not saved-copy/relaunch,
signed/Intel or live-service evidence.

Focused development evidence: the 26 directory/reader cases passed after a new
race test exposed missing ancestor-version checks in the directory primitive.
Both root and intermediate-ancestor changes are now refused; the legacy file
reader is unchanged. Six pure discovery cases cover aggregate entry, empty
directory, depth and path-byte limits and metadata/ignore pruning. Raising the
aggregate entry cap by one was watched fail its boundary test, and removing the
new module from packaged ASAR equivalence was watched fail the packaging lock;
both mutations were restored. Packaged acceptance now additionally exercises the
untracked list and exact selected text using the shipped helper, and proves that
tracked preview and bulk capture retain their old scope. Final frozen-tree gate
outcomes accompany the checkpoint handoff, not these pre-gate observations.

The complete unsigned arm64 `npm run desktop:verify` passed all stages on the
frozen 2,919-file source tree, including the new packaged internal reader checks
and existing native workflows. Independent review found no remaining code defect;
its documentation correction above clarifies the pre-existing copied object-format
probe and changes no packaged runtime code. A subsequent complete local verifier
passed all five lanes and 702 browser tests in 766.7 seconds on the frozen,
documentation-inclusive tree. The full verifier remains mandatory after any
later change; final landing outcomes accompany the checkpoint handoff.

## Completed checkpoint: review documents inside connected sources

The previous goal turn clarified Apple enrollment using Apple's current
mainland-China guidance: individual enrollment supports international Mac
distribution through Developer ID and notarization. Actual residence/account
region and completed membership remain owner inputs, not inferred facts.

Checkpoint review derives the following matrix from the shared browser view,
both native bindings, document projection and saved-file consumers:

| Surface and principal | Explicit acceptance coverage |
| --- | --- |
| Canonical Folder and Git detail, Ada owner | Real DOCX worker preview and no Attach at 320×700, 375×812, 768×1024, 844×390 and 1280×800; existing sibling walks retain listing, errors and non-document states. |
| Conversation source pickers, owner | Every PDF/DOCX/XLSX/PPTX format from both sources at all five viewports in the packaged walk; exact source-byte/fidelity disclosure, complete text, reachable Done and separate Attach. Browser coverage adds protected/no-text/invalid/unsupported outcomes and long relative paths. |
| Draft, saved attachment and shared conversation | First-send materialization, exact stable attachment identity, shared-reader text/fidelity without native authority, foreign denial, and source-absent saved previews/model input after real relaunch. Existing direct-document suites retain their five-viewport owner/shared preview matrix. |
| Project context and account lifetime | Native source browsing is descriptive/read-only; no saved-file or whole-source Attach. Dismiss, Disconnect, native-response delay, stalled worker/importer and account-switch fences prevent late publication. |
| Shared shell regression | Complete 135-cell UI sweep plus the complete local verifier. No theme tokens or global primitives changed; the existing contrast/theme locks remain the oracle for unchanged palettes. |

This is not a claim of original document layout fidelity, automatic OCR,
third-party corpus/provider acceptance, native Open-dialog acceptance or signed
Intel/Apple Silicon release acceptance. The Mac remained locked when native
review availability was rechecked; browser and packaged fixture work can proceed.

Autonomous direction (2026-10-13): extend selected-file browsing in both native
Folders and Git repositories to the PDF, DOCX, XLSX and PPTX formats already
supported by direct file selection. A person should not need to leave a known
source and repeat the OS chooser merely to review one document and attach its
saved text. The actual native-dialog review remains pending because the current
computer-use surface reports a locked Mac; that is not a product failure or a
reason to mark native acceptance complete.

Listing remains bounded metadata only. Explicit preview re-admits the exact
selected regular file, returns at most the existing format's 8 MiB source limit
through path-free native IPC, and runs the existing isolated renderer extractor.
The native host never parses document archives. Only extracted text and its
validated format/outcome disclosure enter transient browser state; original
bytes never enter saved context. Dismiss, Disconnect and account changes cancel
extraction and fence late results. Text previews retain their 64 KiB whole-file
limit; document extraction retains its existing independent resource/text limits.

Separate Attach saved copy preserves exactly the reviewed text and extraction
metadata under the existing receipt identity. Project context remains browse-only.
There is no automatic OCR, formula calculation, layout-fidelity expansion, source
write, original upload or model call. Invalid, protected, empty and bounded-out
documents must remain visibly distinct from ready text.

Acceptance must cover all four formats through genuine renderer workers, both
native source boundaries, exact selected/versioned reads, omissions, cancellation
and person walls, source changes after preview, saved-only model metadata and
source-absent relaunch. Reuse the shared browser and importer rather than adding
format-specific workflows. Keep existing budgets and verification timeouts; new
locks must be watched fail before the final frozen-tree local verifier, UI sweep,
packaged desktop gate, adversarial review and direct main delivery.

Acceptance (2026-10-13): the focused seven-spec browser run passed all 29 tests,
including all nine new document-browse cases. The full shell sweep covered
135/135 cells with zero violations and zero skips. The final unsigned arm64
`npm run desktop:verify` passed every stage, including both native sources,
real packaged extraction workers, exact saved copies after source replacement,
unchanged Git index bytes/mtime, and all four saved previews and model inputs
after full relaunch with the original documents absent. All 80 final native
document screenshots (two sources, four formats, two scroll positions, five
viewports) and the shell captures were visually reviewed without actionable
findings. Independent code review found no remaining actionable defects.

Acceptance development exposed test-harness defects, not a reason to weaken
the product contract: listings now satisfy their closed ordering/count rules,
Git's Project walk follows its actual Repository pane, multi-file relaunch
opens the grouped Files menu, and Send awaits picker exit and hit-tested composer
activation. Text capture centers the preview while retaining strict full
containment. A screenshot caught the responsive rail mid-collapse, so both
disclosure and text captures now wait for unoccluded paint at center/edge hit
points, not a fixed sleep. The new capture and grouped-navigation locks were
watched fail before repair; earlier failed runs and the obscured capture are
not acceptance evidence. No production deadline, retry policy or fidelity
assertion was relaxed. Landing still requires the complete local verifier;
its final outcome accompanies the checkpoint handoff.

The first complete verifier passed checks and three browser shards, but failed
the existing cadence-chunk error walk after 803.7 seconds. Its retained trace
shows a stale conditional read of `main[inert]` immediately after resizing:
the narrow-layout effect had already closed and made the rail inert before the
test attempted Collapse. The walk now awaits accessible main content plus an
existing inert, zero-width drawer; it neither clicks an automatically closing
control nor accepts an absent drawer as evidence. The failed editor must remain
visible, and the original containment, Close/reopen, real reload and unchanged
revision assertions remain. This is a test-precondition repair, not a production
layout change; the failed verifier is not a passing revision.
Both original cadence browser tests passed in 14.5 seconds after this repair,
with unchanged timeouts and coverage; independent review confirmed the causal
trace and the stronger, non-vacuous settled-drawer precondition.

The next full verifier was deliberately stopped after its checks lane passed
(218.8 seconds): screenshot review caught the cadence loading shell during its
section-action reveal fade. That interrupted run is not a passing revision.
The shared browser paint guard now serves both attachment previews and cadence
captures, requiring fully opaque ancestors and stable geometry across animation
frames. The capture source lock was watched fail before repair; no product CSS,
timeout or retry policy changed. Both focused tests passed again (14.6 seconds),
and all 16 fresh loading/error/loaded/footer captures were reviewed at original
size. The blend disappeared with settled paint; the surface is solid and legible,
so no product styling change was justified. The final frozen-tree verifier passed
all five lanes and 702 browser tests in 765.6 seconds; `fea7f307` was committed
and pushed to main after review. The earlier failed/interrupted runs do not
substitute for that final acceptance.

## Completed checkpoint: select files from a connected local folder

Autonomous direction (2026-10-13): complete the local-folder intake workflow
with explicit path listing, one-file preview and a separate Attach saved copy.
The current picker only offers all-folder flat or recursive captures, despite
the native boundary already supporting bounded descriptor-relative enumeration.
Selective intake lets a person review the actual text and add only the file
needed for a conversation. No new service, credential, write or standing model
authority is required.

The macOS listing uses the existing visible-tree bounds (16 levels, 64
directories, 500 raw entries) without reading file bodies. The native reader
re-admits a selected relative path against the current pinned tree before a
whole supported-text preview up to 64 KiB; hidden paths and links grant no body
reads. Native identities stay private. Listing and preview share the existing
owner, account, disconnect and shutdown fences and remain transient. A shared
browser/state funnel preserves the Git workflow while keeping folder scope and
privacy copy truthful. The selected saved copy reuses ordinary file context and
exact receipt identity; Attach never rereads the source or calls a model.
Project context remains descriptive and offers no byte-discarding Attach.
Existing whole-folder capture and explicit Refresh remain unchanged.

Acceptance must cover contract and native refusal/bounds, metadata-only listing,
exact selected reads, account/dismiss/disconnect lifetimes, pending attachment
identity, five-viewport detail/picker/Project rendering and packaged source-edit
then source-absent relaunch. New locks must be watched fail. The complete local
verifier, UI sweep, packaged desktop gate and final diff review remain required
before landing. Signed/Intel/live-service evidence is still separate.

The first focused browser and packaged desktop runs both failed on a real
integration defect: the exact file copy was acknowledged and marked Added, but
the Folder picker footer counted only whole-folder snapshots. The shared-view
extraction also drifted Git loading/refresh labels and hid its next-send
disclosure inside collapsed details. These failed runs are diagnostic evidence,
not acceptance. Repair uses the shared receipt projection and browser view,
with source-specific counts and visible attachment consequences (UI-228).
The packaged import-closure lock also failed until the new folder contract was
included in both the source expectation and real ASAR verification.

Final review found that a failed Disconnect retained its disabled transient
preview. Both Folder and Git registries now announce an accepted disconnect
before awaiting native work; the shared browser dismisses only that source and
fences late reads. Saved attachments and uncertain connection recovery remain
unchanged. The focused controller regression failed before repair and passes
24/24 afterward. The rendered held/failing-disconnect walk also caught an early
return in its test fixture; successful simulated acknowledgement now removes
the fixture row before returning, without weakening any assertion.

Acceptance on the corrected product revision: all 15 focused Folder/Git browser
tests pass; the complete UI sweep passes 135/135 cells with zero violations or
skips; and the complete unsigned arm64 `npm run desktop:verify` exits 0. Review
of 15 folder, five Git, five packaged saved-copy and 20 affected general-sweep
screenshots found no confirmed visual blocker. A suspected 375px popover-margin
issue was not confirmed by the added five-viewport geometry checks.
The real packaged folder walk proves metadata-only listing, exact selected
preview, no attachment/model call from browsing, saving the shown bytes after
the original changes, saved-only model input, and exact state after relaunch
with the original source removed. Native chooser answers remain test fixtures;
this is not signed/Intel, actual OS-dialog, paid-provider or public-service
acceptance. The final complete local verifier and post-test diff review remain
mandatory before main delivery; no GitHub CI is used.

The final frozen tree passed all five local verifier lanes and 693 browser tests
in 752.9 seconds. Its source fingerprint stayed unchanged through acceptance;
post-test review found no remaining blocker. Commit `fe98e2b7` was pushed to
main with a clean worktree. This closes the implementation checkpoint, not the
separate actual-dialog, signed/Intel or live-service release gates.

## Completed checkpoint: explicit local Git tracked-file browsing

Add a read-only browse step to the existing local Git repository page. On macOS,
the person explicitly lists tracked paths and chooses one supported text file to
preview. Listing reads bounded Git metadata and applicable ignore files; the
copied index/ignore aggregate is capped at 16 MiB, and `.git/config` is separately
capped at 128 KiB when needed to resolve object format. It does not read
working-file bodies beyond applicable ignore rules. The listing admits at most
10,000 unique tracked paths and
1 MiB aggregate returned path bytes. The existing ignore walk remains capped at
1,024 directories and depth 64.

Before preview, the exact selected path is re-admitted against the current index,
ignore state and pinned repository identity. Only a current tracked, regular,
supported text file may return a whole preview, capped at 64 KiB. Nonregular and
unsupported-name entries grant no body read; invalid/binary selected text yields
an explicit omission. Listing and preview are transient account-scoped results;
Disconnect, account change, Dismiss and shutdown fence pending work or clear its
projection.

Browsing does not attach, persist or send source text. Dismiss remains available
during initial listing, and the shared browse funnel distinguishes metadata
reads from working-file body reads. A separate explicit Attach saved copy sends
only the exact preview text through the existing UI-host file input path. One
byte-free account/conversation/connection/preview receipt keeps the same copy
identity and pending acknowledgement across picker close/reopen. Added feedback
and counts come only from actual workspace attachments, not optimistic UI state.
After first send materializes a draft, only exact known attachment IDs present
in the saved conversation reconcile that identity; labels and text are never
used to guess a match. Preview-only reads create no attachment intent records.
Project context is descriptive: its picker can list and preview but offers
neither saved-file nor whole-snapshot Attach, which would discard captured bytes.
The existing conversation Git Attach/Refresh capture limits remain unchanged: the
500-entry refusal and 24-file/64 KiB-per-file/128 KiB-total capture limits still
apply. The native bridge carries opaque connection IDs and relative
selections/results, never absolute native paths or commands; this adds no shell,
write, HTTP, or standing access authority.

Acceptance on 2026-10-13: the focused native/contract/host/preload/legacy suite
passes 66/66; the final frontend/controller locks pass 28/28 plus typecheck.
The combined Git browser/review/snapshot walk passes 12/12; after the final
read-only identity cleanup, all four browse walks pass again. These include
pending close/reopen, acknowledged reopen, draft materialization and descriptive
Project gating. The complete UI sweep passes 135/135 cells with zero violations
or skips; five-viewport focused screenshots and 20 affected general-sweep
screenshots have no confirmed visual regression.

The complete `npm run desktop:verify` passes on unsigned arm64. Its real packaged
Git reader/bridge walk proves explicit listing and preview, unchanged workspace
and model-call count before Attach, exact saved preview despite a later source
edit, no model call until Send, unchanged index bytes/mtime, saved-only input and
full signed-in relaunch. Native dialog answers remain fixtures. The complete
local `npm run verify` remains the mandatory final landing gate; no GitHub CI is
used. Actual chooser/lifecycle review, signing/notarization, Intel and live-service
acceptance remain separate release evidence.

The first complete verifier attempt did not pass: its Node lane exposed a
missing Git-browse module in the packaged dependency test's expected closure,
and the Sheet reader keyboard check targeted the last row coordinate rather
than the rightmost column. The dependency expectation is repaired. The Sheet
walk now selects the explicit column heading and asserts its table-header
precondition; that assertion was watched fail against the old selector. Scroll
containment and timeouts are unchanged. The interrupted verifier and diagnostic
runs do not count as acceptance. The final frozen revision passed the complete
trace-enabled local verifier: all five lanes and 689 browser tests in 750.3
seconds. Post-verifier diff review found no confirmed blocker; `db44a107` was
committed and pushed to main with a clean worktree.

## Completed checkpoint: person-approved local Commission programs

Autonomous direction (2026-10-13): complete the existing Commission MCP workflow
for person-owned local stdio tools on desktop. Conversations, Contributions and
Routines already have the native process boundary; Commissions should reuse it
under their own reviewed permission, not infer authority from setup or a Routine.
The private grant freezes exact local connection identities, and admission,
effect dispatch and publication each require the separate native capability.
Existing HTTP grants retain their meaning. Hosted runtimes remain fail-closed.

The review labels local programs and requires a fresh unchecked acknowledgement
of normal OS access and possible startup effects. Startup failure withdraws its
exact current grant without retry; known results retain frozen transport history.
Restore/recovery preserve the existing global work-identity fences, including
backed-up open work that had no claim. No real user program or third-party service
is part of acceptance: tests use authored in-memory peers and an authored child.

Required gates: pure policy/provenance, store/route person walls and effect races,
JSON/SQLite restart and restore, rendered consent/recovery/history across five
viewports, and an isolated packaged child-process walk. The complete local and
desktop verifiers, UI sweep, diff review and direct main push remain required.
Signing, Intel, actual native dialogs, live providers/services and release
publication are separate outstanding gates, not implied by this checkpoint.

The focused policy/route/store/persistence/source checks pass 204/204, alongside
typecheck and the unchanged production build budgets. The general UI sweep
passes 135/135 cells with zero violations or skips. The first focused browser
run passed 11 of 12 walks; its one new test incorrectly queried the tool-choice
card after Review had unmounted it. Choice assertions now precede that transition,
while frozen labels are checked on the actual review. The second run exposed
an incomplete local fixture projection: it omitted transport and expected an
HTTP label. The fixture now returns the real actor-filtered connection view.
The complete Node suite passed 6,020/6,021; its sole failure was the old exact
desktop-verifier command list, now extended to include the new local walk.
At this point, the final frozen-tree browser/full-verifier runs remained
pre-landing requirements; verified completion evidence is recorded below.

The corrected browser run passed 11/12 and exposed a real WCAG target-size defect:
the foreign public Project's shared Comment action measured 56×18px at tablet
width. The inline-action primitive now owns a 24×24px minimum, with a watched-red
source lock, existing enumerated editor controls and the foreign Project scan.
UI-227 records the class-level fix. This broadens final visual acceptance to all
inline-action consumers through the full UI sweep and structured-editor walks.
The MCP fixture intentionally aborts SSE; its visible reconnect notice is not
evidence of a live-update regression or real-service acceptance.

Post-fix acceptance passes all 19 focused browser walks, the complete 135/135-cell
UI sweep with zero violations/skips, and the complete desktop verifier; the
local Commission walk is retained at
`.data/desktop-commission-local-smoke/run-WhxEJA`. Final review then found a
vacuous store refusal test: its supposed other-person tool selection was empty.
A new payload precondition was watched fail; the corrected test submits Grace's
real tool under Ada's otherwise-valid review and proves refusal without a policy
mutation. All 38 targeted policy/claim/registry/store/route tests pass. The active
full verifier was cleanly interrupted before this correction and is not a pass;
the final frozen-tree complete verifier remains required before landing.

Packaged local acceptance passes at
`.data/desktop-commission-local-smoke/run-9plYUb`, source ASAR
`f3823de1566dffb136608e5c0503bae400b0699b3cc5e8478bc6e50078ddbfb5`.
It proves known success and credit, startup failure without a tool call, exact
private provenance and usage retention across signed-in relaunch/revoke, and
actual SQLite replacement through the native managed-restore path with a fresh
safety backup. Reapproval never replays restored pending or unclaimed work;
new work still runs. Native dialog answers and relaunch spawning are fixtures.
The full `npm run desktop:verify` also passed, including the local Commission
walk at `.data/desktop-commission-local-smoke/run-pCaDzp` and all existing native
phases. At that point, the complete local verifier remained required. This
evidence is not a signed, Intel or live-service release gate.

Completion was recorded at `af04e73f` after verified final2 evidence: all five
local verifier lanes passed in 767.5 seconds, including 685 browser tests across
the four shards (148 + 189 + 184 + 164). The complete desktop verifier exited 0;
the UI sweep passed 135/135 cells with zero violations and zero skips. The
latest packaged receipt is
`.data/desktop-commission-local-smoke/run-WhxEJA/receipt.json`. This closes the
checkpoint's local implementation gates without closing signing/Intel,
real-provider or third-party-service acceptance.

## Completed checkpoint: Commission native restore and shutdown

Autonomous direction (2026-10-13): prove Commission MCP's existing explicit
restore boundary through the actual native lifecycle, not only a backup read.
The isolated unsigned-arm64 walk must select the chosen managed backup, retain
a fresh safety copy, exit and independently relaunch signed in. Exact known
claims and settled model usage survive; pending effects become uncertain and
restored open work remains blocked after reapproval, including work with no
claim before backup. New distinct work must still execute. Only native dialog
answers and relaunch spawning are fixtures, alongside existing loopback admission.

Review also found that the Commission executor dropped its caller AbortSignal
at the MCP effect boundary. Link it to the existing bound executor so shutdown
can cancel an outstanding HTTP request promptly. This is not a new Commission
Stop UI or a promise to undo external effects. Retain the Guardian lease and
worker slot until settlement; preserve known late results without completion
credit, and keep unknown effects uncertain and non-replayable. Unit and actual
loopback HTTP regression checks were watched fail before the fix.

Native positive acceptance passes at
`.data/desktop-commission-mcp-smoke/run-LVOW2U` on source ASAR
`b6641246b5a1ac31b8d654f5dba7dec01fca9dca6b3425e7cf426e7fcc64c36a`.
Five preparations and five calls produce three known completions and two
uncertain receipts; restored queued work has no claim and never executes.
The first run correctly exposed the old expectation that graceful shutdown
would leave a pending row; it now asserts durable uncertainty before exit.
The next run refused the fixture's noncanonical temporary path without changing
data; canonicalizing only the fixture path passed the unchanged product guard.
Review strengthened exact interrupted-receipt comparison and observation of
the unclaimed queue across a full worker cadence before backup.

Disabling just the registry guard in a disposable copy did not defeat the
independent queue/admission checks. With all three restored-work guards disabled,
the native negative control failed at the actual fifth call where four were
expected (`.data/desktop-commission-mcp-smoke/run-Wzicsh`). No product guard was
removed. The final full local and desktop verifiers remain pre-landing gates;
their outcomes are recorded in the checkpoint handoff. Signed/Intel, actual
OS-dialog, public-service and paid-provider acceptance remain separate.

## Completed checkpoint: explicit Routine Stop

Autonomous direction (2026-10-12): expose Stop for one exact queued or active
Routine run, separate from Pause (future cadence) and Revoke (tool authority).
The missing control was verified across route, worker and UI surfaces. Stop
persists a distinct `cancelled` outcome, presented as Stopped, before best-effort
worker interruption. It preserves history and known external receipts; pending
calls become uncertain and trigger the existing pause/review policy. It does
not promise to undo external effects or erase already incurred model usage.
Exact run identity survives retries, so a delayed Stop cannot target a newer
run. Completion that wins the race remains completed. All access doors retain
the route-owned ownership policy.

Required acceptance: queued/active worker races, owner/shared-reader walls,
failed-commit ordering, JSON/SQLite restart, rendered held/lost-acknowledgement
flows and five-size review, plus real packaged authored-child Stop and relaunch.
The full local verifier, UI sweep and desktop verifier remain pre-landing gates.
This checkpoint does not close signing, Intel, live-provider, public-service or
remaining product-scope gates.

Checkpoint review caught three frontend gaps: absent ownership exposed Stop,
private MCP history treated cancellation as failure, and consequence prose
clipped inside a hover-only icon cluster. Literal ownership, exhaustive outcome
labels and wrapping in-flow disclosure now have regression locks. The full
135-cell sweep passed before these leaf corrections; final focused screenshots
and seven browser walks pass. Packaging then correctly refused a 501,466-byte
section-page graph against the unchanged 500,000-byte limit. The cadence editor
is extracted into an on-demand leaf with explicit loading/failure recovery.
Follow-up review retains one measured popover shell across lazy body swaps and
makes failed Stop-controller loads visibly recoverable without losing exact
intent. Negative regression locks cover discarded load-failure intent; new
browser walks cover real chunk refusal and five-size loading/loaded geometry.
The current product revision passes typecheck, the unchanged production build
budget, 17 focused browser walks, and the complete 135/135-cell UI sweep with
zero violations or skips. Native Stop itself proves real child exit and durable
stopped history across relaunch. The desktop verifier found two acceptance
harness gaps after that stage: an ambiguous uncertain-receipt selector and a
queued-history read before the Run response. Both now name the exact run and
wait for durable acknowledgement. The corrected local-native walk passes at
`.data/desktop-routine-local-smoke/run-RoECQf`, including real managed restore and
its safety copy. Short-landscape footer scrolling and final unobstructed mobile
error screenshots pass; the latter wait for the closing drawer's rendered width,
not just its logical inert state. Complete `desktop:verify` now passes, including
the local Routine walk at `.data/desktop-routine-local-smoke/run-8deyIb`. The first
full local verifier rejected the extracted shell's missing popover enumeration
and a button-face forwarding shape the size scanner could not follow; its
remaining browser shards were gracefully interrupted, not counted as passing.
The primitive locks now account for both the stable shell and every lazy-body
button using the forwarded face. Negative cases reject unsized bare/conditional
uses, unused sized templates and stale receiver wiring; 62 focused primitive,
component and repository locks pass with no product-source changes. The second
full verifier isolated one remaining stale deletion-menu assertion: it expected
only the prior edit/delete holds instead of also retaining exact-run Stop
recovery. The corrected lock was watched fail with that Stop hold removed, then
the production source was restored. The complete checks lane then passed,
including within a full run. Adversarial review found a further test-only gap:
non-template conditional or aliased uses of the forwarded button face could
escape sizing checks. Complete recipient-use accounting now rejects those
forms as well. Interrupted full runs remain failed gates, not partial acceptance.
Landing requires complete `E2E_TRACE=1 npm run verify` on the frozen revision,
followed by diff review. The exact staged revision subsequently passed all five
local lanes and 682 browser tests in 735.2 seconds; final diff review passed and
`db24037f` was committed and pushed to `main`. The working tree was clean.

The independent Commission checkpoint above now extends the earlier backup-only
evidence through native restore. Routine evidence alone did not close that gate.

## Current milestone: person-approved local Routine MCP

Autonomous direction (2026-10-12): let a person run an existing configured local
MCP program from a Routine after a separate, explicit unattended review. This
closes a core desktop workflow gap; it does not turn connection setup, OAuth,
Contribution consent or an HTTP Routine grant into permission to launch local
code. The program retains normal OS access and may have startup effects before
any tool request. Tool bounds are not a process sandbox or a money ceiling.

The implementation proceeds through these required checkpoints:

1. Strict portable opt-in and private person/transport provenance, separate from
   HTTP/OAuth authority, with immutable queued permission and receipt history.
2. Person-scoped store, persistence and native execution integration; explicit
   unchecked local-program acknowledgement in the existing Routine review;
   truthful launch/failure disclosures; revocation, disconnect and restore
   fencing before admission. A local failure must not trigger an automatic
   relaunch under an assumption that a missing tool result means no effects.
3. Authored-child browser and real packaged acceptance: reviewed execution,
   private durable results, cancellation/revoke, signed-in full relaunch,
   uncertainty without replay and explicit backup restore. Signed, Intel and
   real third-party acceptance remain separate release gates.

Checkpoint 1 is complete: literal `localPrograms: true` is a distinct review
choice; absence grants no local authority. Private local connection IDs and the
approving person cannot be relabeled as OAuth or legacy HTTP. Mixed grants
require the same person and disjoint exact connection sets, and local receipt
transport is derived from the frozen local stamp.

Implementation checkpoint, 2026-10-12: local Routine execution is integrated
through native runtime capability and explicit person consent. The private
catalog/grant/history retain exact bound snapshots and `transport: 'stdio'`.
JSON/SQLite history admission is structural and independent of runtime
availability. A startup failure without a result pauses the Routine, revokes
current local grants and does not retry automatically. Explicit restore revokes
current local grants, pauses affected tasks and terminalizes restored unfinished
frozen-local runs, including queued runs without receipts, while retaining known
receipts; a completed historic local run alone does not revoke a newer
HTTP-only grant. The Routine review includes a separate unchecked acknowledgement
for normal OS access and possible startup effects. This acknowledgement is not a
sandbox, and web execution is unavailable.

The browser suite uses an in-memory injected stdio peer, not a child process;
it covers separate consent, private receipts and account walls. The local
registry/store failure locks were watched fail when startup-failure protection
was removed, then restored. The shared UI sweep passed all 135 cells with zero
violations or skips. A model integration defect was also caught: Routine model
tool projection rejected stdio unconditionally, so an approved Routine
received no tools. The host now passes literal `localPrograms: true` only for
local Routine work, and model exposure requires the private frozen permission's
`stdio` transport to match the inspected connection transport.

The new `npm run desktop:smoke:routine-local` lane is integrated into
`desktop:verify`. Its unsigned macOS arm64 run passed in an isolated profile,
with evidence in `.data/desktop-routine-local-smoke/run-Lp9rPr`, against an
authored child process in a disposable ASAR copy. The source ASAR hash remained
`e1b94fe4ff6fff8b219dc94bf009fc3fe51d47abb6469d860598a66188e0eef9`. It covers
rendered setup Cancel then fresh Allow, separate unchecked Routine consent reset
on Back, scheduler → model → child execution and output, private SQLite receipt,
OS-vault custody, signed-in full relaunch without replay, revoke, startup
failure fenced before `tools/call`, pending-to-uncertain restart, and actual
managed-backup restore with a safety copy and unfinished queued work
terminalized without launch. Native OS-dialog answers and automatic relaunch
spawning remain fixtures. Same-organization person walls remain in-memory
browser evidence, not new native evidence. Feature-specific receipts do not
substitute for mandatory full local and desktop verification before landing.
A negative restore mutation in `.data/desktop-routine-local-smoke/run-INgziY`
failed at the expected `active` versus `interrupted` phase. Authored-child
browser coverage and revoke during an active call remain open; completed-result
revoke is covered, and the Routine Stop checkpoint above now proves active-call
cancellation. Signed/Intel, actual-dialog, live third-party and
paid-provider acceptance remain separate gates.

The previous Commission acceptance checkpoint landed as `05640a35`: the complete
desktop verifier passed, followed by all five local verifier lanes and all 673
browser tests in 725.1 seconds. That restart-only result did not close packaged
Commission explicit restore; the current checkpoint above adds that evidence.
Apple residence/account-region input remains pending, and
release/live-service prerequisites above are unchanged.

## Completed implementation milestone: explicit Commission MCP execution

The first real Commission MCP path implements
one exact HTTP MCP call per posted `mcp.mutate` work item. It is a fresh,
person-private owner opt-in, separate from standing Commission settings and
Routine approval. Each grant pins the reviewed Project/Commission/Agent,
provider/model, live review hash, selected connection revisions and tool
schemas, fixed arguments, expiry (at most 30 days) and work limit (at most 100).
These are scope bounds, not provider or external-service monetary caps. Local
stdio, legacy connector fulfilment and Agent proxies remain outside this path.

Admission now shares active capacity with real Dispatch: at most four active
calls per process, two per paying tenant and one per tenant/Agent. The worker
performs one bounded, tool-free model preparation under a durable usage hold,
then reserves and submits at most one exact HTTP effect call. It rechecks current
membership, role/reach, Project fire, Guardian, connection/tool schema and
publication authority across asynchronous waits. Only verified success on
current work earns completion credit. Failed or uncertain outcomes never replay
and withdraw only the exact grant revision that authorized the claim, so a newer
replacement grant is not accidentally revoked. Claims are globally unique by
Project/work item across renewals and grant replacement.

The public work projection includes `commissionResolution: 'mcp'` only when the
exact done item joins to its canonical successful durable claim; the field is
recomputed and stripped from stored rows rather than trusted or persisted.
Work timelines label those rows `Real MCP` and treat unmarked legacy Commission
completions as `Simulated`. Both Project and Agent Contributor rosters use the
same local per-Project real/simulated counts, without exposing private receipts.

JSON/SQLite startup recovery commits pending work to uncertainty before new
admission. Explicit backup restore revokes all Commission MCP grants and blocks
restored open MCP work IDs for manual review; this is local recovery policy, not
an anti-rollback ledger or external exactly-once guarantee. Local usage holds
apply only to this Commission path and do not provide a universal billing limit.
Snapshot v7 requires an exact claim-to-usage-receipt join. Its v6 migration adds
zero-usage receipts only for the absent legacy slice, because v6 had no model-I/O
host; present partial ledgers fail admission without replacing stored data.
Focused unit/source coverage and all nine feature browser checks have passed,
including five-size approval/receipt review, signed-in person isolation and
same-request lost-acknowledgement recovery. The app-wide UI sweep passed all
135 cells with no violations or skips. The milestone landed as `6a64b113` after
the frozen-tree complete verifier passed all five lanes and 673 browser tests
in 723.3 seconds. This is local test evidence, not release acceptance.
There is no signed, public-service or paid-provider acceptance
evidence, and the broader MOCK-9 boundary remains open. Existing standing
configuration remains unchanged. The feature-specific UI keeps the frozen
review distinct from the current grant and exposes exact receipts through the
existing recovery surface.

### Packaged Commission acceptance

The separate `desktop:smoke:commission-mcp` lane now exercises the actual
unsigned-arm64 app with a generated profile and authored local peers. The
original executable refuses loopback before contacting the peer. Only a
disposable ASAR copy permits that destination; the shipped startup policy and
source archive remain unchanged, and acceptance helpers are excluded from it.
This lane is included in `desktop:verify`, never ordinary signed-candidate smoke.

Rendered review alone and legacy Standing do not execute. Explicit approval
produces one tool-free model preparation and one exact MCP effect. The OS vault
keeps the canary token encrypted; SQLite retains exact private owner/claim/result
and reported usage, while shared work exposes only derived Real MCP provenance.
Foreign Project readers and outsiders cannot read the approval or receipts.
Full signed-in relaunch preserves known history; rendered revoke leaves new
work open. A submitted call is pending on disk before exit, then becomes
uncertain at startup with its grant withdrawn and no credit. Renewed approval
does not replay that item; only new work executes. Managed backup retains the
exact private ledger without the raw credential.

The first acceptance attempt exposed a read-only harness query that treated an
array slice as a singleton; the corrected query passed. A separately mutated
disposable package with startup recovery disabled failed the rendered
`Outcome uncertain` assertion, proving this is non-vacuous recovery evidence.
The first complete desktop gate then found the older Document migration fixture
still required snapshot v6 after the Commission store advanced to v7. Its
compare-before-write guard now requires the authoritative current version and
still stages the same v5 Document case without changing unrelated ledgers.
The [acceptance record](acceptance/commission-mcp-2026-10-12.md) identifies the
artifact, evidence and limits. Same-workspace person isolation remains covered
by the browser test's explicit identity fixture, not this native walk: the
production account switch deliberately has no arbitrary tenant re-mint.
The current checkpoint above adds explicit native restore and linked shutdown
abort to this earlier acceptance. Public TLS/services, paid providers, signing,
native Intel and actual restore-dialog acceptance remain separate. Final local
and desktop verifiers remain mandatory before landing each checkpoint.

### Earlier account-change verifier checkpoint

The first full verifier passed its checks lane and three browser shards, but an
OAuth account-change fixture lost its awaited evaluation context after the
transition ran. The trace contains no document navigation at that point; the
original test passed twelve isolated diagnostic repetitions, so the underlying
protocol failure is not established. The three related fixture walks now retain
the real transition function before opening review and invoke it synchronously,
with an additional generation-change assertion. UI disappearance and exact
native cancellation assertions remain unchanged; no error is swallowed, timeout
is widened or retry added. The corrected frozen-tree run passed all five lanes
and 671 browser tests in 712.7 seconds. The complete local verifier remains the
gate for the final revision, including this evidence update.

## Completed checkpoint: interrupted verification owns its cleanup

The native local-MCP acceptance checkpoint landed as `06e80fcc`. During that
checkpoint an interrupted verifier left four isolated test backends holding
their ports, and the next run failed on address conflicts. The exact owned
processes were identified and stopped before the final clean verifier passed.
This is a demonstrated delivery defect, not a new product feature.

The verifier now coordinates SIGINT/SIGTERM, stops queued steps, waits for
owned-process cleanup and cannot report success or publish timing weights after
interruption. Playwright lanes receive SIGINT so their own teardown runs. The
dev launcher waits for actual child closure with bounded TERM-to-KILL escalation;
the Playwright web-server configuration allows that cleanup to finish. POSIX
group ownership includes surviving descendants, not just a departed leader.
These guarantees cover controlled interruption, not an uncatchable SIGKILL of
the supervisor or arbitrary daemons that detach themselves from its groups.
Windows descendant-tree acceptance remains unproved.

Disposable-process regressions reproduce early launcher/verifier exit and
check actual port release. A real installed-Playwright fixture exercises the
web-server teardown boundary without external services or the owner's store.
The complete local verifier and post-test diff review remain the landing gate.

The first full verifier found a fixture-only port-allocation race: the new
Playwright lifecycle test probed and released an ephemeral port before starting
its child, and concurrent traffic occupied it before bind. Fixtures now let the
OS assign their ports at the actual server bind and read the resulting readiness
records; no retry or timing budget was widened. Controlled SIGINT of that
already-failed full verifier exercised all four real browser stacks: it exited
130 and all twelve shard UI/API/model ports were immediately bindable, without
manual orphan recovery. That interrupted attempt is not a passing gate; the
corrected frozen tree then passed the uninterrupted complete local verifier as
recorded above, followed by diff review and direct main delivery.

The owner requested help enrolling for Developer ID as an individual/sole
proprietor. Mainland China versus US enrollment details are still being
clarified; no membership purchase, credential use or release publication is
authorized by this checkpoint. Signing, native Intel and live update acceptance
remain open after this local verification repair.

## Previous checkpoint: actual native local-MCP consent acceptance

On 2026-10-12 the owner unlocked the Mac and the unchanged unsigned-arm64
package passed `npm run desktop:smoke:stdio -- --native-review`. Actual native
Cancel left the exact connection unchanged with no process or encrypted grant;
fresh Allow enabled inspection only. Separate rendered per-call consent,
interactive and Contribution results, interrupted-history recovery, signed-in
full relaunch without redispatch, and Disconnect/removal all passed afterward.
The source archive remained unchanged. The [acceptance record](acceptance/native-mcp-stdio-2026-10-12.md)
identifies the exact revision/archive, observed controls, isolation, evidence
and unsuccessful UI-control attempts. No deadline or test assertion was relaxed.

This closes the actual-dialog gap for the authored local-MCP workflow only.
It does not establish arbitrary third-party-server safety or substitute for
public-service, signed/notarized, Intel or real update-installation acceptance.
No product behavior or execution authority changed in this checkpoint; complete
local verification and diff review remain mandatory before direct main delivery.

The release-blocker audit found no concrete implementation defect in the
signed-pair/update path. No completed release directory was present. The signing
identity, notary Keychain profile and update-base environment configuration were
absent from the current process; this is not evidence that credentials are
absent from the device. Next, obtain authorized release configuration and native
Intel execution, then validate both signed candidates and a real two-version
update. Do not invent a download destination, inspect secrets, publish or spend
without separate authority. Preserve the remaining live-service and hosted
deployment requirements rather than declaring fixture coverage production-ready.

The cross-sheet checkpoint landed as `2d2d7a54`: all five complete local verifier
lanes (671 browser tests), 135/135 shared UI cells with zero violations/skips and
all 142 captures reviewed, and rebuilt unsigned-arm64 ordinary packaged smoke
passed after the final duplicate-pane regression repair.

## Previous checkpoint: bounded cross-sheet workbook formulas

Autonomous direction (2026-10-12): make summary and detail tabs useful together.
Authored formulas may reference another tab in the same artifact using
`Detail!A1` or `'Detail tab'!A1`; quoted names escape apostrophes by doubling them.
Name lookup is case-insensitive and ambiguous or missing names fail closed.
Unqualified references remain relative to the formula's own tab. SUM ranges
may name one target worksheet, never span worksheets or external workbooks.

One workbook projection supplies editor/read views, saved-copy model text and
values-only XLSX exports. Dependency depth, cycles and the 100,000-step work
budget span the whole workbook; exhaustion marks all formula cells, not a
partially successful subset. Stored source and the existing whole-body mutation,
history, access, replay and restart boundaries remain authoritative.

Worksheet rename is an explicit inline transaction rather than per-keystroke
mutation. Pending name drafts block Save/Create until applied or cancelled.
Saved-editor name drafts share the account-scoped editor lifetime across duplicate
panes and navigation; the controller also refuses Save while any name is pending.
They never enter body history or a server payload.
Keyboard Undo in a transient worksheet name edits that text rather than traversing
unrelated body history; the shared keyboard scope recognizes the explicit field
marker while toolbar Undo remains whole-body.
Prototype-shaped admitted worksheet IDs retain the same name-draft hold; the
regression was reproduced before replacing dictionary assignment with own-key
construction. Post-gate review found the same class of identity in a second
pane's untouched error dictionary: `__proto__` rendered an inherited object and
unmounted that editor. The real duplicate-pane regression was watched fail;
error display now also requires an own key. The final complete gate passed with
that rendered regression and correction before delivery.
Stable-ID rename/removal and row/column deletion rewrite all supported references
against the complete pre-image, preserve unrelated source bytes and refuse
source-budget overflow atomically. Deleted targets become explicit `#REF!`
tokens, so reusing a tab name cannot redirect an already bound reference. Undo
restores the entire prior workbook, including source and order. Unsupported or
malformed formulas are retained verbatim, not partly rewritten.
Adversarial review reproduced a malformed range outside SUM being rewritten by
a structural edit. Grammar admission now rejects that placement before rewriting;
the failing regression preserves the exact invalid source through edits.

The size-gate audit found that Vite's preload map was added after measurement.
The gate now runs after build-import analysis and measures final emitted code;
the existing 800,000-byte initial and 500,000-byte async budgets are unchanged.
Optional proposal displays load behind local, announced loading/failure states
that keep their surrounding conversation or page and cannot grant authority.
Contributor configuration and Agent proposal review also load on demand, with
bounded, dismissible recovery shells and unchanged acknowledgement-owned writes.

No external data access, imported-formula execution, Excel compatibility, new
backend operation, or persistent computed authority is added. The focused browser
walk passed all 22 cases; five-viewport owner/shared/foreign and loading/recovery
captures were reviewed. The shared UI sweep passed 135/135 cells with no violations
or skips, with all 142 captures reviewed. The additional short-landscape keyboard
walk proves lower contributor permissions scroll into view; its geometry lock
allows one CSS pixel for native integer-scroll/subpixel-layout rounding.
Rebuilt unsigned-arm64 ordinary smoke passed, including actual rendered named-tab
formula source and result before and after full app relaunch. The complete frozen-tree
local verifier passed before direct main delivery.
Signed/notarized, Intel, actual native-dialog, update-installation and live-service
release gates remain separate. The owner's preview and data remain untouched.

The next self-approved checkpoint is a release-blocker audit: reconcile the
remaining mock boundaries with the desktop-v1 workflow and release evidence,
then address the highest-impact locally verifiable gap. Do not expand the formula
language or treat fixture success as live-service acceptance. Credential use,
spending and public release still require separate authority.

The authored same-sheet checkpoint landed as `2ddf0c2e`: all five complete local
verifier lanes (660 browser tests), 135/135 shared UI cells with no violations or
skips, five-viewport formula/import/blocked-module review, and rebuilt
unsigned-arm64 ordinary packaged smoke passed.

## Previous checkpoint: explicit bounded authored Sheet formulas

Autonomous direction (2026-10-12): add a deliberately small calculation language
to first-party Sheets. Text stays literal, even when it starts with `=`; Formula
is an explicit cell mode stored as a closed source record. A1 names the first
data cell, not its heading. Support finite decimal/scientific numbers, same-sheet
references, arithmetic, parentheses and SUM with rectangular ranges. Unsupported
syntax, missing references, nonnumeric text, division by zero, nonfinite results,
cycles and excessive work produce visible errors, never guessed values.

One framework-free evaluator supplies read views, editor previews, complete
saved-copy model text and values-only XLSX downloads. Formula source remains
visible and searchable; saved history distinguishes it from identical literal
text. Imports and range paste remain literal. Row/column deletion adjusts valid
references, shrinks ranges and marks deleted targets explicitly. No cross-sheet
or external references, executable code, Excel compatibility, imported-formula
execution or live-source access is claimed.

Formula source shares existing 2,000-character cell and 20,000-character workbook
limits. Calculation bounds are 256 tokens, 32 expression levels, 64 formula
dependencies, 6,400 cells per range and 100,000 work steps per sheet. Whole-sheet
work exhaustion replaces every formula result with a limit error; literal cells
remain intact. Model copies retain their whole 64-KiB budget including derived
values. The 800,000-byte cold-JavaScript budget is unchanged; optional account
menu and usage-detail content load separately from their always-visible controls.

Acceptance covers real create/edit/CAS/replay/history/restore, JSON and SQLite
restart, model copies, values-only exports, literal clipboard behavior, and the
owner/shared/foreign account faces at five viewports. Complete local verification,
the shared UI sweep and rebuilt unsigned-arm64 ordinary smoke precede delivery.
The owner's live preview/store remains untouched; signed/notarized, Intel,
actual native-dialog, update-installation and live-service release gates remain.

The feature acceptance walk and all 135 shared UI cells passed with zero
violations or skips. Review caught accessor-bearing cell input, phantom formula
replacement counts in newly pasted space, and a deferred Usage fallback missing
the shared containment hook. Each regression was watched fail before repair.
The Usage fallback now owns its own viewport containment and explicit warned
reload; its blocked-module five-viewport walk supplements normal loaded states.
These are implementation checks, not production native or live-service evidence.

The first complete gate exposed an import-focus regression from the new cell
toolbar and shared test-budget exhaustion after the expanded tool schema. Import
adoption must focus the first column heading after the new grid is committed;
model-turn acceptance must own its usage partition and assert successful
generation before checking downstream output. Production spend limits and
verification timeouts/retries are unchanged. A second-tab formula journey adds
explicit workbook identity, same-tab calculation, export and restart evidence.

The recursive served-folder checkpoint landed as `9bb62c10`: all five complete
local verifier lanes (657 browser tests), 135/135 shared UI cells with zero
violations/skips, and rebuilt unsigned-arm64 ordinary smoke passed. Its final
grant-narrowing regression was watched fail before the final verifier pass.

## Previous checkpoint: recursive saved folders across served sources

Autonomous direction (2026-10-11): extend the established saved-copy workflow to
nested cloud and mapped-runner folders. Include subfolders starts unchecked;
selecting it creates a strict v2 recursive capture. Omitted scope and all existing v1 copies
stay flat. Every nested file keeps its complete root-relative name, including
same-named files in different directories. Refresh retains the original scope;
changing scope requires removing and reattaching the folder.

Capture reuses the native tree path/text policy: 16 levels, 64 visible
subdirectories (including empty ones), 500 enumerated entries, 24 readable files,
64 KiB/file and 128 KiB total saved text. Hidden paths, links and special files
are excluded. Traversal overflow or changed directory identity/version refuses
the whole capture. Runner traversal follows current list grants without exposing
sibling names; body reads need separate read authority. This remains a sequential
bounded saved copy, not an atomic filesystem image or live browsing permission.

Acceptance covers real authored filesystem fixtures, scope-pinned intake and
Refresh, same-basename model input, failed/replayed Refresh, shared/foreign
account walls, and source-absent JSON/SQLite restart. Full local verification,
five-viewport feature review, the shared UI sweep, rebuilt unsigned-arm64 package
and ordinary smoke precede direct main delivery. The owner's live preview/store
remains untouched. Native-dialog review still requires an unlocked Mac; signing,
Intel, update installation and real-service release gates remain open.

The first complete local pass exposed a 202-byte cold-JavaScript budget overrun,
despite all 5,679 Node tests and 657 browser tests passing. Consolidated served
entry/Refresh URL builders and one selected file-list validator remove repeated
code without changing read timing or raising the 800,000-byte cold-graph limit.
Exact encoded route tests protect the refactor. The corrected product passed all
five complete local verifier lanes (657 browser tests), all 135 shared UI cells
with zero violations/skips, and rebuilt unsigned-arm64 ordinary packaged smoke.
Post-test review found no code defect but added explicit post-body-read runner
grant-narrowing coverage, including an empty-directory traversal-only case. The
complete verifier must pass again with these final regression locks before landing.

The reviewed next core direction is bounded calculation in first-party authored
Sheets (MOCK-2 / FWD-9), not additional marginal recovery refinements. Use a
deliberately limited shared formula grammar, authoritative derived values and
explicit unsupported/cycle/arithmetic errors. Editing, dependency updates,
model input and export must agree. Keep existing XLSX intake as a disclosed
cached-value projection; do not imply Excel compatibility, execute formula code,
or add external-data access. This direction is self-approved under the owner's
standing delegation; implementation follows this checkpoint's landing.

The previous checkpoint landed as `fd9bf7d3` after all five local verifier lanes
(651 browser tests), 135/135 UI cells and both ordinary and cancel-first local
MCP unsigned-arm64 packaged smokes passed. Actual native-dialog acceptance was
not claimed.

## Previous checkpoint: truthful local MCP consent and cancellation acceptance

Autonomous direction (2026-10-11): complete the existing local MCP acceptance
boundary before adding new execution authority. Review found that all three setup
disclosures still excluded Contributions after COMMONS-42 made separately
approved, person-owned Contribution calls available. A shared contract disclosure now names conversation
and Contribution per-call approval while keeping Routine local execution
unavailable in the connection page, setup form and native consent dialog. Source locks and the existing five-viewport setup walk cover this
correction; no permission or execution behavior changes.

The packaged stdio walk now requires Cancel before a fresh configuration and
approval. Cancellation must leave the exact public and private connection
unchanged, create neither a child trace nor an encrypted launch grant, and allow
a new setup from the rendered Configure action. The disposable fixture refuses
the first exact launch, approves only the second, and refuses mismatched input.
`--native-review` instead requires both actual dialog choices on the unchanged
original app. Subsequent exact catalog, separately approved call, Contribution,
relaunch and Disconnect evidence remain mandatory.

The Mac was locked during the readiness audit, so actual native-dialog review
remains unverified; fixture approval cannot close that gate. Signing identity,
notary Keychain profile and update-host configuration were absent from this
process environment, not proven absent from the device. Signed two-architecture,
Intel-native, real update installation and public-service acceptance remain open.
The owner's live preview/store is untouched. The previous checkpoint landed as
`72bebbc5` after the final complete verifier (5,659 Node and 651 browser tests),
135-cell UI sweep and rebuilt ordinary unsigned-arm64 smoke passed.

## Previous checkpoint: item-first reviewed MCP proposals

Autonomous direction (2026-10-11): make **Work this item now** a direct path from
an exact open MCP item to a reviewed Contribution. Select an inspected matching
tool, use the existing owned-Commission/model draft helper, and edit the chosen
arguments on the item page. No empty Contribution or repeated tool setup is
needed. The optional prose response and manual Contribution paths remain usable.

**Publish contribution** is an explicit sharing act: it saves
the linked Contribution and one unapproved v1 exact-call envelope atomically.
The server derives the item target, cardinality of one and explicit-call harness;
current visibility, open work, person-owned connection and schema admission must
still hold after asynchronous validation. Rejected preparation leaves no empty
Contribution. Exact keyed replay returns represented history without recreating
or amending it. Raw edited JSON and detached nested submitted arguments remain
account-scoped across navigation and uncertain acknowledgement.

Drafting remains tool-free and workspace-private; publishing shares only the
reviewed title, summary and plan with Project readers, not the model conversation
or Commission identity. Approval, separately confirmed Run and Project-owner
Land/resolution remain distinct. This is supervised human publication of an
Agent-assisted proposal, not unattended Commission execution or Agent credit.

Acceptance covers the complete item-to-proposal-to-receipt-to-resolution path,
invalid/stale/person-bound refusal, lost-response recovery, atomic JSON/SQLite
retention and five-viewport account review. Full local verification, the shared
responsive sweep and post-test diff review precede main delivery. Use isolated
profiles and authored peers; preserve the owner's live store. Public-service,
paid-provider, actual native-dialog, signed/notarized and Intel acceptance remain
separate release gates.

The five focused browser journeys pass: complete item-to-result resolution,
invalid/stale refusal, exact Dispatch recovery, exact publication recovery and
shared-reader/private-draft separation with an explicit foreign wall after
unsharing. All 85 feature captures and all 135 shared surface/viewport cells
were reviewed; the shared sweep reports zero violations and zero skips.
Review moved model suggestions ahead of the editable call; adoption closes
the helper and focuses the editor, so Publish follows the reviewed arguments.
It also corrected the shared status-badge contrast and visibly disables all
three draft fields while their exact model request is held. Watched-fail
source locks, rendered hold/release checks and exclusion-free accessibility
checks cover those findings; no retries, timeouts or quality budgets changed.
The complete local verifier and rebuilt unsigned-arm64 ordinary native smoke
remain the final pre-push gates, not evidence of a signed or real-service release.
The first complete gate caught an unintended collapsed Contributions ledger in
six existing browser journeys and the section-default source lock. Saved linked
Contributions retain their prior content-open default; only the new proposal
action form starts collapsed. The new browser journey now requires the resolved
row already visible instead of opening that fold on demand. The prose-draft
source lock also follows the explicit prose/MCP hold split.
All 15 focused journeys across the existing linked-work, model-draft, local
Contribution and new item-first proposal suites pass on the corrected tree.
The corrected product tree then passed all five full-verifier lanes (5,657 Node
tests and 651 browser tests). Rebuilt packaged acceptance exposed an independent
Git-smoke race after returning to a conversation: the test sampled zero replies
before the two saved replies hydrated, then miscounted the new reply as three.
The native harness now waits for each fixture's exact prior reply count before
sending and still requires exactly one additional reply. A watched-fail ordering
and baseline lock protects that precondition; no product behavior, retries or
deadlines change. Complete local verification and ordinary packaged smoke must
pass again on the final harness revision before delivery.

## Previous checkpoint: commissioned MCP argument drafts

Autonomous direction (2026-10-11): connect the existing private Project-work
draft workflow to the existing Contribution envelope editor. After selecting
an inspected tool for linked open MCP work, the owner may choose a read-capable
Commission and endpoint/model to draft arguments. One budgeted, tool-free first
turn receives complete frozen viewer-readable facts and the selected input
schema, together with the chosen Agent's configured system prompt and
instructions. It receives no callable tools, credentials or native launch settings.

The saved reply is strict bounded JSON for the exact tool. Explicit Use draft
arguments copies it into the editable JSON field only. Propose, Project approval,
separate Run and owner Land remain independent acts. A portable schema-binding
hash prevents adopting a draft under a changed person, connection revision or
schema. Current reads, open work and Commission revision also gate adoption.
Dispatch remains tenant-private history, not person-private storage or authority.
The drafting disclosure explicitly names workspace-member visibility of the
selected schema and reply; other Project viewers do not inherit that access.
Lost acknowledgements retain the exact selector and existing keyed recovery;
interrupted jobs never silently restart. Existing prose response drafts remain
a separate path and do not list MCP argument drafts as responses.

Acceptance uses authored model/MCP fixtures and isolated profiles. It covers
strict reply parsing, current-source gates, private visibility, held navigation,
no effects before separate Run, persistence, and five-viewport review. Full local
verification and UI review precede main delivery. Paid-provider, real-service,
signed/notarized and native Intel acceptance remain separate release gates.

The three focused browser journeys pass, including owner execution/resolution,
invalid or stale replies, and exact recovery after a lost Dispatch acknowledgement.
The shared-chrome sweep passes all 135 cells without violations or skips. Feature
captures additionally require the named state to intersect the viewport: DOM
visibility alone can hide an invalid-reply notice below the screenshot. Detailed
model-input inventory is expandable; cost, no-execution and workspace visibility
remain visible. Saved replies identify their original Agent, endpoint and model.
The lazy helper retains the existing bundle budgets without importing the large
navigation graph through its error boundary. Complete local verification and
ordinary packaged-native regression acceptance remain the checkpoint's final gates.
The first complete verifier exposed an outdated Dispatch consumer enumeration
and a shared browser-proxy cancellation race during account navigation. The
consumer lock now includes the helper and checks its fail-closed capability gate;
the browser proxy now forwards through one browser-owned request. A held-read
abort test reproduced the exact old late-fulfill failure before the correction;
all 12 focused fixture, OAuth and argument-draft journeys then passed. No retries,
timeouts, capability checks or bundle budgets were relaxed.
The rebuilt unsigned arm64 package and complete ordinary `desktop:smoke` pass,
covering existing startup, identity, draft, artifact and restore workflows. This
is native regression evidence, not new MCP-draft-specific native-dialog,
paid-provider, public-service, signed/notarized or Intel acceptance.

## Previous checkpoint: person-owned local Contribution calls

Autonomous direction (2026-10-11): complete the existing local MCP setup →
reviewed Contribution → saved result → owner-reviewed work resolution path.
A person-owned stdio connection may supply an exact inspected tool to a
Contribution. The connection owner proposes its arguments; Project approval
and a separate explicit Run remain required. Neither a native launch grant,
Project membership nor an approved envelope permits unattended execution.

The review identifies a local process with normal access to its owner's
computer, including possible effects merely from starting it. Public envelopes
and receipts retain an explicit local-process stamp and Project-visible
arguments/results, never private launch settings, grant references or person
authority. Legacy HTTP history retains its absent transport field. Admission
joins the stamp and exact person to the live or retired connection identity;
removal and historical envelope replacement cannot erase that provenance.

Reuse the existing native custody, exact-call executor and durable reservation.
Persist pending history and cardinality before starting a child; recheck owner,
connection revision, current Project/work authority and catalog at dispatch.
Interrupted attempts become uncertain without automatic replay. Local startup
can have effects even when no tool request succeeds; failed receipt copy must
not claim an effect-free program launch. Routine stdio, Commission execution,
Agent proxies and Contribution follow-up forms remain unsupported.

Acceptance covers authored-child execution, person/tenant/Project walls,
revocation and current-source races, strict JSON/SQLite recovery, five-viewport
owner/peer review and unsigned arm64 packaged success/interruption/relaunch.
Use isolated generated profiles and repository-authored children only. This
does not prove actual native-dialog, third-party service, signed/notarized or
Intel acceptance. Full local verification, UI review and post-test diff review
remain required before direct main delivery; the owner's live store is untouched.

The three focused browser journeys pass, with 50 state captures across the five
canonical viewport sizes. The shared-chrome sweep passes 135/135 cells with no
violations or skips. Both ordinary Electron and local-MCP packaged smokes pass;
the latter covers successful linked-work resolution, durable interruption,
relaunch without replay and revocation. Shutdown may persist an uncertain
receipt before exit or retain a pending one until restart; both must converge
to the same non-replayable uncertain state. These are authored-child, unsigned
arm64 results, not evidence for the separate release gates above.

## Previous checkpoint: reviewed Project-work resolution

Autonomous direction (2026-10-11): connect an exact open MCP work item to the
existing Contribution workflow. **Start contribution** creates an immutable
item link, not an exclusive claim or execution permission. The server derives
its sub-goal from the item. Multiple contributors may propose work; only one
successful resolution closes the item.

For this bounded first release path, the item must request `mcp.mutate` and its
target must name the exact MCP tool. Existing connection selection, envelope
approval and separately confirmed Run remain required. The Project owner may
**Land and resolve work** only after a matching successful saved receipt under
the current approved envelope. Pending, uncertain and returned-error attempts
prevent completion; model prose and fixture effects never count as evidence.
Landing and resolution persist atomically with one existing keyed landing
receipt. Attribution names the accepting owner and Contribution, not an Agent
or Commission; no Agent credit is awarded. Closed items cannot start another
linked call. Unattended Commission effects and proxies remain MOCK-9 gaps.

Acceptance must cover exact-link/owner walls, interrupted or refused execution,
changed envelope and closed-item races, lost acknowledgement and JSON/SQLite
restart, owner/visitor rendered controls and five viewport tiers. Preserve the
owner's live store; use isolated generated profiles. Full local verification,
UI review and post-test diff review remain required before committing to main.

The bundle gate exposed a shared count formatter importing the whole navigation
pane into the lazy Changes panel. Keep that pure formatter independently chunked,
with the existing graph budgets unchanged. The Changes form stays in one persistent
panel so switching actions does not discard its text. Admission also rejects a
linked persisted Contribution missing the event history its reader requires.
The complete design locks keep linked Contributions in the shared frameless
ledger and now scan both the canonical section component and its local alias.
Browser navigation acceptance waits for the actual lazy Changes section before
clicking a later row; a retained first-failure trace exposed its loading layout
being replaced during the click. No retries or timing budgets were relaxed.

## Previous checkpoint: private Project-work response drafts

Autonomous direction (2026-10-11): complete an explicit **Draft a response →
review → post comment** workflow before expanding unattended Project execution.
The Commission owner selects an existing read-capable Contributor and endpoint
model. A server-authored frozen prompt contains the viewer-readable Project
description/instructions, complete item facts and Commission role. The first
turn has no tools, ambient registries or linked contexts. A shared Project never
exposes its owner's private instructions to the visiting contributor's model.

Reuse real Dispatch's private durable conversation, capacity, Stop, exact keyed
replay and interrupted-restart behavior. Recheck open work, Commission revision,
ownership, sharing and Commission/Agent/both-provider/account token budgets
before committing the first prompt. The account owning the Agent pays; these
checks do not reserve a monetary ceiling. Drafting neither reserves nor resolves
the item and never awards Agent completion credit. Ordinary explicit conversation
continuation keeps its existing owner-controlled context and tool semantics.

Sharing is a separate, editable, bounded work-item comment. Only the reviewed
prose crosses into the Project; private conversation identity stays private.
Overlong replies are never silently shortened. Both model admission and comment
posting retain exact intent across navigation and lost acknowledgements. A
closed item cannot start a new draft. This is not a replacement for effect
approval, an unattended Commission runtime, or completion of MOCK-9.

Acceptance covers owner/shared/foreign reads, budget/refusal before I/O,
tool-free model wire and unexpected-tool refusal, full-source size limits,
JSON/SQLite restart, five-viewport rendered review/recovery and an ordinary
unsigned arm64 package's draft/review/comment/relaunch journey. Local model
fixtures are not paid-provider, signed/notarized or Intel evidence. Preserve the
owner's live store and outstanding recovery choice; use generated profiles only.
The full local verifier and post-test diff review remain mandatory before push.

The initial package gate caught new lazy controls importing the entire navigation
chunk through bundled shared policy. Keep pure role/Dispatch policy independently
chunked and extract the existing Dispatch form as a lazy leaf; retain all physical,
cold-start and async-graph budgets. The rendered review also exercises current-read
admission, exact reply hydration and account-fenced comment acknowledgement after
navigation, so previously posted prose cannot remain as an enabled duplicate draft.
Narrow-screen review also caught result actions starving timestamp text; shared
run metadata now keeps a readable wrapping basis, with five-viewport geometry locks.

## Previous checkpoint: explicit recursive folder snapshots

Autonomous direction (2026-10-11): make nested project context useful through
an unchecked **Include subfolders** choice on macOS folder Attach, not live
filesystem browsing. Old version-1 snapshots remain flat. Explicit recursive
copies use a closed version-2 record with root-relative file names; Refresh
preserves the reviewed scope and retries frozen bytes. Changing scope requires
removing and reattaching the folder. No source path or reusable read capability
enters a conversation, portable backup, model request or MCP response.

CTX-FS-27 reuses the bundled descriptor-relative helper and shared text policy:
24 readable files, 64 KiB per file, 128 KiB total. A traversal additionally
admits at most 500 raw entries, 64 visible subdirectories including empty ones,
16 levels and 4,096-byte relative paths. Hidden trees and symlinks are never
followed; exceeded limits or changed sources refuse the whole new capture and
retain the previous copy. Metadata and selected files are checked before and
after reading. This is a bounded sequential capture, not an atomic filesystem
image. Connect, listing, preview, send and relaunch still perform no body reads.

The startup-size gate remains unchanged. Shared exact-record validation replaces
duplicate snapshot guards without changing their enumerable/all-own-key policy;
Unicode guards retain valid astral text while refusing lone surrogates.

The complete checkpoint gate covers portable validation, native traversal and
races, exact account/owner checks, JSON/SQLite retention, rendered scope choice
and frozen Refresh, all five viewport tiers, and the packaged attachment walk
through nested duplicate basenames, hidden/link exclusion, source removal and
relaunch. The complete local verifier and post-test diff review remain required
before landing; outcomes belong in the checkpoint handoff. Use generated
sources/profiles only. The owner's live store and outstanding recovery choice
remain untouched. Actual native-dialog, signed/notarized and Intel release
acceptance remain separate; no automated dialog substitute closes those gates.

## Previous checkpoint: person-owned local MCP workflow

Autonomous direction (2026-10-11): finish the complete interactive workflow before
landing another internal-only checkpoint. Local process is an explicit transport,
not an HTTP endpoint. The person creates a metadata-only connection, prepares
device-private launch settings, and confirms a default-Cancel native warning that
the program has normal OS access. Settings travel only through trusted native IPC
and encrypted custody; portable records retain an opaque person-bound reference.
Routine and Contribution execution remain explicitly unsupported for this transport.

PORT-33 integrates trusted-cookie source/revision checks, post-rehydration native
binding synchronization, one-attempt inspection and receipt-only recovery with the
existing inspected catalog, attachment and separately approved interactive call.
Preparing, restarting and reconnecting the app do not launch saved processes.
Disconnect/revision changes revoke live native authority before asynchronous
custody cleanup, and shutdown waits for physical process closure before accepting
restore/update. A lost response must never cause automatic execution retry.

Review fixed a renderer/native account-switch race, lifecycle-cache identity,
shutdown outrunning physical child cleanup, late-close capacity, person-qualified
lost-create recovery, and a failed native synchronization still advertising the
local capability. Restored locks were watched fail for source identity, final
dispatch, receipt identity and bounded recovery-notice layout. Cleanup stays
independently actionable during setup uncertainty; retry never launches another
inspection. Narrow notices retain readable text width and many retained notices
share a keyboard-scrollable region capped at 35% of the viewport.
The shared Contexts projection now names local transport accurately. A bounded,
same-session, exact precommit upstream rejection releases its provisional grant;
missing responses, ambiguous failures and changed sources still retain it.
Packaged relaunch also exposed an OAuth-only transcript ownership join rejecting
valid local-process history; the shared validator now covers both person-owned
transports with JSON/SQLite and compacted-history locks.

Seven focused browser scenarios passed with all six demo accounts stacked,
same-organization peers and foreign readers checked, and new dialogs/recovery
states reviewed at all five canonical sizes. The generic shared-chrome sweep
passed **135/135 cells, zero violations and zero skips**; all screenshots were
visually reviewed. A fresh unsigned arm64 package passed the complete local MCP
journey: rendered configuration, exact fixture-only native approval, catalog
inspection, attachment, separate tool confirmation, one real child result,
SQLite owner/receipt retention across relaunch without auto-launch, and
Disconnect/removal with grant retirement. The five existing packaged regression
commands also passed: `desktop:smoke`, `desktop:smoke:mcp-effects`,
`desktop:smoke:routine-mcp`, `desktop:smoke:oauth`, and `desktop:smoke:mcp-input`.
Together with the new `desktop:smoke:stdio`, these cover every acceptance step
in `desktop:verify` against the fresh package. The persistence suite passed
269/269 tests, including live/retired and active/compacted local-call history.

The mandatory landing gate is `E2E_TRACE=1 npm run verify` on the final frozen
tree; its outcome is recorded in the checkpoint handoff. Only repository-authored
child programs and generated profiles were used. The owner's live store and
existing recovery choice remain untouched. The live-preview handoff is
intentionally not performed against that store; actual native-dialog review also
remains pending while the Mac is locked. Automated dialog substitution is never
counted as that manual gate, third-party-server, signed/notarized or Intel
acceptance. Those release gates remain open.

## Previous checkpoint: native local MCP grant custody

Autonomous direction (2026-10-11): the first product integration will admit
person-owned **interactive** local MCP calls only. Routine and Contribution
execution must not inherit launch authority; their unattended/separately approved
effects need a distinct policy before support. HTTP connections retain their
existing workflow. A stdio connection will be an explicit transport with no
fabricated URL, and no executable, argument, working-directory or environment
data in the portable connection record.

PORT-32 adds the internal macOS custody and launch-approval composition. A
detached description must receive exact approval from an injected native review
ceremony before an OS-encrypted grant is durably saved. Bindings identify one
tenant, person and connection. Native-only leases fence subsequent opens and
abort owned processes on acknowledged revocation or shutdown. Cancelled dialogs
and custody reads retain capacity until they actually settle. A late cancellation
cannot hide a durably acknowledged provisional reference from its custodian.
The composition is not installed in IPC, startup, backend dispatch or the UI;
it is not yet a user-accessible local-server feature or a sandbox.

Private file comparison/publication is now shared with folder/Git grants. It
requires an already admitted owner-only profile, pins file and parent identities,
compares the last acknowledged text, fsyncs a private temporary file, samples
current authority immediately before rename and syncs the directory. External
changes, cleanup failure or uncertain publication disable the handle rather than
repairing or overwriting the file. Existing folder/Git encrypted formats remain
unchanged. This also closes a final asynchronous-compare/source-check race.
Final review caught a Windows folder-connection regression in the extraction:
Windows has no POSIX effective-user API. Its existing admitted-profile behavior
is retained without POSIX mode checks or directory fsync; identity, regular-file,
no-follow, bounded-read and CAS checks still apply. This adds no Windows ACL
assurance. New stdio custody remains explicitly macOS-only.

Focused locks passed with exact durable reopen, source/cancel races, capacity,
revocation and owned-child cleanup. Mutations that weakened exact review consent,
removed person binding, sampled authority before the final file comparison or
imported custody into startup all failed their intended locks and were restored.

The next milestone remains a complete native setup and backend workflow:
trusted-cookie person binding, default-Cancel native review explaining full OS
access, opaque-reference inspection and durable receipts, GET-only lost-ack
recovery, per-call review, revocation/relaunch, and packaged acceptance. No new
UI/native-dialog, Keychain or packaged stdio acceptance is claimed by these
temporary-file and repository-authored child tests. Full local verification and
post-test diff review remain required before landing. The owner's live data is
not a fixture and remains untouched.

## Previous checkpoint: local MCP protocol transactions

Autonomous direction (2026-10-11): keep executable configuration and physical
process ownership native, with an injected stream protocol client reusing the
backend's bounded catalog, intent, result and form parsers. Do not disguise stdio
as HTTP or admit command/argument/environment data through portable connections.
PORT-31 adds modern discovery, bounded catalog pagination and one explicit tool
attempt per fresh transaction. A successful modern probe reuses its process;
legacy errors, silence or early exit require confirmed probe close before one
fresh initialization. Recognized modern errors never downgrade. Form mode is
explicit and modern-only; each reviewed continuation is a separate call, never
an automatic loop. Final dispatch requires synchronous current authority.

The native manager retains cancelled capacity through physical close. All phases
share one 30-second default/60-second maximum transaction budget, with a bounded
2-second default era probe and at most one second of remaining-budget cleanup.
Only actual tool submission contributes execution uncertainty. Cleanup failure
cannot erase a known tool result, while cancelled/stale read-only catalogs refuse
publication. Request metadata also accompanies exact-ID cancellation. The existing
HTTP workflow is unchanged apart from shared catalog-budget constants.

Deterministic fake-connection and repository-authored subprocess locks exercise
both protocol eras, explicit private forms, final consent refusal and crashes
without replay. Review fixed a settled-operation write attempt after a consent
callback closed its connection, and a launch-time cancellation race inside the
current-source callback. Both regressions failed before their fixes. Removing
modern-error refusal, intent detachment or the aggregate tool cap also made their
locks fail; the correct implementation was restored. A vacuous tool-cap fixture
was corrected to use unique second-page tools before that mutation check.
There are still no renderer controls, native IPC, persisted launch
grants or product dispatch adapter. Next is the complete person-owned native
configuration/consent and backend integration, then packaged workflow acceptance.
This internal checkpoint does not make local servers user-accessible or confer
process confinement. Full local verification and diff review remain the landing
gate; the checkpoint handoff records their outcome. Owner data remains untouched.

## Previous checkpoint: local MCP process foundation

Autonomous direction (2026-10-11): implement person-owned desktop stdio MCP
connections next, using the existing inspect, attach and per-call review model.
Local servers are executable code, not protocol-sandboxed services. Launch
configuration must stay native and explicitly user-approved; models and portable
HTTP copies must never select commands, arguments, environment or directories.
Only repository-authored fixtures are authorized for development acceptance.

PORT-30 establishes the internal transport first: immutable bounded launch
descriptions with no inherited environment or shell, strict incremental UTF-8
JSON lines, serialized request IDs, inert notifications, current-source checks,
deadlines and fixed secret-free errors with conservative submission uncertainty.
Four live process groups retain capacity until close, including cancelled work.
Shutdown closes stdin before TERM/KILL escalation; ordinary descendant cleanup
is included, but deliberately escaped processes and executable filesystem/network
access are not contained. No restart or call replay occurs automatically.
The JSON snapshot authority is shared with the existing HTTP MCP implementation.

Review caught and fixed cross-platform path admission on macOS and direct-PID
cleanup that could leave descendants holding pipes. Regression tests use only
repository-authored children and generated/in-memory data. Mutations of path
admission, JSON-root validation and submission uncertainty were watched fail.
Disabling group signals also failed both uncooperative-descendant close deadlines.
Final review also removed delayed signaling of a reaped leader's group ID:
leader exit triggers one immediate kill, retires that identifier and clears
pending signal timers. A late pipe close never signals it again. The new
regression failed before this fix and passed afterward; test teardown likewise
never signals a PID after observing that it exited.
This checkpoint adds no renderer controls, native IPC, saved launch grants or
product adapter. Protocol negotiation, private native configuration/consent,
person-bound backend dispatch and packaged workflow acceptance remain next.
Full local verification is still required before landing; its final outcome is
recorded in the checkpoint handoff. The owner's live store remains untouched.

## Previous checkpoint: private MCP follow-up forms

Autonomous direction (2026-10-11): implement modern, person-reviewed form
elicitation as the next core MCP workflow. It will not grant standing authority,
auto-answer with a model, or broaden Routine/Contribution execution. URL mode,
sampling, roots and local process transports remain separate work.

The first checkpoint implemented the bounded protocol boundary: strict
inert form/response admission, modern capability opt-in, exact opaque-state echo,
one request per transaction, and fixed uncertainty semantics. Default callers
remain complete-only outside the private conversation follow-up path.
Local HTTP fixture tests cover actual request bodies/metadata, fresh identities,
original argument preservation, explicit rounds, legacy refusal and no replay.
The current checkpoint integrates private durable rounds and the review screen
together. Four rounds and one hour bound each original decision. Only the actual
approving person may read or answer a form, including on tenant-owned none/bearer
connections. Exact tool/schema/arguments and current membership/attachment remain
required. Pending forms and opaque state stay outside public activity history;
submitted answers remain in client memory and the dispatched request, while the
durable receipt stores only identity and a command hash.

Continue reserves its exact round before I/O. Stop locally sends no remote
cancellation. Expiry or lost membership releases waiting state as uncertain;
restart settles reserved calls as uncertain without replay. Check status is a
receipt GET, never a resubmission. Explicit Review latest rereads current truth
before discarding local answers; only another reviewed Continue can send again.
Routine/Contribution and legacy calls retain their complete-only behavior.
Native IPC and credential scope are unchanged. JSON/SQLite restart locks now
cover private waiting forms and reserved responses that become uncertain without
replay. The rendered workflow covers all five viewports, actual owner/reader/
foreign identities, failed review reads, lost acknowledgement, GET-only recovery,
another reviewed round and local Stop. The separate UI sweep passed 135/135 cells
with no violations or skips; every capture was visually reviewed.

Fresh unsigned arm64 packaging passed with the existing 800 KB startup budget.
The opt-in packaged form walk passed with native OAuth custody, a pending form
across full signed-in relaunch, one explicit continuation, lost acknowledgement,
exact receipt recovery and completed relaunch without replay. The fixture's
answer appeared in neither SQLite/WAL, model input nor shared history; its final
result deliberately does not echo answers. Ordinary OAuth acceptance separately
passed interactive, Contribution and Routine consent, refresh, relaunch, revoke
and Disconnect. Both walks used disposable copies/profiles and verified the
original ASAR unchanged. An initial acceptance-driver race was fixed by awaiting
the exact Check status response, not an already-visible receipt. These are local
fixture results, not public issuer/system-browser, signed or Intel acceptance.
The complete local verifier remains the mandatory pre-push gate; its final
outcome is recorded in the checkpoint handoff.

Review also aligned runtime/fork admission with the fixed 100,000-flow snapshot
bound and replaced repeated history scans with one exact activity index per
session. Removing each capacity guard made its lock fail; the old validator
required 3,168 activity-list reads for 32 flows and failed the linear-work lock.
Acknowledged follow-up commands now refresh open transcripts without waiting for
SSE, using the shared API listener factory. The rendered offline-Stop regression
failed before that fix; the startup budget stayed unchanged after deduplication.

At the protocol-only checkpoint, independent review found and fixed raw session-facade descriptor bypasses, a
vacuous invalid-response fixture, standard result-metadata refusal and malformed
format coercion. Fail-first mutations proved the direct-facade guard, exact
opaque-state wire comparison, strict schema/response validation and fixed-error
locks; the correct implementations were restored. Adjacent ordinary transport,
discovery, OAuth authority and cancellation regressions passed before the full
local verifier. That earlier checkpoint changed no UI rendering.

The activation constraints bind every round to the original person, connection revision,
tool/schema/arguments and activity decision. Save awaiting-input privately; save
continuation intent before dispatch; make response-loss/restart receipt-only.
Require explicit review/edit/Continue and a clear local Stop, recheck current
membership and attachment authority, bound expiry/total rounds, and never put raw
form answers or opaque state in shared events/transcripts or model prompts.
Known results may themselves echo submitted data; existing final-result review
and sharing policy still apply. A stop cannot promise rollback of remote effects.

The owner-data recovery issue remains separate and untouched. All tests use
isolated peers/stores; live preview handoff is still deferred as recorded below.

## Completed checkpoint: desktop MCP OAuth

The local startup budget caught eager consent and filesystem query code crossing
their existing optional feature boundaries. Their API-owned hooks now load with
tool cards and file pickers/previews, retaining the same identity and freshness
semantics. The 800 KB initial-graph budget is unchanged. Boundary locks reject
eager imports/re-exports; both locks were watched fail before restoration.
Replacing an older display-flag-only reader fixture with real Grace sign-in and
a view grant exposed an unfocusable transcript when no consent controls remain.
The shared transcript now uses the named keyboard-reader funnel; fail-first
source and rendered Home/End scrolling checks cover that state.

The owner approved system-browser OAuth sign-in on 2026-10-10, with
connection-specific scope review, Keychain-protected tokens, automatic refresh
limited to the existing grant, and unchanged tool-call consent. Implementation
and acceptance use local fixtures only; this does not authorize public-service
access, paid calls, local command execution, private-LAN access or publication.

The first implementation layer supplies bounded resource/authorization metadata
parsing and discovery URL ordering, S256 PKCE, independent state, exact decoded
issuer checks, one-use code exchange forms, and a short-lived native loopback
callback. Token parsing retains only bounded opaque credentials and scopes within
the reviewed grant; refresh forms retain the original client/resource. Missing
expiry remains unknown, not an invented lifetime. The second layer adds typed
encrypted grant custody and a bounded refresh manager. Shared bearer cleanup
understands OAuth without exposing it through generic credential reads. Refresh
removes the old token pair durably before dispatch; interrupted reservations
cannot replay after restart. Exact owner/audience, narrowed scopes, coalesced
callers, cancellation and publication-time authority fences remain explicit.
At that checkpoint these modules were not yet wired to product HTTP, Electron IPC or browser launch.
Local callback tests use test-owned sockets; custody tests
use real temporary files with fixture encryption/exchange. There is no claim of
completed OAuth sign-in, Keychain OAuth acceptance or network/tool authority at that layer.

The third layer adds bounded native metadata/token HTTP and staged discovery.
It shares native-importable address/protocol cores with the backend, checks every
DNS answer, pins sockets, retains TLS verification, bounds headers/strict JSON and
deadlines, and never redirects or retries a token request. Challenge hints and
ordered well-known fallbacks compose with exact resource/issuer identity and
separate review scopes. Real local TLS tests now compose discovery, PKCE and one
code exchange, plus vault reservation, refresh and uncertain-result refusal.
They do not prove system-browser or Keychain OAuth acceptance. An integration
regression exposed discarded server capability facts; discovery now retains a
frozen bounded native-only RFC document for authorization revalidation. Header
regressions also corrected legal whitespace and empty-list-member parsing.
Disabling DNS admission/TLS verification failed their locks before restoration;
facade identity mutations failed the shared-authority locks.

The fourth layer adds exact-issuer pre-registration, configured HTTPS client
metadata identity and one-shot public-native dynamic registration. The actual
ephemeral callback is bound before registration; one monotonic deadline covers
preparation and authorization. An internal transaction now composes registration,
browser handoff, callback, one code exchange and initial encrypted custody with
current-scope publication fences and a provisional-reference-only result.
Real local TLS/callback/disk tests exercise that composition. Browser/provider
interaction and encryption are fixtures, not OS-browser or Keychain OAuth proof.
Fail-first review corrected late URL publication after synchronous preparation
overran its deadline and refusal of unsolicited registered refresh capability.
Removing initial custody's publication fence made its regression fail.

Sign-in checkpoint `555be119` passed all five local verifier lanes, all 609
browser tests, 553 desktop unit tests and complete unsigned arm64 acceptance.
A subsequent real-callback audit found cancellation released a sign-in slot
while its registration preparation could still be pending. The unit callback
had awaited preparation and masked that lifecycle difference. Sign-in now owns
and drains the preparation promise independently of callback readiness, retaining
per-connection and global capacity while cancellation still returns promptly.
Real-loopback cancellation and deadline regressions cover late-result refusal
and admission recovery. Removing the preparation drain made both fail at the
premature-registration assertion; the restored implementation passes. The
receiver's own deadline can also precede the outer timer, so terminal errors
publish before cleanup drains preparation. Disabling that publication made the
earlier-receiver-deadline regression fail before restoration. The checkpoint
handoff records final acceptance for the corrected tree.

The delegated ownership decision is person-owned OAuth: each person signs into
their own external account, even inside one shared workspace. Existing none and
bearer connections retain their tenant semantics, without inferred migration.
An OAuth grant may be used by a Routine only through a separately reviewed,
bounded Routine MCP approval attributed to that person; signing in or attaching
a context is never consent to unattended calls.

The fifth layer adds explicit `device-oauth` rows stamped by authenticated person,
strict persisted owners and deletion tombstones, actor-filtered lifecycle and
catalog projections, and person-private live/replayed invalidation events.
Store reads recheck live account membership; the credential and single-call
seams require an exact person/revision binding and a separate OAuth resolver,
never generic bearer fallback. Public HTTPS remains required for OAuth even
when the development deployment admits loopback MCP. These are backend boundary
fixtures, not product OAuth activation. At that checkpoint, interactive, Contribution and Routine callers refused OAuth
rather than borrowing a tenant member's grant. The current layer below adds
interactive attribution; the Contribution layer below extends the same person
boundary, while Routine OAuth remains unavailable.

Fail-first registry tests rejected the absent ownership implementation. Review
also found tenant-wide lifecycle events revealing personal connection existence;
person-stamped live/replay filtering now closes that path. Removing the person
event gate made the shared-organization regression fail at its actorless delivery
assertion, then passed after restoration. The event-discriminant lock now tracks
the actor-aware signature and no longer exempts these private events as global.

The sixth layer prepares the native account/transaction composition. A cookie-only
owner source route exposes a small no-store binding and revision, not a tool
catalog or credential reference. The internal HTTP adapter pins the trusted
loopback session across reads and inspection; owner/account/revision changes
refuse before submission. Native flow orchestration keeps discovery and scope
review separate from sign-in, retains one stable inspection identity through
lost acknowledgement, and publishes only fresh matching receipt truth. Cancelled
work retains capacity until it drains; submitted references are never discarded
on uncertainty, and abandoned recovery handles have a bounded lifetime. A
separate child/main OAuth channel carries exact person/revision authority, refuses
replayed request IDs and suppresses cancelled or late token responses.

That checkpoint established internal composition boundaries with deterministic
session, HTTP and sign-in fixtures, before installing the renderer bridge. Removing the native
adapter's pre-submit owner check caused its no-POST regression to fail, then
passed after restoration. No public OAuth service or real account was contacted.

The seventh layer installs native main/preload/launcher composition and explicit
issuer/scope review, cancellation and same-flow recovery. Cookie changes and
window lifetimes cancel setup without changing a previously approved worker's
person. The backend advertises OAuth only after native custody synchronization.
Interactive turns now stamp a private durable activity owner atomically with the
proposal. Approval/replay/dispatch require that person and live membership; an
already-running worker can still save its exact known outcome after revocation.
Compaction/fork/deletion retain or retire exact private anchors. Context SSE is
invalidation-only, so filtered HTTP reads are the sole context projection.
Shared transcript readers retain the recorded proposals and results, but cannot
approve or detach another person's private OAuth connection. Viewer-relative
decision eligibility is a separate no-store read, not a guessed session-owner
flag or a public person identifier. Unknown/error states fail closed with an
explicit retry; an already-held decision retains its exact disabled controls
until its receipt reconciles. Retired bindings still permit their owner to
decline history or detach, never to confirm a fresh call.

The lazy sign-in dialog follows the shared bounded-dialog and keyboard-readable
body rules. Module failure is local to setup: Close receives safe initial focus,
and explicit Reload warns about unsent text and in-memory recovery loss. Review
and pending states are checked across the five canonical viewports.
That walk exposed development lifecycle replay cancelling a recovered handle.
Deferred same-source cleanup preserves real unmount cancellation without that
duplicate act; late cancellation and completion settle only the exact held flow,
so they cannot resurrect a finished handle or clear a newer one.
The focused browser checkpoint passes all 11 setup/consent/recovery tests.
Its mounted-query assertion failed when a trailing delimiter was deliberately
added to the eligibility invalidation prefix; the correct prefix was restored.
All five review/pending viewport captures and owner/peer/shared-reader captures
were visually inspected. Live development-profile review remains deferred while
the separate data-recovery choice below is unresolved; no seeding or restoration
is used to manufacture that missing evidence.

Local acceptance includes real native callback, encrypted OS custody, child
resolution, inspection, relaunch, refresh and disconnect in an isolated app copy.
It now continues through rendered attachment, a real Messages exchange with an
excluded bounded local model peer, a proposed call and separate Run tool consent.
The exact external call, private person anchor and result are compared against
SQLite before and after a full signed-in relaunch. Replaying the same decision
key returns the saved receipt without redispatch, including after Disconnect.
Raw OAuth token canaries remain absent from model requests, public messages and
stored bytes. Removing actor propagation in a disposable package copy failed the
exact rendered result assertion. Review also caught the model fixture accepting
misordered/wrong-role continuations; its new regression failed before enforcing
the original prompt, issued call identity and ordered assistant/user messages.
Transcript captures wait for settled entry animation before visual review.

Only the copied DNS/socket destination, browser handoff and model peer are
fixtures; the source package remains public-HTTPS-only and fixture helpers never
ship. This does not prove public issuer, actual system-browser, paid-service,
signed or Intel acceptance. The final handoff records the complete verifier results.

### Person-owned Contribution OAuth (2026-10-11)

Contribution envelopes now bind OAuth selections to the authenticated person,
using the private proposal principal plus a retained OAuth-owner stamp. The stamp
keeps a replaced proposal person-bound even if its connection identity is lost;
admission refuses that orphan rather than reclassifying it as legacy history.
Project approval remains a separate governance act; only the bound person with
current membership and Project authority can confirm each exact Run. Shared
readers retain reviewed arguments and saved results without private owner IDs,
connection authority or credentials. Ledger reads and mutation acknowledgements
use the same current person-relative availability projection.

Private attempts include the person in their immutable call hash. JSON/SQLite
admission joins current and historical proposals, calls and receipts to exact
live or retired connection ownership; missing or contradictory owners fail
closed rather than migrating from tenant identity. Pending recovery preserves
that person and its occupied slot. Credential-wait revocation refuses dispatch;
known outcomes after dispatch remain recordable without returning fresh content
to a revoked caller. Exact owner receipt replay remains read-only after disconnect.
Legacy unauthenticated/bearer hashes and tenant semantics are unchanged.

Acceptance extends the existing isolated OAuth native walk with rendered
Contribution proposal, separate approval and per-call confirmation, exact SQLite
owner/result retention, signed-in relaunch and no-redispatch replay. One unused
act remains available before Disconnect and unavailable afterward. Browser
checks cover the owner, same-workspace peer, explicitly shared reader and foreign
account. These are local fixture gates; no public service or owner profile is used.
Complete unsigned arm64 native acceptance passed. Removing the execution seam's
person argument in a disposable package copy made the new Contribution result
assertion fail after the earlier interactive call passed; cleanup verified the
original ASAR unchanged. The separate UI matrix covered all 135 cells with zero
violations or skips. Screenshot review also tightened the foreign-account walk
to await the settled unavailable Project instead of accepting a loading shell.
Final live-state review found connection events did not refresh already-open
Contribution Run controls, and Routine permission invalidation used a nonmatching
prefix. Shared key-family builders and event invalidation now cover both. The
rendered disconnect regression first observed the stale Run button; prefix locks
also failed before repair. The browser walk retains a usable owner connection
through all peer/reader checks before testing live disconnect without navigation.
One full Node run refused a Git review before its injected mutation ran; the
generic baseline error did not preserve a cause. Its unchanged mutation assertion
passed in isolation and in the full nine-test Git-review suite. Test-only read
and command diagnostics now retain early-refusal evidence; there are no retries,
weakened assertions or production deadline changes.
The checkpoint handoff records their final outcomes. Routine OAuth attribution
is now implemented as the next layer below; sign-in itself does not grant
unattended execution. Public issuer/system-browser and release acceptance gates
remain separate.

## Previous checkpoint: person-attributed Routine OAuth

Routine MCP now supports selected person-owned OAuth connections only through a
separate bounded per-Routine review. The private grant records the authenticated
owner and exact selected OAuth IDs; the queued run freezes that owner. Membership,
live approval and connection identity are rechecked before credential resolution
and before output publication. Known outcomes can settle after revocation, but
remain private and are never retried automatically. Legacy none/bearer connections
keep their tenant semantics.

Same-workspace peers cannot borrow the grant or replay its exact keyed receipt.
Their review exposes only whether another person's grant is active; they may
revoke it or replace it using their own connections, without seeing the other
person's catalog or receipts. Strict persistence validation joins current and
historical OAuth authority to live or retired connection ownership. This checks
snapshot consistency; it is not a claim of protection against arbitrary
backing-store tampering.

Focused typecheck, pure, route and persistence tests pass. The affected seven
browser tests cover approval, private history, peer replacement/revoke, shared
readers and foreign accounts across the five canonical viewports. The separate
UI sweep passed all 135 cells with zero violations or skips; screenshot review
excluded stale captures from earlier runs. Peer review exposed adjoining approval
buttons: UI-211 now owns their shared wrapping/spacing layout, with source and
rendered geometry locks watched fail before repair.

Adversarial review also found a member removed during the POST body wait could
replace an OAuth grant with a legacy workspace grant. A real-router held-body
test reproduced the 200 response; the store now rejects any supplied actor whose
membership expired before decision or replay. That regression and all 25 adjacent
route/store tests pass without weakening omitted-actor legacy internal callers.
Membership loss before dispatch and during credential resolution also has
mutation-watched refusal coverage.

The first complete verifier caught an older recovery browser fixture using
desktop development headers as if they could switch people. They kept the local
device user in Ada's workspace, without actual membership. That fixture now
signs Ada in and asserts the verified person/workspace before the original
unavailable-review and transient-error recovery checks; the membership guard
remains intact.

Post-green review found cross-slice validation repeatedly scanned unrelated
Routine histories and connection identities within the accepted snapshot limits.
The joins now index exact scope, revision and connection identity while preserving
legacy admission, unsorted historical revisions and stable equal-revision ties.
Two deterministic work-count locks first failed on the old implementation:
512 decisions required 655,872 scope-identity reads, and a separate 256-connection
case required 45,056 connection-ID reads. Indexed reads are 2,048 and 256
respectively, with all eight authority tests and all 63 adjacent pure/persistence
tests passing. The locks bound lookup work rather than machine-dependent time.
Complete local and packaged gates must be rerun after this review correction
before landing.

Complete unsigned arm64 `npm run desktop:verify` passed. The extended local OAuth
walk proves three separately authorized calls (interactive, Contribution and
Routine), exact private SQLite policy/decision/receipt ownership, ordinary Routine
output, and signed-in relaunch/replay/revoke/disconnect without redispatch. All
seven new Routine native captures were reviewed. Removing the Routine executor's
person argument only in a disposable ASAR copy made the exact execution gate
fail; cleanup verified the source ASAR unchanged. The dedicated model peer remains
excluded from the package and accepts only the exact successful tool result.
The complete local `E2E_TRACE=1 npm run verify` remains the mandatory pre-push gate;
the checkpoint handoff records its final outcome. Public issuer/system-browser,
combined real-service/native, signed/Intel, stdio, standing-trust and MRTR gaps
remain separate. Live preview handoff remains deferred while the earlier
development-store recovery choice below is unresolved; this checkpoint leaves
that store untouched and uses only isolated test data.

During the preceding Contribution OAuth checkpoint, a newly written persistence test omitted its temporary
JSON path and overwrote the local development store; the watch process then
reloaded the fixture. The owner was informed and recovery was left untouched
pending a choice of backup. Node test processes now refuse omitted persistence
paths and explicit paths resolving to the exact live fallback before backend
I/O, with mutation-watched regressions. This guard does not claim symlink or
general path confinement. It also caught five older
export tests reading the development path without enabling test persistence;
those suites now compare their own saved fixtures in isolated in-memory SQLite.
No production client
metadata URL is invented: its hosted identity is an operator release input.
Focused metadata, authorization, real loopback-callback and token tests pass.
Disabling S256 admission, issuer validation and the scope ceiling each made its
lock fail before restoration. Review corrected empty-fragment redirect admission,
incremental metadata-byte limits and canonical origin-root resource spelling.
The initial native gate was stopped before an RFC 9728 identity correction:
metadata resource aliases must not pass by URL normalization. Its regression
failed first; request canonicalization and exact response comparison now remain
separate. Only a complete run on the corrected frozen tree counts as acceptance.
The full local verifier and post-test review remain mandatory before each push;
the checkpoint handoff records their final result.

Custody locks cover mixed bearer/OAuth reconciliation, exact owner and audience,
atomic reservation, rotated/retained refresh tokens, restart without replay,
scope narrowing, late cancellation and actual disk-publication fences. Intentional
removal of ticket-presence, publication and independent-waiter checks made their
tests fail. Review identified a stale queued reservation erasing an otherwise
valid grant; its regression requires the same last-moment publication fence as
completion. Another fail-first regression binds the grant's resource to the
canonical MCP endpoint, preventing an otherwise valid different HTTPS audience
from entering custody. These guards do not change scope or tool-call consent.
During native regression acceptance, a read-only probe found cancel/rejoin could
retain unbounded promise handlers despite the live-waiter cap. The test runner
was stopped before edits; a failing regression now keeps each canceled
subscription counted until the shared promise settles. Only the subsequent
complete frozen-tree acceptance counts for this checkpoint.

Discovery checkpoint `f6a69797` passed all five local verifier lanes, all 609
browser tests, complete unsigned arm64 native acceptance and independent review.

Custody checkpoint `54f8db31` passed complete local and unsigned arm64 native
verification. Its first browser run timed out before an MCP proposal appeared;
the traced full run passed all 609 tests without reproducing it. The initial
failure's cause remains unproven, not fixed. A recurrence needs send-route,
persisted-session and model-wire evidence before changing product behavior.

## Completed checkpoint: bounded unattended Routine MCP

Shipped as `f2b91f24`: all five local verifier lanes and 609 browser tests passed,
along with the 135/135 visual matrix and unsigned arm64 packaged acceptance.
The detailed preparation record below is historical, not an unfinished gate.

The approved direction is implemented as a separate per-Routine permission, never
inherited from attached contexts or Commissions. MODEL-40 now connects owner
review/approval/revocation, private JSON/SQLite state, the shared model tool loop
and exact one-shot execution. Six focused browser journeys, the complete 135/135
visual matrix (zero violations or skips), and rebuilt unsigned arm64
`npm run desktop:verify` passed. The complete local verifier and post-test diff
review remain mandatory before landing; the handoff records their final result.
See the [acceptance record](acceptance/routine-mcp-2026-10-10.md).

The owner review fixes selected tools and exact top-level argument values
(for example, repository or channel), while leaving other arguments subject to
the reviewed tool schema. Preparation bounds are 16 tools, 20 reserved attempts
per run, and 30 days of permission. Every attempt consumes a slot, including
pre-submit refusal; these are not monetary caps. Scope, definition, connection,
schema, expiry and live permission are checked independently. Replacement or
revocation cannot widen an already queued run.

The private ledger preserves its initial permission even when empty, and binds
each receipt to exact arguments and tenant/Routine/run identity. Represented
replay returns history, not authority to dispatch. Any external reservation
forbids retrying the model prompt. Uncertainty or a returned tool error stops
further call admission; recovery preparation marks pending calls uncertain.
The store commits these transitions before outbound I/O/admission.

Focused tests cover strict bounded parsing, scope/revision checks, fixed argument
semantics, expiry, revocation, replay, receipt joins, capacity and interruption.
Negative checks broke expiry and receipt hashing and failed as expected. Review
also caught empty-ledger approval replacement and continuation after a possibly
effectful tool error; regressions failed before both fixes. Full local verification
and post-test review remain the delivery gates, recorded in the checkpoint handoff.

Focused tests now cover owner-only route access, exact decision replay after
revocation, destination/audience review changes, reservation-before-dispatch,
timeout/uncertainty pause, and restart without replay on both storage backends.
Review caught a misleading active-ledger/run-status label and the permission
history cap potentially blocking revocation; both now have explicit corrections.
The final history slot is reserved for revocation. Further review added exact
approval-decision joins on hydration and checks on actual run-conversation
sharing before output publication; a configured conversation label is never
mistaken for an existing destination ID. Completed calls interrupted before the
model finishes retain their known result, while the run fails without replay.
Browser acceptance proves real runner/model/MCP wiring, exact lost-acknowledgement
Retry, expiry/revocation, private owner/reader/foreign walls, and uncertainty.
The owner cache now evicts authoritative permission denials; GET publication
stays behind the query generation fence so a stale read cannot resurrect an old
approval after a decision. POST acknowledgement publication also checks the
captured account generation immediately before writing the cache: a late switch,
including away and back, cannot repopulate the previous account's private data.
Both executable regressions failed before this correction. The first complete
verifier was intentionally stopped before edits and does not count as final
acceptance; the corrected tree requires a fresh complete run.
Narrow/short layouts, expanded schema readers and
private receipts have keyboard, accessibility and five-viewport coverage.

The packaged local-protocol journey proves rendered approval, an exact successful
call and model output, durable permission/receipt after signed-in relaunch,
rendered revocation, and interruption after a known result without replay. It
uses an excluded disposable loopback copy, never modifies the original package,
and runs separately from signed-candidate acceptance. The full Node diagnostic
found only two obsolete desktop command-sequence expectations, updated to include
the new gate without removing the existing Contribution gate. Final complete
verification will include these test/documentation updates.
Native screenshot re-review also caught the blank template's stale “paused”
description beside an Active status. The authoritative template now says “New
workflow”; the all-template lifecycle-word lock failed before correction, and
browser/native header assertions cover it. Existing saved descriptions are not
rewritten. The second full verifier was stopped before this narrow seed edit;
only a complete final run counts toward landing.
No further product decision is currently needed for this checkpoint.
Paid-provider/public-MCP acceptance and signing/Intel gates remain separate.

## Completed checkpoint: real one-off Dispatch

Shipped and pushed as `8de444d8`. The complete local verifier passed all five
lanes and 603 browser tests; the visual sweep passed 135/135 cells with no skips
or violations, and rebuilt unsigned arm64 desktop acceptance passed. The detailed
pre-landing record below is historical evidence, not pending work.

The approved workflow is implemented for local acceptance: explicitly select an
Agent, endpoint connection and catalog model; launch one private conversation;
open it to observe, Stop, review proposals or continue normally. The initial turn
has the submitted instructions and no attached context; the selected Agent's
instructions and permitted workspace tools still apply. External calls retain
the existing per-call consent boundary. Authenticated remote MCP reaches the same
tenant-scoped route and admission rules; in-session mutations remain proposals.

Admission commits the exact task, binding and conversation before model I/O.
The shared conversation executor removes duplicated model/consent logic. A reply
and the run outcome commit together; “Reply ready” does not claim proposed effects
were performed. There are four instance slots, two per account and one per
account-Agent; busy requests retain explicit Retry rather than scheduling future
spend. Restart records interruption without replay. Deleting the result removes
the run and retires its logical key. Fixture history remains labeled Simulation.

Focused route, executor, store and JSON/SQLite recovery tests pass. Snapshot
tests caught and locked mixed legacy/real identity collisions. Historical Agent,
provider and message references remain valid after legitimate conversation
handoff or compaction. The old append-only UI merge was removed: query-owned
generation fences now prevent delayed acknowledgements resurrecting deleted runs.

The focused browser workflow passes all eight tests, including exact binding,
held recovery, continuation and owner/foreign visibility. The full visual sweep
passes 135/135 cells with zero violations or skips; all five screenshot columns
and focused Dispatch/standing-work states were reviewed. The rebuilt unsigned
arm64 desktop gate passes: its original executable saves the exact private reply,
continues the conversation, persists a pending call before quitting, and recovers
as Interrupted after a signed-in full relaunch. Same-key replay retains the exact
job and Session without another model request. Only the local protocol peer is a
model fixture; the native launcher, OS authentication and SQLite remain real.

The broad sweep was stopped before the final scope-copy repair, then rerun in
full on the corrected product revision. An initial native assertion incorrectly
expected no tools at all; it now verifies the normal generated workspace API
tools, with no external MCP tools. The complete native gate passed afterward.
Removing the Dispatch helper exclusions and smoke import made both source guards
fail; restoring them passed. The five-viewport scope-disclosure check also passes,
including scroll reachability above the fixed footer. Remaining checkpoint gates:
complete local verifier, diff review and push. No paid model/public MCP acceptance is implied.
Next is the approved bounded unattended Routine MCP policy, using a separate
versioned per-Routine grant and durable call receipts rather than reusing legacy
context-level standing approval. No additional product decision is currently
needed. Signing/notarization, Intel and public-service acceptance remain separate.

Adversarial review found that interruption was initially changed only in memory:
a current snapshot with no other recovery could remain running on disk until a
later write. The verifier was stopped before edits. JSON and SQLite regressions
both failed after adding a backing-store read immediately after startup, before
Retry or deletion. Recovery now participates in the startup commit flag, and the
native smoke also compares the recovered job directly with SQLite. The complete
rebuilt native gate passed after this repair. The frozen complete local verifier
remains the final test gate before diff review and push.

## Completed checkpoint: truthful automation availability

Shipped as `4a74158b`: five local verifier lanes and 602 browser tests passed,
with 135/135 UI sweep cells and rebuilt unsigned arm64 desktop acceptance.
The following records the pre-landing work; real Dispatch above supersedes the
legacy UI gate without weakening release refusal of timer-based simulations.

The owner approved both pending automation defaults on 2026-10-08:

- Real Dispatch explicitly selects an Agent and endpoint model, saves its result
  in a private conversation that can be continued, and requires fresh confirmation
  for each external tool call.
- Unattended Routine MCP is opt-in per Routine, limited to selected tools and
  reviewed argument constraints, with per-run call limits, expiration and immediate
  revocation. Changed tool definitions require renewed approval. Results follow
  the disclosed destination's sharing; uncertain calls are never automatically
  repeated. Call limits are not monetary caps and third parties may charge.

These are approved implementation directions, not live grants or authorization
to use a paid provider/public MCP service for acceptance. Existing Commissions
do not inherit either permission policy.

Before those workflows, the audit found a release-integrity defect: legacy
Dispatch completed on a timer, Project effects and Agent proxies returned
synthetic success, and eligible standing Commissions could mark posted work done
and award credit without any execution adapter. MOCK-9 gates those fixtures at
the store and route boundaries, before cached Dispatch replay. Release posting
and Commission configuration remain available but leave new work open, including
A2A submissions. Real Routines and explicitly confirmed Contribution MCP are
unchanged. One backend capability drives honest development/release disclosure
and closed-by-default Dispatch controls, including the rail action.

Store and route locks were watched fail against the old implementation and now
pass. The final local verifier, full UI sweep and rebuilt packaged acceptance
remain the landing gates. Next: implement the approved real Dispatch workflow,
then bounded Routine MCP grants; no further policy approval is needed for those
defaults. The rendered regression also caught a rail action that looked enabled
while its page handler was blocked; both now use the same capability policy.
Unknown availability avoids promising that work will stay open on a development
backend. The page-action structural lock now enumerates complete elements rather
than imposing an arbitrary source-character limit; its negative check failed as
expected. Signing/notarization, hosted delivery, Intel and public-service acceptance
remain separate release gates.

The A2A instance card now states the same runtime boundary for protocol clients;
its profile-aware route regression failed before the repair and passes afterward.
Focused rendered checks pass, including five viewport sizes, owner/reader/foreign
scope and short-landscape keyboard/scroll reachability. The complete broad sweep
passes all 135 cells with zero violations or skips, and its captures were reviewed.
The rebuilt unsigned arm64 desktop gate passes, including original-package
automation refusal and the isolated Contribution MCP fixture. The complete local
verifier remains the final landing gate before push.
The first package build caught an initial-bundle overrun caused by eagerly loading
all disclosure copy through the rail. The tiny capability predicate is now shared
separately from lazy page copy; the existing size budget is unchanged. The initial
broad sweep was stopped before further edits; the successful sweep above ran on
the repaired revision.

## Completed checkpoint: native Contribution MCP acceptance

Shipped as `73c995b3`: the complete local verifier passed all five lanes and
597 browser tests. The detailed pre-landing record below is historical evidence.

The exact-bound Contribution workflow now has a feature-specific macOS fixture
gate. The original unsigned package must refuse a loopback MCP connection
without contacting it. Only a disposable app copy changes the startup network
scope; the original ASAR is hash-checked before and after. Actual packaged UI,
HTTP, schema worker, OS credential vault, account sharing and SQLite remain real.
Rendered proposal/approval performs no call; separate confirmation sends exact
arguments. Full process interruption and signed-in relaunch retain uncertainty
without replay, preserve cardinality, and retain exact managed-backup history.

The native gate passed, then deliberately disabling pending-to-uncertain recovery
made its rendered uncertain-state check fail. Restoring recovery is mandatory
before final acceptance. Removing the fixture's package exclusion likewise made
its source lock fail. All helpers remain excluded from the shipped app; the
signed-release smoke never substitutes this modified copy. This closes only the
local feature-specific native fixture gap, not public-service/TLS, paid-provider,
signed/notarized or Intel acceptance. Final `desktop:verify` and the complete
local verifier are the landing gates; no GitHub CI is used.

The rebuilt complete desktop gate passed. Final review strengthened exact peer
result comparisons in public history and SQLite; that journey passed again on
the unchanged original ASAR. All five final captures were reviewed. The
[acceptance record](acceptance/native-contribution-mcp-2026-10-08.md) binds the
scope, package digests and negative checks. The complete frozen local verifier
passed before push.

## Completed checkpoint: bounded Routine execution

Shipped as `c268c3ce`: the final strengthened local gate passed all five lanes
and 597 browser tests. The pre-landing history below records the checks performed.

The core-workflow audit confirmed two unfinished automation directions. Real
Dispatch still needs an approved Agent/model and result-destination policy;
external MCP calls in unattended Routines need separate scoped standing authority
or a pause-for-confirmation workflow. Both decisions have been requested and are
now approved as recorded above. The earlier pending decision did not authorize
either policy change before that explicit owner approval.

The existing PD60 requirement for bounded automation can proceed independently.
The Routine worker now queues durable rows under process/tenant/tenant-Agent
limits (defaults 4/2/1), without spending attempts until admission. Ready order
is preserved within competing scopes while eligible other scopes can proceed.
Repeated recovery/wakeup calls cannot duplicate active runs. Admission rechecks
authority and budget; retries release capacity during backoff. Stop/start keeps
abort-ignoring work counted until settlement, and late cancelled results cannot
publish. Fatal state transitions stop admissions before supervisor reporting;
failed storage commits are never treated as transient model failures.

Focused locks cover limits, fairness, deduplication, current authority, retry,
shutdown, fault handling and zero-attempt restart recovery. The global limit,
Agent limit, cancellation retention and fatal-commit locks were each watched
fail under targeted implementation mutations, then restored. The complete local
verifier remains the landing gate. No UI, external-tool authority, persistence
shape or provider credentials changed; this does not complete real Dispatch,
standing MCP permissions, spend reservations or the wider production goal.

The first complete local gate passed checks and three browser shards; one MCP
browser walk failed because its connection had moved behind the picker's real
“More available” disclosure as the worker's fixture registry grew. The harness
now drives that portaled tail, and the long-label case deliberately creates a
crowded registry and proves the target is not inline. Disabling overflow lookup
failed at that exact hidden row; restoring it passed all seven focused MCP
browser tests. No product behavior, assertion, retry count or timing budget is
relaxed. The complete frozen local gate remains required before landing.

That corrected full run passed all five lanes and 597 browser tests. Review then
strengthened the shutdown lock to wait for the actual generator and worker
continuations before asserting unchanged state. Removing late-result fencing
made it fail with a falsely completed run; the implementation was restored. The
final strengthened test revision repeats the complete local gate before push.

## Completed checkpoint: real Contribution execution

Shipped as `c9dffd0b`: the corrected final local verifier passed all five lanes
and 597 browser tests. The broad review covered 135/135 cells without violations
or skips, and the rebuilt unsigned arm64 native regression passed. The detailed
pre-landing history below is retained as evidence, not outstanding local work.

The exact-bound Contribution execution foundation was pushed at `576bbce7`
after its final local run passed 4,800 Node tests and 593 browser tests. The
current checkpoint integrates that foundation with the Contribution store,
HTTP route, strict durable attempts, restart recovery and explicit first-party
Run flow. Focused JSON/SQLite, route, restore, durable-commit and controller
locks pass. The final frozen revision must pass the complete local verifier,
broad UI sweep and packaged/native regression acceptance before landing.
No public or paid MCP service has been used.

The owner has approved Project-reader visibility for Contribution tool arguments
and results. Credentials stay private. Proposal review must disclose that the
arguments will be shared, and each separate Run confirmation must disclose the
result's sharing scope. Execution uses only the initiating person's existing
connection, never another Project member's credentials.

The real path selects one existing MCP tool on the initiating person's own
connection, binds its reviewed schema and exact arguments to an approved
envelope line, and requires a separate human Run confirmation for each call.
Arguments and bounded results are Project-reader-visible; credentials and
private connection authority are not. The server commits a pending receipt and
slot reservation before I/O. Only a known pre-submit failure releases a slot;
pending blocks amendment and landing, restart converts it to durable
uncertainty, and exact retries only read the existing receipt. Receipts are
append-only and capped at 100. Invalid or oversized results become uncertain,
without truncation or automatic replay.

Adversarial persistence review added approval-event correlation, a permanent
effects-fired floor and strict pending-state admission. Browser review found
pane-width clipping and insufficient contrast on tinted consent panels; UI-9
and UI-205 now name the shared layout and readable-ink funnels. Transport is
loaded before admitting effect controls, so a failed code import is not mistaken
for an uncertain submitted call. A lost acknowledgement offers receipt-only
checks; dismissing local recovery never suppresses the next call's duplicate-risk
warning. Optional extraction preserves the existing bundle budgets.

All four focused browser journeys passed, with 41 reviewed screenshots spanning
proposal, separate confirmation, owner/reader/foreign views, durable uncertainty,
and module loading/recovery across the five viewport tiers. The rebuilt unsigned
arm64 Electron regression suite also passed. Final review then found that
switching an MCP draft back to a simulated act retained the incompatible
`explicit-call` harness; the shared transition now clears MCP authority and
restores a valid simulated harness, with pure and rendered regression locks.
Final acceptance repeats on that correction, including unresolved-acknowledgement
controls at all five sizes. The incomplete pre-correction broad sweep was stopped
before editing and does not count as acceptance evidence.

On the corrected implementation, all four focused journeys pass with 46 reviewed
captures. The complete broad sweep passes 135/135 cells with zero violations or
skips; every viewport column has been visually reviewed. The rebuilt complete
unsigned arm64 `desktop:verify` suite also passes, including existing OS-storage,
SQLite, sharing, restore and signed-in relaunch regressions. The first full local
verifier passes all four browser shards, but its checks lane finds two context
documentation defects: a one-line budget excess and an invalid rule relation.
These are corrected without changing runtime code, and the complete local gate
repeats on the final frozen tree before landing. No GitHub CI is used.

The legacy simulated envelope-effect path remains a deterministic development
fixture and is refused in release profiles. Harness labels (dry-run, escrow,
canary, cooling and hold-until-landing) do not authorize real effects. Local
loopback fixtures validate the implemented exact-bound workflow, not a public
service. The later checkpoint above adds isolated native fixture acceptance. Signed/notarized, Intel and real-service
acceptance remain independent release gates.

## Completed checkpoint: Artifact saved context

The owner approved both pending defaults on 2026-10-08. Artifact context is an
explicit saved copy governed by the destination conversation's sharing; only
explicit Refresh reads the current source again, and source revocation does not
erase an existing copy. The current Contribution execution checkpoint is
tracked separately above; these Artifact-context permissions do not authorize
public MCP service use.

Conversation download landed at `86ef5e73`: all five local verifier lanes passed
(583 browser tests), the broad UI sweep covered 135/135 cells without violations
or skips, and the rebuilt ordinary unsigned arm64 Electron lifecycle verified
exact owner/reader downloads before and after relaunch.

The next complete workflow is Artifact-as-context. It reuses the saved Discussion
copy's draft/first-send, destination-owner mutation and acknowledgement recovery
paths. A copy includes the complete canonical document, sheet, workbook, slides
or figure body; model input derives whole text/data from that one immutable
body under the existing attachment budget. Unsupported, unreadable, bodyless or
oversized sources are refused, never replaced with excerpts or name aliases.
Saved previews preserve each body's nature without source reads or editing.

Implementation and fail-first locks are present. The first permitted full Node
run passed 4,760 tests. Focused route/contract/persistence and controller locks
also passed. A new late-acknowledgement test caught draft adoption after account
replacement: the shared draft funnel now checks account generation after each
wait while preserving valid same-account coalesced sends. The startup budget
caught new eager parser cost; optional connector/workspace panels and connector
detail now share lazy admission with visible loading/recovery rather than a
larger budget. The corrected build and typecheck passed.

Adversarial review also caught an organization-owner source-read mismatch:
copy capture used the destination organization rather than the authenticated
person's current read access. Both Artifact and Discussion now carry that
requester through the existing owner-gated capture/Refresh funnel. A realistic
owner-seat route test failed before the repair and now proves capture, explicit
Refresh and refusal after the source enters Trash without erasing saved copies.

The three Artifact browser journeys passed, including 35 reviewed viewport
captures. The complete unsigned arm64 Electron suite passed; its Artifact
receipt verifies exact model input, SQLite, sharing, permanent source deletion,
signed-in relaunch and detach. The broad sweep exposed a harness timing defect:
its fixed 300 ms delay judged a still-exiting panel as stuck on tablet and
captured a pointer-disabled phone panel mid-exit. A fail-first sweep lock now
requires bounded DOM disappearance, not elapsed time, before judging or taking
the next screenshot. Browser acceptance repeats with that stronger condition.

That stronger check then exposed a real cold-load race: a module resolving
during Close could replace the exiting loading shell and leave the new motion
root mounted indefinitely. UI-204 fixes admission once at the shared PanelShell
for all context families; a late shell renders nothing and completes its own
presence participation. The held-import browser case failed before the guard
and passed on phone/tablet afterward. All six cold Workspace, Repository and
Connector cases pass. Their gate waits for exact request completion before
cleanup and for the unrelated seeded panel to finish exiting after preference
hydration; no route errors are swallowed or dismissal assertions weakened.

Owner/shared/foreign, source-revoked, draft, held-refresh and all five viewport
tiers passed browser acceptance. The final broad sweep passed 135/135 cells
with zero violations/skips; every captured viewport column was reviewed.
The rebuilt complete `npm run desktop:verify` passed after the shared-shell
repair. Its Artifact receipt is `.data/desktop-artifact-context-smoke/run-vvvwvl/receipt.json`
(ASAR SHA-256 `79f337825cde0f5a47212fe270b5ead8cdb40a29f5b1942cee9e3d2e80c3c584`).
Full local verification and post-test diff review remain the final landing
gates. The entire tree freezes for acceptance. Contribution execution follows this checkpoint; signing,
notarization, Intel and real-service evidence remain separate release gates.

The first complete verifier passed static checks/build but found three browser
failures. Exact Repository-header selection and awaited workbook-tab text fix
two asynchronous assertion races. The third reproduced under retained trace:
a replaced Workspace loading shell finished its old exit after unregistering,
recreated a stale presence claim, and blocked a later folder-detach dismissal.
The shared `panelPresence` adapter now forwards completion only for live
registrations; rejected shells also pair manual registration with cleanup.
Both pure negative controls fail without that filter. The unchanged five-size
draft/detach journey and all six cold-panel cases pass with it. UI-204 covers
this additional lifecycle edge. Final broad UI, rebuilt native and full local
verification repeat on this corrected revision before landing.

On the corrected revision, the broad UI sweep again passed all 135/135 cells
with zero violations/skips, and the rebuilt complete `npm run desktop:verify`
passed. The final Artifact receipt is
`.data/desktop-artifact-context-smoke/run-0ABtnI/receipt.json` (ASAR SHA-256
`a147867df6d6f0fb83a256daee9562a7fb510ad2b0b506f7f7b7d66293dd6eb0`).
The second full local verifier passed checks/build and 591/592 browser tests.
Its sole failure was the narrow conversation accessibility audit: retained trace
showed the deferred Repository body mounting after the audit's finite-animation
snapshot, so axe measured blended entrance paint. E2E-V3 now explicitly sets
the durable Repository preference, awaits its actual code body, then proves the
correct tier, full ancestor opacity and stable geometry before scanning. The
new source lock failed before that repair; all 14 focused WCAG journeys passed
afterward with unchanged rules, exclusions and budgets. Product runtime is
unchanged from the accepted visual/native revision. The complete local verifier
repeats on the final frozen tree with first-failure traces and no automatic
retries; no GitHub CI is used.

The third full verifier passed checks/build and 591/592 browser tests, including
the repaired accessibility audit. Its sole failure was a test-only MCP proxy
connection reset on reload, precisely six idle seconds after the previous
successful request and before teardown. The installed Node runtime's 5-second
keep-alive timeout plus 1-second buffer explains the pooled-socket expiry race.
The in-process fixture now closes each response connection. A new behavioral
lock failed on the former `keep-alive` response and now proves two successful
requests use exactly two sockets; the original durable-uncertainty reload
journey also passes. No request retry, deadline increase or production network
change was introduced. E2E-O1 owns the rule; the final full gate now includes
593 browser tests.

The fourth full verifier passed checks/build and 592/593 browser tests. The
remaining failure captured an old-document session poll during image-download
reload, before the new document's JavaScript loaded; navigation invalidated its
response-body handle. E2E-V73 now waits for the newly writable composer and
reads fresh request-context metadata, retaining the real preview and exact-byte
download assertions. The source lock failed before repair, and all eight
image-original browser journeys now pass. Product runtime remains unchanged;
the complete gate repeats on the frozen final revision.

## Completed checkpoint: conversation download

The previous checkpoint landed at `c6ba70b2`: rebuilt unsigned arm64 package,
complete native smoke and all five local verifier lanes passed (578 browser
tests). The real signed-in relaunch retained 44 exact saved messages.

The next complete workflow is a readable conversation download (ADAPT-42), not a
new sharing policy. Owner and currently granted reader use the existing read
wall for an explicit fresh Markdown snapshot. Saved user/assistant text,
retained compacted originals and the current summary are separated and labeled;
private context, tool payloads and attachments never enter the file. Downloads
refuse while a reply is active or if the complete UTF-8 file exceeds 8 MiB.
Close, navigation and account changes retire pending browser work.

Read-only review identified speaker-like Markdown/raw HTML inside messages as a
content-integrity problem; a fail-first lock now requires collision-free literal
blocks without changing original text. The cold build budget also caught 199
excess bytes; Find and Download now share their lazy loading/recovery boundary
instead of increasing the budget. Fresh authorization, descriptor validation,
retry and export side effects have dedicated locks.

The first focused browser run passed eight of nine journeys and caught a
short-landscape shared-reader accessibility defect: the prose-only scrolling
disclosure had no keyboard entry point. UI-202 adds one shared named read-region
funnel and fail-first source/browser locks; the five-size matrix repeats after
repair, including Escape return focus and always-visible download controls.

The broad sweep completed 135/135 cells with zero violations or skips. All 15
affected titlebar captures were reviewed; Download fits at every tier and stays
absent from drafts. The corrected dialog matrix passed; retry assertions now
name the dialog's own error instead of colliding with an unrelated interrupted
conversation notice, and revoked screenshots reissue the rejected read at every
size. Final focused, packaged and complete-verifier runs follow on the frozen
tree. A final lifecycle review consolidated Find/Download into one pane-local
selection so late module loading cannot mount competing dialogs; a fail-first
source lock and browser import gate cover that overlap without changing layout.
The first native export attempt exposed an acceptance-harness mismatch: ordinary
CDP launch has no injected Electron application handle. Download acceptance must
retain that ordinary process/OS-storage lifecycle and configure only its browser
download destination, not substitute a different launcher.

The corrected ordinary Electron suite passed, including exact owner/reader
downloaded bytes before and after signed-in relaunch; all eight native download
captures passed review. The first complete local verifier passed all four
browser shards but its checks lane caught an off-scale 17px dialog title and a
deliberate traversal filename misclassified as a source reference. The title
now uses the existing 15px step (UI-27); the path lock explicitly identifies
that one non-read fixture without weakening traversal rejection. Acceptance
repeats on this final correction before landing.

Acceptance covers owner/shared/revoked/foreign states, five viewport sizes,
keyboard and WCAG checks, the full 135-cell UI sweep, and actual Electron saved
file bytes before and after relaunch. Complete local verification and post-test
diff review remain required before committing and pushing this checkpoint.
The entire tree stays frozen during acceptance. Release signing/notarization,
native Intel, public hosting and real-service gates remain open; pending
Contribution execution and Artifact context decisions are unchanged.

## Completed checkpoint: packaged conversation search and relaunch

The browser checkpoint landed at `37b14c3f`: all five local verifier lanes passed,
including 578 browser tests. The broad sweep covered 135/135 cells with zero
violations/skips, and the final five-size search matrix repeated after its help
copy correction. That evidence does not yet prove the packaged Electron path.

The new acceptance extends the existing ordinary Discussion lifecycle, profile,
local model fixture and signed-in relaunch. It creates 44 exact saved messages,
placing the first of two matches outside the initial 40-message read. Owner and
shared-reader search must open that exact turn through real earlier-history
loading; an ungranted account must neither discover nor read the conversation.
Search cannot mutate its messages or invoke the model. Reload and Back retain
the canonical conversation URL without treating transient focus as a bookmark.
Read-only SQLite checks compare exact IDs and bodies before quit, after process
exit and after relaunch; the helper remains outside the shipped application.

Required evidence is a rebuilt host-architecture package, a deliberately broken
search-target check rejected by the native workflow, reviewed native captures,
the complete packaged smoke and final full local verifier. This checkpoint
changes acceptance code, not rendered product surfaces; the prior responsive
matrix remains applicable unless native acceptance discovers a product defect.
Unsigned Apple Silicon evidence does not close signed/notarized distribution,
native Intel, public hosting or real-service acceptance. The pending Artifact
context and Contribution execution decisions remain separate; no GitHub CI is used.

The rebuilt unsigned arm64 package passed its packaging checks. A test-only
response mutation replaced a real message match with a nonexistent target; the
native exact-turn assertion rejected it. Review also added an explicit empty
foreign-account search API assertion, independently of UI filtering, with a
failing-then-passing lock. The complete unmodified packaged run and final local
verifier remain the landing gates; neither result is inferred from these checks.
The first normal native run reached the exact highlighted turn but exposed a
test-only paragraph assertion: DOM text nodes concatenate Markdown paragraphs.
The assertion now reads visible text, retaining the exact content expectation;
the independent HTTP and SQLite comparisons still check every original byte.
The next complete native run passed, but visual review caught landing captures
midway through the real message fade-in. The helper now waits for full opacity
before asserting the highlight and capturing evidence; its lock failed before
that correction. Final native captures and the complete verifier are repeated
on the frozen corrected tree, without changing the renderer or its animations.

The corrected complete `npm run desktop:smoke` passed on the unchanged unsigned
arm64 package (ASAR SHA-256
`000fcd37a82c3a32593790ee9d359ef8e59d48fea85e1588abbe18b2eb3f494e`).
Its real signed-in relaunch retained all 44 exact messages; all ten search
captures were reviewed with readable text, visible exact-turn highlights and
distinct owner/shared/foreign states. The built ASAR contains no search acceptance
helper. Existing credential, import/OCR, export, MCP, backup and restore phases
also passed. Final full local verification and post-test diff review remain
required before committing and pushing this checkpoint to `main`.

## Completed checkpoint: search saved conversation text

Global search now includes current user/assistant text in human-initiated
conversations, including conversations readable through an explicit grant.
One result per conversation previews its first matching message and opens that
exact turn in the landing pane, loading earlier history through the existing
Find mechanism. Metadata-only matches retain the ordinary conversation door.
Archived originals, tool output, attachments and scheduled-run conversations
remain outside this search. Existing category paging counts conversations, not
messages; Find in conversation remains the way to inspect every matching turn.

All global queries share a 256-character bound. Saves refresh open results;
deletion and sharing changes evict obsolete snippets. The projection shares its
literal matcher and read permission with conversation Find, introduces no index
or new backend operation, and preserves transient highlight semantics (the
conversation URL remains canonical; highlights are not persisted in history).
Fail-first route, navigation and freshness locks precede implementation. Browser
acceptance covers older-message landing, duplicate panes, shared/foreign access,
revocation, live arrivals and stale targets. Full local verification and the
135-cell UI sweep remain required before landing; no GitHub CI is used.

The first affected browser run passed 20/21 journeys and caught low-contrast
muted text on highlighted turns. The shared arrival-highlight class now uses its
paired foreground, locked across palettes/modes and by the rendered WCAG walk.
Read-only review also found an initial-read false missing-message announcement;
arrival loading/failure must settle before absence is asserted, with an explicit
Retry retaining the same target. These are checkpoint acceptance findings, not
new product directions.

The broad responsive sweep completed 135/135 cells with zero violations or
skips. Subsequent review narrowed the search help to message-text matches so it
does not promise exact-turn focus for title-only results; its source lock failed
before the correction. The final local verifier repeats the affected five-viewport
journey after that wording change, with the entire tree frozen during each run.

The previous draft-local Undo/Redo checkpoint landed at `a48c9eaa` with all five
local verification lanes green (574 browser tests), 135/135 UI cells and complete
unsigned arm64 packaged smoke. Artifact-as-context and real Contribution
execution still await their separate sharing/execution-policy decisions.
Signed/notarized distribution, Intel and real-provider acceptance remain open.

## Completed checkpoint: draft-local Artifact Undo/Redo

Complete Document, Sheet, workbook and Slides editors now share bounded,
memory-only Undo/Redo: up to 50 recent states and 2 MiB serialized history per
draft. Focused typing coalesces; paste and structural actions are separate steps.
Exact block/worksheet identities survive traversal. History follows the shared
draft through navigation and duplicate panes, but never rewrites saved versions.
Save acknowledgement, Cancel and account disposal clear it; held uncertain or
conflicting saves disable traversal until the existing recovery releases them.
The opening revision and explicit whole-body Retry consent remain unchanged.

Visible controls and scoped keyboard commands replace competing paste/removal
undo controls only in saved editors. Creation dialogs retain their existing
one-step reversals. Read surfaces and remote MCP gain no new operation or access.
Unit/controller/source locks were watched fail before implementation. The new
browser journeys cover four formats at all five viewports, structural identity,
typing/paste grouping, duplicate panes, navigation and held recovery.
An intentional disconnected-Undo mutation failed the exact browser value check
before the original implementation was restored. Packaged
Document and Sheet import acceptance also exercise exact Undo/Redo restoration.
Final full local verifier, UI sweep and unsigned native outcomes are recorded in
the checkpoint handoff; they remain mandatory before landing.

Artifact-as-conversation-context and real Contribution execution remain separate
pending sharing/execution-policy decisions. Neither is implicitly authorized by
this draft-recovery feature. Signed/notarized distribution, Intel and real-provider
acceptance remain open production gates; GitHub CI is not used.

## Completed checkpoint: packaged Document editing and migration

The full editor shipped at `3ce125a4` after the local verifier passed all five
lanes, including 570 browser tests, and the 135/135-cell UI sweep passed with no
violations or skips. The new native acceptance extends the existing ordinary
Artifact history launch/relaunch lifecycle rather than adding a privileged test
bridge or another user-data profile.

The focused unsigned arm64 packaged workflow passed: the built renderer edits
the title and all five block kinds, inserts/reorders/deletes under one exact
revision-fenced Save, and retains literal list/code entries. Discussion doors
follow moved originals and explicitly label deleted originals before and after
signed-in relaunch. Exact current bodies, IDs, versions and discussion rows are
read from the real SQLite database.

A separate generated legacy fixture is staged only after the app exits and its
old service is unreachable. A compare-before-write transaction removes IDs only
from that fixture's current/history blocks, preserves all other rows and receipts,
and restores the old numeric discussion locus. Ordinary startup performs v5→v6
migration; exact restore lineage survives, the numeric discussion stays explicitly
unavailable, and a subsequent rendered edit appends a new revision without
rewriting its retained versions. Test-only helpers are excluded from the package.

Review found ID-less expectations in older direct-create, local import, image OCR
and scanned-PDF OCR native helpers. Their exact-content checks now include every
canonical block identity; the search helper also has a behavioral two-block lock.
`npm run desktop:package` and the complete `npm run desktop:smoke` passed on the
unsigned arm64 artifact, including the existing credential, import/OCR, export,
MCP, backup and restore paths. The actual ASAR excludes the new test helpers.
A disposable response mutation replaced the moved block's ID after Save; the
native workflow failed its exact-body assertion before the unmodified full run
passed. Editor, moved/deleted discussions and migrated-edit captures were reviewed.
The first full local verifier passed static/unit/build checks and three browser
shards, but exposed an existing discussion-copy test race: its request event
preceded the async route observer's saved-state read. That walk now waits for the
same POST's successful response before checking the exact pre-send empty copy;
no assertion, deadline or retry policy was relaxed. The focused regression and
all six discussion-context browser tests passed. A fresh trace-enabled full local
verifier passed all five lanes with 570 browser tests in 552.5 seconds; the
checkpoint landed as `dd18374b` and was pushed to `main`.
This milestone is unsigned Apple Silicon evidence, not signed/notarized,
Intel, paid-provider, or public-release acceptance. Those production gates remain
open; no GitHub CI is used.

## Completed checkpoint: full Document editing and stable discussions

The approved editor now covers title, headings, paragraphs, bullet items, code
lines and email headers, with insert, delete and keyboard-accessible reorder.
Whole-body saves reuse the account-scoped draft and explicit conflict recovery
workflow. Inline prose drafts also pin the opening revision and original block
ID, so a later reorder cannot redirect a held edit to its neighbor.

Authoritative creation and current reads identify every Document block. The
append-only v5→v6 migration assigns legacy history revision-local identities,
preserves already identified bodies and exact restore lineage, and refuses
current/history mismatches. Legacy numeric discussion anchors remain explicitly
unavailable. New anchors use stable IDs; deleted originals are labeled “original
block deleted.” Ordinary editing cannot resurrect a retired identity; explicit
saved-version restore can. Revision-fenced search positions remain unchanged.

Acceptance includes fail-first contract/controller/migration/route locks, the
five-viewport editor and owner/shared/foreign discussion journeys, the complete
135-cell UI sweep, and the full local verifier on the frozen final tree. These
are required gates, not implied by implementation. Packaged acceptance of this
new editor and migration remains a separate follow-up; previous native evidence
predates this rollout. Signing, notarization, Intel and real-service gates remain
open and no GitHub CI is used.

Review caught two additional boundary gaps before final acceptance. A transient
discussion focus could reveal a folded section only to hide it again immediately;
the shared section now latches navigation reveal locally, preserving global fold
preferences and explicit user folding. A browser test reproduced the failure.
Current-version snapshots with retained ID-less Document history must also refuse
admission instead of normalizing only the current body and making future edits
unappendable. Older version-5 snapshots still migrate current and history together.

All six focused Document browser journeys pass, including the reproduced
folded-section regression. Twenty editor/access/recovery viewport screenshots
and the full 135/135-cell surface sweep were reviewed; the sweep reports zero
violations and skips. The signed-in preview is left on Ada, light desktop, with
the six-account roster stacked. Existing Sheet/workbook recovery assertions now
follow the shared Artifact wording, and the removed-block assertion addresses the
held original rather than its obsolete ordinal. The first full verifier found one
remaining ID-less scheduled-output expectation; that assertion now verifies the
exact revision-local block identity alongside content. The complete local verifier
is the remaining mandatory landing gate for this tree.

## Completed checkpoint: Document block-identity foundation

The owner approved full Document editing with stable block IDs, insert, delete
and reorder. Discussions must follow the original block; deletion must leave an
explicit “original block deleted” state, never attach the thread to a neighbor.
This approval replaces the earlier pending Document-identity decision. External
Contribution execution and the outstanding release gates remain separate.

Implementation is staged without exposing structural edits prematurely. First,
the shared body contract, prose patch helper and history admission/append path
preserve exact IDs across all five existing block variants. A body is wholly
legacy or wholly identified; duplicate, malformed and partial identities refuse
admission. Restore must match the retained source including its IDs, independent
of object field order. This checkpoint neither assigns IDs to existing data nor
changes discussion/proposal addresses, the storage version, or editor controls.

Next, connect authoritative ID assignment, conservative migration and typed
anchor resolution before the full editor. Old history can contain whole-body
replacements, so equal indices or equal prose cannot establish lineage. Retain
provable identities; preserve ambiguous legacy anchors as explicitly unavailable
without guessing. Saved-source restore may reattach only the exact retained ID.
The editor must cover headings, prose, lists, code and email headers, retain
account-scoped drafts, require the reviewed body revision, and preserve explicit
conflict recovery. Existing revision-fenced search locations remain safe without
being turned into permanent block addresses.

Foundation acceptance includes tests observed failing before implementation,
exact JSON/SQLite restart and restore checks, focused history/content suites and
the complete frozen-tree local verifier. The UI-review skill's matrix is deferred
until renderer changes land; this checkpoint changes no rendered surface or
preview account. It does not claim the approved full editor is already shipped.

The focused 82-test content/history/route/persistence/context run passed. Negative
checks rejected the old ID-dropping parser, removed all-or-none/ID validation and
weakened exact-source restore. Review also exposed current Documents without
history bypassing ID checks; admission now validates identity-bearing bodies
before any backend save, with failing-then-passing tests for both backends.
Wholly legacy current-body admission remains unchanged. Sparse list/code arrays
are refused instead of turning missing lines into JSON nulls. The complete local
verifier remains the pre-commit/pre-push gate for this final tree.

The consumer audit also found Word export rejecting otherwise valid ID-bearing
blocks. Its admission now shares the portable block parser while retaining its
own title, XML and text limits. A failing-then-passing test proves all five block
variants produce byte-identical Word exports with or without IDs; no identity
metadata enters the package. The first verifier was stopped before this repair;
only the subsequent full run on the final frozen tree counts as acceptance.

## Completed checkpoint: packaged current and saved search workflow

Committed locally as `79ca86d3`: the complete unsigned arm64 packaged smoke and
all five local verifier lanes passed, including 564 browser tests. All eighteen
history/search captures were reviewed. The working tree was frozen throughout
final acceptance. The normal HTTPS push succeeded after transient GitHub server
errors; `79ca86d3` is now on `main`, with no force push or CI use.

The browser checkpoint is complete at `c5637ea9`: all five local verifier lanes
passed, including 564 browser tests; the responsive sweep covered 135/135 cells
with zero violations or skips. That does not establish the new reading locations
in the built Electron renderer or after a real process restart.

The existing ordinary Artifact-history acceptance now also creates exact
Document, Sheet, workbook and Slides bodies through the packaged API. Rendered
current search must reveal the actual field, select a later worksheet, restore
keyboard focus after visiting an equal-shaped tab, and preserve its location
through reload and Back. Current navigation must neither mutate Artifacts nor
read private history. Exact SQLite bodies and signed-in relaunch are checked
before repeating the four-format journey. Restoring the existing history fixture
also makes its old current locator stale; both launches must explain that state
without highlighting a substitute. The existing saved-search, access-wall,
comparison, cancelled/confirmed restore and receipt-replay checks remain.

Acceptance requires a newly built host-architecture package, a disposable ASAR
negative mutation that the rendered current-search assertion rejects, screenshot
review, the complete packaged smoke and a final frozen-tree local verifier.
The added helper is excluded from shipped code and reuses the existing real
profile/authentication lifecycle. No provider call or user document is involved.
Unsigned arm64 acceptance cannot close signing/notarization, native Intel,
real-service or release-hosting gates. Document identity was approved after this
checkpoint; external Contribution execution remains a separate product decision.

The focused ordinary packaged journey passed on unsigned arm64. A copied ASAR
with current-search locators removed then failed at the exact rendered Document
match URL, while the original package hash stayed unchanged. The first negative
copy failed before that assertion because its framework symlinks were rewritten;
preserving those links repaired only the disposable copy harness. All five new
source/packaging locks were watched fail against removed guarantees, then passed
after restoration. The focused receipt binds ASAR SHA-256
`47255cb0f1bb513d94c438640c99538f68753f72317b97832067b3474b1e9ddd`.
The complete packaged smoke and local verifier subsequently passed on the final
frozen tree, and the verified commit was pushed successfully.

## Completed checkpoint: reveal exact Artifact search matches

Current-body search closed the missing-text gap, but opening a result still hid
matches in later workbook tabs and left long bodies at their beginning. Search
now carries a revision-pinned authored-field locator through pane navigation,
Back and canonical current/history URLs. The reading surface selects the exact
tab, highlights the field and brings it into keyboard focus without editing.
Show match returns to it after browsing elsewhere. A changed current revision
or absent field is explained without applying an old position to new content.
Queries and body text never enter the address; ordinary metadata-only hits keep
their existing resource door. This does not introduce stable Document block
identity, new read authority or an external service.

UI-197 records the demonstrated hidden-match defect. Negative checks rejected
both removed revision fencing and first-tab-only initialization. Acceptance
requires current and immutable saved bodies, reload/Back, stale/missing targets,
all authored formats, owner/shared/foreign access, keyboard/viewport checks,
the complete UI sweep and full local verifier on the final frozen tree. The
packaged history acceptance helper follows the new search-derived URL; updating
that helper alone is not fresh native acceptance. Larger Document identity and
external Contribution execution decisions remain outside this checkpoint.

Adversarial review reproduced a Show match focus failure between equal-shaped
worksheet tabs: React reused the cell, and the old focus receipt suppressed its
return. The field-registration funnel now retires that receipt on detach. The
browser assertion failed before repair. The preliminary verifier was stopped
before changing the tree; only final, uninterrupted acceptance counts for delivery.

## Completed checkpoint: complete current Artifact search

Commit `aa9db7b2` passed all five local verifier lanes (561 browser tests) and
the full 135-cell UI sweep with zero violations or skips, then was pushed to
`main`. Visual review was clean and Ada was left signed in. No GitHub CI was used.

Ordinary search previously matched only Artifact names, sources and short
excerpts, missing later Document paragraphs and structured body values. It now
searches each currently readable Document, Sheet, workbook and Slides body
through the same literal text projection used by saved-version search. Results
retain exact current identities, category order and complete paging, with a
bounded matching snippet shown in a three-line wrapped preview. No persistent
index, new route, authority or external service is introduced.

Current body reads reuse the canonical tenant/grant projection; foreign,
revoked and trashed bodies stay absent. History remains a separate owner-only
mode. HTTP regression tests reproduced the missing later-body matches before
implementation, and a source lock rejected the old preview wiring. Acceptance
covers later fields in every authored format, exact IDs, bounded Unicode
snippets, paging, edits, revocation, five-viewport owner/shared/foreign browser
walks, the complete UI sweep and the full local verifier on the final frozen
tree. The two pending product policy questions below remain outside this scope.

The first browser run exposed a missing global-search refresh on grant changes:
an already-open shared-reader result retained its snippet after revocation.
The common event handler now evicts every cached search query/category/page
before rechecking access (UI-196), locked by the failing browser assertion,
event wiring and actual cache-family eviction tests. Review also preserves
lazy historical snippet construction: off-page matches count without building
their previews. A duplicate Search-button test selector was corrected.

## Completed checkpoint: packaged saved-version workflow

The browser search/history checkpoint is complete. Prior packaged attachment
acceptance covered history restoration and API reads after relaunch, but not
explicit saved-version search or canonical revision pages in the built
renderer. The new acceptance uses an ordinary isolated desktop launch with real
OS-backed authentication and SQLite, generated accounts and authored content,
and no model/provider call or main-process injection. It proves owner search,
exact revision reload/comparison, inert Cancel, current-page navigation, shared
and foreign privacy, explicit restore, and signed-in full relaunch with exact
history and replay receipts. Its helper remains excluded from shipped code.
The focused packaged journey passed on unsigned arm64. A disposable copied
ASAR with saved-version query results disabled failed at the rendered exact
revision search result; the real package was untouched. All three helper locks
were watched fail against missing wiring/exclusion or weakened SQLite read-only
admission, then restored. Review corrected the post-relaunch search screenshot
to capture results before opening a hit. The complete packaged desktop smoke
then passed, and all eight final history screenshots plus the matching ASAR
digest receipt were reviewed without findings. The complete local verifier
passed all five lanes, including all 559 browser tests, without retries.
Commit `61d6b229` was pushed to `main`.
This is unsigned host-architecture workflow evidence, not signing/notarization,
native Intel or real-provider acceptance. The complete local verifier remains
mandatory before pushing. The Document identity and external Contribution
execution policy questions remain pending and outside this checkpoint.

## Completed checkpoint: explicit saved-version search

Ordinary search remains current-only. An explicit Search saved versions mode
finds literal text in the owner's retained Document, Sheet, workbook and Slides
bodies, including Trash. Queries are bounded to 256 UTF-16 units, pages to 20
hits and snippets to 320 units. No additional persistent index or external
service is introduced. Each result identifies its exact saved revision and
opens a canonical read-only history address, never a substituted current body.
Current-resource navigation, reload and Back preserve that distinction.
Comparison and separately confirmed CAS restore reuse the existing history
workflow; a restore from an exact-version address acknowledges the new current
revision without changing which saved revision the URL names.

Acceptance requires owner/shared/foreign and deletion tests, explicit-mode and
literal-match negative locks, exact-address navigation, paging and recovery,
five-viewport/accessibility review, the complete UI sweep and the full local
verifier on a frozen tree. Document stable-block identity and real external
Contribution execution remain separate pending decisions. Signing/notarization,
hosting, native Intel and authorized real-provider evidence remain release gates.

The first complete local verifier passed all five lanes and 559 browser tests.
Post-pass review found an unnecessary current-content library read on exact
revision pages; the UI sweep was stopped before repair. Shared read admission
now suppresses live reads on saved-body surfaces. A source lock failed before
repair, and the rendered walk counts network requests across opening, reload
and comparison. The corrected frozen tree passed all five verifier lanes and
559 browser tests; the final UI sweep passed 135/135 cells with zero violations
or skips. All five screenshot columns and ten explicit search/comparison views
were reviewed without findings. Commit `4f0927fd` was pushed to `main`, leaving
Ada signed in on the exact-version preview. This supersedes the preliminary run.

## Completed checkpoint: conversational Project sharing

This core-workflow checkpoint closed the missing named `share_project`
proposal tool over the existing sharing capability. The generic API door already
exposes this operation; no new route or sharing authority is introduced. An
explicit shared/private boolean and exact, unambiguous owned created-Project
target produce the normal consent card, which names public discovery and
contribution consequences without exposing private conversations or context.
Endpoint and Session transports share the tool and confirmation funnel.
The shared-reader browser walk caught an existing relation-card mismatch: Confirm
was visible to readers although the server denied it. All relation cards now
derive visible and callable consent from exact conversation ownership, retaining
readable proposal/history text. UI-193 records this demonstrated defect and lock.
Screenshot review also caught graph state overriding a previous Not now decision
after a later proposal was approved. UI-194 centralizes history precedence in a
pure verdict function, with a truth-table lock watched fail before repair.
Existing Agent tool grants are preserved rather than widened on upgrade; new
full-catalog Agents include `share_project`, and existing Agents may explicitly
select it through their normal configuration.

Strict-input and authority locks, model-to-route consent and replay checks,
Session-transport coverage, and five-viewport/accessibility review passed.
The final local verifier passed all five lanes including 555 browser tests;
the separate complete UI sweep passed 135/135 cells with no violations or skips.
Commit `2f234212` was pushed to `main`, with Ada signed in on the consent preview.

## Completed checkpoint: artifact history comparison

Owners can compare a retained version against the exact current saved revision
before deciding to restore it. The read-only comparison shows literal Document,
Sheet, workbook and Slides changes, distinguishes empty from absent values, and
pages every changed field in groups of 20. Workbook tabs retain their saved
identity; positional content does not invent moves. A newer current revision
requires explicit Refresh comparison before Restore becomes available again.
Restore remains a separately confirmed, revision-pinned operation. Trash history
can be compared but still cannot restore a body until lifecycle restoration.

This checkpoint requires the full local verifier, complete UI sweep and focused
five-viewport/accessibility browser acceptance on a frozen source tree. It adds
no API authority, model input or external integration. Signed/notarized releases,
native Intel and real external-provider acceptance remain separate release gates.
Adversarial review added a guard for version reads that reveal a newer current
revision before the history list/SSE arrives, plus success-state reset after a
restore. The exact-revision guard and literal projection both received negative
mutation checks. The initial UI sweep was intentionally stopped before edits;
acceptance must run again against the final frozen tree.
The complete 135-cell UI sweep and six focused comparison browser walks passed.
The first full verifier found one source-scan collision in an inert test string
(4,561/4,562 Node checks passed); the fixture was changed without weakening the
no-native-dialog rule, and the browser lanes were deliberately interrupted.
Follow-up review also keeps observed newer-revision evidence after leaving
comparison or changing selection. The final complete local verifier passed all
five lanes, including 554 browser tests; the final UI sweep passed 135/135 cells
with no violations or skips. Commit `f5012e14` was pushed to `main` after review,
with Ada signed in on the comparison preview. This evidence supersedes the
interrupted preliminary runs above.

## Completed checkpoint: conversation Find

After the verified paged-resource-search checkpoint, the next core gap was
finding text in older conversation history. Browser Find cannot see unloaded
messages. Conversation-scoped Find now uses a permission-checked paged read,
bounded snippets and exact-message navigation through the existing history
window. Shared readers use the same door; unavailable history has explicit
Retry/cancel and a removed or compacted target has a terminal explanation.
Current summaries are searchable; archived originals, attachments and tool
payloads are not. Global resource search remains title/preview based for sessions.

The checkpoint's delivery gates are the complete local verifier, UI sweep,
five-viewport/accessibility conversation-search browser walks, and signed-in
preview review. This is product-workflow progress, not a release-readiness claim;
signed/notarized distribution, Intel and real external-provider acceptance gates
remain. No GitHub CI is required or dispatched. The query/page guard was watched
fail when its page comparison was removed; the backend role lock likewise
received an intentional negative check. Unicode snippet behavior has dedicated
regression cases.

Adversarial review also found and corrected a doubled cache-family delimiter;
the actual cache eviction regression failed before repair. Open-dialog browser
checks cover new saved turns and revoked sharing. The initial broad Node run
observed a five-second native profile ACL helper timeout (4,549/4,550 passed);
its isolated 15-test suite passed, and no concurrent helper builder was found.
The fail-closed production check and deadline remain unchanged. Delivery still
requires the complete local verifier on the final revision.

The first full verifier passed static/build checks and 546 of 548 browser tests.
Two browser assertions needed alignment with the rendered structure: the
revocation alert includes its Retry button, and a current summary now has its
own addressable turn alongside the four retained originals. The strengthened
checks assert the alert/retry separately and distinguish summary from tail;
no production behavior, deadline or retry policy was relaxed. The final complete
local verifier passed all five lanes and all 548 browser tests; the UI sweep
covered 135/135 cells with no violations or skips. Reviewed and pushed as
`b373bf57`.

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

### Approved follow-on decisions (2026-10-05)

The owner approved the three recommendations requested after the Folder checkpoint:

- Real Git context captures tracked working-tree files, including uncommitted
  edits, through explicit Attach or Refresh; untracked and ignored files stay
  excluded. Remember remains opt-in and access stays read-only.
- Bundle a pinned Git executable so end users do not need a separate Git install.
- Previous artifact versions are owner-only and retained without automatic
  pruning until permanent deletion. Shared readers see only the current version.

The owner subsequently approved permanent-deletion cascade semantics: remove the
artifact, all versions and shares, and artifact-only discussions/proposals;
preserve conversations, content-free audit/retirement records and existing backup
files. A later explicitly confirmed whole-backup restore can restore older
content; permanent deletion is not a promise of forensic erasure. This approves
the feature policy, not deletion of any real user artifact.
The owner also approved keeping original imported image files privately for later
download alongside their normalized preview/model copies. Original means the
selected source bytes, not another decoded frame. This applies to explicit local
and served-image imports; it does not grant new source access or send originals
to models/shared viewers. Implementation must account for both copies in storage,
backups and cleanup and preserve existing imports that have no retained original.
Approval alone does not establish implementation or release acceptance.

### Approved contribution review policy (2026-10-06 UTC)

The Project owner selects the reviewer Agent/provider and explicitly starts each
review using the owner's budget. The reviewer receives only the frozen changeset,
has no tools, and cannot land changes automatically. This approval does not
authorize delegated policy decisions, envelope fulfilment or a paid-provider
acceptance run using real credentials.

The explicit reviewer path now preserves private Project walls, owner-scoped
reviewer/provider resolution, budget preflight and usage attribution, exact
changeset identity, and separate human landing. An attempt commits before
provider I/O: retry or restart cannot silently repeat a possibly paid request,
and a late result cannot review a newer changeset. Pending, findings, passed,
failed, stale and uncertain outcomes have distinct public history. Existing
local usage counters are metering, not a strict reservation of concurrent or
unreported spend. Legacy reviewer omission remains a development fixture only.

### Approved OCR and Discussion attachment defaults (2026-10-06 UTC)

The owner approved both recommended defaults:

- OCR runs on-device. Extracted text is editable and must be reviewed and
  explicitly adopted before saving. Extraction itself does not upload an image,
  contact a configured provider or incur a provider charge.
- A Discussion attaches as an explicit saved copy. Attach and Refresh check
  current source access; the copy follows the destination conversation's sharing.
  The UI must warn before copying. Later source revocation does not erase the
  existing copy or prior replies. This is not a live permission-linked view.

The bounded macOS recognition engine is now connected to Document creation:
explicit single-image selection, on-device extraction, read-only text review,
explicit adoption into editable Content, then ordinary Create. Neither selecting
nor extracting saves or uploads the image; recognition never calls a provider.
Browser/other-platform OCR and scanned-PDF page rendering are not silently added
by the desktop image engine. Discussion-as-Context implements the approved
copy/sharing semantics under CTX-DISC-1, as scoped in the checkpoint below.

The internal engine locks recognize generated pixels with the real native helper,
including blank and malformed images. Packaged acceptance checks the shipped
single-architecture binary, system-only dependencies and ASAR-matched runtime.
The capacity lock was watched fail when cancellation released its child slot
before process close; the real helper lock also failed when malformed PNG framing
was misreported as no-text. Compressed metadata and APNG chunks are refused before
OS decoding. The renderer workflow adds account/operation fences and explicit
adoption; none of this establishes scanned-PDF extraction, complete
language/corpus accuracy or native Intel evidence.
Implementation uses Apple's [Vision text-recognition request](https://developer.apple.com/documentation/vision/recognizing-text-in-images)
with a fixed accurate revision and automatic language detection; accuracy and
language support are OS-dependent, not a promise of universal recognition.

## Progress and next milestones

### Complete resource-search navigation (2026-10-06)

The next core-workflow audit found that global search exposed only five matches
per category without continuation and dropped several selected resource IDs at
navigation. COMMONS-15 now keeps the small overview while offering fixed-size
category pages and exact canonical doors, including work items and prompts.
Each page reuses current authorized reads; live changes may shift offsets and
the UI says so. Artifact excerpts join the existing metadata/prose search;
full conversation transcripts and saved-version indexing are separate work.

The shared result mapper and response-coordinate guard prevent generic landings
and stale-query activation. Keyboard selection scrolls into view, read failure
has explicit Retry even beside local Pages, and the loaded palette now uses the
same viewport-bounded dialog as its deferred loading state. No index, persisted
search history, external connection or new write authority is introduced.
Acceptance covers exact paged IDs, HTTP/MCP parity, current access, canonical
resource doors, query races and five-viewport accessibility/layout. The complete
local verifier and responsive sweep remain the pre-push gates; no GitHub CI is
used. Contribution execution still awaits its separate design decision, and
the signed/notarized, hosting, Intel and paid-provider gates remain open.

The first focused browser run exposed 4.38:1 selected-result secondary text;
UI-189 now pairs that text with its tested chromatic seat across both modes,
presets and sampled customization extremes. Both browser and intentional pure
contrast regressions failed before repair. The first full Node run found an
existing message-metrics test exhausting the shared demo tenant's five-hour
budget (HTTP 429). That test now owns a fresh usage partition and proves a 200
plus terminal message before checking the counter; production limits and test
timeouts/retries are unchanged.

The responsive sweep completed all 135 cells with no violations or skips;
focused search/browser coverage passed 11 tests and the full Node suite passed
4,531 tests. Post-test review tightened the keyboard destination's heading
assertion to use the actual selected title, rather than an undefined name. The
final complete local verifier must include that strengthened assertion before
landing. The signed-in preview demonstrated a formerly hidden sixth artifact
opening its exact page and retained Ada plus the six-account stack.

The first complete verifier passed all four browser lanes but exposed a native
Git fixture collision: six concurrent suites compiled to the same development
helper path, while the failed reader suite passed alone. Each now builds an
identical helper into its own temporary directory with suite-owned cleanup;
the helper fixture is excluded from packaging. A source lock failed on all six
shared builds before migration. No production Git authority, reader behavior,
deadline or retry policy changed. The search race test also now proves its
response is held before attempting Enter.

### Literal Sheet range paste (2026-10-06)

ADAPT-40 adds bounded table paste to the shared creation and editing fields.
TSV quoting preserves literal values, and one validated replacement grows the
chosen worksheet without changing other tabs, notes or cells. Malformed and
oversized pastes leave the draft untouched. Immediate Undo is fenced by the
exact resulting body so a later edit from another pane cannot be overwritten;
normal Save/Create and Cancel still own persistence. CSV/TSV file import and
clipboard paste now share one parser instead of separate grammars.
The production bundle gate caught a 502,641-byte section dependency graph
against its unchanged 500,000-byte ceiling. Saved editing now loads on demand
behind announced local loading/failure, safe Cancel and explicit warned Reload;
the shared memory draft and creation-runtime admission remain authoritative.

Acceptance covers pure boundaries, creation/edit browser workflows at all five
viewports, the full local verifier and UI sweep, plus built-renderer paste and
source-independent relaunch in the unsigned arm64 package. The packaged paste
event is a generated fixture, not OS-clipboard acceptance. No GitHub CI is used.
MCP Contribution execution remains a separate pending design decision; release
credentials, update hosting and native Intel acceptance remain open.

### Actual native PDF review acceptance (2026-10-06)

The [native PDF record](acceptance/native-pdf-ocr-2026-10-06.md) adds actual macOS
chooser cancellation, blank-PDF refusal, two-page scanned recognition, separate
read-only review, explicit adoption/correction/Create, and exact saved text after
a full source-absent relaunch. Three ordinary launches used one generated private
profile, real OS storage, no debug/test bridges and native-menu Quit. Native
control state intermittently lagged; a clean relaunch restored the successful
selection. The uncompleted protected-PDF manual attempt is not counted as a pass.

The next core direction is real Contribution execution through a user-selected
tool on an existing MCP connection, with reviewed exact arguments, a separate
Run confirmation for each call and no automatic retry after uncertainty. That
design decision is pending; approval would not authorize any real external
action or credentials. Signed/notarized and native Intel evidence, public update
hosting and authorized real-provider acceptance remain external release gates.

### Sandboxed scanned-PDF review (2026-10-06)

The owner approved a separately sandboxed macOS service and continued independent
core work. Explicit single-PDF selection now feeds a byte-only broker and an
authenticated App Sandbox XPC service. Only the service links the native
CoreGraphics/Vision decoder; it has no user-file or network entitlement. The
Document form keeps recognized text in a read-only candidate until explicit
adoption, correction and ordinary Create. Limits are 8 MiB input, 100 pages, a
2,000-pixel rendered edge, 64 KiB whole text, one job and a 120-second deadline.
The existing authored-document source limit refuses larger candidates without
clipping. Every admitted page is processed sequentially, including blank pages.

The isolated browser bridge-fixture workflow now passes all 22 focused artifact
import journeys, covering PDF/image OCR, ordinary text/PDF/DOCX imports,
presentation/workbook imports and recovery. PDF idle, pending, review and refusal
states pass exclusion-free accessibility and containment checks at all five
canonical viewports, with both native OCR capabilities represented. The general
UI sweep passed 135/135 cells with no violations or skips. These establish
renderer behavior only, not native confinement or a release-ready PDF engine.
The initial browser run exposed two test defects (a rounded rather than exact
source-limit expectation and attempting an account switch behind a modal); both
were corrected without retries or wider timing budgets. Native picker payload
coverage also watched the incorrect byte-field mapping fail before repair.

The service validates its own sealed identity and authenticates the fixed broker
identifier and Developer ID team; local ad-hoc builds instead pin the exact
standalone transport signature. The broker validates its nested service before
connecting. The service exits on broker loss even with an uncooperative decoder,
and has an independent deadline. Real generated-file/loopback denial, forced
cancellation, wrong-peer rejection and tampered-seal tests passed; the denial
assertion was watched fail with a test-only unsandboxed service. Page bitmap
budgets do not claim to bound every internal decoder allocation.

The unsigned arm64 packaged OCR phases passed with actual two-page image-only
PDFs, blank/protected/over-page-limit refusals, exact review/adoption/correction,
and saved Document content after source-absent relaunch. Initial packaging
failures exposed the actual codesign requirement prefix and Packager hook path;
both are now covered by locks. Native picker answers are fixtures, not manual
OS-dialog evidence. Developer ID/notarization, Intel execution and broader OCR
corpus acceptance remain release gates. The complete `npm run desktop:verify`
passed, including the independent recovery repair below. The complete local
`npm run verify` remains the mandatory pre-push gate, without retries or GitHub
CI reliance. Ordinary PDF attachment/import stays explicitly text-only.

The first complete verifier passed all four browser lanes and 4,485 of 4,486
node tests. Its sole failure was the suite-path lint treating a quoted expected
renderer import as a path relative to the cross-layer test itself. That assertion
now uses the same exact import regex shape as the surrounding source locks;
neither the path lint nor its exceptions, product behavior, timing or retries
changed. The corrected complete verifier passed before commit `1d53e352`:
4,486 node tests and 527 E2E tests, all five lanes green without retries in
474.2 seconds. The production build and complete packaged verifier also passed.

### Actual startup restore and cancellation repair (2026-10-06)

The [native recovery review](acceptance/native-restore-2026-10-06.md) now proves
actual macOS selection/confirmation and Electron-managed automatic relaunch on
the unsigned arm64 package. The exact baseline Document returned after replacing
generated damaged SQLite; newer work was absent, the authentication root and
empty vaults stayed byte-identical, and no additional safety copy appeared.

The manual review found picker cancellation left the failed-start app running
without a usable window. Startup recovery now quits on picker or confirmation
cancellation and on failure, while an explicit restarting outcome leaves exit
to the restore lifecycle. Behavioral and wiring regressions were watched fail;
both actual cancellation paths now exit cleanly with generated damaged bytes
unchanged. The complete packaged verifier passed. Populated-vault/token recovery,
healthy safety-copy behavior and malformed-backup recovery remain covered by
their separate automated walks, not this narrower manual record. Signing and
native Intel acceptance remain open; no GitHub CI is used.

### Damaged-startup restore acceptance (2026-10-06)

The expanded packaged recovery walk uses only generated isolated profiles and
explicit dialog fixtures. It found a real gap: a valid portable backup could
not repair an unreadable SQLite database because restore tried to open the
damaged destination first. Recovery now stages and read-back-validates a new
SQLite database privately, retains the existing main file without an absent-path
crash window, separates old sidecars and atomically publishes the replacement.
Final-path read-back and durable rollback prevent false success. Orphan sidecars
without a main database remain a fail-closed manual-recovery case.

The new regression was watched fail against the old direct-open path. Focused
locks prove malformed input, staging failure and final-read-back failure preserve
the original bytes, including removal of replacement-created WAL/SHM files before
rollback. The real packaged damaged-startup walk now passes: exact chosen
Document/Sheet/Slides/conversation state, no fresh safety copy, unchanged device
authentication root and provider vault, and a still-usable pre-damage personal
token. Dialog answers, relaunch spawning and that walk's mock keychain are
explicit test fixtures, not manual OS-dialog or OS-encryption evidence. Separate
ordinary packaged launches still prove OS-backed credential/auth persistence.

### Captured possible-rename review (2026-10-07 UTC)

PORT-29 extends the read-only review with optional grouping of staged additions
and deletions. Unique identical text and conservatively scored edited text can
pair old HEAD with new Index; every suggestion remains a possible move because
copy-plus-delete is indistinguishable from these bytes. Ambiguous, unread and
over-budget edited candidates stay as raw rows. Unstaged changes remain separate,
and a fresh read or dismissed review resets grouping. This is a pure projection
of the existing capture, not native Git rename detection or a new API authority.

The duplicate-exact ambiguity guard was intentionally broken and its regression
failed before restoration; bypassing grouping also failed the rendered old-to-new
heading assertion. Independent cutoff and reverse-ambiguity mutations also failed.
Pure locks cover UTF-8 weighting, exact line endings,
input/work budgets and raw immutability. Browser acceptance covers opt-in/out,
old-path selection, fresh-read/disposal resets, no implicit reads or writes and
short/long paths across five viewports. Packaged acceptance creates actual staged
moves in an isolated generated repository and checks exact old/new sides,
unchanged index/sharedindex bytes and mtimes, saved context and model requests.
Complete local verification, the general UI sweep and unsigned arm64 desktop
verification remain required before landing; outcomes belong in the checkpoint
handoff. Signed/Intel and broader real-provider/service acceptance remain open.

### Changed-line Git review (2026-10-06 UTC)

PORT-27 turns the existing read-only Git capture into line-numbered changed
sections with three context lines, added/removed totals, newline cues, and a
Full files alternative. Rendering is paged at 200 text rows without dropping
later changes. Exact missing sides and unread sides stay distinct; unavailable
or excessively complex comparisons retain the captured full text and explain
why changed lines cannot be shown. View changes do not reread the repository.

The pure bounded matcher preserves CRLF and final-newline identity, handles
whole-file addition/deletion linearly and is checked by reconstruction and a
small-input minimality oracle. The byte-limit and unknown-side-as-empty
mutations were watched fail. Acceptance covers changed-line/full-file views,
pagination, long lines, mode-only and empty changes, omission/fallback, native
read counts, account disposal and the five-viewport accessibility matrix.
The complete local verifier, general UI sweep and packaged Git walk remain the
delivery gates. PORT-29 separately adds possible-rename hints; neither adds Git
writes, live status, model access, or signed/Intel evidence.

### Saved Discussion context (2026-10-06 UTC)

CTX-DISC-1 adds a confirmed saved-copy attachment to existing conversations and
new drafts. The picker uses the participating readable Discussions projection,
excluding direct messages; the server rechecks source access on Attach and
explicit owner Refresh. A complete transcript is bounded to 200 posts and
64 KiB and joins the ordinary shared attachment-input budget. Rendering never
fetches the source, and the saved copy follows destination sharing even after
source revocation or deletion. No tool permission is created by a Discussion.

First send replaces a queued target with the acknowledged saved copy before
adoption. Capture refusal preserves the exact retryable turn and its one created
conversation. An uncertain context write must reconcile the current desired
workspace and remove abandoned effect bindings before Retry can send; a removed
copy cannot survive a lost response and silently become model input. Reset and
account disposal fence late acknowledgement and failure publication.

Locks cover source walls, tamper refusal, strict durable snapshots, bounded
untrusted model framing, shared-reader restrictions, explicit Refresh and
lost-response recovery. Source-wall and draft-adoption mutations were watched
fail. The browser matrix covers picker, confirmation and owner/shared panels at
all five viewport sizes; the general sweep passed 135/135 cells with no skips
or violations, and all 142 general plus 20 Discussion captures were reviewed.
The shared picker workflow now loads on demand under the unchanged startup
budget, with local failure and Done recovery. The complete local verifier is
the final delivery gate; GitHub Actions is not used. Signed/Intel releases,
public update hosting and authorized real-provider/external-effect acceptance
remain separate prerequisites, not claims made by this saved-copy workflow.

### Packaged Discussion saved-copy closure (2026-10-06)

CTX-DISC-1 now has ordinary packaged-process evidence for the complete saved-copy
workflow, not only browser and route-level locks. The excluded
`desktop/discussionContextSmoke.mjs` sets up generated accounts and resources
through the shipped HTTP API, then uses rendered confirmation, Attach, Refresh,
send and detach controls. Its independent transcript oracle checks exact Unicode,
line breaks, author names, timestamps and reply relationships on the actual model
wire. The single provider conformance probe is accounted for separately from four
conversation requests; Attach, Refresh and relaunch do not dispatch model work.

Source edits leave the saved copy unchanged until explicit Refresh. A separate
real account sees the copy through destination-only sharing while the private
source remains 404, with no owner controls. Deleting the generated source branch
does not remove the destination copy. A full native-process exit leaves the exact
snapshot in SQLite; ordinary relaunch preserves sign-in, replies and the saved
open-panel preference before another exact saved-copy send. Detach removes new
attachment input while retaining earlier replies. No effect-bearing SessionContext
is created. The network assertion covers per-Discussion detail requests; the
explicit picker's participating-Discussion list remains its normal projection.

The focused unsigned arm64 walk passed on runtime ASAR
`892b8db100f67c2630c410c416b18d116916ed8459389c430777fc7dd095c620`.
A disposable copy with model `post_count` forced to zero failed the exact-wire
assertion (`0` versus `2`), while saved data and reply text still matched. The new
package-exclusion and awaited-smoke wiring locks also failed before implementation.
Per-run screenshots and hash-bound receipts live under the ignored
`.data/desktop-discussion-smoke/` directory; no test helper ships. The complete
local and packaged verifiers remain mandatory before landing; no GitHub Actions,
paid provider, signed/notarized or Intel acceptance is implied by this checkpoint.

The complete packaged verifier passed. The first full local verifier passed all
527 browser tests but exposed an existing 25 ms timeout-test race: the delegated
judgment fixture sometimes received no request before connection setup expired.
That test and its identical Contribution review counterpart now assert the exact
configured deadline and inject a timeout only after full request-body admission,
with a bounded admission watchdog and early-settlement failure. Both reject an
intentional production deadline mutation from 25 to 26 ms. Runtime deadlines,
retry policy and application behavior are unchanged. The repaired revision passed
all five local verification lanes, including all 527 browser tests. Post-test
review additionally pins the reader's source 404 after destination sharing, not
only before it; the final revision remains subject to the complete pre-push gate.

### Local image to editable Document (2026-10-06 UTC)

PORT-26 now completes the approved bounded macOS workflow. Extract image text
shares the ordinary Document import review and preserves any typed name/content.
The native chooser admits only one image; the normalized PNG alone crosses the
trusted main-frame bridge. The shared contract rejects diagnostic fields and
incomplete, invalid Unicode or oversized text. Explicit Use/Replace adopts the
candidate, the Content field permits corrections, and Create saves through the
existing acknowledged Document lifecycle. There is no image upload, original
retention, provider request or OCR-specific durable record in this path.

Cancellation, format change, account transition, navigation and shutdown fence
late work. Native child capacity remains occupied until process exit; an outer
renderer deadline also prevents an unanswered bridge from stranding the form.
The result-shape, sender-ownership, single-image admission and post-recognition
lifetime locks are deliberately mutation/failure checked. Acceptance gates cover
five-viewport review/accessibility, standard document/sheet/slides regressions,
the complete local verifier and general UI sweep, plus real packaged OCR from
generated PNG pixels and corrected Document content after a source-absent relaunch.
The full 517-test E2E suite, 135/135-cell responsive sweep, production build and
packaged OCR acceptance passed. Browser bridge fixtures establish UI wiring;
the packaged helper establishes recognition for this bounded macOS path.

Discussion-as-Context follows the separately scoped checkpoint above. PORT-28
now separately provides scanned-PDF-to-Document review. Browser/non-macOS OCR,
automatic OCR in ordinary PDF attachments and broader accuracy/language
acceptance remain distinct future work. Release blockers are still signed and
notarized Apple Silicon/Intel evidence, public update hosting and authorized
real-provider/external-effect acceptance; no GitHub CI dependency is introduced.

### Actual native Git review and update notice (2026-10-06 UTC)

The [revision-scoped native acceptance](acceptance/native-git-review-2026-10-06.md)
now covers the real macOS chooser and PORT-25's explicit staged/unstaged review,
freshness, Dismiss, missing-source Retry and durable Disconnect across three
ordinary launches. The remembered connection survives while transient results
do not. Exact generated index/shared-index hashes and timestamps remain unchanged;
no provider was configured and the session registry stayed empty. The actual
application menu and unconfigured-update notice were also visually reviewed.
No product source, native policy, normal user profile or shared demo state changed.
This closes those unsigned arm64 manual cells, not signed update consent,
two-version installation, Intel or paid-provider acceptance.

The existing Discuss with Claude action still seeds a digest into a new
conversation; reusable Discussion attachments to existing conversations have
been implemented separately under CTX-DISC-1. Its current-source read check,
saved snapshot and destination-sharing behavior follow the approved
explicit-copy policy and checkpoint above. The OCR choice
above is approved and its bounded macOS implementation and acceptance are
complete; configured-model uploads are not authorized by that decision.

### Explicit local Git review (2026-10-06 UTC)

The existing repository page now exposes an explicit **Review changes** read,
with separate staged (HEAD → index) and unstaged (index → working tree)
comparisons. The shared diff primitive shows complete bounded before/after text,
executable mode, absent/empty files and explicit omissions. Read time and raw-byte
limits stay visible; this is neither live Git status nor a line-hunk/rename engine.
Passive review and selection are account-scoped memory only: they imply no
saved snapshot refresh, model input, HTTP mutation or Git write. A separate,
explicit conversation-only **Attach this comparison** action can save one
already captured selection as a bounded ordinary JSON text attachment (CTX-FS-34);
it does not reread or write Git. Dismiss, disconnect and account switches fence
late review replies. Native snapshot/review operations share capacity and
shutdown revocation; the portable parser validates and detaches every
publication.

This completes the user-facing review workflow over the internal foundation
below; captured review stays read-only until the separately explicit saved-copy
action above. Signed/notarized two-architecture release, external-service and
paid-provider acceptance, OCR, and richer source/format workflows remain
separate production milestones. Local verification and browser/native
acceptance remain the checkpoint gate; GitHub Actions is not used.

Checkpoint evidence: all seven focused Git browser journeys pass, including
five-viewport ready/empty/omitted/error/loading/dismissed states, bounded keyboard
code scrolling, navigation retention, account disposal, malformed output and
lazy-module recovery. The general sweep covers 135/135 cells with zero skips or
violations; all 142 captures were visually reviewed. The complete unsigned
arm64 desktop suite passes, including actual bundled-reader/preload/renderer
review, unchanged index/sharedindex bytes and timestamps, saved-only model input,
relaunch and disconnect. This is not signed/Intel or real-provider acceptance.

### Read-only Git diff foundation checkpoints (2026-10-06 UTC)

The real Git baseline review rests on these completed prerequisites, not a
comparison of saved snapshots. Its first layer adds internal no-follow object range reads and
fixed-depth pack-index discovery to the existing native helper. Exact slices are
bounded at 16 MiB even when a pack is larger; every result carries the whole-file
version, and an out-of-range request cannot silently return partial bytes.
Only canonical SHA-1/SHA-256 object paths are accepted. Pack discovery excludes
alternates and unrelated names, and both operations recheck descriptor bindings.

The internal baseline transaction now resolves real detached, loose or packed
HEAD references and preserves staged/unmerged index identities, including
SHA-1/SHA-256, split indexes, unborn branches and linked worktrees. Git decodes
loose and packed/delta objects only in private generated metadata; source paths,
configuration, hooks and alternate stores never become Git execution authority.
Pack/index checksums, independently hashed returned objects and final source
version/root fences protect publication. Metadata-only probes explicitly return
unverified hints; they cannot establish content integrity. Limits include
500 paths, 64 tree levels, 1 MiB/object, 8 MiB decoded bodies, 32 MiB pack indexes,
512 MiB staged object data and a 30-second operation lifetime. Regular baseline
blobs retain the shared 64 KiB bound. Private staging is removed on normal exit;
forced-crash cleanup is not yet claimed.

Packaged acceptance now exercises generated packed HEAD/index baselines through
the actual bundled Git and descriptor helper, checks unchanged source metadata,
and byte-compares the baseline modules/dependencies against their ASAR copies.
This is internal-library acceptance, not product IPC, native selection or diff UI.

The internal review reader now combines HEAD, index, current ignore rules and
working-tree reads under the same final fences. It reports staged and unstaged
raw-byte/mode changes separately, distinguishes missing files from unsupported
or unreadable ones, and never presents sparse subtrees or skip-worktree leaves
as deletions, or an unmerged index as a normal comparison. A generated private
sparse cone preserves captured sparse-directory entries without source rules;
tagged index enumeration retains leaf skip-worktree state. A path deleted from the index grants
no access to a recreated, now-untracked working file. Ignored paths are excluded
before any baseline/working body reads. The shared private ignore helper now
also serves existing saved captures, with 64-level/1,024-directory limits and
32 KiB candidate batches. File/directory transitions use conservative directory
ignore matching, which can exclude an additional historical file rather than
expose an ignored subtree.

Working input remains limited to 24 readable files/128 KiB; display text across
all sides is separately capped at 128 KiB, with 64 KiB per body. Staged changes
receive first access to the bounded preview; every remaining omission is
explicit. Comparisons are literal bytes and owner-executable mode, not a promise
to reproduce Git status with source configuration, attributes, line-ending
conversion, clean/smudge filters or external drivers. This reader adds no source
writes, automatic reads, renderer bridge, saved-context schema or model input.

PORT-25 now connects this transaction to the explicit local review surface above.
Source Git configuration, external diff drivers, untracked/ignored files and
repository writes remain excluded. Persisting, sharing or sending this review
to a model needs a separate product decision.
At that review checkpoint the OCR choice was still pending; it has since been
approved, implemented as PORT-26, and accepted for the bounded macOS path. The
signed/paid-provider release gates remain pending.

### Packaged delegated judgment acceptance (2026-10-06 UTC)

The unsigned arm64 packaged workflow now covers delegated judgment through the
ordinary Electron executable, real OS-backed authentication and SQLite. It
reuses the existing local Messages fixture and generated profile; no credentials
or user workspace are involved. Rendered Draft keeps work open. The exact wire
contains only policy, changeset/envelope and structural risk, without tools,
Project/discussion context or Agent instructions. Review instructions remain
allowed for the separate review path, so independent test markers distinguish
those two input boundaries.

A second judgment is observed pending on disk before and after shutdown. An
independent launch durably records uncertainty while retaining the first result,
owner identity and exact usage windows. The captured body/key returns that
receipt with no provider redispatch. Explicit promotion to policy revision one
does not execute; a new rendered Decide lands the permitted non-effectful work.
A separate Decide approves a read-only envelope without landing or fulfilling
its lines. The actual managed backup retains both private judgment histories.

The focused walk passed eight fixture requests with six completed responses and
996 reported tokens in each usage window. Its ordinary package ASAR hash was
`a00e01c32048fcb69d3f80ba35cba0f82819f60c6129c5f190835d1da9c93210`.
Removing judgment recovery in a disposable package copy failed precisely at the
rendered uncertain-state check after relaunch; the altered copy was removed and
the ordinary package hash stayed unchanged. Fixture recognition and acceptance
source locks were also watched fail and restored. The complete desktop smoke
passed its startup, credential, native-import, Git, schema and restore phases.
The complete local verifier remains the final delivery gate. Paid-provider, signed and
native Intel acceptance, and real external-effect fulfilment remain outstanding.

### Real delegated judgment implementation (2026-10-06 UTC)

The approved owner-started model path now uses an exact policy/work/reviewer
request and commits its pending receipt before provider I/O. It sends only the
written policy, frozen changeset/envelope and structural risk, without tools or
Agent instructions. Draft recommendations do not act. Decide can approve only
a read-only envelope or land non-effectful work after policy revision, expiry,
revocation, ownership, provider binding and all frozen work/risk facts are
rechecked. Irreversible work escalates before model I/O. Refusal and escalation
are distinct outcomes, including in the attention ledger.

Model explanations remain initiating-owner-only because they can quote private
policy. Shared readers see attributed status and content-free timeline acts.
Same-key recovery returns the exact durable attempt; restart converts pending
to uncertain without another call. A fresh paid attempt always requires a new
explicit activation. Local fixture verification and browser review precede this
checkpoint's delivery; packaged native judgment acceptance remains the next
release gate. No paid-provider run or external envelope execution is implied.

Adversarial review repaired model-label/ID receipt confusion, delayed approval
overwriting newer envelope usage, and a failed lazy load stranding later held
intent. Independent guards were watched fail and restored. Compatibility tests
also exposed a consumed request body being read twice; the legacy wrapper now
receives the already-parsed body, with a bounded regression lock. Real pending
attempts are observed on JSON/SQLite disk before a fixture response, survive an
abrupt child-process exit, and recover to uncertainty in a fresh process. The
comprehensive snapshot exercises a completed judgment through the actual store
mutator and retains history after its temporary authority is removed.

### Approved delegation lifecycle and judgment policy (2026-10-06 UTC)

The owner approved both pending defaults: real delegated judgment is explicitly
started by the Project owner on their own budget, with no tools and only the
written policy, frozen changeset/envelope and necessary risk facts. Draft mode
is advice; Decide mode may approve a read-only envelope or land a non-effectful
Contribution only after current authority and exact versions are rechecked.
Irreversible actions always return to the human. Uncertain requests never retry
automatically. Delegation policies support explicit versioned edits and expiry;
changing or expiring a grant invalidates any unfinished decision's authority.

Implementation is staged at complete checkpoints: first the owner-facing policy
lifecycle and durable version/expiry boundary, then the separately metered model
judgment seam and native acceptance. This approval does not authorize a paid
provider acceptance run, external-effect execution or signing credentials.

The policy lifecycle now retains the original grant and up to 49 explicit edits,
including policy text, autonomy, triggers and expiry, privately for its owner.
Agent and act identity stay fixed. Editing requires the original delegator's
current Project ownership and exact reviewed version; retry proves the retained
next-version payload and returns current truth without reverting later edits.
Expired grants remain readable and revocable but authorize no new judgment.
Revocation pins both grant identity and policy revision. Legacy immutable grants
retain revision-zero meaning and no expiry.

The editor keeps unsent policy and uncertain requests across navigation, exposes
exact Retry or explicit Dismiss/review, and never rebases authority silently.
The boundary tests include owner/shared/foreign projections, stale writes,
bounded history, expiry, JSON/SQLite restart and unchanged release refusal.
Adversarial review caught two persistence admission gaps: unknown row fields
could enter shared projections, and a fabricated retirement receipt could
acknowledge revocation while authority remained live. Strict row/receipt
admission now rejects both, with each lock watched fail against its disabled
guard. This checkpoint does not yet enable real delegated model judgment.

The UI review also corrected duplicate-pane draft divergence and aligned Edit
and Revoke with their distinct server authority rules. All open editors now
observe one memory-only draft; the original delegator may edit only while still
owning the Project, while either the delegator or current owner may revoke.
The final full visual sweep covered 135/135 cells without violations or skips;
focused browser checks cover held navigation, lost responses, explicit
stale-policy review and synchronized duplicate panes. Two full-verifier runs
then exposed a deferred-section layout regression during a neighboring Land
click. The retained trace identified the swap during the pointer action; a
delayed-module test reproduced a 21-pixel shift. Loading and failure now retain
the shared folded-section anatomy, with held-pointer and local-recovery locks.
The complete local verifier remains mandatory before landing; no GitHub CI is
used.

### Packaged owner-review lifecycle acceptance (2026-10-06 UTC)

The rebuilt unsigned arm64 application now has a dedicated acceptance phase in
the ordinary desktop and extracted-release smoke. It uses an isolated generated
profile and the real OS-backed authentication root, production renderer, HTTP
service, Messages client and SQLite; only the local Messages peer is a fixture.
Rendered review controls produce findings and a pass without landing. The wire
contains only the frozen changeset and no tools, and completed replies meter
exactly the fixture's reported usage.

An unanswered third request is observed as pending in the real database before
and after app shutdown. A new process commits uncertainty, retains both earlier
results and exact usage windows, and answers the original keyed request without
another model call. Only an explicit fourth review dispatches again; a separate
human Land completes the workflow. The actual managed backup preserves all four
private receipts. Package-hash-bound evidence and screenshots are emitted under
`.data/desktop-review-smoke/`; no real provider credentials or user data are used.

The focused packaged walk passed. To verify the acceptance lock, a disposable
copy of the ASAR was changed to leave the interrupted receipt pending: its
relaunch failed at the expected rendered uncertain-state assertion. The altered
copy was removed; the ordinary artifact was unchanged. Fixture tests also catch
scoped finding corruption, and package exclusion tests reject shipping either
acceptance helper. Harness review additionally reproduced an unhandled rejection
when socket failure preceded late assertion attachment; the rejection assertion
now attaches before shutdown. The complete desktop smoke also passes its ordinary startup,
credential, attachment, schema-worker and restore phases. The complete local
verifier remains the final pre-push gate. This does not close signed/notarized, native Intel,
paid-provider, delegated judgment or external-effect milestones.

### Owner-controlled contribution review (2026-10-06 UTC)

The Contribution page offers an explicit eligible Agent selection and discloses
its configured endpoint model, frozen version and owner-funded budget. The
reviewer receives only that changeset plus its selected review instructions;
the separate Messages call declares no tools, performs no fallback or automatic
retry, and has bounded input, output and deadline. Strict entry-bound JSON
findings or a no-findings verdict enter retained review history, not discussion
comments or automatic landing.

A private exact-version/reviewer receipt commits before outbound I/O. Same-key
replay returns current receipt truth even if reviewer configuration later
changes; changed intent conflicts. A restart durably changes unfinished work to
uncertain. Invalid completed output still meters reported usage; ambiguous
transport has no passing authority. A new version or newer unsuccessful attempt
cannot borrow an older pass. Public history includes display attribution and
results, never tenant anchors, credential references or endpoint configuration.

Verification covers deterministic local Messages fixtures, owner/shared/foreign
boundaries, immutable retry intent, separate landing, and JSON/SQLite/portable
state. It does not claim paid-provider or signed-package acceptance. Delegated
policy judgment and envelope fulfilment remain independently release-blocked;
neither is implicitly authorized by this reviewer policy.

The responsive sweep covered all 135 cells without violations or skips, with
separate owner/shared review screens at all five canonical viewports. Its new
long-label check caught and locked a 320px disclosure overflow. Final review
also requires uncertain billable holds to survive failed Dismiss truth reads,
failed controller loading to retain visible recovery, and malformed provider
usage to settle uncertain rather than pass unmetered or remain pending forever.
These are explicit regression cases in the focused review suites. The local
preview retains the walkthrough and findings after its temporary fixture Agent
and provider are removed; no dead endpoint is left available for selection.

The first complete gate passed 4,198 Node tests and all four browser shards,
then rejected the new section bundle at 507,460 bytes against its unchanged
500,000-byte async-graph ceiling. Review history and controls now have a dedicated
deferred boundary: both display and the actual shared write runtime must load
before intent can be accepted. Loading dispatches nothing; a rejected module
offers explicit full reload with an unsent-text warning, not a same-URL retry
that the browser module cache cannot recover.
The emitted graph exposed a shared `CircleX` icon assigned to the section chunk;
using the already-shared alert icon for the red Failed state removes that
dependency. The budgeted build passes without changing its ceilings, and the
deferred review panel itself is 9.09 KB.

### Actual native image chooser acceptance (2026-10-06 UTC)

The [native image record](acceptance/native-images-2026-10-06.md) now adds actual
macOS Files cancellation, Files and Photos SVG selection, distinct same-name
assets, native original-file downloads and source-absent relaunch on the unchanged
unsigned arm64 package at `da395674`. Exact originals and normalized model-image
hashes match across the recorded checks; saved workspace, context and message
hashes match across a full Quit/relaunch. Only generated images, an isolated
profile and a credential-free loopback model fixture were used.

This closes the local SVG picker/original-download handoff gap for this artifact,
not signed/notarized, Intel, Photos-library, all-format, multi-account or
paid-provider acceptance. The normal six-account Ada preview remains untouched.
Owner-controlled contribution review is recorded in the checkpoint above;
real delegated judgment and envelope fulfilment remain independently unavailable.

### Contribution execution release wall (2026-10-06 UTC)

The current audit found three development fixtures outside the existing model
and connector release guards: contribution review always passed, delegated
judgment always found policy satisfied, and effect-envelope execution recorded
success without calling an external adapter. Desktop/web profiles now refuse
all three operations before new state or fixture receipt replay. The same store
wall protects internal callers; HTTP and MCP expose the ordinary
`capability_unavailable` refusal behind the Project visibility boundary.

Historical timeline entries remain readable. Their mock review stamps no longer
appear as effective review on an open release contribution or authorize Tier-1
contributor landing. Attention guidance directs the contributor to the Project
owner instead of promising a mock self-landing, and release advice no longer
proposes an unavailable delegated reviewer. Manual owner approval and landing
remain intact; approving an envelope is not a claim that its effect ran.

This closes a false-success defect, not the underlying production feature gap.
The explicit owner-selected review path is now recorded above; delegated policy
evaluation and envelope effect fulfilment remain required core work. A configured conversation provider or
connector does not silently configure these seams or approve paid acceptance.
Direct-store and route regressions were watched fail against the old behavior
before implementation; focused tests cover both release profiles, old fixture
receipts, unchanged state/events, private Project walls and the human path.
Disabling the shared release guard after implementation made six tests fail,
including the real MCP tools/call regression; the original guard was restored.
Complete local verification and final diff review remain the landing gate.

### Prior attachment and native acceptance checkpoints

The preceding checkpoint closed the actual macOS Git chooser acceptance gate on
the unchanged unsigned arm64 build at `a4212731`. The
[dated native record](acceptance/native-git-2026-10-06.md) covers real selection
and cancellation, explicit temporary/remembered grants, Attach, saved-only model
input, opt-in persistence, explicit Refresh, missing-source recovery and durable
Disconnect across four ordinary launches. Exact saved state and model-input
comparisons pass; split-index/shared-index bytes and nanosecond mtimes remain
unchanged. Only generated repositories, an isolated profile and a credential-free
loopback model fixture were used. Native-control limitations are recorded without
turning unresponsive actions into passes. No product code changed in this check.

The previous checkpoint implemented approved private original-image retention
and authenticated download. Explicit local and served imports bind the exact
source container and normalized copy to one immutable asset identity. Original
bytes count toward quota and cleanup, survive JSON/SQLite and portable backups,
and are downloadable only by the owning tenant; shared views and in-session
models retain only the normalized representation. Legacy imports remain valid.
The UI checks original availability before offering download and fences pending
reads across selection/account changes. Focused regression tests cover exact
bytes, original-private metadata, body budgets, acknowledgement validation and
restart. Original metadata and body responses are no-store; source containers
download as opaque files, never as inline image markup.

Focused browser acceptance passes all 28 image/collection workflows; the eight
new original-file workflows also pass after the final shared-view copy repair.
These cover exact SVG/ICO/PNG bytes across reload, legacy imports, owner/shared/
foreign walls, availability/body failure and retry, revocation, delayed selection
and account switches, and served-image capture. The frozen responsive sweep
passes 135/135 cells with zero violations or skips. All 137 fresh sweep captures
and 20 image-specific captures were visually reviewed across five sizes; five
older artifact-viewer PNGs were excluded from this revision's evidence.

The rebuilt unsigned arm64 package passes attachment acceptance, including an
actual original-file download with the exact filename/bytes before and after a
full relaunch with source files removed. Model image blocks remain normalized.
Native selection results and model responses in this automated gate are fixtures.
The separate native image record above now covers actual local Files/Photos SVG
selection and original download; the earlier Git record is not substituted for it.
Review corrected private-download vs model-input disclosure, stale intake copy,
shared-reader send wording, error contrast and invalid deferred rail-status
nesting, with failing-then-passing locks (UI-129, UI-179, UI-180).
The live preview remains on Ada's original-image walkthrough with all six demo
accounts stacked. The complete local verifier is the mandatory final landing gate;
no GitHub CI is used.
Signing/notarization credentials, hosting, native Intel and real signed updates
remain separate release gates. No public production-release claim is made.

The preceding checkpoint implemented the approved permanent-delete workflow from
Trash: a separate owner-only consequence preview and confirmation, exact reviewed
state held through recovery, one atomic cascade, and durable retirement that
prevents old saves, create retries or routine writes from resurrecting a deleted
artifact. Current content, retained versions, shares and recursively artifact-only
discussions/proposals are removed together. Conversations, audit records and
existing backups remain; explicitly restoring an older whole backup is an
intentional rollback exception, not a secure-erasure guarantee.

The owner-only HTTP/MCP capabilities use the same reviewed lifecycle/cascade
precondition and durable exact retry receipt. A lost response retains one
display-only Trash row through navigation; Retry never rebases the confirmed
scope, Dismiss only reads, failed reads retain recovery, and late responses cannot
redirect a newly chosen page. Private history/body caches are removed, stale
live acknowledgements cannot resurrect the identity, and former readers receive
an ID-free access-change hint. Deferred controls wait for their recovery module
and contain loading failures without losing Restore. Optional backup controls
load only in Customize, keeping the unchanged startup and async bundle budgets.

Focused browser acceptance passes all nine deletion workflows, including module
refusal, stale consent, lost acknowledgement, exact retry and owner/shared/foreign
walls. The separate responsive sweep passes 135/135 cells with zero violations
or skips; all 142 sweep screenshots and ten new confirmation/recovery captures
were visually reviewed across five viewports. The rebuilt unsigned arm64 package
exercises Cancel, explicit reviewed deletion, a full relaunch, absent history,
exact receipt replay and preserved conversations. JSON/SQLite restart and portable
backup tests cover retirement, failed durable commits and explicit older-backup
rollback. The complete local verifier remains the mandatory final landing gate;
no GitHub CI is used.

Adversarial review locked one graph revision per cascade, generic reader
invalidation, direct-create provenance independence and orphaned social-reference
refusal. Incidental notification reads do not invalidate consent; changes to the
artifact, versions, sharing or discussions still require fresh review. Retirement
admission accepts lawful large descendant sets rather than writing a record that
would fail on restart. Regressions were watched fail before repair.
The first complete verifier passed all four browser lanes but found the old Trash
and history source locks still requiring their prior guards. They now explicitly
require the deletion hold, its history exclusion and both lifecycle/deletion row projections. The
three module-refusal browser cases use separate declarations so the unchanged
coverage planner counts each case. The corrected complete local verifier passed
all five lanes, including 490 browser tests, before `a4212731` landed. The separate
135/135 UI sweep and rebuilt unsigned arm64 packaged gate also passed.

The live preview remains signed in as Ada with all six demo accounts stacked,
on an active disposable deletion walkthrough; no real user artifact was purged.
That checkpoint left native Git chooser acceptance open; the current dated record
above supplies actual OS-dialog evidence without substituting packaged fixtures.
Original-image retention was approved but not yet implemented at that checkpoint;
the current checkpoint above supplies it. Signing/notarization
credentials, download hosting, native Intel and signed update acceptance remain
separate production gates.

The preceding checkpoint implemented owner-only retained Artifact history. Each saved body
revision remains inspectable through the canonical Artifact page and the
same authorized HTTP/MCP capabilities. Explicit restore creates a new current
revision; it never rewinds ordering or erases intervening work. Its reviewed
current revision and selected source remain fixed through acknowledgement
recovery. Shared readers and ordinary model input continue to receive only the
current body. Owners may inspect retained history in Trash, but must restore
the artifact before making a body version current again.

The rollout cannot reconstruct versions that were never stored. The first
history-aware replacement retains the then-current body as a baseline with an
unknown original save time, and subsequent editor, proposal and routine writes
retain their versions without automatic pruning. History belongs in JSON,
SQLite and portable backups with strict admission and the same exact Artifact
identity. Permanent deletion and its retention cascade remained a separate gate
at that history checkpoint and are implemented by the current checkpoint above.

Focused acceptance passes all seven history browser workflows, beside the
body-edit and Trash regression coverage.
The responsive sweep passes 135/135 cells with no violations or skips; all five
columns and 55 history-specific captures were visually reviewed. The rebuilt
unsigned arm64 Electron package passes its complete smoke gate, including a
reviewed version restore, full relaunch and exact retry without another version.
JSON/SQLite restart and portable backup tests retain exact history and receipts;
portable admission rejects orphaned versions and forged ownership before writing.
The complete local verifier remains the final landing gate. Native dialogs and
model responses in packaged automation remain fixtures; this is not signed,
Intel or paid-provider acceptance. No GitHub CI is required or used.

Review reproduced a history Retry callback receiving a DOM event as display
text, pagination losing a loaded boundary after a live edit, and reconciliation
mistaking metadata resemblance for an exact restore receipt. Shared zero-argument
recovery callbacks, stable page merging and read-only Dismiss now have regression
locks watched fail before repair. Deferred history rendering and one shared
active/Trash section keep the unchanged startup and async bundle budgets passing.
Owner/shared/foreign browser checks preserve current-body-only sharing and model
input, fixed restore consent, navigation recovery and late-account fencing.
Final review also found an unguarded lazy recovery notice: the shell now contains
module failures without dropping the workspace, and history admission waits for
that same recovery module before accepting intent. Root/notice refusal walks
preserve typed drafts, refuse premature restores and recover only on explicit
warned reload across all five viewports. The admission source lock was watched
fail before repair. The first full verifier passed all 480 browser tests but
failed the canonical API-path parity lock; history now uses the shared registry.
Sharing its repeated URL encoder preserves all builder outputs and keeps the
new recovery boundary within the unchanged cold bundle limit. The corrected
135/135 sweep and rebuilt native gate pass. One verifier attempt overlapped the
sweep's port 5193 and could not start a browser lane; its other lanes passed,
but it is not a complete pass. The final standalone verifier passed all five
lanes, including 481 browser tests, before the history checkpoint landed as
`7d8d7ba4`; the separate sweep and rebuilt unsigned arm64 gate also passed.
That checkpoint left the preview on the version-history walkthrough with Ada active and the
six demo accounts stacked. The separately requested permanent-deletion policy
was then explicitly approved for the current implementation checkpoint.

The preceding Git checkpoint is committed and pushed as `dbfbb109`. Its final
complete local verifier passed all five lanes, including 474 browser tests;
the separate UI sweep passed 135/135 cells, and the rebuilt unsigned arm64
Electron package passed its complete smoke suite. No GitHub CI was used.

That Git checkpoint connected the approved native workflow end to end:
Repository → This computer offers an explicitly selected read-only connection,
Remember is opt-in, and Attach/Refresh saves bounded current tracked text through
the same portable workspace/model-input boundary. Contexts exposes symmetric
connection rows and an account-local Disconnect page. Saved copies survive lost
source access, disconnect and relaunch; opening and sending never read the source.
Repositories above 500 tracked entries refuse capture; smaller repositories keep
up to 24 readable files at 64 KiB/file and 128 KiB total, with omission reasons.
Nested paths and uncommitted edits are retained; untracked files and matches from
`.gitignore` / `.git/info/exclude` are excluded. Other local/global Git configuration
does not participate. Live diff/terminal, Git writes and hosted Git remain separate.

Native review found that even read-only Git enumeration freshens split-index
mtime. The implementation therefore runs pinned Git only on private copied
metadata and a generated worktree. A bundled descriptor-relative reader refuses
symlink traversal and changed root/file bindings; bounded metadata never enters
renderer or portable state. SHA-1/SHA-256 and optional zero-checksum indexes,
linked worktrees, source mutation, cancellation and account/grant isolation have
focused tests. UI review caught unbounded repository intake and misleading
truncation copy: the existing shared scroll body keeps Done outside, and one
limits disclosure supplies honest policy to intake, management and saved preview.
The four focused browser journeys pass, and the responsive sweep covers 135/135
cells with no violations or skips; all five screenshot columns and 25 dedicated
Git workflow screenshots were reviewed. The unsigned arm64 packaged workflow
passes actual capture, unchanged index/shared-index bytes and mtime, remembered
relaunch, saved-only model input, missing-source recovery and Disconnect. Final
review caught case/HFS aliases bypassing the literal metadata-path guard; the
new regression was watched fail before rejecting those aliases and disguised
dot traversal at both native enumeration and portable ingress. The complete local
verifier and rebuilt packaged run passed the final landing gates described above.
Native OS-dialog, signed/Intel and paid-provider acceptance remain separate gates.
Owner-only retained artifact history follows this accepted capture workflow.
No GitHub CI is required or monitored.

The preceding Git checkpoint built the approved bundled-executable prerequisite. macOS
packaging builds the checksum-pinned upstream Git 2.56.0 source for the explicit
target architecture using only Apple's toolchain and system libraries. Source,
license texts and an exact build recipe accompany the executable outside ASAR;
build inputs and acceptance helpers stay excluded. The source archive is sealed
as app data, while the Git executable remains in normal hardened-runtime signing.
Review removed the generic Electron JIT entitlement from standalone Git; its
empty entitlement set retains signing and hardened runtime. A disposable ad-hoc
signed copy passed strict verification and execution, not Developer ID/notarization.
Package and extracted-release acceptance verify source/license identity, binary
architecture/version and link dependencies, then enumerate tracked files in a
generated repository without changing its index or metadata. That foundation
did not yet connect a user's repository; the current checkpoint adds the capture,
remembered access, Attach/Refresh and saved-only model workflow above. Native
Intel and signed release evidence remain separate gates.

Both source builds passed their architecture/system-library checks; only arm64
was executed here. The rebuilt unsigned arm64 app passed the complete native
smoke suite and the first local verifier passed all 470 browser tests. Checksum,
architecture, signing-exclusion and JIT-entitlement regressions were watched
fail their locks. A repeat packaged run timed out when the Folder recovery walk
reset from desktop to phone and selected closing controls before the requested
tier settled. The harness now reuses its existing exact-tier/geometry readiness
check after that reset; no product behavior, retries or timeouts changed. Landing
requires the complete local verifier and packaged acceptance on the corrected
tree, with their outcomes recorded in the checkpoint handoff; no GitHub CI is used.

The current checkpoint repairs native Folder recovery observed in the recorded
macOS walk. A closed native outcome preserves busy and connection-limit guidance,
while the sandboxed preload converts failures into fixed path-free messages
instead of exposing Electron's IPC wrapper. Successful list, Connect, capture
and Disconnect keep the existing renderer API and account fences. Unknown native
exceptions and malformed replies retain the generic unavailable message; no new
filesystem authority, automatic retry, capture or saved-state mutation is added.
The new packaged missing-source regression was watched fail on the previous app
at the exact wrapped message. The host/preload tests likewise failed before the
repair, then passed. All 229 desktop tests and the rebuilt unsigned arm64 package's
complete smoke gate pass. The missing-source journey verifies exact workspace
preservation through Use saved state and retains saved-only model input. All five
recovery screenshots were reviewed after reusing the existing exact-tier,
ancestor-opacity and stable-geometry helper; the first captures caught motion,
not a product defect, and were replaced. No renderer component or layout changes
are included. The complete local verifier remains the final landing gate;
actual OS-dialog, signed/Intel and paid-provider acceptance remain separate.

The current implementation closes a first-run catalog mismatch found during the
native Folder walk: clean profiles had empty saved Contexts but the two Add
controls still offered bundled demo accounts and repositories. Both now read one
server-owned catalog selected by the persisted world. Demo fixtures stay explicitly
labelled and remain available in established demo stores; clean stores expose no
fixture candidates, including model connector-name lookup. Actual external MCP
connections and native Folder setup remain independent. Catalog loading/failure
has explicit recovery without fictional fallback, and the conversation MCP picker
can open the existing real server-setup dialog. No stored contexts are deleted or
reinterpreted. Git and service adapters remain required integration milestones;
this change does not implement them or claim fresh native/signed acceptance.

Ten focused browser checks pass for clean/demo catalogs, loading and Retry,
real local-fixture MCP setup/inspection/attachment, saved-context acknowledgement,
and optional-module recovery. The clean UI matrix injects the clean catalog;
separate real-process persistence tests establish clean/demo world selection.
Forty targeted screenshots cover clean/error entry points and all three demo
browsers across five viewports. Review exposed both a hidden demo notice and a
transformed picker clipping its nested browser: one shared disclosure and a
document-level browser portal repair these, with regression checks watched fail.
The separate responsive sweep passes 135/135 cells with zero violations or skips;
all five screenshot columns were reviewed, and the owner preview remains Ada,
light, with the six-account roster stacked. Repository-specific UI and MCP detail
chrome remain deferred, keeping the existing production bundle budget unchanged.

The current acceptance checkpoint closes the real macOS chooser gap for the
remembered Folder workflow on the unsigned arm64 artifact at `14f20c02`.
[The recorded native walk](acceptance/native-folder-2026-10-05.md) verifies
unchecked Remember and Cancel, temporary-selection expiry, opt-in encrypted
connection persistence, explicit Attach/Refresh, saved-only model input,
missing-source recovery, and Disconnect persisting across native Quit/relaunch.
Exact saved state survives independently of both the source path and device
grant. The temporary connection's full saved-copy journey remains automated
evidence; this manual run does not claim it. Early native-control disagreement
recovered after a clean Quit/relaunch and is recorded without inferring a product
defect. Product source and security policy were unchanged during acceptance.
The separate history-visibility and retention questions remain unanswered;
their answers are not inferred from approval of the six desktop defaults.

The preceding checkpoint extends the same explicit saved-context workflow to images
from existing cloud and mapped-runner sources, preserving Files/Photos placement.
One bounded capture normalizes the first frame to PNG and stores it through the
existing tenant-asset boundary. Original bytes remain transient. Preview, shared
reading and model input use only saved assets; legacy images expose Save snapshot.
Refresh and upload Retry retain one capture. New commits require source and asset
authority, while exact replay recovers a committed receipt after access revocation.
JSON/SQLite persistence, shared visibility, collection, model budgets and monotonic
workspace merging use the same image-reference resolver. Intentional removal of
retry caching, account fencing, reconciliation identity and fresh source authority
failed focused locks before restoration. Review additionally exposed receipts
whose asset was absent, mismatched, orphaned or owned by another tenant. Both
JSON and SQLite now refuse those states at startup; unstamped legacy sessions
retain the runtime-default ownership rule. All ten corruption regressions failed
before repair, and the 16-case persistence suite retains malformed-path refusal
beside the new cross-reference checks.

Nine rendered workflows pass for image capture, saved-only reload/sharing/model
input, held Refresh and identical-payload Retry, malformed/oversized input,
cancellation, account switching and optional-module recovery. The served catalog
and capture code now load only on explicit intake, keeping existing bundle
budgets unchanged. Visual review found a full Files image collapsing into a
thin strip at 844×390; the shared full-preview primitive now preserves its
aspect box and scrolls, with a browser assertion watched fail before repair.
The responsive sweep passed 135/135 cells with zero violations or skips, and
all five viewport screenshot columns were reviewed. The rebuilt unsigned arm64
Electron package passed its complete smoke gate, including imports, source-free
relaunch, remembered Folder access, credentials and backup/restore. Native
dialog results and model responses remain fixtures; signed/Intel acceptance is
not claimed. The complete local verifier remains the final pre-push gate.

The preceding checkpoint `0470d7ae` extends saved context to PDF, DOCX, XLSX and PPTX files
from the existing cloud and mapped-runner sources. It reuses the bounded local
worker importers, keeps raw documents transient, and preserves complete extracted
text plus its format disclosure in a version-2 snapshot. Explicit Refresh owns
one capture across Retry, while failed reads preserve the previous copy. Source
authority is checked for a new commit; a previously committed exact receipt is
recoverable without opening a revoked or absent source. Model input and shared
previews consume only the saved projection. Focused contract, client and backend
tests cover these boundaries. Five rendered workflows pass for all four formats,
saved-copy model input, owner/shared/foreign access, five-viewport recovery,
malformed/oversized/cancelled intake and exact lost-acknowledgement Retry.
Review reproduced extensionless format recognition and empty
ready-document admission and repaired both. Intentional removals of the byte
ceiling, post-extraction account fence and single-capture Retry each failed their
new locks before restoration.

Rendered review reproduced Done clipping under long intake errors and a pane
remount that erased pending Refresh status on an empty transcript. Files,
Photos and Folder now share one bounded scrolling body with a fixed completion
footer. Cache seeding now requires an untouched, unreconciled conversation;
held context operations and recovery survive responsive remounts. Visual review
also found panel recovery covering the prior text on short screens; the shared
panel shell now reserves footer space outside its keyboard-scrollable body,
including while Refresh is disabled. Its drawer body also excludes the shell's
border instead of clipping the final pixel. These repairs have failure-first
locks, including a browser keyboard-scroll check while Refresh is disabled.
The final responsive sweep passed 135/135 cells with no violations or skips;
all five viewport screenshot sets were reviewed. The rebuilt unsigned arm64
Electron package passed native imports, saved-copy relaunch, credentials,
remembered Folder access, update posture and backup/restore smoke journeys.
Native picker results and model responses remain fixtures; signed/Intel and
manual OS-dialog acceptance are not claimed. The complete local verifier is
the final pre-push gate, with no GitHub CI dependency.

This is independent of the pending native Git choices (tracked working-tree
versus HEAD snapshots; bundled versus system Git). Those decisions are not
inferred from the earlier six-default approval. Rich Office fidelity, Git,
permanent deletion, saved-version history and release acceptance
remain required milestones, not replaced by this increment.

The preceding checkpoint `98efdae1` connects the native boundary to the Folder workflow for
approved default 1. The desktop picker offers unchecked Remember, metadata-only
Connect, and separate explicit Attach. Contexts gives each connection one
canonical detail with Disconnect. Conversation copies persist independently;
Refresh captures once per intent and retries those same bytes through a targeted
compare-and-swap endpoint. Preview, shared reading and model input use saved
content, never automatic filesystem reads. Native ownership comes from the
trusted window's session cookie, with renderer identity used only as a matching
precondition. Account transitions fence dialogs, reads and late acknowledgements.
The client preserves old copies through failed capture/save, and ordinary stale
workspace writes cannot rewind a refreshed folder.

Five focused browser workflows pass: canonical main/rail navigation, failed
module recovery, explicit capture and identical-byte Retry, responsive long-name
controls, and owner/shared/foreign access. The separate responsive sweep passed
135/135 cells with no violations or skips. The complete unsigned arm64 packaged
gate passed real native readers, trusted IPC, encrypted remembered grants,
temporary-grant expiry, saved-copy model input after relaunch/disconnect, and the
existing credential, import/export and backup/restore journeys. Native dialog
results and model responses remain test fixtures. The complete local verifier
is the final landing gate; no GitHub CI is used. Bundle budgets remain unchanged;
optional connection controls load on demand with visible, non-mutating recovery.

Review caught and repaired short-landscape completion clipping, delayed request
bodies adopting a detached-and-reattached folder, and shutdown leaving reads
uncancelled. Their regression checks failed before repair. Account-generation
fence removal also fails its lock. Shutdown now aborts active captures and
refuses queued work without erasing remembered grants. Native acceptance exposed
test-only assumptions about bridge shape, hidden chip controls, escaped newlines
and which saved copies survive relaunch; exact identities and structured content
assertions corrected these without weakening product guards or timeout budgets.

The preceding checkpoint `175e2d12` started the native boundary for this default.
The internal local-connection store separates device-private root identity and
access lifetime from portable saved snapshots. Selection defaults to memory-only;
only explicit opt-in enters an OS-encrypted private file. Account bindings are
exact namespace/user pairs, descriptors are path-free, and opening/listing never
reads source content. Explicit capture uses the existing bounded top-level text
policy, pins the selected directory identity, and refuses changed sources.
Disconnect commits before acknowledgement and fences an unsettled capture without
touching saved snapshots or source files. Corrupt or unsafe storage is preserved,
not repaired or replaced. Intentional persistence-filter, owner-gate and late-read
fence removals each fail their regression locks.
The source reader also honors cancellation between reads; disconnect cancels
bounded active captures and independently refuses late output from a reader that
ignores cancellation. Deterministic filesystem-adapter tests exercise replacement,
directory changes and exact publication failures, including post-rename sync
uncertainty. Review caught a test whose retry masked the initial uncertainty wall;
checking read refusal first now fails when that wall is removed. Review also found
that the shared Linux storage check accepted unrecognized backend names. Its
explicit known-secure allowlist now fails closed, with a failure-first regression.

That revision was an internal foundation; the current workflow supplies its
renderer/HTTP integration. Local Git remains a required real-reader milestone,
not the seeded repository picker. Browser remembered-directory support,
recursive selection, actual native dialog interaction and signed/Intel release
acceptance are not claimed by automated browser or unsigned arm64 smoke evidence.
If an account changes after a remembered connection is committed and its cleanup
also fails, the bridge withholds the result but the grant may remain for its
original exact owner; no other account receives it. Explicit Check connections
reconciles uncertain changes. The full Folder/Git workflow remains required.

The preceding checkpoint `4b8852ee` closes the already-open conversation live-observation
gap recorded below. Every authoritative pane read can discover a remotely
started reply, including a restarted orphaned turn. One account-scoped stream
claim per conversation prevents duplicate panes, repeated pushes and late active
snapshots from replaying completed/failed turns automatically. Unsent drafts and
local sends keep their identity; idle-boundary reconciliation catches a next
turn whose start arrived while the prior stream was settling. Shared readers
remain read-only. Reply observation rechecks current access throughout replay
and live delivery and closes on revocation without cancelling owner generation;
an unpersisted handle is not a readable conversation capability.
Controller and route regressions are failure-first; a deliberate dedupe removal
also fails the completed-turn lock. Browser mutations separately disabled ambient
observation and idle-boundary recovery; both failed on the missing live reply.
Restored focused tests pass, including successive owner/reader replies, the
held-prior-stream race, Stop and stale-handle recovery. Responsive captures wait
for the actual rail geometry to settle and inspect the latest reply at all five
viewport sizes. The final local verifier and separate UI sweep remain required
before landing.
The first full gate exposed two old test assumptions: consent resurfacing counted
only mount/push reads, and the manual-Retry walk disabled ambient events but still
allowed the new idle read to prove a lost-response turn completed. The shared
consent lock now includes all three read entries. Manual recovery must keep the
authoritative detail read unavailable through the held failure; a separate
browser walk checks automatic saved-result recovery without another send.
The restored run passed all 3,864 unit tests and every browser shard, but the
production build caught a 280-byte cold-graph overrun. The optional context
browsing dialog now loads only after explicit Browse, while its ready trigger
and attachment workflows remain eager. Loading/failure stay local, cancellable,
and non-mutating; reload warns about unsent text. Its accessibility announcement
was deliberately broken and observed failing both source and browser locks.
The unchanged bundle budgets pass the extracted-dialog build, and the subsequent
complete verifier passed all five lanes and 445 browser tests. Screenshot review
then caught short-landscape recovery controls below the picker's visible edge.
Both browsing entry points now place recovery before the recent-items list;
source-order and full-notice/action geometry checks failed before this repair
and pass afterward. The final revision passed the complete verifier (all five lanes,
445 browser tests) and the separate 135/135-cell UI sweep with no violations or
skips. No retry or timeout budget was relaxed.
No GitHub CI, paid provider or signed/Intel release evidence is implied.

The preceding workbook checkpoint `ba00e035` passed the complete local verifier
(all five lanes and 440 browser tests), 135/135 responsive sweep cells and the
unsigned arm64 native gate. It implements the tabbed-workbook portion of approved
default 4. One artifact contains ordered named worksheets and shares access,
filing, Trash, and one revision-checked Save. Legacy single-sheet content remains
readable and promotes only when a tab-level edit needs the workbook shape.
Import explicitly chooses one visible sheet or all visible sheets, with complete
validation before adoption; XLSX export retains all saved tabs and names.
Limits remain explicit: 20 tabs, 32 columns and 200 rows per tab, 6,400 cells and
20,000 characters across the workbook. Formula execution and rich Office fidelity
remain separate required work. Current revision counters do not retain prior
bodies; browsable/restorable saved versions are not claimed in this checkpoint.
The responsive sweep completed 135/135 cells with no violations or skips.
Review caught stale import-scope labels on a new candidate and an XLSX escape
edge that changed literal tab names. Candidate-scoped choices and one-pass name
encoding/decoding now have regression locks. Structured previews load on demand
without raising the startup budget, with explicit loading/failure/reload states.
Focused browser acceptance covers owner editing/reading, shared reading, foreign
denial, all-visible import, held-save recovery and lazy-preview failure, including
all five viewport sizes. The complete unsigned arm64 packaged gate passes native
workbook import and exact tab persistence after full relaunch. Review corrected
test-only single-sheet selectors, an active-preview mismatch and the import
viewport helper without relaxing retries or timeouts. The complete local
verifier remains the mandatory final landing gate; no GitHub CI is used.
Final review also removed an unrelated blank-header failure from the aggregate
cell-limit fixture: the well-formed over-limit workbook now fails specifically
when that limit is enforced, and omitting the guard was watched fail the lock.
The full gate exposed a source-scan race with Playwright trace cleanup. Its
identity scanner now prunes generated directories before reading them, and an
observed failing regression fixture verifies that authored nested source remains
covered. Orphaned isolated test servers from the interrupted run were stopped;
the live development preview was preserved. A fresh complete gate is required.
That run passed static checks and three browser shards; the fourth exposed one
PPTX test's broad status locator when the new deferred preview announced loading.
The test now names its import-review status explicitly; the final full run must
cover this fix too.

The preceding checkpoint implements the native workflow for approved default 5.
Signed candidates now require a canonical owner-selected update base URL embedded
before signing, checked again in the extracted app, and recorded in schema-v3
candidate receipts. Finalization refuses a different destination; the paired
completion manifest remains schema-v2. No real host or credentials are invented.
The owner-approved public HTTPS URL is still needed before release builds.

Runtime checks are metadata-only, bounded, credential-free and exact-architecture.
They run after 30 seconds and every six hours. The native app menu exposes manual
checks and the current download/install action without granting renderer IPC.
Download and Install and Restart have distinct, default-Later consent. A private
ZIP is checked against the feed's exact size and SHA-256; only install consent
allows a safety backup, strict backend shutdown and a short-lived local feed
serving those verified bytes to Squirrel. Native signature validation stays with
Squirrel; no real signed update installation is claimed. Development packages
remain unconfigured and report that honestly from the menu.

Review reproduced manual/background-check interaction and relaunch-cleanup gaps.
Manual intent now joins in-flight checks, and quit/restore/recovery drain aborted
downloads before exit. Repeated disposal coalesces, later downloads remain inert,
and failed native staging restarts through the established safety-copy boundary.
Intentional consent, shutdown, metadata, size, signed-destination and cleanup
mutations fail their regression tests. All 181 desktop tests pass. The complete
unsigned arm64 packaged gate passes real native menu/activation and unconfigured
notice checks across relaunch, profile admission, OS-backed credentials, imports,
exports, schema isolation and exact backup/restore. Its first run caught a
test-only unsupported dynamic import in Electron's evaluation context; the
helper now reads the actual packaged plist independently and the complete rerun
passes. No product guard or timeout was relaxed. Visual OS-menu/dialog review
was pending at that checkpoint; the actual menu and unconfigured notice now have
[native evidence](acceptance/native-git-review-2026-10-06.md), while signed
download/install consent dialogs still need acceptance. Signed two-version installation/relaunch,
hosted channel publication and native Intel acceptance remain distinct release
gates. The final complete local verifier remains mandatory before landing.

The preceding checkpoint adds the release-feed prerequisite for approved default 5
while the permanent-deletion cascade decision awaits the owner. Finalization
generates deterministic, architecture-specific Squirrel.Mac update feeds from
the two already-verified signed ZIP candidates. A required operator-selected
HTTPS base URL supplies archive locations; no real hosting destination is
invented. Stable-version, URL and exact archive metadata validation happen
before publication. Feeds join the existing immutable publication transaction;
the schema-v2 paired manifest still lands last, and partial output rolls back.
Review found and reproduced mutable-source and partial-copy publication races.
Finalization now validates private candidate snapshots and publishes those exact
bytes. Individual outputs become visible only after complete private copies,
through an exclusive atomic link; a failed copy cannot expose a partial manifest.
Private candidate-snapshot cleanup failures are reported with the temporary path
and inspect-before-retry guidance; a completed release is preserved, and any
earlier validation/publication failure remains available in the aggregate error.
That checkpoint produced release artifacts, not runtime update behavior. The
current checkpoint above adds checks, consent and shutdown coordination;
configured hosting and real signed two-version update acceptance remain required.
Electron's native checker must not run unattended: it stages downloads that may
install on next launch, which would bypass the approved consent policy.
Failure-first locks reproduced omitted feeds, changed candidate bytes, partial
publication and silent snapshot cleanup, then passed after repair. All 136 desktop
unit tests and the complete unsigned arm64 packaged acceptance pass; direct ASAR inspection also confirms
the release generator/publisher do not ship. The complete local verifier passed
all five lanes and 432 browser tests. Final review aligned the older release
ledger with the new eight-file set. A subsequent full run hit an intermittent
MCP proposal timeout; the unchanged trace-enabled full gate and twelve focused
traced repetitions passed. That failure is not claimed repaired; see the open
verification follow-up below. The final revision remains subject to the same
full local gate. No signed update installation or hosted publication is claimed.

The preceding checkpoint integrates the recoverable half of approved default 3.
Trash is a permanent nested collection inside Artifacts, mirrored in the rail;
the canonical artifact page owns confirmed Move to Trash and Restore. HTTP and
MCP expose the same owner-only lifecycle contract. Account-scoped reviewed intent
remains reachable but inoperable across uncertain acknowledgement and navigation.
Retry keeps the exact revision and key, never rebases an old Trash over a later
restore; failed truth reads retain Dismiss recovery. Reload reads durable server
state rather than replaying a browser-stored intent. Retained artifacts are absent
from active content, project/model references, exports and nested social doors.
Nested-only discussion readers receive a private access hint without disclosure
of their inaccessible root artifact. Canonical contents, filing and current grants
survive JSON/SQLite restart; restore never recreates revoked access. Review also
caught and fixed Ada's seed-project filing mismatch and clipped long confirmation
names through their canonical ownership and shared wrapping rules. Browser locks
cover the owner/reader/foreign workflow, lost acknowledgement, a later restore
cycle, and five-viewport recovery/confirmation geometry and accessibility.
The separately confirmed permanent-delete path, including non-resurrecting
retirement receipts, remains the next required slice of default 3. There is no
automatic purge or permanent deletion in this checkpoint. Complete local
verification and the separate UI sweep remain landing gates; no GitHub CI is used.

The preceding checkpoint implements approved default 6: unsafe POSIX modes and
macOS ACL grants refuse startup without repair. Admission is synchronous before
the instance lock and ready-driven product startup. The bundled read-only helper
checks the already-open no-follow directory, distinguishes absent ACLs from failed
inspection, accepts owner-only/deny-only entries and refuses other allow entries,
including inherited and inherit-only grants. Errors offer manual repair guidance,
not database restore. Build hooks compile the exact target architecture and keep
native build/test inputs outside the shipped ASAR. Unit and real temporary-ACL
tests pass; deliberately bypassing ACL inspection, delaying admission with an
await, and selecting the wrong helper architecture each failed their locks.
Review corrected platform-specific repair guidance. Packaged admission acceptance
passes missing-leaf startup, mode/ACL refusal with exact profile preservation,
and successful relaunch after explicit repair of only its disposable fixtures.
An isolated ASAR mutant with ACL inspection bypassed reached backend readiness
instead of refusing and failed the native gate; the artifact was then restored.
The complete packaged suite also passes OS-backed storage, attachments, artifact
imports/exports, MCP and managed restore. Each landing remains gated by the full
local verifier, without GitHub CI. Actual native-dialog visual review
was attempted but the host was locked; it remains unverified, and only the owned
temporary test process was stopped. This is a profile-boundary check, not a descendant
audit or defense against a same-user/admin attacker; trusted parents remain
required. No user's profile has been used as a fixture or repaired.

The preceding checkpoint `fb0e10ea` integrates saved served-folder snapshots end to end:
explicit intake, independent identity even for empty folders, derived read-only
previews, model input, and owner-only Refresh. A folder owns one closed snapshot;
displayed artifacts never duplicate its saved bodies. Refresh pins the reviewed
copy and request receipt, rechecks current ownership, binding and runner grants
after capture, and preserves unrelated workspace changes. Stale ordinary writes
cannot rewind retained copies. Shared readers see saved text without source
reads or mutation controls. Legacy folders require an explicit Save snapshot;
failure retains the copy through the existing Retry / Use saved state workflow.
JSON and SQLite fresh-process locks cover source-absent reopen and replay plus
malformed snapshot refusal. Empty-folder, local-import, draft materialization,
cross-source identity and targeted reconciliation locks cover integration seams.
Adversarial review reproduced duplicate legacy folder identities across workspace
containers. The shared validator now rejects both legacy/legacy and mixed
legacy/explicit ambiguity at intake and JSON/SQLite startup, with observed failing
locks at all three boundaries; multiple files inside one folder remain valid.
The startup budget remains unchanged: conversation panes now seed only from
exact account-scoped API cache, never bundled demo transcripts. The old static
fallback was caught by a failure-first lock while diagnosing bundle growth.
The initial five-viewport sweep covered 135/135 cells with no mechanical
violations or skips. Visual review found eight truncated identity headings that
lacked full-value disclosure; one shared helper now supplies it without changing
layout or rename labels. Native review also corrected the smoke's old file-count
expectation to the new independent folder count while retaining exact file/model
assertions. Final adversarial review then reproduced a committed Refresh whose
lost response left Retry rejecting its own already-synced receipt. Persisted
retries now admit that exact request ID while drafts and unrelated newer copies
remain fenced; the failure-first browser lock proves identical request replay
and the unchanged saved snapshot, including its capture time. The final local
verifier passed all five lanes and 428 browser tests, the final UI sweep passed
135/135 cells, and packaged Electron smoke passed. No GitHub CI was used.

The preceding checkpoint added the internal served-folder capture foundation:
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

The saved-file and folder slices implement approved policy 2 for served text;
unsupported formats remain explicit omissions. They do not complete all six defaults:
remembered local/Git connections, workbook tabs, the complete Trash workflow,
and update consent remain required milestones. Profile refusal is implemented
as described above, with native-dialog visual review still outstanding.

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
refuse-and-preserve policy in default 6 above; its implementation supersedes this
historical mode-repair behavior at the current checkpoint. The earlier mode-only
pass is not ACL evidence or acceptance of the new policy.

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
| Useful first conversation | Provider onboarding and the Messages transport are built. Local text reaches both endpoint and Session transports as whole files (64 KiB per file, 128 KiB total, first 24 items), with shared-plan UI and one input snapshot reused through the tool loop. Browser/native intake shares source/configuration recognition and strict whole UTF-8 decoding. Bounded top-level folder snapshots (CTX-FS-11), direct-file PDF text extraction (CTX-FS-12), bounded DOCX text extraction (CTX-FS-14), bounded XLSX visible-value extraction (CTX-FS-15), bounded PPTX slide-text extraction (CTX-FS-16), and the bounded image path now extend the same input plan. DOCX is limited to 8 MiB/file, 24 MiB/selection, 512 entries, 4 MiB parts, 16 MiB expanded content, 128 XML depth, 128 attributes/tag, 100,000 nodes and 64 KiB body text; it excludes images/layout and legacy or macro-enabled Word files. Images accept PNG/JPEG/GIF/WebP up to 8 MiB raw, normalize the first frame to PNG at a 2,000 px maximum edge and ≤3 MiB, retain durable tenant-scoped asset references, and deliver at most 8 images/8 MiB per turn alongside the shared 24-item plan. Native folder/Git and served cloud/mapped-runner text, folder, document and image snapshots now provide explicit saved model input; CTX-FS-26 retains exact image originals privately. Bounded macOS local-image OCR (PORT-26) is implemented and accepted for the stated macOS path. Discussion-as-Context (CTX-DISC-1) adds confirmed saved copies under its bounded checkpoint; PORT-28 separately adds explicit macOS scanned-PDF-to-Document review; non-macOS and automatic PDF-attachment OCR, broader PDF recognition accuracy/language acceptance, unsupported document formats, rich Office fidelity, live/recursive source browsing, richer Git tooling and paid-provider acceptance remain future work. Targeted text/PDF/DOCX/image tests and XLSX acceptance, packaged executable smoke and the 135/135-cell responsive sweep cover this bounded path. Shared interactive preview handoff is restored as recorded above. Provider proof is deterministic protocol evidence, not paid-model acceptance. |
| Useful external work | Tenant-owned HTTPS MCP lifecycle, inspection receipts, Contexts setup and OS-encrypted desktop credentials now compose with isolated schema admission, exact attachment and per-call owner approval on both model transports. The running receipt precedes one outbound attempt; bounded inert results, known failures and restart-safe uncertainty retain honest history without automatic replay. Deterministic browser protocol fixtures and JSON/SQLite tests prove the portable workflow; packaged OS-storage and schema-worker checks are separate from combined real-service/native acceptance. Legacy development connectors remain mocked and other release adapters remain unconfigured. Person-owned OAuth and private interactive form rounds now have local browser/unsigned-arm64 acceptance. PORT-33 completes person-owned local stdio setup, encrypted native launch custody, negotiated inspection and separately approved interactive calls with five-viewport and unsigned arm64 authored-child acceptance, including owner-bound restart and Disconnect/removal without replay. The [2026-10-12 native review](acceptance/native-mcp-stdio-2026-10-12.md) additionally proves actual Cancel/Allow and the complete authored-peer workflow; third-party-server acceptance remains open. COMMONS-42 now adds person-owned local Contribution execution with separate Project approval and explicit Run, durable receipts and owner-reviewed linked-work resolution. COMMONS-43 adds budgeted tool-free argument drafting with explicit review/copy; a draft confers no execution authority. [MODEL-45](spec/06-model-and-tools.md) adds person-approved local Routine stdio execution through the native runtime; store and JSON/SQLite persistence locks plus the injected in-memory-peer browser scenario (2/2) cover person boundaries, separate consent and success/failure receipts. Unsigned-arm64 authored-child Routine acceptance now covers native custody, exact-run Stop/child exit, restart history and explicit managed restore; see the current Routine checkpoint above. Public-service/signed/Intel acceptance, broader input modes and standing-trust policy remain separate work. Native saved Git snapshots are real; legacy development repository panels remain fixtures. |
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

The saved-version-search checkpoint reproduced native profile admission timeout
under the Node runner's default 16-worker load, with or without browser lanes.
Test-only diagnostics captured `ETIMEDOUT`, `SIGTERM` and no helper output at
the unchanged five-second boundary. All 15 profile checks passed in isolation.
Moving its compiled executable out of the shared development path removed an
independent fixture-isolation problem but did not cure the loaded timeout.
The identical complete Node suite at four workers passed all 4,595 tests, with
the formerly failing admission taking 871ms. Local npm tests now declare four
workers and the complete verifier derives the same setting from that one script;
strict parser/wiring tests preserve full suite coverage. Real ACL inspection,
production deadlines, assertions and zero automatic retries are unchanged.
This supports bounding verifier contention, not a claim about the precise OS
delay or every native startup environment. Keep helper outcome diagnostics for
recurrence. Failed verifier browser lanes were deliberately interrupted; only
a subsequent complete frozen-tree run counts as checkpoint acceptance.

The release-feed checkpoint observed one first-attempt timeout in
`e2e/mcp-tool-execution.spec.ts` (long external labels): after Enter, neither
the user message nor the proposed tool call appeared. The reconnecting banner
is expected because this fixture intentionally aborts live events. The unchanged
trace-enabled complete verifier passed all 432 tests, as did twelve focused
repetitions with always-on tracing; a successful trace confirms the message POST
returned 200. There is no failure trace establishing whether the original send
was issued or later state was replaced. Keep this unresolved; capture the next
failure's request and transcript sequence before changing product logic, test
readiness, timeouts or retries. No speculative MCP fix is included here.

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
