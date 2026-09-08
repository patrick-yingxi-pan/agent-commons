/** ── The API client transport ──────────────────────────────────────────────
 *  One thin wrapper over `fetch` for every request the UI makes. The base URL is
 *  resolved once: dev/web use the same-origin `/api/v1` (Vite proxies it to the
 *  mock server); a native host can override it with `VITE_API_BASE`. Nothing else
 *  in the UI knows a URL — swap the backend by swapping this base. */
import { API_BASE_PATH, type ApiError } from '../../contract/index.ts'
import { activeAccount, accountGeneration, shouldDropResponse } from './account.ts'

/** Where the API lives. Same-origin by default (the Vite proxy / the production
 *  server both mount it at `/api/v1`); a packaged desktop app injects an absolute
 *  `http://127.0.0.1:<port>` via `VITE_API_BASE`. */
export const API_BASE: string =
  (import.meta.env?.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? API_BASE_PATH

/** An API call that failed — carries the contract error code so callers can
 *  branch (e.g. `capability_unavailable` → hide a native-only affordance). */
export class ApiRequestError extends Error {
  readonly code: ApiError['error']['code']
  readonly status: number

  constructor(
    code: ApiError['error']['code'],
    message: string,
    status: number,
  ) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.status = status
  }
}

/** A response abandoned because the active account changed while it was in
 *  flight, or the server's identity echo mismatched (multi-account §6.2,
 *  invariant I5). Callers treat it as silent abandonment, never as data. */
export class AccountSwitchedError extends Error {
  constructor(reason: string) {
    super(`response dropped: ${reason}`)
    this.name = 'AccountSwitchedError'
  }
}

export interface ApiMutationOptions {
  signal?: AbortSignal
  /** One key per logical mutation. A caller that retries after an uncertain
   * acknowledgement reuses it so an idempotent route can replay, not reapply. */
  idempotencyKey?: string
  /** Bind a first-party identity-sensitive request to the signed-in account
   * that initiated it. The server refuses a later cross-tab cookie change. */
  expectedSessionUserId?: string | null
}

async function request<T>(method: string, path: string, body?: unknown, options: ApiMutationOptions = {}): Promise<T> {
  // Staleness fence (multi-account §6.2): identity rides the session cookie
  // (P6 — the browser attaches it; nothing to inject here); the generation
  // captured HERE decides, after the await, whether the world this response
  // belongs to still exists.
  const acct = activeAccount()
  const issuedGen = accountGeneration()
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers:
        body !== undefined || options.idempotencyKey || options.expectedSessionUserId !== undefined
          ? {
              ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
              ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
              ...(options.expectedSessionUserId !== undefined
                ? { 'X-Account-Transition-Source': options.expectedSessionUserId === null ? 'unsigned' : `session:${options.expectedSessionUserId}` }
                : {}),
            }
          : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: options.signal,
    })
  } catch (err) {
    // Network / server-down — surface a uniform shape so the UI can show "offline".
    throw new ApiRequestError('internal', err instanceof Error ? err.message : 'Network error', 0)
  }
  // I5 tripwire: a response from the previous account's world, or one whose
  // server-resolved tenant disagrees with who we think we are, never reaches a
  // cache. Echo mismatch is a routing BUG — make it loud.
  const verdict = shouldDropResponse(issuedGen, accountGeneration(), acct, res.headers.get('x-resolved-tenant'))
  if (verdict.drop) {
    if (verdict.reason === 'echo-mismatch') {
      console.error(`[api] identity echo mismatch: acting as tenant '${acct?.tenantId}' but the server resolved '${res.headers.get('x-resolved-tenant')}' — response dropped`)
    }
    throw new AccountSwitchedError(verdict.reason ?? 'switched')
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const json = text ? JSON.parse(text) : undefined
  if (!res.ok) {
    const e = (json as ApiError | undefined)?.error
    throw new ApiRequestError(e?.code ?? 'internal', e?.message ?? res.statusText, res.status)
  }
  return json as T
}

export const apiGet = <T>(path: string, options?: ApiMutationOptions) => request<T>('GET', path, undefined, options)
export const apiPost = <T>(path: string, body?: unknown, options?: ApiMutationOptions) => request<T>('POST', path, body, options)
export const apiPatch = <T>(path: string, body?: unknown, options?: ApiMutationOptions) => request<T>('PATCH', path, body, options)
export const apiDelete = <T>(path: string, body?: unknown, options?: ApiMutationOptions) => request<T>('DELETE', path, body, options)

/** Absolute URL for a raw-bytes endpoint (a served image / binary), to use as an
 *  `<img src>` — the browser fetches it through the same proxy the API uses. Bytes
 *  can't go through `apiGet`, which JSON-parses the response. */
export const apiUrl = (path: string): string => `${API_BASE}${path}`
