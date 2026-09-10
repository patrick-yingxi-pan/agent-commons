# 11 · The mock boundary

> **Intent.** The project's claim is "real boundaries, only the model mocked." In
> practice a few **content** surfaces are also fixtures — which is fine and
> deliberate (deterministic, reviewable data), but only if it's *declared*. This
> pillar enumerates the **complete** set of things faked beyond the model, each
> naming the real boundary it stubs, so "is X real or mock?" always has an answer.
> The contrast is load-bearing: the filesystem context types (files/photos/folders)
> were moved off this list — they're now really served (pillar 02, CTX-FS-*). Any
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
Structural validation is not complete codec decoding. Protocol and persistence
locks, packaged executable smoke, and the complete responsive sweep exercise
this boundary. Automated repository and packaged-executable verification cover
the implemented path; they do not by themselves claim a completed manual macOS
picker handoff. OCR, SVG/BMP/ICO, other documents, live folder/Git, remote input,
paid-provider acceptance, and manual OS-dialog acceptance remain outside this
milestone. A public native release additionally still requires the signed,
notarized two-architecture release gate.

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
those remain required work.

## The declared fixtures (L2)

| ID | What is mocked (and the real boundary it stubs) | Anchor | Status |
|----|--------------------------------------------------|--------|--------|
| MOCK-1 | **The development model** — the one intended behavioral mock. Generation runs through a real Messages + tool-use boundary; development fulfilment is a local deterministic endpoint. Release profiles never enable it implicitly: the selected endpoint is visibly unconfigured and fail-before-write until a real connection exists (MODEL-28). Going live remains config only (MODEL-5); Electron's OS-encrypted provider-key creation/rotation lifecycle, acknowledgement recovery, and atomic connection probe/swap are real and never silently select this fixture. | `server/model/index.ts`, `server/model/endpointExecution.ts`, `server/generate.ts`, `server/runtimeProfile.ts`, `server/routes/providerConnection.ts`, `src/controller/providerCreationCredentialCore.ts`, `desktop/credentialVault.mjs` | 🟡 |
| MOCK-2 | **Seeded/imported artifact bodies** — `/artifact-content` still serves a hand-authored file-name-keyed library for seeded demo doc/email/image/slide/sheet rows. CTX-FS-12, CTX-FS-14, CTX-FS-15 and CTX-FS-16 extract actual bounded text/value projections from directly selected PDFs, DOCX, XLSX and PPTX archives; PDF/DOCX/XLSX/PPTX layout, formulas/calculation, images/OCR, notes/media and other rich document extraction remain unbuilt. The fixture does **not** back newly authored documents (including REL-13 standing routine reports), CTX-FS-11 local folder snapshots or PDF/DOCX/XLSX/PPTX attachments: those persist actual bounded bodies under opaque identities. Local previews never substitute the demo library for missing content. Served folder artifacts fetch real content via CTX-FS-5. | `server/data/artifactContent.ts`, `contract/content.ts`, `server/store/index.ts`, `src/components/panels/ArtifactPanel.tsx`, `src/lib/docxExtraction.ts`, `src/lib/xlsxExtraction.ts`, `src/lib/pptxExtraction.ts` | 🟡 |
| MOCK-3 | **External MCP has a real, bounded interactive execution path; other connector fulfilment remains mocked or unavailable.** Tenant-owned HTTPS connections undergo real catalog discovery and isolated schema admission before exact attachment. Both model transports produce owner-approved proposals; confirmation persists a running receipt before one outbound attempt, then saves a bounded inert result, known failure or uncertainty without automatic replay. Electron provisions OS-encrypted tokens through a write-only bridge. Remote metadata is not consent, safety or live health. Deterministic loopback browser and JSON/SQLite recovery fixtures prove this path, not third-party acceptance. Legacy development connectors remain visibly `(mock)` and other release adapters remain `unconfigured`; routines reject failed provenance. Combined real-service/native acceptance, OAuth, stdio, standing trust and MRTR remain unfinished. | `server/mcpDiscovery.ts`, `server/mcpCatalog.ts`, `server/mcpHttpTransport.ts`, `server/mcpConnectionService.ts`, `server/routes/mcpConnections.ts`, `server/connectorRuntime.ts`, `server/model/connectorTools.ts`, `server/data/connectorDetails.ts`, `server/runtimeProfile.ts`, `server/routineRunner.ts`, `src/components/McpCatalogBody.tsx` | 🟡 |
| MOCK-4 | **Repo content + git** — a repo's files/diff/terminal are fixtures; real git is the native `localGit` seam (`/git/repos/:id/diff`), stubbed and `409` on a remote backend (PORT-4). Repos are real *attachable contexts*; their *content* is fixture. | `server/data/contextOptions.ts`, `server/runner-runtime.ts` | 🟡 |
| MOCK-5 | **Seed entities** — sessions, projects, artifacts, schedules, runs, dispatch are seeded fixtures (deterministic by design) in the development/review world; release profiles install a clean first-run database and never expose these as user history. A real backend's database + the live model would produce actual rows. | `server/data/sessions.ts`, `server/data/cowork.ts`, `server/initialWorld.ts`, `server/store/index.ts` | 🟡 |
| MOCK-6 | **Usage policy and estimates** — per-tenant reported token counts and rolling-window anchors are durable across restarts (MODEL-7), not reseeded each boot. Only a new/legacy demo baseline includes fixture spend; clean installs start at zero. Plan ceilings and the unused Sonnet-only gauge remain fixtures; context size and development-provider token counts remain estimates (≈4 chars/token). Local counters are not a provider billing ledger, do not reserve concurrent/unreported in-flight spend, and follow an explicitly restored backup's state. | `server/usage.ts`, `server/usageRegistry.ts`, `server/persistence/usage-durability.test.ts` | 🟡 |
