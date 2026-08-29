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
| MOCK-1 | **The development model** — the one intended behavioral mock. Generation runs through a real Messages + tool-use boundary; development fulfilment is a local deterministic endpoint. Release profiles never enable it implicitly: the selected endpoint is visibly unconfigured and fail-before-write until a real connection exists (MODEL-28). Going live remains config only (MODEL-5). | `server/model/index.ts`, `server/model/endpointExecution.ts`, `server/generate.ts`, `server/runtimeProfile.ts` | 🟡 |
| MOCK-2 | **Seeded/imported artifact bodies** — `/artifact-content` still serves a hand-authored file-name-keyed library for seeded demo doc/email/image/slide/sheet rows; a real import boundary would render/extract those files. This fixture does **not** back newly authored documents: direct and conversational saves now persist their actual bounded, id-keyed editable body in the durable snapshot. Served folder artifacts fetch real content via CTX-FS-5. | `server/data/artifactContent.ts`, `contract/content.ts`, `server/store/index.ts` | 🟡 |
| MOCK-3 | **Connector / MCP detail and fulfilment** — `/connectors/detail` returns fixture resource lists; MCP servers are a static catalog with no real discovery or transport (no OAuth, no stdio/HTTP MCP). **The tool-exposure and authority seams are real, though (P6 slice 1):** an attached connector/MCP's tools are derived and declared to the model. In a foreground turn, reads execute immediately and writes remain consent-gated. In an unattended routine, only a context carrying the routine's standing approval may execute its action without another prompt. Both paths produce real tool-loop provenance, but the returned resource/action result is still a fixture: routine model completion therefore does not claim that an external delivery happened. | `server/model/connectorTools.ts`, `server/data/connectorDetails.ts`, `server/data/contextOptions.ts`, `server/routineRunner.ts` | 🟡 |
| MOCK-4 | **Repo content + git** — a repo's files/diff/terminal are fixtures; real git is the native `localGit` seam (`/git/repos/:id/diff`), stubbed and `409` on a remote backend (PORT-4). Repos are real *attachable contexts*; their *content* is fixture. | `server/data/contextOptions.ts`, `server/runner-runtime.ts` | 🟡 |
| MOCK-5 | **Seed entities** — sessions, projects, artifacts, schedules, runs, dispatch are seeded fixtures (deterministic by design) in the development/review world; release profiles install a clean first-run database and never expose these as user history. A real backend's database + the live model would produce actual rows. | `server/data/sessions.ts`, `server/data/cowork.ts`, `server/initialWorld.ts`, `server/store/index.ts` | 🟡 |
| MOCK-6 | **Usage windows** — the plan-usage meter is a live rolling meter reseeded each boot (not persisted), mock semantics; real token spend is metered into it per turn (MODEL-7), per tenant. Token counts are an estimate (≈4 chars/token) until live against the real API. | `server/usage.ts` | 🟡 |
