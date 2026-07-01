# 06 · Real model + tool boundary

> **Intent.** The mock model is the *only* faked part of the system. Everything
> around it is production-shaped: the backend calls a real **Anthropic Messages**
> endpoint through the official SDK **with a real tool interface** (one tool per
> resource manipulation) and runs the **tool-use loop** — model answers with
> `tool_use`, the backend executes each call into a consent-gated proposal, feeds the
> `tool_result`s back, and streams the final prose. In dev the endpoint is a local
> Anthropic-compatible mock; going live is `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`
> with no code change. The resource manipulations are therefore *tool calls*, not a
> backend keyword overlay. (AGENTS "Generation runs through a real Anthropic Messages
> API boundary"; README "How it stays in sync".)

## Requirements (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| MODEL-1 | Generation runs through a real Anthropic Messages API boundary via `@anthropic-ai/sdk`, not an in-process fake. | `server/generate.ts` | `tests/generate.test.ts` | ✅ |
| MODEL-2 | A real tool interface (one tool per resource manipulation) drives the tool-use loop: model → `tool_use` → backend executes → `tool_result` → final prose. | `server/model/tools.ts`, `server/generate.ts` | `tests/model-tools.test.ts`, `tests/generate.test.ts` | ✅ |
| MODEL-3 | The dev mock model server speaks the Messages wire format (JSON + streaming SSE incl. `tool_use`) and decides which tools to call by fixed string (tour) / keyword (otherwise). | `server/model/index.ts`, `server/model/intents.ts`, `server/model/replies.ts` | `tests/model-server.test.ts`, `tests/model-intents.test.ts` | ✅ |
| MODEL-4 | An assistant turn streams token-by-token from `POST /v1/sessions/:id/messages`, carrying typed reply-stream events (start / delta / relations / escalation / end). | `server/routes/index.ts`, `ReplyStreamEvent` in `contract/events.ts`, `src/api/commands.ts` | `tests/routes-messages.test.ts` | ✅ |
| MODEL-5 | Going live is config only — `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`); the in-process mock then stands down. No code change. | `server/generate.ts`, `server/index.ts`, `server/model/index.ts` | `tests/generate.test.ts`; ops/config | ✅ |
| MODEL-6 | Resource manipulations are the model's tool calls, surfaced as consent-gated proposals (`message.relations` / `message.escalation`) — not a backend keyword overlay. | `server/generate.ts`, `server/model/tools.ts`, `Message` in `contract/entities.ts` | `tests/routes-messages.test.ts`, `tests/model-tools.test.ts` | ✅ |
| MODEL-7 | The real token usage of each turn is metered into the plan-usage windows the composer gauge reads — **per tenant** (F2/PD9): the default tenant owns the seeded demo meter, every other tenant a fresh one, so one tenant's spend never shows in another's gauge. | `server/usage.ts`, `server/store.ts`, `server/routes/index.ts` | `tests/usage.test.ts`, `tests/usage-tenancy.test.ts` | ✅ |
| MODEL-8 | A per-turn **spend-time gate** refuses a turn (429 `limit_exceeded`) once a plan window is exhausted for the Agent's effective budget (the D8 attenuation, evaluated at spend time — the runtime counterpart to COMMONS-1's mint-time funnel), scoped to the caller's tenant so one tenant's exhaustion never 429s another. | `server/usage.ts`, `server/store.ts`, `server/routes/index.ts` | `tests/usage.test.ts`, `tests/usage-tenancy.test.ts`, `tests/routes-messages.test.ts` | ✅ |
