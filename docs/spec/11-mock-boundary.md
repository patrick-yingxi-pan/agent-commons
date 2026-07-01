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
| MOCK-1 | **The model** — the one intended mock. Generation runs through a real Messages + tool-use boundary; the *fulfilment* is a local mock model. Going live is config only (see MODEL-5). | `server/model/index.ts`, `server/generate.ts` | 🟡 |
| MOCK-2 | **Artifact bodies** — `/artifact-content` serves a hand-authored content library keyed by file name; a real backend would render/extract the actual file. (Served folder artifacts now fetch real content via CTX-FS-5; this library backs the seeded/demo artifacts.) | `server/data/artifactContent.ts`, `contract/content.ts` | 🟡 |
| MOCK-3 | **Connector / MCP detail** — `/connectors/detail` returns fixture resource lists; MCP servers are a static catalog with no real discovery or transport (no OAuth, no stdio/HTTP MCP). **The tool-exposure seam is real, though (P6 slice 1):** an *attached* connector/MCP's tools are derived and declared to the model, and calling one runs a real tool-use round-trip surfaced as a `message.toolActivity` card — only the *fulfilment* is a fixture result. | `server/model/connectorTools.ts`, `server/data/connectorDetails.ts`, `server/data/contextOptions.ts` | 🟡 |
| MOCK-4 | **Repo content + git** — a repo's files/diff/terminal are fixtures; real git is the native `localGit` seam (`/git/repos/:id/diff`), stubbed and `409` on a remote backend (PORT-4). Repos are real *attachable contexts*; their *content* is fixture. | `server/data/contextOptions.ts`, `server/runner-runtime.ts` | 🟡 |
| MOCK-5 | **Seed entities** — sessions, projects, artifacts, schedules, runs, dispatch are seeded fixtures (deterministic by design); a real backend's database + the live model would produce them. | `server/data/sessions.ts`, `server/data/cowork.ts` | 🟡 |
| MOCK-6 | **Usage windows** — the plan-usage meter is a live rolling meter reseeded each boot (not persisted), mock semantics; real token spend is metered into it per turn (MODEL-7). | `server/usage.ts` | 🟡 |
