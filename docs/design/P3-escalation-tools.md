# P3 · Escalation & real tool execution

> **Pillar.** Turning the model's proposed escalations and tool calls into real,
> consent-gated, audited effects. Builds on [F5](F5-security-consent.md) (consent +
> authority), [F4](F4-broker-runners.md) (broker execution), [F1](F1-domain-model.md)
> /[P4](P4-relations-scheduler.md) (graph). Serves spec ESC-1..5, MODEL-4/6.

## 1. Problem & scope

The prototype runs a **real tool-use loop** (`server/generate.ts`, `server/model/tools.ts`): the model answers with `tool_use` blocks, the backend turns each into a
**consent-gated proposal** (a `message.escalation` panel or a `message.relations`
card), and applies it only on approval — the panels' content is the tool's *output*,
not a client fixture. What's mocked is the *fulfilment* (fixture diffs/terminal,
seed artifacts). Production keeps the loop + the consent shape and swaps mock
fulfilment for **real executors**, with rollback and audit. **Shared** across
deployments; the executor backing differs (local sidecar vs remote services).

## 2. Design

### 2.1 Execute vs propose (the consent split)

Each tool call is classified (the CALM/monotonicity line, D5/F5):

- **Observational / monotonic** (reads, scans, a draft preview) — **execute directly**
  in the loop; stream the result.
- **Irreversible / externally-visible** (write a file, push a repo, send via a
  connector, create a project, charge) — become a **consent-gated proposal** (F5 PD23):
  surfaced as the escalation/relation card the prototype already uses; executed only on
  the user's confirm (or a pre-authorized standing approval).

The three panel escalations (`open_workspace` / `connect_repo` / `create_project`) are
proposals that, on approval, perform the **real** attach/create (real fs scan, real
repo connect via the connector framework, a real project row + relation edits).

### 2.2 Real executors

Each tool maps to a real backend (replacing the prototype's fixture returns):

| Tool class | Real executor |
|------------|---------------|
| `fs.*` / `git` / `terminal` | the **runner** over the broker (F4) — real diff/terminal replace the fixtures (spec MOCK-4) |
| connector / MCP effects | the **connector framework** ([P6](P6-connectors-mcp.md)) |
| project / artifact / relation edits | the **graph transaction** (F1 PD2, [P4](P4-relations-scheduler.md)) |
| workspace open / artifact render | real **content extraction** ([P2](P2-context-filesystem.md)/[P5](P5-model-tools.md)) |

The loop feeds each executor's real `tool_result` back to the model, then streams the
final prose — exactly the prototype's protocol, now with live outputs.

### 2.3 Rollback / undo & pre-commit review

- **Reversible** effects (relation edits, file writes with object-store versioning,
  project creation) support **undo** via the soft-delete + version trail (F1 PD7) — a
  "review changes" surface shows the pending diff before commit and an undo after.
- **Irreversible** effects (sent email, a charge, a force-push) cannot be undone — which
  is exactly why they pass the **consent gate** first. The gate *is* the safety for
  irreversibility.

### 2.4 Audit

Every executed tool call — observational and irreversible, fulfilled and failed — is
recorded in the audit trail (F5 PD27) with principal, capability, target, and outcome.

## 3. Failure modes & edge cases

- **Executor failure mid-loop** — return a structured error `tool_result` to the model
  (it can adapt/apologize) and surface it to the user; never silently drop.
- **Partial multi-tool effect** — group into a transaction where the backend allows
  (graph edits); otherwise apply compensating actions and report what landed.
- **Runner offline** — `capability_unavailable`; the proposal stays pending/retryable.
- **Consent declined / timed out** — no-op; the proposal is dismissed and audited as
  not-applied.
- **Injected tool call** beyond authority — refused by the authority cascade (F5 PD24)
  regardless of prompt content.

## 4. Security & multi-tenancy

Execution is bounded by the authority cascade (F5 PD24) + broker mediation (F4 PD22) +
the consent gate (F5 PD23); injected instructions can't widen reach (F5 PD25); all
effects tenant-scoped (F2). The model never holds a credential — it proposes; the
backend executes under the principal's (clamped) authority.

## 5. Observability & ops

Tool-call volume + latency + error rate by class; proposal accept/decline/timeout
rates; undo usage; executor availability (runner/connector). Alert on a spike in
authority-refused tool calls (possible injection/abuse).

## 6. Open questions & decisions

See [`DECISIONS.md`](DECISIONS.md): **PD43** (monotonic tool calls execute in-loop;
irreversible/external ones become consent-gated proposals — the prototype's model,
generalized to every tool), **PD44** (each tool maps to a real executor: runner for
fs/git/terminal, connector framework for connectors/MCP, graph transaction for
relations, content extraction for workspace/artifacts), **PD45** (undo for reversible
effects via the version/audit trail + a pre-commit review surface; irreversible ones
rely on the consent gate), **PD46** (every executed tool call audited, fulfilled or
failed).
