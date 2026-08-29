/** ── Verified sessions (multi-account P6 — the production identity seam) ─────
 *  Replaces client-asserted identity with a SERVER-ISSUED credential: `POST
 *  /v1/auth/session` validates a pick against the identity directory and sets an
 *  HttpOnly cookie carrying an HMAC-signed token; `server/identity.ts` resolves
 *  the cookie FIRST, and the legacy header/query seam survives only while
 *  `IDENTITY_HEADERS` allows it (dev/tests; a production deployment sets
 *  `IDENTITY_HEADERS=deny` and client-asserted identity is refused outright).
 *
 *  Why a cookie (not a bearer header): it rides automatically on every transport
 *  the client uses — fetch, `EventSource` (which cannot set headers), and `<img>`
 *  byte fetches — closing the two asymmetries the header seam had. HttpOnly keeps
 *  it out of script reach; SameSite=Lax bounds cross-site sends; the hosted
 *  profile also requires Secure so the credential never rides plain HTTP.
 *
 *  The token is claims + HMAC, not an encrypted JWT: the claims aren't secret
 *  (userId/tenantId), only UNFORGEABLE. In a real deployment the IdP's verified
 *  token replaces `signSession` and this module shrinks to `verifySession` over
 *  the IdP's public key — the resolution order in identity.ts is the part that
 *  carries over unchanged. */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** The signing secret. A real deployment MUST set `AUTH_SECRET`; the dev default
 *  keeps `npm run dev` zero-config (and is obviously non-secret by its name). */
const SECRET = process.env.AUTH_SECRET || 'dev-only-secret-do-not-deploy'

/** The production posture must not run on the KNOWN dev secret: with
 *  `IDENTITY_HEADERS=deny` the cookie is the only identity input, so a
 *  forgeable cookie would be authentication theater. Refuse to boot instead —
 *  a loud crash at deploy time beats a silent hole. (Exported so tests can
 *  lock the rule without spawning a process.) */
export function assertAuthConfig(env: Record<string, string | undefined> = process.env): void {
  if (env.IDENTITY_HEADERS === 'deny' && !env.AUTH_SECRET) {
    throw new Error(
      'IDENTITY_HEADERS=deny (the production posture) requires AUTH_SECRET — refusing to run on the dev signing secret.',
    )
  }
}
assertAuthConfig()

export const SESSION_COOKIE = 'uw_session'

/** Session lifetime (seconds). Long enough for a demo day; short enough that a
 *  leaked dev token ages out. Production tunes via env. */
const MAX_AGE_S = (() => {
  const n = Number(process.env.AUTH_SESSION_TTL_S)
  return Number.isFinite(n) && n > 0 ? n : 7 * 24 * 3600
})()

export interface SessionClaims {
  userId: string
  tenantId: string
  /** Issued-at (epoch ms) — lets `verifySession` expire old tokens. */
  iat: number
  /** Token REGISTRY id (JWT's `jti`), stamped on bearer mints: a jti-carrying
   *  token is valid only while its registry row exists (revocation authority —
   *  server/accounts.ts; checked in identity resolution, not here, so this
   *  module stays a pure-crypto leaf). Cookie sessions carry none. */
  jti?: string
}

const b64url = (buf: Buffer) => buf.toString('base64url')

function mac(payload: string): Buffer {
  return createHmac('sha256', SECRET).update(payload).digest()
}

/** claims → `base64url(json).base64url(hmac)` */
export function signSession(claims: SessionClaims): string {
  const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'))
  return `${payload}.${b64url(mac(payload))}`
}

/** Verify + decode a token. Null on ANY defect — bad shape, bad signature
 *  (constant-time compare), malformed claims, or expiry. Never throws. */
export function verifySession(token: string | undefined): SessionClaims | null {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  let given: Buffer
  try {
    given = Buffer.from(token.slice(dot + 1), 'base64url')
  } catch {
    return null
  }
  const expected = mac(payload)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims
    if (typeof claims.userId !== 'string' || typeof claims.tenantId !== 'string' || typeof claims.iat !== 'number') return null
    if (claims.jti !== undefined && typeof claims.jti !== 'string') return null
    if (Date.now() - claims.iat > MAX_AGE_S * 1000) return null
    return claims
  } catch {
    return null
  }
}

/** Parse a request's `Cookie` header (name=value; …) — only what we need. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return out
}

const secureCookie = (): string => (process.env.AUTH_COOKIE_SECURE === 'on' ? '; Secure' : '')

/** The `Set-Cookie` value that installs a session. HttpOnly (no script access),
 *  SameSite=Lax (rides same-site navigations + all same-origin requests, not
 *  cross-site POSTs), Path=/. The web profile adds `Secure`; dev and the
 *  loopback-HTTP desktop profile intentionally omit it. */
export function sessionSetCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secureCookie()}`
}

/** The `Set-Cookie` value that signs out (expires the cookie immediately). */
export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie()}`
}

/* ── The account stack (multi-account §12 — GitHub-style multi-account) ───────
 * A SECOND signed HttpOnly cookie remembering every account that signed in on
 * this browser, so the workspace switcher can hop between them instantly (a
 * stack pick re-mints the ACTIVE session without a credential). Same trust
 * construction as the session cookie — HMAC over public claims, per-entry
 * expiry — and the registry stays the authority: a stack entry only ever mints
 * what `accounts.identityFor` still resolves. Entries record the LAST-ACTIVE
 * tenant so switching back lands where you left off. */

export const STACK_COOKIE = 'uw_accounts'

/** SIGN-IN ORDER, stable: the list reads oldest sign-in first and NEVER
 *  reorders on activity — switching accounts must not shuffle the menu under
 *  the user's pointer. Bounded so a hostile client can't grow the cookie past
 *  header limits. */
export const STACK_MAX = 8

export interface StackEntry {
  userId: string
  /** The account's last-active tenant — where a switch back to it lands. */
  tenantId: string
  /** Issued/refreshed-at (epoch ms); entries age out on the session TTL. */
  iat: number
}

/** entries → `base64url(json).base64url(hmac)` (same envelope as the session). */
export function signStack(entries: StackEntry[]): string {
  const payload = b64url(Buffer.from(JSON.stringify(entries), 'utf8'))
  return `${payload}.${b64url(mac(payload))}`
}

/** Verify + decode the stack. `[]` on ANY defect (bad shape, bad signature) —
 *  a broken stack degrades to "no remembered accounts", never to a guess.
 *  Individually expired entries are dropped, valid siblings kept. */
export function verifyStack(token: string | undefined): StackEntry[] {
  if (!token) return []
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return []
  const payload = token.slice(0, dot)
  let given: Buffer
  try {
    given = Buffer.from(token.slice(dot + 1), 'base64url')
  } catch {
    return []
  }
  const expected = mac(payload)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return []
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is StackEntry =>
        !!e &&
        typeof e.userId === 'string' &&
        typeof e.tenantId === 'string' &&
        typeof e.iat === 'number' &&
        Date.now() - e.iat <= MAX_AGE_S * 1000,
    )
  } catch {
    return []
  }
}

/** The stack with `entry` merged in, SIGN-IN ORDER preserved: an account
 *  already remembered is refreshed IN PLACE (new last-active tenant, fresh
 *  iat) — a switch or re-sign-in never moves its row; a NEW account appends at
 *  the END. The cap evicts the OLDEST sign-in (the front). */
export function stackWith(entries: StackEntry[], entry: StackEntry): StackEntry[] {
  const i = entries.findIndex((e) => e.userId === entry.userId)
  if (i >= 0) return entries.map((e, j) => (j === i ? entry : e))
  return [...entries, entry].slice(-STACK_MAX)
}

/** The stack without `userId`'s entry (that account signed out here). */
export function stackWithout(entries: StackEntry[], userId: string): StackEntry[] {
  return entries.filter((e) => e.userId !== userId)
}

/** `Set-Cookie` for the stack — same posture as the session cookie. */
export function stackSetCookie(entries: StackEntry[]): string {
  if (entries.length === 0) return stackClearCookie()
  return `${STACK_COOKIE}=${signStack(entries)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secureCookie()}`
}

export function stackClearCookie(): string {
  return `${STACK_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie()}`
}

/** Whether the legacy client-asserted identity seam (x-user-id/x-tenant-id
 *  headers, /events query params) is honoured. Default: allowed (dev, tests, the
 *  co-authoring E2E's per-context headers). `IDENTITY_HEADERS=deny` is the
 *  production posture: the signed cookie is then the ONLY identity input. Read
 *  per call so tests can toggle it without module-reload gymnastics. */
export function identityHeadersAllowed(): boolean {
  return process.env.IDENTITY_HEADERS !== 'deny'
}
