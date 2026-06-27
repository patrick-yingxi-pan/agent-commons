/** ── Contract: Model providers (the cognition source — D9) ───────────────────
 *  A registered *cognition source* (docs/agent-commons.md, D9): one Messages-API
 *  integration point with named **effort levels** and an optional **provider plan**
 *  — the root of the D8 budget cascade. An Agent's *mind*; each Agent selects exactly
 *  one. Account-scoped and referenceable by id, like a Runner — never attached
 *  per-thread as a context.
 *
 *  The provider's credential / base-URL / model config is **server-side only** and is
 *  deliberately NOT on this type (mirroring `Capabilities`, which exposes feature
 *  flags, never the key). The contract carries only what the UI may show.
 *
 *  Forward-looking: today there is exactly one registered instance, wrapping the
 *  single implicit Anthropic client — the degenerate N=1 case. Going multi-provider
 *  *multiplies* that real boundary rather than weakening it. */
import type { Budget } from './budget.ts'
import type { Authority } from './authority.ts'

export interface ModelProvider {
  id: string
  /** Human label, shown wherever a provider is listed / chosen. */
  label: string
  /** The model family this provider resolves to (e.g. 'claude') — the typed
   *  compatibility edge a system prompt is checked against at selection (D10). */
  modelFamily: string
  /** The provider-declared effort vocabulary (e.g. ['Low','Medium','High']). A
   *  provider-local vocabulary, NOT a universal scale — "High" on one provider is
   *  not "High" on another (D9 trade-off); the UI shows each provider's own levels. */
  effortLevels: string[]
  /** The provider plan — the **root** of the D8 attenuation cascade (token face): an
   *  Agent's budget (and a Commission's grant) must be a subset of it. Optional: a
   *  provider with no declared plan imposes no token ceiling of its own (the account
   *  plan still bounds it, enforced when the provider is minted). */
  plan?: Budget
  /** The provider's **authority** grant — the root of the D8 cascade's *primary*
   *  (authority) face: which tools / connectors / scopes Agents on this provider may
   *  reach. An Agent's authority must be a subset (`overAuthority`). Absent =
   *  unrestricted. */
  authority?: Authority
}
