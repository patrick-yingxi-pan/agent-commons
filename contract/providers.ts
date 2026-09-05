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

/** The seeded default provider's id — the degenerate N=1 anchor both sides
 *  reference: the backend seeds it (server/data/providers.ts) and resolves unset
 *  bindings to it; the UI's model selector renders its catalog as the built-in
 *  Claude models (an unset session pick) rather than as a duplicate list entry. */
export const DEFAULT_PROVIDER_ID = 'provider-anthropic'

/** Server-computed execution posture for an endpoint provider. `mock` is the
 * deliberate development model; `configured` means the provider has a usable
 * connection definition; `unconfigured` means a turn is refused before it can
 * be written. This is status only — endpoint and credential values never cross
 * the read boundary. Session providers keep their separate `online` signal. */
export type ModelExecution = 'mock' | 'configured' | 'unconfigured'

/** ── One model in a provider's catalog ────────────────────────────────────────
 *  The flexible, provider-agnostic projection of "a model this provider serves".
 *  Real providers disagree wildly about what a model-list API returns — Anthropic
 *  ships per-level effort capabilities and token limits, Gemini ships token limits
 *  and a thinking flag, Mistral ships capability booleans, OpenRouter adds pricing,
 *  and OpenAI's list carries *nothing* beyond ids — so **every metadata field here
 *  is optional**, and an absent field means *unknown*, never a default. The UI
 *  degrades per-field (an unknown context window renders an unknown-capacity
 *  gauge, not a made-up 100%). Only `id` + `label` are guaranteed. */
export interface ModelInfo {
  /** The provider-local model id a turn is routed with (e.g. 'claude-opus-4-8'). */
  id: string
  /** Human display name; falls back to the id when the provider names nothing. */
  label: string
  /** Optional one-line description for the picker row. */
  blurb?: string
  /** Max input context window, in tokens. Absent = the provider doesn't expose it
   *  (OpenAI-class lists) — the usage gauge renders unknown-capacity, not a guess. */
  contextWindow?: number
  /** Max output tokens per response. Absent = unknown. */
  maxOutputTokens?: number
  /** Capability flags. Each flag is tri-state by absence: true / false / unknown. */
  capabilities?: { toolUse?: boolean; vision?: boolean; thinking?: boolean }
  /** This model's own effort vocabulary (e.g. Anthropic's per-model effort levels).
   *  Absent = fall back to the provider-level `effortLevels`. */
  effortLevels?: string[]
  /** Per-million-token pricing, when the provider publishes it (OpenRouter-class). */
  pricing?: { inputPerMTok: number; outputPerMTok: number }
  /** The provider still serves it but has marked it deprecated (Mistral-class). */
  deprecated?: boolean
}

export interface ModelProvider {
  id: string
  /** The tenant that created it (F2/PD9). Unset ⇒ a seeded/shared entry visible to every
   *  tenant (the default toolkit is shared infra); a created one is private to its tenant.
   *  A `kind:'session'` provider is always tenant-stamped (forced — a shared relay would
   *  route one tenant's prompts to another tenant's session model). */
  tenantId?: string
  /** How this provider's cognition is reached (docs/delegated-cognition-provider.md).
   *  Unset/'endpoint' = a Messages endpoint the backend dials out to (slice 18);
   *  'session' = a delegated AI session that dials IN — its connector drains prompts
   *  at a rendezvous secret. Session providers are prose-only in v1 (no tool use, so
   *  no relation-edit cards or escalations on their turns — declared, not discovered). */
  kind?: 'endpoint' | 'session'
  /** Endpoint kind only, computed at read time from server-side configuration.
   * Never accepted as caller truth or persisted on the provider row. */
  execution?: ModelExecution
  /** Endpoint kind only: server-owned ordering for the write-only connection
   * and its endpoint-owned model catalog. A replacement may compare this value
   * without learning the endpoint, model, or credential reference it protects.
   * Legacy/seeded absence reads as zero. */
  connectionRevision?: number
  /** Server-owned ordering for the editable provider definition (label, model
   * family, effort vocabulary, plan, and authority). This is deliberately
   * independent from the write-only connection/catalog revision and transient
   * Session-relay activity. Legacy/seeded absence reads as zero. */
  definitionRevision?: number
  /** Session kind only: the tail of the rendezvous secret for the masked
   *  `rv_live_••••3f9a` fingerprint. Never the secret (one-time-shown at mint/rotate). */
  secretHint?: string
  /** Session kind only: the durable receipt for the most recent keyed secret
   * rotation request. `applied` authorizes exact same-key recovery while that
   * credential is still current; `cancelled` fences a late request without
   * retaining an unbounded history of opaque operation ids. */
  secretRotationReceipt?: { id: string; state: 'applied' | 'cancelled' }
  /** Session kind only, computed at read time (never stored): whether a drain loop is
   *  currently bound — a parked poll or an in-flight turn (§7.3). The UI's status dot;
   *  live flips arrive as `relay.connected|disconnected` events. */
  online?: boolean
  /** Session kind only, computed at read time (never stored): how many conversations
   *  currently hold an in-flight relayed turn on this relay. The observed half of the
   *  v5 serving handshake (§9.4) — kept live by `relay.activity` events. */
  activeConversations?: number
  /** Session kind only, computed at read time (never stored): the NEGOTIATED
   *  concurrent-conversation ceiling — min(server cap, what the binding's polls
   *  advertise via `?channels=`; an advertisement-less binding is serial, window 1,
   *  because a pre-v4 connector can't hold two undelivered prompts). What the
   *  pre-turn capacity gate actually enforces, shown so it's never a surprise. */
  conversationWindow?: number
  /** Human label, shown wherever a provider is listed / chosen. */
  label: string
  /** Viewer-relative, stamped at serve time (like `online`) — never stored on the
   *  entity: this entry is the viewer's **default**, pre-selected wherever a provider
   *  must be picked (the New-agent dialog). At most one per registry per tenant, and
   *  purely a *UI shortcut*: the API never resolves an absent id to it — a request
   *  that names no provider is refused, not defaulted (`defaultEntry` is the UI-side
   *  fallback when no entry is flagged). Set/cleared via `isDefault` on a create /
   *  patch request; optional on purpose — zero defaults is a valid registry state. */
  isDefault?: boolean
  /** The model family this provider resolves to (e.g. 'claude') — the typed
   *  compatibility edge a system prompt is checked against at selection (D10). */
  modelFamily: string
  /** The provider-declared effort vocabulary (e.g. ['Low','Medium','High']). A
   *  provider-local vocabulary, NOT a universal scale — "High" on one provider is
   *  not "High" on another (D9 trade-off); the UI shows each provider's own levels.
   *  A catalog model's own `effortLevels` overrides this for that model. */
  effortLevels: string[]
  /** The provider's model catalog — what the composer's model picker lists for it.
   *  Absent/empty = the provider can't enumerate models (a Session provider's
   *  cognition is whatever session drains its mailbox; a list-less endpoint just
   *  serves whatever id it's configured with) — the picker shows that honestly
   *  instead of fabricating rows. Populated by the registration-time fetch from the
   *  endpoint's own list API, or declared statically on the create request. */
  models?: ModelInfo[]
  /** How `models` was obtained — server-stamped, never caller-forgeable:
   *  'listed' = fetched from the endpoint's model-list API (refreshable);
   *  'static' = declared on the create/patch request (the endpoint has no list API). */
  catalogSource?: 'listed' | 'static'
  /** The model an UNSET session pick resolves to on this provider — its configured
   *  model (the server-only config's `model`, or the env default). Stamped at serve
   *  time like `online`, never stored and never caller-settable, so the client's
   *  inherit display can't drift from what a turn actually runs. Endpoint kind
   *  only — a Session provider's model is whatever session drains its mailbox. */
  defaultModelId?: string
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

/** Body of `DELETE /v1/providers/:id`. A first-party removal pins both public
 * revision domains because either a definition edit or a write-only
 * connection/catalog change can make the reviewed provider materially stale.
 * Omitting both fields retains the v1 unconditional-delete meaning. */
export interface ProviderDeletionPrecondition {
  expectedDefinitionRevision: number
  expectedConnectionRevision: number
}

export type DeleteProviderRequest =
  | ProviderDeletionPrecondition
  | { expectedDefinitionRevision?: never; expectedConnectionRevision?: never }

/** The endpoint half of a registration — **write-only**: it may ride a create request
 *  (that's how a user brings a provider's endpoint) but is never echoed on the read
 *  type above. Integrating a provider is supplying *data*, not code: any endpoint
 *  that speaks the Messages protocol (natively or behind a translating gateway) plugs
 *  in here — the backend knows one protocol and zero providers. The credential is an
 *  env-var *reference*, never a raw key, so neither the wire nor the persisted store
 *  ever carries a secret. */
export interface ProviderEndpointConfig {
  /** The Messages-protocol endpoint this provider is served from. Unset = inherit the
   *  ambient default endpoint (`ANTHROPIC_BASE_URL` / the dev mock). */
  baseURL?: string
  /** Name of the server-side env var holding this provider's API key. Must sit under
   *  the `PROVIDER_` prefix — the reference and the endpoint are both caller-supplied,
   *  so an unconstrained reference could point any server secret at an arbitrary URL;
   *  the prefix wall is enforced server-side before any probe request leaves. */
  apiKeyEnv?: string
  /** The concrete model id a turn on this provider runs against. Unset = the env
   *  default (`ANTHROPIC_MODEL`). */
  model?: string
}

/** Replace selected fields of an existing endpoint provider's write-only
 * connection. An absent field preserves its current value; explicit `null`
 * clears it. The effective connection is probed before the server commits the
 * swap, so a failed rotation leaves the working configuration untouched. */
export type ProviderConnectionPatch = {
  [Field in keyof ProviderEndpointConfig]?: ProviderEndpointConfig[Field] | null
}

/** `expectedRevision` is an optional compare-and-swap precondition. Absence
 * preserves legacy unconditional-write behavior; current clients always send
 * the public provider's latest `connectionRevision`. */
export type UpdateProviderConnectionRequest = ProviderConnectionPatch & {
  expectedRevision?: number
}

/** Replace a caller-authored static catalog without admitting it through the
 * provider-definition domain. Catalogs share the endpoint connection's public
 * ordering because an endpoint replacement also moves the model namespace. */
export interface UpdateProviderModelsRequest {
  models: ModelInfo[]
  expectedRevision?: number
}

/** Register a provider (the server mints the id). `config` is the write-only endpoint
 *  half — accepted here, verified by the registration probe, stored server-side, and
 *  never present on the `ModelProvider` reads. `kind:'session'` takes no config at all
 *  (there is nothing to dial): the server mints the rendezvous secret and answers with
 *  it exactly once. `secretHint`/`online` are server-stamped — ignored on a request. */
export type ProviderDefinitionFields = Pick<
  ModelProvider,
  'label' | 'modelFamily' | 'effortLevels' | 'plan' | 'authority'
>

/** The only durable public fields ordinary provider editing may change. */
export type ProviderDefinitionPatch = Partial<ProviderDefinitionFields>

/** User intent for one definition edit; the default flag is a separate
 * viewer-relative pointer but shares the editor's acknowledgement ceremony. */
export type ProviderDefinitionMutationPatch = ProviderDefinitionPatch & {
  isDefault?: boolean
}

export type CreateProviderRequest = Pick<
  ModelProvider,
  'label' | 'modelFamily' | 'effortLevels' | 'plan' | 'authority' | 'kind' | 'models'
> & {
  config?: ProviderEndpointConfig
  isDefault?: boolean
}

/** `POST /providers` (and `/providers/:id/rotate`) response: the registered provider,
 *  plus — for `kind:'session'` only — the rendezvous secret. It is returned only by
 *  the mint ceremony or an exact keyed recovery while the durable current receipt
 *  still represents it; ordinary reads expose only its hash-derived hint. */
export type CreatedProvider = ModelProvider & { secret?: string }

/** A keyed Session-secret ceremony freezes the connection revision it reviewed.
 * Omission retains the legacy unconditional rotation behavior for non-UI callers. */
export interface RotateProviderSecretRequest {
  expectedRevision?: number
}

/** Patch a provider's definition. All optional — only the named fields change.
 *  `isDefault: true` moves the viewer's default flag here (clearing any other entry's);
 *  `isDefault: false` clears it when this entry holds it — leaving the registry with
 *  no default, which is fine (the flag is a UI shortcut, not an invariant).
 *  `expectedRevision` is an optional compare-and-swap precondition; absence
 *  retains the explicit legacy unconditional-write meaning. */
export type UpdateProviderRequest = ProviderDefinitionMutationPatch & {
  expectedRevision?: number
}

/** The one entry a picker should pre-select for a registry list (providers, system
 *  prompts): the viewer's flagged default when one exists, else the first entry —
 *  a pure UI convenience shared by every "create an agent" surface (the dialog AND
 *  the conversational tool), so the two can't disagree. Undefined for an empty list.
 *  Deliberately NOT used by the API's write paths: a request that omits a binding is
 *  refused, never silently defaulted — missing bindings should surface as bugs at the
 *  call site, not as surprising resolutions later. */
export function defaultEntry<T extends { isDefault?: boolean }>(list: readonly T[]): T | undefined {
  return list.find((e) => e.isDefault) ?? list[0]
}
