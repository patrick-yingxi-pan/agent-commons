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

## The declared fixtures (L2)

| ID | What is mocked (and the real boundary it stubs) | Anchor | Status |
|----|--------------------------------------------------|--------|--------|
| MOCK-1 | **The development model** — the one intended behavioral mock. Generation runs through a real Messages + tool-use boundary; development fulfilment is a local deterministic endpoint. Release profiles never enable it implicitly: the selected endpoint is visibly unconfigured and fail-before-write until a real connection exists (MODEL-28). Going live remains config only (MODEL-5); Electron's OS-encrypted provider-key path is real and never silently selects this fixture. | `server/model/index.ts`, `server/model/endpointExecution.ts`, `server/generate.ts`, `server/runtimeProfile.ts`, `desktop/credentialVault.mjs` | 🟡 |
| MOCK-2 | **Seeded/imported artifact bodies** — `/artifact-content` still serves a hand-authored file-name-keyed library for seeded demo doc/email/image/slide/sheet rows; a real import boundary would render/extract those files. This fixture does **not** back newly authored documents: direct and conversational saves now persist their actual bounded, id-keyed editable body in the durable snapshot. Served folder artifacts fetch real content via CTX-FS-5. | `server/data/artifactContent.ts`, `contract/content.ts`, `server/store/index.ts` | 🟡 |
| MOCK-3 | **Connector / MCP discovery, detail, and development fulfilment** — `/connectors/detail` returns fixture resource lists; MCP servers are a static catalog with no real discovery or transport (no OAuth, no stdio/HTTP MCP). **The tool-exposure, authority, consent, and execution seams are real:** attached tools are derived and declared; every admitted call crosses `connectorRuntime`; consent persists and previews the exact input; routines reject failed provenance. Direct development selects the visibly `(mock)` fixture adapter. Both release profiles instead select `unconfigured`, surface a typed failure, and cannot claim an external read/write or routine delivery. The remaining gap is a real OAuth/MCP adapter and live discovery behind the existing runtime interface. | `server/connectorRuntime.ts`, `server/model/connectorTools.ts`, `server/data/connectorDetails.ts`, `server/data/contextOptions.ts`, `server/runtimeProfile.ts`, `server/routineRunner.ts` | 🟡 |
| MOCK-4 | **Repo content + git** — a repo's files/diff/terminal are fixtures; real git is the native `localGit` seam (`/git/repos/:id/diff`), stubbed and `409` on a remote backend (PORT-4). Repos are real *attachable contexts*; their *content* is fixture. | `server/data/contextOptions.ts`, `server/runner-runtime.ts` | 🟡 |
| MOCK-5 | **Seed entities** — sessions, projects, artifacts, schedules, runs, dispatch are seeded fixtures (deterministic by design) in the development/review world; release profiles install a clean first-run database and never expose these as user history. A real backend's database + the live model would produce actual rows. | `server/data/sessions.ts`, `server/data/cowork.ts`, `server/initialWorld.ts`, `server/store/index.ts` | 🟡 |
| MOCK-6 | **Usage windows** — the plan-usage meter is a live rolling meter reseeded each boot (not persisted), mock semantics; real token spend is metered into it per turn (MODEL-7), per tenant. Token counts are an estimate (≈4 chars/token) until live against the real API. | `server/usage.ts` | 🟡 |
