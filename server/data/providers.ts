/** ── Seed: the registered Model providers (docs/agent-commons.md, D9) ────────
 *  One provider for now — the degenerate N=1 case — wrapping the single implicit
 *  Anthropic client `server/generate.ts` already builds. The mock model endpoint is
 *  this one registered instance of the provider type; a real account would register
 *  more, and going multi-provider *multiplies* the boundary in `generate.ts` rather
 *  than weakening it.
 *
 *  Split, on purpose, into two halves: the contract `ModelProvider` (what the UI may
 *  see) and the server-only `ProviderConfig` (credentials / base-URL / concrete model
 *  id) — never exposed to the client, mirroring how `Capabilities` hides the key. */
import type { ModelProvider } from '../../contract/index.ts'

/** Server-side-only provider config: the concrete model id a turn runs against, and
 *  (in a real deployment) the credentials + base URL this provider authenticates
 *  with. NEVER part of the contract the UI imports. `model` unset = the provider
 *  inherits `generate.ts`'s env-configured default (`ANTHROPIC_MODEL`), the single
 *  source for the default provider's model. */
export interface ProviderConfig {
  model?: string
}

export const DEFAULT_PROVIDER_ID = 'provider-anthropic'

/** The seeded default provider — the cognition source every Conversation uses until
 *  a user registers others. Its plan is left unset so it inherits the account plan
 *  (`usage.planCeilings()`) as the cascade root, rather than duplicating those
 *  ceilings here where they could drift. */
export const DEFAULT_PROVIDER: ModelProvider = {
  id: DEFAULT_PROVIDER_ID,
  label: 'Anthropic',
  modelFamily: 'claude',
  effortLevels: ['Low', 'Medium', 'High'],
  // The cascade root grants everything (D8, authority face) — so the seeded default
  // Agent (which carries the whole tool catalog) is a valid attenuation of it, and an
  // Agent or Commission can only ever tighten from here. Explicit '*' so the grant is
  // visible in the UI rather than an implicit absence.
  authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] },
}

/** The default provider's server-only config. `model` unset → `generate.ts` uses its
 *  env-configured default, so the env override (`ANTHROPIC_MODEL`) stays the one
 *  place the default model is chosen. */
export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {}
