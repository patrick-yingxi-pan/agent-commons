/** Provider observations are private, transient readings, never a billing ledger.
 * No endpoint, credential, upstream body or upstream diagnostic crosses this wire. */
export type UsageProvider = 'deepseek' | 'openai' | 'anthropic' | 'other'

export interface ProviderRateLimit {
  key: 'requests' | 'tokens' | 'input-tokens' | 'output-tokens' | 'project-tokens'
  limit: number
  remaining: number
  observedAt: number
  /** Absolute milliseconds, normalized from the provider's reset representation. */
  resetAt?: number
}

export interface ProviderRequestUsage {
  inputTokens: number
  outputTokens: number
  observedAt: number
}

export interface ProviderBalanceAmount {
  currency: 'CNY' | 'USD'
  /** Provider decimal strings, preserved without floating-point conversion. */
  total: string
  granted: string
  toppedUp: string
}

export type ProviderBalance =
  | { status: 'unsupported' | 'not-requested' }
  | { status: 'available'; observedAt: number; isAvailable: boolean; amounts: ProviderBalanceAmount[] }
  | { status: 'error'; checkedAt: number; reason: 'authentication' | 'rate-limited' | 'unavailable' | 'invalid-response' }

export interface ProviderUsageSnapshot {
  providerId: string
  /** The exact requested model; absence means no concrete model is selected. */
  modelId?: string
  provider: UsageProvider
  availability: 'available' | 'unconfigured' | 'shared' | 'unsupported'
  /** Latest completed observed request for this connection and model, not the
   * whole conversation, account history, or all applications using the key. */
  lastRequest?: ProviderRequestUsage
  /** Empty means no valid headers have been observed, never zero allowance. */
  rateLimits: ProviderRateLimit[]
  balance: ProviderBalance
}
