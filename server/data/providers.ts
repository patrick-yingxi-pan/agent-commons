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
import { DEFAULT_PROVIDER_ID, type ModelProvider, type ProviderEndpointConfig } from '../../contract/index.ts'
import { seedModels } from '../model/catalog.ts'

/** What the registration probe learned about a provider's endpoint — the capability
 *  record `generate.ts` branches on (never on provider identity). Today one axis:
 *  whether the endpoint accepts the `tools` param (native tool use); a non-tool
 *  provider still converses, but the tool-use loop — and so the consent-gated
 *  proposals — degrades away for turns on it. Server-only, like the config. */
export interface ProviderCapabilities {
  toolUse: boolean
}

/** Thrown when a provider config fails verification: the endpoint doesn't answer the
 *  registration-time conformance probe, the credential reference is out of policy
 *  (`validApiKeyEnv`), or a config that declares an endpoint reaches the mint funnel
 *  *without* a probed capability record. Either way the invariant holds: an
 *  unverified config is unrepresentable in the registry. */
export class ProviderProbeError extends Error {}

/** Only env vars under this prefix may be referenced as a provider credential. The
 *  reference is caller-supplied and its *value* is sent (as `x-api-key`) to the
 *  caller-supplied endpoint — without the prefix wall, registering
 *  `{ baseURL: <attacker>, apiKeyEnv: 'ANTHROPIC_API_KEY' }` would exfiltrate any
 *  server secret to an arbitrary URL. Enforced at both funnels: the probe (before any
 *  request leaves) and the mint. */
export const PROVIDER_KEY_ENV_PREFIX = 'PROVIDER_'
export function validApiKeyEnv(name: string | undefined): boolean {
  return name === undefined || (name.startsWith(PROVIDER_KEY_ENV_PREFIX) && /^[A-Z][A-Z0-9_]*$/.test(name))
}

/** Server-side-only provider config: the write-only endpoint half of a registration
 *  (`ProviderEndpointConfig` — base URL, env-var credential *reference*, concrete
 *  model id) plus the probed capability record. NEVER part of the contract reads the
 *  UI imports. All fields unset = the provider inherits `generate.ts`'s env-configured
 *  defaults (`ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`), the
 *  single source for the default provider's endpoint and model. */
export interface ProviderConfig extends ProviderEndpointConfig {
  /** Stamped by the registration probe (`probeProviderEndpoint`); required by the
   *  mint funnel whenever `baseURL` is set, so a config can't smuggle in an
   *  unverified endpoint. */
  capabilities?: ProviderCapabilities
  /** Transport discriminant (docs/delegated-cognition-provider.md). Unset/'endpoint'
   *  = dial-out Messages (`generateReply`); 'session' = the rendezvous relay — the
   *  messages route dispatches to `relayReply` instead, and the mint branch stamps
   *  `capabilities:{toolUse:false}` (inverting the dangerous unset-means-tools default). */
  kind?: 'endpoint' | 'session'
  /** Session kind only: SHA-256 hex of the rendezvous secret — at once the bearer
   *  credential, the durable re-bind identity, and the restart-recovery key (§6.1).
   *  Plaintext never persists; presented secrets are hashed and compared
   *  constant-time. Rides the persisted `providerConfigs` slice like the rest. */
  secretHash?: string
}

// The id itself now lives in the contract (the UI's model selector anchors on it).
export { DEFAULT_PROVIDER_ID }

/** The seeded default provider — the cognition source every Conversation uses until
 *  a user registers others. Its plan is left unset so it inherits the account plan
 *  (`usage.planCeilings()`) as the cascade root, rather than duplicating those
 *  ceilings here where they could drift. */
export const DEFAULT_PROVIDER: ModelProvider = {
  id: DEFAULT_PROVIDER_ID,
  label: 'Anthropic',
  modelFamily: 'claude',
  effortLevels: ['Low', 'Medium', 'High'],
  // The endpoint's own catalog (server/model/catalog.ts — ONE record set derives
  // this seed AND the mock's `/v1/models` wire face, so they can't drift; a live
  // refresh through `fetchProviderModels` round-trips to exactly this list).
  // Every model picker renders THESE rows — the UI carries no model constants.
  models: seedModels(),
  catalogSource: 'listed',
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

/** The second seeded provider — OpenAI, so provider selection is exercisable out
 *  of the box (two providers ⇒ the composer's Provider section renders). Its
 *  catalog is **static** on purpose: OpenAI's real `GET /v1/models` carries no
 *  metadata (ids only — no context windows, no capabilities), so a client curates
 *  its catalog from the docs rather than the list API — exactly the degradation
 *  class the flexible `ModelInfo` exists for (spec MODEL-16). The entries vary
 *  deliberately: GPT-5.1 declares the reasoning-effort ladder, the mini a subset,
 *  GPT-4.1 an EMPTY vocabulary (no reasoning — the effort control stands down
 *  rather than falling back to the provider's). Like every provider here, its
 *  turns dial the ambient mock endpoint in dev (mock by design). */
export const OPENAI_PROVIDER: ModelProvider = {
  id: 'provider-openai',
  label: 'OpenAI',
  modelFamily: 'gpt',
  effortLevels: ['Minimal', 'Low', 'Medium', 'High'],
  models: [
    {
      id: 'gpt-5.1',
      label: 'GPT-5.1',
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      capabilities: { toolUse: true, vision: true, thinking: true },
      effortLevels: ['Minimal', 'Low', 'Medium', 'High'],
    },
    {
      id: 'gpt-5.1-mini',
      label: 'GPT-5.1 mini',
      contextWindow: 400_000,
      maxOutputTokens: 64_000,
      capabilities: { toolUse: true, vision: true, thinking: true },
      effortLevels: ['Low', 'Medium'],
    },
    {
      id: 'gpt-4.1',
      label: 'GPT-4.1',
      contextWindow: 1_047_576,
      maxOutputTokens: 32_768,
      capabilities: { toolUse: true, vision: true, thinking: false },
      effortLevels: [],
    },
  ],
  catalogSource: 'static',
  authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] },
}

/** OpenAI's DEMO server-only config: a concrete configured model (what an unset pick
 *  resolves to — stamped onto reads as `defaultModelId`), no endpoint of its own
 *  (dev turns run against the ambient Messages mock). Real OpenAI connections
 *  explicitly select openai-responses, their endpoint/model, and a PROVIDER_*
 *  credential. The seed is not evidence of a connected OpenAI account. */
export const OPENAI_PROVIDER_CONFIG: ProviderConfig = { model: 'gpt-5.1' }

/** The seeded provider registry, in list order (the default first). Rehydrate
 *  re-inserts a seed row a pre-seed snapshot doesn't carry (the P9 re-stamp rule;
 *  a runtime delete of a seed therefore lasts until the next restart — the same
 *  mock semantics as seed sessions). */
export const SEED_PROVIDERS: ModelProvider[] = [DEFAULT_PROVIDER, OPENAI_PROVIDER]
export const SEED_PROVIDER_CONFIGS: Array<[string, ProviderConfig]> = [
  [DEFAULT_PROVIDER.id, DEFAULT_PROVIDER_CONFIG],
  [OPENAI_PROVIDER.id, OPENAI_PROVIDER_CONFIG],
]
