# 11 · The mock boundary

> **Intent.** The project builds real boundaries with explicitly declared fixtures.
> Some **content** surfaces and contribution execution seams are still fixtures —
> which is acceptable for development and
> deliberate (deterministic, reviewable data), but only if it's *declared*. This
> pillar enumerates the **complete** set of things faked beyond the model, each
> naming the real boundary it stubs, so "is X real or mock?" always has an answer.
> The contrast is load-bearing: filesystem files/photos/folders and native local
> Git saved snapshots are real captured boundaries (pillar 02, CTX-FS-*). Any
> *new* fixture that isn't listed here is a regression to flag, not a silent shortcut.
>
> (Surfaced by the top-down audit: `/artifact-content`, `/connectors/detail`, and MCP
> were faked without being declared here before.)

The bounded image path is implemented and is not a fixture: the browser/Electron
boundary structurally validates PNG/JPEG/GIF/WebP bytes (8 MiB raw), normalizes
the first frame to PNG (2,000 px maximum edge, ≤3 MiB), and persists immutable
tenant-scoped asset references through SQL and portable backups. Model turns are
bounded to 8 images/8 MiB; endpoint and negotiated relay/MCP image blocks are
real boundary work. Owner context walls and shared-view image reads are real.
Raw local admission also validates bounded RGB BMP CORE/INFO/V2/V3/V4/V5
variants and ICO PNG/DIB entries; normalized previews remain PNG.
Self-contained static SVG follows the same PNG
normalization path through bounded worker-only XML admission and detached image
decode. Scripts, animation, external resources, malformed geometry and recursive
use are rejected; only static PNG/JPEG raster embeds within a combined 32-megapixel
budget are admitted. CTX-FS-26 retains exact originals privately alongside the
normalized asset, including BMP, ICO and SVG. Originals are inert owner-only
downloads, never inline application markup, shared previews or automatic model
image input; storage limits, backups and cleanup include both copies. Structural
validation is not complete codec decoding. Protocol and persistence
locks, packaged executable smoke, and the complete responsive sweep exercise
this boundary. The [October 6 native image acceptance](../acceptance/native-images-2026-10-06.md)
separately verifies actual local Files/Photos SVG selection, exact original
downloads and normalized saved input after source-absent relaunch on its recorded
unsigned arm64 artifact. It does not cover Photos-library access or every format.
Non-macOS OCR, active/external-resource SVG, RLE/embedded BMP variants,
unsupported documents, live folder/Git browsing and rich document fidelity,
paid-provider acceptance, and broader manual OS-dialog acceptance remain outside this
milestone. A public native release additionally still requires the signed,
notarized two-architecture release gate.

PORT-26 adds explicit local-image text extraction in the macOS Document creation
form using OS Vision. The path-free native bridge receives normalized PNG bytes;
extraction does not upload or save an image or call a provider. Users review and
explicitly adopt the recognized text into an editable draft, then Create saves
an ordinary Document. PORT-28 separately implements explicit scanned-PDF text
recognition in that same macOS Document review flow through a byte-only broker and
authenticated App Sandbox XPC service. It processes every page within its declared
input/page/pixel/text/deadline limits; recognition itself does not upload or save
the PDF, and only reviewed, explicitly adopted text reaches ordinary Create. Its
unsigned arm64 native/package acceptance passed. Neither path implies browser or other
platform OCR, universal language support, rich-layout recognition or corpus-wide
accuracy. Ordinary PDF attachment/import behavior remains the existing bounded
text projection and does not invoke OCR.
The full 517-test E2E suite, 135/135-cell responsive sweep, production build and
packaged OCR acceptance passed for the existing PORT-26 image workflow, including
recognition of generated PNG pixels and corrected Document content after a
source-absent relaunch. This does not claim universal language or corpus accuracy.

Discussion-as-Context (CTX-DISC-1) is a real, read-checked saved-reference
boundary, not a model or seeded-content fixture. The saved snapshot follows the
destination conversation's sharing, survives later source revocation, and is
not fetched live when rendered; draft references capture only on first send.
Its browser matrix and ordinary unsigned arm64 packaged workflow are accepted:
confirmed Attach, exact local-model input, explicit Refresh, destination-only
sharing, source deletion, signed-in SQLite relaunch and detach. The model peer
is a deterministic loopback fixture; paid-provider and signed/Intel release
acceptance remain separate gates.

Served cloud and mapped-runner text files and top-level folders now use actual
bounded saved copies, not fixture bodies or automatic per-turn source reads.
Explicit Refresh alone replaces a saved copy through current source authority;
folders retain independent identity even when empty. CTX-FS-22 connects PORT-20's
native local-folder reader and encrypted opt-in grant store to explicit
Connect/Attach/Refresh/Disconnect controls. A local capture is portable saved
content, not authority to read the original folder on another device or through
MCP. CTX-FS-23 extends explicit saved input to PDF/DOCX/XLSX/PPTX from the
existing cloud and mapped-runner sources using the same renderer-isolated local
importers. These are saved text projections, not original documents or rich
Office fidelity. Raw bytes stay transient; extraction metadata persists with the
complete saved text, and Refresh retries the same captured projection. CTX-FS-24
extends the existing bounded PNG normalization and tenant-asset path to explicit
Files/Photos capture from these sources. Saved previews and model input never
reread the original image; legacy attachments require explicit Save snapshot.
CTX-FS-26 also retains served-image originals privately; legacy normalized-only
imports remain valid. Native local Git Attach/Refresh now
captures bounded tracked working-tree text into a portable saved snapshot
(CTX-FS-25). Explicit read-only Git review on that connection's page now shows
real bounded HEAD/index/working-tree comparisons (PORT-25), kept only in local
account-scoped memory and never sent to a model. PORT-27 adds exact changed-line
views and PORT-29 optional possible-rename hints over those captured bytes, not
recorded Git operations or new read/write authority. Existing demo repository panels
and terminal surfaces remain fixtures. Recursive folder selection, rich remote document fidelity and signed
two-architecture acceptance remain production work.

Authored sheet and slide saves (REL-16) now persist actual bounded literal values
under exact artifact identities. The model proposes those values for consent;
one shared renderer shows them before and after saving. They never borrow seed
bodies. Saved literal sheets and slides export through the authenticated boundary
as real XLSX and PPTX packages, and packaged-executable smoke verifies their exact
downloaded bytes. Standing routine approval and the guarded model loop likewise
deliver bounded Document, Sheet, or Slides bodies under a frozen explicit format
and name (REL-13 / MODEL-29). None of this implies spreadsheet calculation,
formula execution, arbitrary slide layout or media authoring, imported Office
fidelity, paid-provider acceptance, or a signed/notarized two-architecture release;
those remain required work. ADAPT-35 imports actual text/PDF/DOCX text into a
reviewed Document draft; ADAPT-36 additionally maps actual visible PPTX slide
boundaries into editable title/bullet outlines. Neither borrows seeded content,
preserves rich Office fidelity, nor saves before explicit adoption and Create.
ADAPT-37 maps actual CSV/TSV records into editable literal Sheets with an explicit
first-row header choice; it does not infer spreadsheet types, calculate formulas
or determine XLSX workbook identity. ADAPT-38 adds explicit visible-worksheet
selection from actual bounded XLSX cells, importing only saved literal values
after review. Missing formula caches refuse adoption; rich formatting, merges,
media and calculation remain unbuilt. Saved bodies and XLSX exports use the same
canonical authored-artifact boundary, never fixture content. ADAPT-39 adds real
ordered workbook tabs under one artifact identity and access boundary, with
whole-workbook edits, all-visible-sheet adoption and multi-tab XLSX export.
REL-25 adds owner-only retained body history and explicit restoration as a new
revision. The current body becomes the baseline on its first history-aware
replacement; earlier unrecorded edits cannot be reconstructed. Shared readers
and ordinary model input still receive only current content. This does not
execute formulas or retain rich Office fidelity. REL-24 separately adds reviewed
permanent deletion from Trash: current content, retained versions, shares and
artifact-only social material are removed together. Conversations and content-free
audit/retirement records remain. Old save/create retries and routine output cannot
resurrect the artifact. Existing backups are not erased; an explicit later whole
backup restore may intentionally restore older content.

Saved authored Documents and draft emails also export through the authenticated
boundary as bounded DOCX projections of the current saved text snapshot. The
2 MiB decoded-payload ceiling before Blob creation, exact identity/revision, granted-reader visibility and
post-serialization revocation checks are real; omitted format remains Markdown.
The Word package is a portable text projection, not imported rich Office fidelity.
Browser and unsigned arm64 packaged acceptance passed, including actual downloaded
bytes and editable package contents. The original generated DOCX also rendered
successfully through bundled LibreOffice. This does not claim rich imported
fidelity, Microsoft Word application testing, signing/notarization or Intel acceptance.

## The declared fixtures (L2)

`GET /context-catalog` projects fixture candidates only from the persisted demo
world; a clean world returns empty candidates. Both UI entry points share this
read and disclose loading, failure and demo data without a bundled fallback.
Actual saved MCP connections and native Folder access remain separate. Locks:
`server/contextCatalog.test.ts`, `server/persistence/initial-world.test.ts`,
`src/components/context-catalog.test.ts`, `e2e/context-catalog.spec.ts`.

Contribution governance has three distinct execution seams (MOCK-7). Legacy
adversarial review without an explicit reviewer remains a deterministic
development fixture; empty-body delegated judgment and the legacy simulated
envelope-effect Run also remain fixtures. A separate exact-bound MCP mutation
path is implemented under MOCK-8 and requires explicit per-call confirmation;
MCP configuration alone is not execution consent. Desktop/web profiles refuse those canned operations with
`409 capability_unavailable`, including replay attempts against old fixture
receipts, before verdict, effect consumption or event. An explicit owner-selected
review can use one exact-revision Agent/provider binding and a configured
Messages endpoint; it is tool-free, budgeted to the Project owner, and never
auto-lands. Explicit owner-started judgment uses a version-pinned Delegation and
the same tool-free endpoint boundary, with private policy explanations and
authority rechecks before read-only approval or non-effectful landing.
Local loopback fixtures prove the Messages wire, validation, and
recovery behavior only—not acceptance against a paid provider. Contribution MCP
loopback HTTP/browser and JSON/SQLite fixtures do not prove public services.
MOCK-8 now also records native acceptance using an isolated startup-scope-modified
app copy; the original public-only package remains unchanged. Historical mock
reviews remain readable but cannot satisfy fresh release Tier-1 landing. The
owner can still land manually or approve a proposed envelope; approval alone
does not execute it. Configuring a conversation model does not authorize a
delegated request. Locks:
`server/routes/contribution-model-review.test.ts`,
`server/model/contribution-review.test.ts`,
`server/persistence/contribution-model-review.test.ts`,
`server/store/contribution-runtime.test.ts`,
`server/routes/contribution-runtime.test.ts`, and `server/mcp.test.ts`.

Local MCP remains unconfigured for users. PORT-30's native supervisor now has
PORT-31's internal stream protocol client (`server/mcpStdioClient.ts`), exercised
with repository-authored modern and legacy child programs, not a native setup
flow or a real third-party server. PORT-32 adds internal person-bound encrypted
grant custody and injected native approval/launch composition, tested with
temporary files and reversible storage stand-ins. Actual setup controls/dialogs,
trusted product source binding, dispatch, reconciliation and packaged acceptance
are still required. No local-server launch is user-accessible yet.

| ID | What is mocked (and the real boundary it stubs) | Anchor | Status |
|----|--------------------------------------------------|--------|--------|
| MOCK-9 | **Legacy collaboration automation is fixture-only.** Dispatch timer completion, commissioned Project effects and Agent proxies cannot execute in any release profile, even with a real model or MCP connection. Refusal precedes cached fixture replay, guardian use, audit and credit. Posting native/A2A work and configuring standing Commissions leave new work open/submitted. Legacy Dispatch rows are labeled Simulation. Real explicitly bound Dispatch uses the separate conversation execution capability (ADAPT-8); no standing configuration inherits its authority. Unattended Routine MCP uses the separate explicit bounded permission in MODEL-40, verified through local protocol/browser and unsigned native fixtures; public-service acceptance remains separate. | `server/automationRuntime.ts`, `server/store/index.ts`, `server/routes/index.ts`, `contract/api.ts`, `src/lib/automationPresentation.ts`, `src/lib/dispatchPresentation.ts`, `src/components/SectionView.tsx` | 🟡 `server/store/automation-runtime.test.ts`, `server/routes/automation-runtime.test.ts`, `server/routes/real-dispatch.test.ts`, `src/lib/automation-presentation.test.ts`, `src/lib/dispatch-presentation.test.ts`, `e2e/automation-runtime.spec.ts`, `desktop/contributionMcpSmoke.test.ts`; original packaged executable refusal gate |
| MOCK-8 | **Contribution exact-bound MCP execution has local browser and feature-specific native fixture acceptance; public-service and signed two-architecture acceptance remain pending.** A first-party user separately confirms each call against one approved `mcp.mutate` line, exact selected tool/schema/arguments and their own existing connection. The server durably commits a private pending attempt plus cardinality reservation before dispatch; the Project-visible receipt contains reviewed arguments and bounded inert results, never credentials or connection authority. At most 100 append-only attempts are retained. Only a known pre-submit failure releases capacity; pending blocks amendment/landing, restart becomes durable uncertainty, and exact retry is receipt-only. Invalid/oversized results become uncertainty, never truncation or automatic redispatch. Local loopback HTTP/browser and JSON/SQLite fixtures validate deterministic behavior, not public-service acceptance. The native gate first proves the original package refuses loopback, then uses only a disposable startup-scope-modified app copy to verify real OS credentials, separate rendered consent, reader isolation, durable interruption/relaunch without replay and exact managed backups. The original ASAR remains unchanged. This is not public-service/TLS, signed/notarized or Intel evidence. | `contract/contributionExecution.ts`, `contract/mcpExecution.ts`, `server/mcpBoundCall.ts`, `server/mcpBoundExecution.ts`, `server/contributionEffectState.ts`, `server/store/index.ts`, `server/routes/index.ts`, `server/persistence/format.ts`, `src/api/contributionMcpEffectCommands.ts`, `src/controller/contributionMcpEffectMutations.ts`, `desktop/contributionMcpSmoke.mjs` | 🟡 `server/contribution-effect-state.test.ts`, `server/store/contribution-mcp-commit.test.ts`, `server/routes/contribution-mcp-execution.test.ts`, `server/persistence/contribution-effect-attempt.test.ts`, `server/persistence/contribution-effect-recovery.test.ts`, `e2e/contribution-mcp-execution.spec.ts`, `desktop/contributionMcpSmoke.test.ts`, `desktop/contributionMcpSmokeFixture.test.ts`, `desktop/mcpLoopbackSmokePackage.test.ts`; isolated packaged Contribution MCP smoke |
| MOCK-7 | **Contribution governance boundary.** Legacy review-without-reviewer and empty-body delegated judgment retain canned development outcomes and are refused in release profiles before fixture replay. Explicit owner-selected reviews and owner-started delegated judgments cross the real tool-free Messages boundary with durable pending/terminal receipts, exact versions, bounded output and usage accounting; restart retains uncertainty without replay. Draft judgment is advice; Decide may only approve a read-only envelope or land non-effectful work after a fresh authority/risk check. The legacy simulated envelope-effect path is also fixture-only and release-refused; separately, COMMONS-29 defines the real exact-bound, per-call-confirmed MCP mutation path. Local loopback fixtures do not prove paid-provider or public MCP acceptance. | `server/contributionRuntime.ts`, `server/contributionReviewState.ts`, `server/delegatedJudgmentState.ts`, `server/contributionEffectState.ts`, `server/generate.ts`, `server/store/index.ts`, `server/routes/index.ts` | 🟡 |
| MOCK-1 | **The development model** — the one intended behavioral mock. Generation runs through a real Messages + tool-use boundary; development fulfilment is a local deterministic endpoint. Release profiles never enable it implicitly: the selected endpoint is visibly unconfigured and fail-before-write until a real connection exists (MODEL-28). Going live remains config only (MODEL-5); Electron's OS-encrypted provider-key creation/rotation lifecycle, acknowledgement recovery, and atomic connection probe/swap are real and never silently select this fixture. | `server/model/index.ts`, `server/model/endpointExecution.ts`, `server/generate.ts`, `server/runtimeProfile.ts`, `server/routes/providerConnection.ts`, `src/controller/providerCreationCredentialCore.ts`, `desktop/credentialVault.mjs` | 🟡 |
| MOCK-2 | **Seeded/imported artifact bodies** — hand-authored demo doc/email/image/slide/sheet bodies remain fixtures, but `/artifact-content` projects only actual readable seed identities and unambiguous compatibility names under REL-22. It never dumps the global fixture library; clean installs and unrelated tenants receive no fictional body content. CTX-FS-12, CTX-FS-14, CTX-FS-15 and CTX-FS-16 extract actual bounded text/value projections from directly selected PDFs, DOCX, XLSX and PPTX archives; PDF/DOCX/XLSX/PPTX layout, formulas/calculation, embedded-image extraction, notes/media and other rich document extraction remain unbuilt. Ordinary PDF import/attachment remains text-only and does not OCR. PORT-26 implements bounded on-device macOS OCR for explicitly selected images; its UI/packaged acceptance passed for that stated path. PORT-28 implements a separate macOS-only scanned-PDF OCR review action in Document creation; unsigned arm64 native/package acceptance passed; signed/Intel and broader corpus acceptance remain separate. Neither OCR path is a seeded body or provider fixture, and only explicitly adopted text is saved through ordinary Document creation. The fixture does **not** back newly authored documents (including REL-13 standing routine reports), CTX-FS-11 local folder snapshots or PDF/DOCX/XLSX/PPTX attachments: those persist actual bounded bodies under opaque identities. Local previews never substitute the demo library for missing content. Served folder artifacts fetch real content via CTX-FS-5. | `server/data/artifactContent.ts`, `contract/content.ts`, `server/store/index.ts`, `src/components/panels/ArtifactPanel.tsx`, `src/lib/docxExtraction.ts`, `src/lib/xlsxExtraction.ts`, `src/lib/pptxExtraction.ts` | 🟡 |
| MOCK-3 | **External MCP has a real, bounded interactive execution path; other connector fulfilment remains mocked or unavailable.** Tenant-owned HTTPS connections undergo real catalog discovery and isolated schema admission before exact attachment. Both model transports produce owner-approved proposals; confirmation persists a running receipt before one outbound attempt, then saves a bounded inert result, known failure or uncertainty without automatic replay. Electron provisions OS-encrypted tokens through a write-only bridge. Remote metadata is not consent, safety or live health. Deterministic loopback browser and JSON/SQLite recovery fixtures prove this path, not third-party acceptance. Legacy development connectors remain visibly `(mock)` in demo catalogs; clean release catalogs offer no such candidates, and other release adapters remain `unconfigured`; routines reject failed provenance. MODEL-43 adds person-owned native OAuth and an excluded local Messages peer (`desktop/mcpOAuthMessagesSmokeFixture.mjs`), with copied networking/browser handoff only, to prove explicit interactive consent, exact call/result and private SQLite owner retention across signed-in relaunch without receipt redispatch. COMMONS-29 extends this to separately confirmed person-bound Contribution calls and durable private receipts. The Routine OAuth layer now binds a separately reviewed bounded grant and queued calls to the authenticated person, with strict private history joins and peer-redacted projections; local protocol/persistence, five-viewport browser and unsigned arm64 packaged acceptance prove private ownership, exact result/output, relaunch, revoke and disconnect without redispatch. Its separate bounded model peer (`desktop/mcpOAuthRoutineMessagesSmokeFixture.mjs`) remains an excluded fixture, and removing the executor's person argument in a disposable ASAR copy fails the Routine execution gate. Private interactive form rounds now have JSON/SQLite, five-viewport and unsigned arm64 packaged acceptance with explicit Continue/local Stop and no replay; other input modes remain unsupported. PORT-30 adds internal native stdio supervision tested only with repository-authored child programs, not a configured end-user connection. Public issuer/system-browser, combined real-service/native acceptance, stdio product integration and standing trust remain unfinished. | `server/mcpDiscovery.ts`, `server/mcpCatalog.ts`, `server/mcpHttpTransport.ts`, `server/mcpConnectionService.ts`, `server/routes/mcpConnections.ts`, `server/connectorRuntime.ts`, `server/model/connectorTools.ts`, `server/data/connectorDetails.ts`, `server/runtimeProfile.ts`, `server/routineRunner.ts`, `server/routineMcpAuthority.ts`, `server/contextCatalog.ts`, `src/components/McpCatalogBody.tsx`, `src/components/RoutineMcpApprovalPanel.tsx` | 🟡 `server/routes/routine-mcp-oauth.test.ts`, `server/persistence/routine-mcp-oauth.test.ts`, `e2e/routine-mcp-oauth.spec.ts`, `desktop/mcpOAuthRoutineMessagesSmokeFixture.test.ts`; packaged `desktop/mcpOAuthSmoke.mjs`; full local verifier is the mandatory pre-push gate |
| MOCK-4 | **Live-repository content + Git operations** — demo/live repo files, diff and terminal behavior remain fixtures available as attachable demo candidates only in the persisted demo world; clean release catalogs do not advertise them. The native `localGit` bridge provides real explicit saved tracked-working-tree text captures (CTX-FS-25) and transient bounded staged/unstaged full-text review (PORT-25). It grants no live repo browsing, terminal or write authority. The remote `/git/repos/:id/diff` route remains stubbed and returns `409` (PORT-4). | `server/data/contextOptions.ts`, `server/contextCatalog.ts`, `server/runner-runtime.ts`, `desktop/localGitReader.mjs`, `desktop/localGitReview.mjs`, `contract/localGitCapture.ts` | 🟡 |
| MOCK-5 | **Seed entities** — sessions, projects, artifacts, schedules, runs, dispatch are seeded fixtures (deterministic by design) in the development/review world; release profiles install a clean first-run database and never expose these as user history. A real backend's database + the live model would produce actual rows. | `server/data/sessions.ts`, `server/data/cowork.ts`, `server/initialWorld.ts`, `server/store/index.ts` | 🟡 |
| MOCK-6 | **Usage policy and estimates** — per-tenant reported token counts and rolling-window anchors are durable across restarts (MODEL-7), not reseeded each boot. Only a new/legacy demo baseline includes fixture spend; clean installs start at zero. Plan ceilings and the unused Sonnet-only gauge remain fixtures. Context is explicitly a partial estimate (≈4 chars/token) of conversation text, enabled base-tool schemas and base prompt; attachments, per-turn tools/framing and provider-managed context are excluded. No fictional Skills, memory, Agents or MCP inventory is added. Development-provider token counts are estimates too. Local counters are not provider quota or a billing ledger, do not reserve concurrent/unreported in-flight spend, and follow an explicitly restored backup's state. | `contract/usage.ts`, `src/components/UsageControl.tsx`, `server/usage.ts`, `server/usageRegistry.ts`, `server/persistence/usage-durability.test.ts` | 🟡 |
