/** ── The API client transport ──────────────────────────────────────────────
 *  One thin wrapper over `fetch` for every request the UI makes. The base URL is
 *  resolved once: dev/web use the same-origin `/api/v1` (Vite proxies it to the
 *  mock server); a native host can override it with `VITE_API_BASE`. Nothing else
 *  in the UI knows a URL — swap the backend by swapping this base. */
import { API_BASE_PATH, type ApiError } from '../../contract/index.ts'

/** Where the API lives. Same-origin by default (the Vite proxy / the production
 *  server both mount it at `/api/v1`); a packaged desktop app injects an absolute
 *  `http://127.0.0.1:<port>` via `VITE_API_BASE`. */
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? API_BASE_PATH

/** An API call that failed — carries the contract error code so callers can
 *  branch (e.g. `capability_unavailable` → hide a native-only affordance). */
export class ApiRequestError extends Error {
  constructor(
    readonly code: ApiError['error']['code'],
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    // Network / server-down — surface a uniform shape so the UI can show "offline".
    throw new ApiRequestError('internal', err instanceof Error ? err.message : 'Network error', 0)
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

export const apiGet = <T>(path: string) => request<T>('GET', path)
export const apiPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body)
export const apiPatch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body)
export const apiDelete = <T>(path: string, body?: unknown) => request<T>('DELETE', path, body)

/** Absolute URL for a raw-bytes endpoint (a served image / binary), to use as an
 *  `<img src>` — the browser fetches it through the same proxy the API uses. Bytes
 *  can't go through `apiGet`, which JSON-parses the response. */
export const apiUrl = (path: string): string => `${API_BASE}${path}`
