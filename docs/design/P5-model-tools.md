# P5 · Model + tools production

> **Pillar.** The real generation path — the Anthropic Messages + tool-use boundary at
> production: a model gateway, context-window management/compaction, cost/budget, the
> provider abstraction, and injection defense. Builds on [F5](F5-security-consent.md),
> [F6](F6-persistence-ops.md), [P3](P3-escalation-tools.md). Serves spec MODEL-1..7,
> and promotes BROKER-EXP-3 ([`docs/context-compaction.md`](../context-compaction.md)).

## 1. Problem & scope

The prototype already runs a **real Messages + tool-use boundary** via the official SDK
(`server/generate.ts`, tools in `server/model/tools.ts`); only the *endpoint* is a local
mock model (`server/model/`, spec MOCK-1). Going live is config
(`ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`). Production wraps that seam in the
operational machinery a real model integration needs. **Shared** boundary; web routes
through a managed gateway, desktop calls out directly (or via the same gateway when
signed in).

## 2. Design

### 2.1 The model gateway

A server-side **model gateway** (F6) sits between `generate.ts` and the Anthropic API:

- **Keys** from the secrets manager (F5 PD26), never on the contract (the prototype
  already keeps `ProviderConfig` server-only).
- **Budgets** — per-agent/provider/account token windows enforced (the D8 budget face;
  `overSpendLimit` + `recordUsage` already exist) plus per-tenant plan caps (F3 rate
  limiting); a turn over the window is refused `limit_exceeded` (already wired).
- **Resilience** — retries with backoff on 429/5xx, request timeouts, and optional
  fallback (a cheaper/alternate model) under load; streaming is relayed token-by-token
  (already), with cancellation on client disconnect (already).

### 2.2 Tool-use loop hardening

The loop (model → `tool_use` → execute → `tool_result` → prose) gains: a **bounded
iteration count**, **per-tool timeouts**, **structured tool errors** fed back so the
model can adapt, idempotency (F3 PD15), and the **execute-vs-propose consent split**
(P3 PD43). The tool schema is the resource-manipulation interface
(`server/model/tools.ts`) — additive evolution (F3 PD17).

### 2.3 Context-window management & compaction (BROKER-EXP-3)

When a conversation's context approaches the window, **compact** older turns:

- Summarize the older span via a model call, preserving **pinned/important** context
  (attached contexts, recent turns, the active task); replace the raw span with the
  summary in the assembled prompt while keeping the full history in storage (F1).
- The UX is the captured pattern in `docs/context-compaction.md`: a warm first-person
  caption ("Compacting our conversation so we can keep chatting…"), a determinate
  progress bar, and the usage gauge (`src/components/UsageControl.tsx`) dropping back as
  space frees.
- Compaction is itself metered (it's a model call) and audited.

### 2.4 Cost, budget & metering

Real per-turn token usage is metered into the rolling windows (the prototype's
`usageMeter`/`recordUsage`, MODEL-7) and enforced via the D8 cascade per agent/provider/
account, plus per-tenant plan limits. Usage surfaces in the composer gauge; the
tool-schema token weight is counted (already). Cost attribution is per tenant/agent for
billing.

### 2.5 Provider abstraction

The D9 provider model lets an Agent bind a cognition source; the concrete model id +
credentials stay **server-only config off the contract** (already). The gateway routes
to the bound provider/family; the prompt-fit probe (D10) scores a (prompt × model)
pairing at selection. Multi-provider is just a non-default `providerId`.

### 2.6 Injection & safety

Cross-ref [F5](F5-security-consent.md) PD25: model output is untrusted; attached/fetched
content is data-not-instructions; capability containment + the consent gate backstop
injection. The model never holds a credential — it proposes; the backend executes under
clamped authority (P3).

## 3. Failure modes & edge cases

- **Provider 429 / outage** — retry/backoff; fallback model or a clear "try again"; the
  turn is idempotent (F3 PD15).
- **Context overflow** — compaction; if compaction itself can't fit, drop-oldest with a
  visible notice (no silent loss).
- **Tool loop non-termination** — iteration cap → stop with a partial result + notice.
- **Budget exhausted mid-turn** — refuse `limit_exceeded` before streaming (already), so
  no partial charge surprise.
- **Streaming disconnect** — cancellation already wired; the turn can be retried.

## 4. Security & multi-tenancy

Keys in KMS (F5); budgets/limits isolate tenants; model output untrusted; per-tenant
cost attribution; the gateway is the single egress to the model (auditable, rate-limitable).

## 5. Observability & ops

Tokens in/out per turn/agent/tenant; generation latency + success; retry/fallback
rates; compaction frequency + reclaimed tokens; budget-window saturation; tool-call
iteration distribution. Alert on provider error spikes + budget exhaustion.

## 6. Open questions & decisions

See [`DECISIONS.md`](DECISIONS.md): **PD51** (a model gateway mediates the Anthropic API
— keys, per-agent/tenant budgets, retries/timeouts/fallback, streaming relay; going live
is config, MOCK-1), **PD52** (context-window compaction: summarize older turns via a model
call, preserve pinned context, reflect in the usage gauge — realizes BROKER-EXP-3),
**PD53** (real per-turn token metering enforced against the D8 budget windows + per-tenant
plan caps), **PD54** (multi-provider via the D9 abstraction; concrete model id + keys stay
server-only off the contract), **PD55** (tool-use loop hardened: bounded iterations,
per-tool timeouts, structured tool errors, idempotency, the consent split).
