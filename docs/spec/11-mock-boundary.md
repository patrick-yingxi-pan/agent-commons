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
OCR, active/external-resource SVG, RLE/embedded BMP variants,
unsupported documents, live folder/Git browsing and rich document fidelity,
paid-provider acceptance, and broader manual OS-dialog acceptance remain outside this
milestone. A public native release additionally still requires the signed,
notarized two-architecture release gate.

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
account-scoped memory and never sent to a model. Existing demo repository panels
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
development fixture; empty-body delegated judgment and envelope effect execution
also remain fixtures. Desktop/web profiles refuse those canned operations with
`409 capability_unavailable`, including replay attempts against old fixture
receipts, before verdict, effect consumption or event. An explicit owner-selected
review can use one exact-revision Agent/provider binding and a configured
Messages endpoint; it is tool-free, budgeted to the Project owner, and never
auto-lands. Explicit owner-started judgment uses a version-pinned Delegation and
the same tool-free endpoint boundary, with private policy explanations and
authority rechecks before read-only approval or non-effectful landing.
Local loopback fixtures prove the Messages wire, validation, and
recovery behavior only—not acceptance against a paid provider. Historical mock
reviews remain readable but cannot satisfy fresh release Tier-1 landing. The
owner can still land manually or approve a proposed envelope; approval alone
does not execute it. Configuring a conversation model or connector does not
authorize a delegated request or configure the separate effect seam. Locks:
`server/routes/contribution-model-review.test.ts`,
`server/model/contribution-review.test.ts`,
`server/persistence/contribution-model-review.test.ts`,
`server/store/contribution-runtime.test.ts`,
`server/routes/contribution-runtime.test.ts`, and `server/mcp.test.ts`.

| ID | What is mocked (and the real boundary it stubs) | Anchor | Status |
|----|--------------------------------------------------|--------|--------|
| MOCK-7 | **Contribution governance boundary.** Legacy review-without-reviewer, empty-body delegated judgment, and envelope execution retain canned development outcomes and are refused in release profiles before fixture replay. Explicit owner-selected reviews and owner-started delegated judgments cross the real tool-free Messages boundary with durable pending/terminal receipts, exact versions, bounded output and usage accounting. Restart retains uncertainty without replay. Draft judgment is advice; Decide may only approve a read-only envelope or land non-effectful work after a fresh authority/risk check. Local loopback fixtures prove this seam, not paid-provider acceptance. External envelope execution remains unbuilt; manual approval/landing, configuration and the ledger are real. | `server/contributionRuntime.ts`, `server/contributionReviewState.ts`, `server/delegatedJudgmentState.ts`, `server/generate.ts`, `server/store/index.ts`, `server/routes/index.ts` | 🟡 |
| MOCK-1 | **The development model** — the one intended behavioral mock. Generation runs through a real Messages + tool-use boundary; development fulfilment is a local deterministic endpoint. Release profiles never enable it implicitly: the selected endpoint is visibly unconfigured and fail-before-write until a real connection exists (MODEL-28). Going live remains config only (MODEL-5); Electron's OS-encrypted provider-key creation/rotation lifecycle, acknowledgement recovery, and atomic connection probe/swap are real and never silently select this fixture. | `server/model/index.ts`, `server/model/endpointExecution.ts`, `server/generate.ts`, `server/runtimeProfile.ts`, `server/routes/providerConnection.ts`, `src/controller/providerCreationCredentialCore.ts`, `desktop/credentialVault.mjs` | 🟡 |
| MOCK-2 | **Seeded/imported artifact bodies** — hand-authored demo doc/email/image/slide/sheet bodies remain fixtures, but `/artifact-content` projects only actual readable seed identities and unambiguous compatibility names under REL-22. It never dumps the global fixture library; clean installs and unrelated tenants receive no fictional body content. CTX-FS-12, CTX-FS-14, CTX-FS-15 and CTX-FS-16 extract actual bounded text/value projections from directly selected PDFs, DOCX, XLSX and PPTX archives; PDF/DOCX/XLSX/PPTX layout, formulas/calculation, images/OCR, notes/media and other rich document extraction remain unbuilt. The fixture does **not** back newly authored documents (including REL-13 standing routine reports), CTX-FS-11 local folder snapshots or PDF/DOCX/XLSX/PPTX attachments: those persist actual bounded bodies under opaque identities. Local previews never substitute the demo library for missing content. Served folder artifacts fetch real content via CTX-FS-5. | `server/data/artifactContent.ts`, `contract/content.ts`, `server/store/index.ts`, `src/components/panels/ArtifactPanel.tsx`, `src/lib/docxExtraction.ts`, `src/lib/xlsxExtraction.ts`, `src/lib/pptxExtraction.ts` | 🟡 |
| MOCK-3 | **External MCP has a real, bounded interactive execution path; other connector fulfilment remains mocked or unavailable.** Tenant-owned HTTPS connections undergo real catalog discovery and isolated schema admission before exact attachment. Both model transports produce owner-approved proposals; confirmation persists a running receipt before one outbound attempt, then saves a bounded inert result, known failure or uncertainty without automatic replay. Electron provisions OS-encrypted tokens through a write-only bridge. Remote metadata is not consent, safety or live health. Deterministic loopback browser and JSON/SQLite recovery fixtures prove this path, not third-party acceptance. Legacy development connectors remain visibly `(mock)` in demo catalogs; clean release catalogs offer no such candidates, and other release adapters remain `unconfigured`; routines reject failed provenance. Combined real-service/native acceptance, OAuth, stdio, standing trust and MRTR remain unfinished. | `server/mcpDiscovery.ts`, `server/mcpCatalog.ts`, `server/mcpHttpTransport.ts`, `server/mcpConnectionService.ts`, `server/routes/mcpConnections.ts`, `server/connectorRuntime.ts`, `server/model/connectorTools.ts`, `server/data/connectorDetails.ts`, `server/runtimeProfile.ts`, `server/routineRunner.ts`, `server/contextCatalog.ts`, `src/components/McpCatalogBody.tsx` | 🟡 |
| MOCK-4 | **Live-repository content + Git operations** — demo/live repo files, diff and terminal behavior remain fixtures available as attachable demo candidates only in the persisted demo world; clean release catalogs do not advertise them. The native `localGit` bridge is real only for explicit saved tracked-working-tree text captures (CTX-FS-25); it grants no live repo browsing, diff or terminal authority. The remote `/git/repos/:id/diff` route remains stubbed and returns `409` (PORT-4). | `server/data/contextOptions.ts`, `server/contextCatalog.ts`, `server/runner-runtime.ts`, `desktop/localGitReader.mjs`, `contract/localGitCapture.ts` | 🟡 |
| MOCK-5 | **Seed entities** — sessions, projects, artifacts, schedules, runs, dispatch are seeded fixtures (deterministic by design) in the development/review world; release profiles install a clean first-run database and never expose these as user history. A real backend's database + the live model would produce actual rows. | `server/data/sessions.ts`, `server/data/cowork.ts`, `server/initialWorld.ts`, `server/store/index.ts` | 🟡 |
| MOCK-6 | **Usage policy and estimates** — per-tenant reported token counts and rolling-window anchors are durable across restarts (MODEL-7), not reseeded each boot. Only a new/legacy demo baseline includes fixture spend; clean installs start at zero. Plan ceilings and the unused Sonnet-only gauge remain fixtures. Context is explicitly a partial estimate (≈4 chars/token) of conversation text, enabled base-tool schemas and base prompt; attachments, per-turn tools/framing and provider-managed context are excluded. No fictional Skills, memory, Agents or MCP inventory is added. Development-provider token counts are estimates too. Local counters are not provider quota or a billing ledger, do not reserve concurrent/unreported in-flight spend, and follow an explicitly restored backup's state. | `contract/usage.ts`, `src/components/UsageControl.tsx`, `server/usage.ts`, `server/usageRegistry.ts`, `server/persistence/usage-durability.test.ts` | 🟡 |
