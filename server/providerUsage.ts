import { createHash } from 'node:crypto'
import type { ProviderBalance, ProviderBalanceAmount, ProviderRateLimit, ProviderRequestUsage, ProviderUsageSnapshot, UsageProvider } from '../contract/providerUsage.ts'
import { validApiKeyEnv, type ProviderConfig } from './data/providers.ts'

const CACHE_MS = 60_000
const DEADLINE_MS = 5_000
const BODY_BYTES = 16 * 1024
const MAX_ENTRIES = 256
const MAX_BALANCE_REQUESTS = 8

function endpoint(config: ProviderConfig): string {
  return config.baseURL ?? process.env.ANTHROPIC_BASE_URL ?? `http://127.0.0.1:${process.env.MODEL_PORT ?? 8788}`
}

function classify(config: ProviderConfig): UsageProvider {
  try {
    const url = new URL(endpoint(config))
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return 'other'
    const path = url.pathname.replace(/\/$/, '')
    const protocol = config.protocol ?? 'anthropic-messages'
    if (url.origin === 'https://api.deepseek.com' && path === '/anthropic' && protocol === 'anthropic-messages') return 'deepseek'
    if (url.origin === 'https://api.openai.com' && path === '/v1' && protocol === 'openai-responses') return 'openai'
    if (url.origin === 'https://api.anthropic.com' && path === '' && protocol === 'anthropic-messages') return 'anthropic'
  } catch { /* Unknown/custom endpoints have no provider-specific adapters. */ }
  return 'other'
}

function credential(config: ProviderConfig): string | undefined {
  if (!config.apiKeyEnv || !validApiKeyEnv(config.apiKeyEnv)) return undefined
  const value = process.env[config.apiKeyEnv]
  return value && value.trim() && !/[\r\n]/.test(value) ? value : undefined
}

function fingerprint(config: ProviderConfig, model: boolean): string {
  return createHash('sha256').update(JSON.stringify([
    config.usageIdentity?.tenantId, config.usageIdentity?.providerId, config.usageIdentity?.connectionRevision,
    config.usageIdentity?.epoch,
    config.kind, endpoint(config), config.protocol ?? 'anthropic-messages', config.apiKeyEnv,
    credential(config), ...(model ? [config.model] : []),
  ])).digest('hex')
}

/** Opaque private cache identity; never publish this or use it as authorization. */
export function providerUsageCacheKey(config: ProviderConfig): string {
  return fingerprint(config, true)
}

function usable(config: ProviderConfig, provider: UsageProvider): boolean {
  if (!config.usageIdentity || config.kind === 'session') return false
  if (config.apiKeyEnv || provider !== 'other') return !!credential(config)
  return !!config.baseURL
}

function count(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function duration(value: string | null, now: number): number | undefined {
  if (!value || value.length > 80) return undefined
  const pattern = /^(?:(\d+(?:\.\d+)?)d)?(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/
  const match = pattern.exec(value)
  if (!match || match[0] !== value || !match.slice(1).some(Boolean)) return undefined
  const milliseconds = Number(match[1] ?? 0) * 86400000 + Number(match[2] ?? 0) * 3600000 + Number(match[3] ?? 0) * 60000 + Number(match[4] ?? 0) * 1000 + Number(match[5] ?? 0)
  const result = now + milliseconds
  return Number.isFinite(result) && result >= 0 && result <= 8.64e15 ? result : undefined
}

function absolute(value: string | null): number | undefined {
  if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return undefined
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10))
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]! || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return undefined
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : undefined
}

function rates(provider: UsageProvider, headers: Headers, now: number): ProviderRateLimit[] {
  const result: ProviderRateLimit[] = []
  const keys: ProviderRateLimit['key'][] = provider === 'openai' ? ['requests', 'tokens', 'project-tokens']
    : provider === 'anthropic' ? ['requests', 'tokens', 'input-tokens', 'output-tokens'] : []
  for (const key of keys) {
    const field = (part: string) => provider === 'openai' ? `x-ratelimit-${part}-${key}` : `anthropic-ratelimit-${key}-${part}`
    const limit = count(headers.get(field('limit')))
    const remaining = count(headers.get(field('remaining')))
    if (limit === undefined || remaining === undefined || remaining > limit) continue
    const reset = headers.get(field('reset'))
    const resetAt = provider === 'openai' ? duration(reset, now) : absolute(reset)
    result.push({ key, limit, remaining, observedAt: now, ...(resetAt === undefined ? {} : { resetAt }) })
  }
  return result
}

class InvalidBalance extends Error {}

function parseBalance(value: unknown, now: number): ProviderBalance {
  if (!value || typeof value !== 'object') throw new InvalidBalance()
  const data = value as Record<string, unknown>
  if (typeof data.is_available !== 'boolean' || !Array.isArray(data.balance_infos) || data.balance_infos.length < 1 || data.balance_infos.length > 2) throw new InvalidBalance()
  const currencies = new Set<string>()
  const decimal = (value: unknown): string => {
    // Preserve finite decimal amounts exactly, including a reported negative
    // balance. Neither floating-point rounding nor currency conversion belongs here.
    if (typeof value !== 'string' || !/^-?\d{1,24}(?:\.\d{1,24})?$/.test(value)) throw new InvalidBalance()
    return value
  }
  const amounts: ProviderBalanceAmount[] = data.balance_infos.map((item: unknown): ProviderBalanceAmount => {
    if (!item || typeof item !== 'object') throw new InvalidBalance()
    const row = item as Record<string, unknown>
    if ((row.currency !== 'CNY' && row.currency !== 'USD') || currencies.has(row.currency)) throw new InvalidBalance()
    currencies.add(row.currency)
    return { currency: row.currency, total: decimal(row.total_balance), granted: decimal(row.granted_balance), toppedUp: decimal(row.topped_up_balance) }
  })
  return { status: 'available', observedAt: now, isAvailable: data.is_available, amounts }
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > BODY_BYTES)) {
    void response.body?.cancel().catch(() => {})
    throw new InvalidBalance()
  }
  if (!response.body) throw new InvalidBalance()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    for (;;) {
      if (signal.aborted) throw new Error('deadline')
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > BODY_BYTES) throw new InvalidBalance()
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
    catch { throw new InvalidBalance() }
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel()
  }
}

type Entry = { kind: 'observation'; rateLimits: ProviderRateLimit[]; lastRequest?: ProviderRequestUsage }
  | { kind: 'balance'; balance: ProviderBalance; checkedAt: number; pending?: Promise<void> }

export class ProviderUsageRegistry {
  #entries = new Map<string, Entry>()
  // Independent of cache lifetime: a store restore can clear observations while
  // earlier requests are still settling under their bounded deadline.
  #activeBalanceReads = 0
  #now: () => number
  #fetch: typeof fetch

  constructor(options: { now?: () => number; fetch?: typeof fetch } = {}) {
    this.#now = options.now ?? Date.now
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  #put(key: string, entry: Entry): void {
    this.#entries.delete(key)
    this.#entries.set(key, entry)
    // An in-flight read owns its coalescing slot until settlement. Observation
    // churn must not evict it and allow a second request for the same connection.
    while (this.#entries.size > MAX_ENTRIES) {
      const oldest = [...this.#entries].find(([, value]) => value.kind !== 'balance' || !value.pending)
      if (!oldest) break
      this.#entries.delete(oldest[0])
    }
  }

  observeHeaders(config: ProviderConfig, headers: Headers, captureKey?: string): void {
    if (captureKey !== undefined && captureKey !== providerUsageCacheKey(config)) return
    const provider = classify(config)
    if (!usable(config, provider) || !config.model) return
    const key = `request:${providerUsageCacheKey(config)}`
    const previous = this.#entries.get(key)
    this.#put(key, { kind: 'observation', rateLimits: rates(provider, headers, this.#now()), ...(previous?.kind === 'observation' && previous.lastRequest ? { lastRequest: previous.lastRequest } : {}) })
  }

  observeUsage(config: ProviderConfig, usage: { inputTokens: number; outputTokens: number }, captureKey?: string): void {
    if (captureKey !== undefined && captureKey !== providerUsageCacheKey(config)) return
    if (!usable(config, classify(config)) || !config.model || ![usage.inputTokens, usage.outputTokens, usage.inputTokens + usage.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) return
    const key = `request:${providerUsageCacheKey(config)}`
    const previous = this.#entries.get(key)
    this.#put(key, { kind: 'observation', rateLimits: previous?.kind === 'observation' ? previous.rateLimits : [], lastRequest: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, observedAt: this.#now() } })
  }

  snapshot(config: ProviderConfig): ProviderUsageSnapshot {
    const provider = classify(config)
    const availability = config.kind === 'session' ? 'unsupported' : !config.usageIdentity ? 'shared' : usable(config, provider) ? 'available' : 'unconfigured'
    const observation = availability === 'available' ? this.#entries.get(`request:${providerUsageCacheKey(config)}`) : undefined
    const cached = availability === 'available' ? this.#entries.get(`balance:${fingerprint(config, false)}`) : undefined
    return structuredClone({ providerId: config.usageIdentity?.providerId ?? '', ...(config.model ? { modelId: config.model } : {}), provider, availability,
      ...(observation?.kind === 'observation' && observation.lastRequest ? { lastRequest: observation.lastRequest } : {}),
      rateLimits: observation?.kind === 'observation' ? observation.rateLimits : [],
      balance: provider === 'deepseek' && availability === 'available' ? cached?.kind === 'balance' ? cached.balance : { status: 'not-requested' } : { status: 'unsupported' },
    })
  }

  async refreshBalance(config: ProviderConfig): Promise<ProviderUsageSnapshot> {
    if (classify(config) !== 'deepseek' || !usable(config, 'deepseek')) return this.snapshot(config)
    const key = `balance:${fingerprint(config, false)}`
    const previous = this.#entries.get(key)
    if (previous?.kind === 'balance') {
      if (previous.pending) { await previous.pending; return this.snapshot(config) }
      if (this.#now() - previous.checkedAt < CACHE_MS) return this.snapshot(config)
    }
    if (this.#activeBalanceReads >= MAX_BALANCE_REQUESTS) {
      const checkedAt = this.#now()
      this.#put(key, { kind: 'balance', checkedAt, balance: { status: 'error', checkedAt, reason: 'unavailable' } })
      return this.snapshot(config)
    }
    const entry: Extract<Entry, { kind: 'balance' }> = { kind: 'balance', balance: { status: 'not-requested' }, checkedAt: this.#now() }
    this.#put(key, entry)
    this.#activeBalanceReads++
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('deadline')) }, DEADLINE_MS) })
    const request = async (): Promise<ProviderBalance> => {
      const response = await this.#fetch('https://api.deepseek.com/user/balance', { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${credential(config)!}` }, redirect: 'error', signal: controller.signal })
      if (!response.ok) {
        void response.body?.cancel().catch(() => {})
        return { status: 'error', checkedAt: this.#now(), reason: response.status === 401 || response.status === 403 ? 'authentication' : response.status === 429 ? 'rate-limited' : 'unavailable' }
      }
      return parseBalance(await boundedJson(response, controller.signal), this.#now())
    }
    entry.pending = (async () => {
      let result: ProviderBalance
      try { result = await Promise.race([request(), deadline]) }
      catch (error) { result = { status: 'error', checkedAt: this.#now(), reason: error instanceof InvalidBalance ? 'invalid-response' : 'unavailable' } }
      finally { clearTimeout(timer!); this.#activeBalanceReads-- }
      if (this.#entries.get(key) === entry) { entry.balance = result; entry.checkedAt = this.#now(); delete entry.pending }
    })()
    await entry.pending
    return this.snapshot(config)
  }

  clear(): void { this.#entries.clear() }
}

export const providerUsage = new ProviderUsageRegistry()
