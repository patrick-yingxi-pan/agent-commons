/** Bounded pre-response retries for the native Responses transport. The caller
 * supplies the retry budget and one signal for the whole operation; successful
 * response bodies are handed off exactly once and are never replayed here. */
const MAX_ERROR_BYTES = 16 * 1024
const MAX_RETRY_DELAY_MS = 60_000
const QUOTA_CODES = new Set([
  'insufficient_quota', 'credit_balance_exhausted', 'billing_hard_limit_reached',
  'billing_not_active', 'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded', 'organization_usage_limit_exceeded',
])

export class EndpointHttpError extends Error {
  readonly status: number
  readonly quotaExceeded: boolean
  readonly retryWaitUnfulfilled: boolean
  constructor(status: number, details: { quotaExceeded?: boolean; retryWaitUnfulfilled?: boolean } = {}) {
    // Never retain provider bodies, private URLs or credentials in diagnostics.
    super(`The model endpoint returned HTTP ${status}.`)
    this.status = status
    this.quotaExceeded = details.quotaExceeded === true
    this.retryWaitUnfulfilled = details.retryWaitUnfulfilled === true
  }
}

/** Preserve cancellation semantics while preventing an outer workflow from
 * bypassing a server minimum when this operation's deadline expires. */
export class EndpointRetryWaitError extends DOMException {
  constructor(signal: AbortSignal) {
    super('The model endpoint retry wait was aborted.',
      signal.reason?.name === 'TimeoutError' ? 'TimeoutError' : 'AbortError')
  }
}

function aborted(signal: AbortSignal): Error {
  return new DOMException('The model endpoint request was aborted.',
    signal.reason?.name === 'TimeoutError' ? 'TimeoutError' : 'AbortError')
}

/** Unlike a per-attempt timeout, this listener always observes the same caller
 * deadline, including backoff and bounded error-body inspection/cleanup. */
async function withinSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let stop = () => {}
  const abort = new Promise<never>((_, reject) => {
    stop = () => reject(aborted(signal))
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
  })
  try { return await Promise.race([promise, abort]) }
  finally { signal.removeEventListener('abort', stop) }
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { await withinSignal(new Promise<void>(resolve => { timer = setTimeout(resolve, ms) }), signal) }
  finally { clearTimeout(timer) }
}

function numericDelay(value: string | null, scale: number): number | undefined {
  if (value === null || !/^\d+(?:\.\d+)?$/.test(value.trim())) return
  // Infinity is an excessive valid numeric hint, never permission to retry early.
  return Number(value) * scale
}

function retryMinimum(headers: Headers): number | undefined {
  const raw = headers?.get('retry-after')?.trim() ?? null
  let seconds = numericDelay(raw, 1000)
  if (seconds === undefined && raw && /^[A-Za-z]{3,9}[, ]/.test(raw)) {
    const date = Date.parse(raw)
    if (Number.isFinite(date)) seconds = Math.max(0, date - Date.now())
  }
  const millis = numericDelay(headers?.get('retry-after-ms') ?? null, 1)
  return seconds === undefined ? millis : millis === undefined ? seconds : Math.max(seconds, millis)
}

function retryDelay(hint: number | undefined, attempt: number): number | undefined {
  if (hint !== undefined) {
    if (hint > MAX_RETRY_DELAY_MS) return
    return Math.ceil(Math.min(MAX_RETRY_DELAY_MS, hint + Math.random() * 100))
  }
  return Math.ceil(Math.min(500 * 2 ** Math.min(attempt, 4), 8000) * (0.75 + Math.random() * 0.25))
}

/** Classify only bounded 429 JSON. Opaque or oversized bodies stop transport
 * retries conservatively; their bytes and diagnostics never escape this scope. */
async function quotaKind(response: Response, signal: AbortSignal): Promise<'quota' | 'other' | 'unreadable'> {
  if (!response.body) return 'other'
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0, text = ''
  try {
    for (;;) {
      const { value, done } = await withinSignal(reader.read(), signal)
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_ERROR_BYTES) return 'unreadable'
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    if (!text.trim()) return 'other'
    const payload: unknown = JSON.parse(text)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'unreadable'
    const error = (payload as Record<string, unknown>).error
    if (!error || typeof error !== 'object' || Array.isArray(error)) return 'unreadable'
    const { code, type } = error as Record<string, unknown>
    return [code, type].some(value => typeof value === 'string' && QUOTA_CODES.has(value)) ? 'quota' : 'other'
  } catch {
    if (signal.aborted) throw aborted(signal)
    return 'unreadable'
  } finally {
    const cancelled = reader.cancel().catch(() => {})
    try { if (!signal.aborted) await withinSignal(cancelled, signal) }
    finally { reader.releaseLock() }
  }
}

export async function fetchOpenAIWithRetry(
  url: string,
  init: RequestInit & { signal: AbortSignal },
  fetcher: typeof fetch,
  maxRetries: number,
): Promise<Response> {
  const { signal } = init
  if (signal.aborted) throw aborted(signal)
  // Reject deterministic URL/header validation failures before the retry loop.
  // fetch's own TypeError can include credentials, so keep diagnostics static.
  try {
    const target = new URL(url)
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error()
    init = { ...init, headers: new Headers(init.headers) }
  } catch { throw new Error('The model endpoint request failed.') }
  const retries = Number.isSafeInteger(maxRetries) && maxRetries >= 0 ? maxRetries : 0
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw aborted(signal)
    let response: Response
    try { response = await fetcher(url, init) }
    catch {
      if (signal.aborted) throw aborted(signal)
      if (attempt >= retries) throw new Error('The model endpoint request failed.')
      await wait(retryDelay(undefined, attempt)!, signal)
      continue
    }
    if (response.ok) return response
    const minimum = retryMinimum(response.headers)
    try {
      const kind = response.status === 429 ? await quotaKind(response, signal) : 'other'
      if (response.status !== 429) await withinSignal(response.body?.cancel().catch(() => {}) ?? Promise.resolve(), signal)
      const retryable = kind === 'other' && response.headers.get('x-should-retry') !== 'false'
        && ([408, 409, 429].includes(response.status) || response.status >= 500)
      const delay = retryDelay(minimum, attempt)
      if (!retryable || attempt >= retries || delay === undefined) {
        throw new EndpointHttpError(response.status, {
          quotaExceeded: kind === 'quota', retryWaitUnfulfilled: (minimum ?? 0) > 0,
        })
      }
      await wait(delay, signal)
    } catch (error) {
      // This is deliberately conservative even if body inspection consumed part
      // of the wait: a Routine must not restart on its shorter generic backoff.
      if (signal.aborted && (minimum ?? 0) > 0) throw new EndpointRetryWaitError(signal)
      throw error
    }
  }
}
