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
this boundary. Final repository verification gates landing; the shared preview
handoff awaits an unlocked Mac. OCR, SVG/BMP/ICO, other documents, live folder/Git, remote
input, paid-provider acceptance, and manual OS-dialog/native release acceptance
remain outside this milestone.

## The declared fixtures (L2)

| ID | What is mocked (and the real boundary it stubs) | Anchor | Status |
|----|--------------------------------------------------|--------|--------|
| MOCK-1 | **The development model** — the one intended behavioral mock. Generation runs through a real Messages + tool-use boundary; development fulfilment is a local deterministic endpoint. Release profiles never enable it implicitly: the selected endpoint is visibly unconfigured and fail-before-write until a real connection exists (MODEL-28). Going live remains config only (MODEL-5); Electron's OS-encrypted provider-key creation/rotation lifecycle, acknowledgement recovery, and atomic connection probe/swap are real and never silently select this fixture. | `server/model/index.ts`, `server/model/endpointExecution.ts`, `server/generate.ts`, `server/runtimeProfile.ts`, `server/routes/providerConnection.ts`, `src/controller/providerCreationCredentialCore.ts`, `desktop/credentialVault.mjs` | 🟡 |
| MOCK-2 | **Seeded/imported artifact bodies** — `/artifact-content` still serves a hand-authored file-name-keyed library for seeded demo doc/email/image/slide/sheet rows. CTX-FS-12 and CTX-FS-14 extract actual bounded text from directly selected PDFs and DOCX archives; PDF/DOCX layout/images/OCR and other rich document extraction remain unbuilt. The fixture does **not** back newly authored documents, CTX-FS-11 local folder snapshots or PDF/DOCX text attachments: those persist actual bounded bodies under opaque identities. Local previews never substitute the demo library for missing content. Served folder artifacts fetch real content via CTX-FS-5. | `server/data/artifactContent.ts`, `contract/content.ts`, `server/store/index.ts`, `src/components/panels/ArtifactPanel.tsx`, `src/lib/docxExtraction.ts` | 🟡 |
| MOCK-3 | **Connector/MCP tool fulfilment remains mocked or unavailable; external MCP catalog inspection is real.** Legacy connector detail uses explicit fixtures and development execution uses the visibly `(mock)` adapter. User-added external MCP identities instead resolve tenant-owned saved catalogs through bounded HTTP discovery, strict lifecycle routes and Contexts UI; endpoints and opaque credential references remain private, and Electron provisions OS-encrypted tokens through a write-only bridge. The shared catalog presents remote text as untrusted metadata, not consent, safety, or live health. Semantic schema validation, external tool attachment/execution, OAuth, stdio and explicit trust remain unfinished. Both release profiles keep fulfilment `unconfigured`, surface typed failures and cannot claim external execution; routines reject failed provenance. | `server/mcpDiscovery.ts`, `server/mcpCatalog.ts`, `server/mcpHttpTransport.ts`, `server/mcpConnectionService.ts`, `server/routes/mcpConnections.ts`, `server/connectorRuntime.ts`, `server/model/connectorTools.ts`, `server/data/connectorDetails.ts`, `server/runtimeProfile.ts`, `server/routineRunner.ts`, `src/components/McpCatalogBody.tsx` | 🟡 |
| MOCK-4 | **Repo content + git** — a repo's files/diff/terminal are fixtures; real git is the native `localGit` seam (`/git/repos/:id/diff`), stubbed and `409` on a remote backend (PORT-4). Repos are real *attachable contexts*; their *content* is fixture. | `server/data/contextOptions.ts`, `server/runner-runtime.ts` | 🟡 |
| MOCK-5 | **Seed entities** — sessions, projects, artifacts, schedules, runs, dispatch are seeded fixtures (deterministic by design) in the development/review world; release profiles install a clean first-run database and never expose these as user history. A real backend's database + the live model would produce actual rows. | `server/data/sessions.ts`, `server/data/cowork.ts`, `server/initialWorld.ts`, `server/store/index.ts` | 🟡 |
| MOCK-6 | **Usage windows** — the plan-usage meter is a live rolling meter reseeded each boot (not persisted), mock semantics; real token spend is metered into it per turn (MODEL-7), per tenant. Token counts are an estimate (≈4 chars/token) until live against the real API. | `server/usage.ts` | 🟡 |
