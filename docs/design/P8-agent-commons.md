# P8 · Agent Commons at scale

> **Pillar.** The Agent Commons — model providers, system prompts, worker agents, and
> commissions — enforced for many users and orgs: the D8 attenuation cascade and
> D11–D16 in production, with isolation, abuse limits, reputation, and audit. Builds on
> [F2](F2-identity-tenancy.md) (identity/tenancy), [F5](F5-security-consent.md)
> (authority/audit), [F4](F4-broker-runners.md) (coordination). Serves spec
> COMMONS-1..5; design record [`docs/agent-commons.md`](../agent-commons.md).

## 1. Problem & scope

The prototype implements the Agent Commons end-to-end (`contract/providers.ts`,
`prompts.ts`, `workers.ts`, `commission.ts`, `authority.ts`, `budget.ts`, `roles.ts`;
the D8 funnel + reclamp in `server/store.ts`) but single-tenant and in-memory. Production
makes the registries tenant-scoped, the cascade enforced at scale, and adds the abuse/
reputation controls a multi-tenant commons needs. **Shared** model; the web carries the
multi-tenant + cross-user weight, the desktop is the degenerate N=1 case.

## 2. Design

### 2.1 The registries as tenant entities, two management paths

Providers / prompts / agents / commissions are tenant-scoped entities (F1), managed two
ways through **one funnel** (the prototype's design, COMMONS-1): by hand (the Agents hub
dialogs) and conversationally (a model tool call proposed through the **same** confirm
gate as relation edits, P3 PD43). The single funnel is what keeps both paths honest.

### 2.2 The D8 cascade enforced server-side

*provider ⊇ agent ⊇ commission* attenuation (authority + budget faces) is enforced at
**mint, patch, and via parent-shrink reclamp** (already designed: `mintAuthority` /
`mintBudget` / `reclampCommissionsOf`) — an over-grant is unrepresentable, and narrowing
a parent re-clamps already-minted children. This is the authorization spine (F5 PD24);
production keeps it the single decision point.

### 2.3 D11–D16 in production

- **D11 coordination** — concurrent Contributors on a shared Project serialize on
  sub-goal reservations at the guardian (F4 shared-storage guardian); a same-sub-goal
  conflict re-reasons (`409`).
- **D12 isolation** — a commission's effective reach is its grant **clamped to the
  Project** (`projectAdmittedAuthority` ∩ grant); the owner's ambient connectors/scopes
  are unreachable — the confused-deputy wall, enforced at effect time (F4 PD22).
- **D13 caps + reputation** — a per-Project **commission cap** bounds abuse (fail-closed
  at the funnel); **reputation** aggregates a Contributor's fulfilled effects (the
  prototype's `recordContribution`).
- **D14 roles** — a Contributor's Project role gates actions (reader may read, not fire);
  composed into the cascade.
- **D15 audit** — every cross-principal effect (proxy / Project effect / commissioned
  host invoke), fulfilled or denied, in the append-only trail (F5 PD27).
- **D16 provenance** — each turn is stamped with the agent that drove it, so authorship +
  metering attribution survive a mid-thread hand-off.

### 2.4 Abuse controls

Per-tenant commission caps (D13) + budget caps (P5 PD53) + rate limits (F3) + the
detective audit trail (F5) form the abuse defense. A Contributor reaching past its
Project is refused and audited (the highest-value signal).

### 2.5 Forward: cross-org sharing / marketplace

Within a tenant by default. **Sharing agents/prompts across orgs** (a commons
marketplace, cross-org commissions) is a forward extension — flagged `⚠ confirm`, as it
expands the trust boundary (a stranger commissioner is exactly the confused-deputy case
the cascade is built to survive, but cross-tenant data-sharing + billing need explicit
product/legal decisions).

## 3. Failure modes & edge cases

- **Over-grant attempt** — refused at the funnel (mint/patch), `400`.
- **Contributor reaching past its Project** — D12 wall, `403` + audit.
- **Commission cap hit** — `429` (LimitError), re-target or raise the cap.
- **Runaway agent** — budget + rate caps (P5/F3) + circuit breaker (P7 PD62).
- **Provider/agent/prompt deleted with live dependents** — `409` conflict guards (the
  prototype refuses orphaning the default or a still-referenced entity).

## 4. Security & multi-tenancy

The cascade is the authz spine; registries + commissions are tenant-isolated (F2);
secrets (provider keys) in KMS off the contract (F5/P5); cross-principal effects audited
(F5); least privilege throughout. The confused-deputy wall (D12) is the structural
guarantee a commissioned agent can't be tricked into using authority it was never granted.

## 5. Observability & ops

Registry sizes per tenant; commission count vs cap; over-grant + reach-denied rates
(security signals); reputation distribution; per-agent spend (D16 attribution); funnel
rejection reasons. Alert on reach-denied spikes + cap saturation.

## 6. Open questions & decisions

See [`DECISIONS.md`](DECISIONS.md): **PD63** (registries tenant-scoped, managed by hand +
conversationally through one funnel; the D8 cascade enforced at mint/patch/reclamp
server-side), **PD64** (D11–D16 enforced in production: guardian coordination, D12
isolation, D14 roles, D13 caps + reputation, D15 audit, D16 provenance), **PD65** (abuse
controls = commission caps + budget caps + rate limits + the detective audit trail;
cross-org sharing/marketplace is a flagged forward extension).
