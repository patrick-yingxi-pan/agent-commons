import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { deriveServerSecret, parseCookies, SESSION_COOKIE, verifySession } from '../auth.ts'
import type { Ctx } from '../http/respond.ts'
import { headerValue, sendJson } from '../http/respond.ts'
import { fail, PartnerRegistryError } from './protocol.ts'
import type { PartnerActor } from './registry.ts'
import type { PartnerEnvironment } from '../../contract/taskPartners.ts'
import type { Identity } from '../../contract/identity.ts'
import type { WorkActor } from './taskTerms.ts'

export function environmentOf(value: unknown): PartnerEnvironment {
  if (value === 'sandbox' || value === 'production') return value
  return fail(404, 'not_found', 'Unknown task partner environment.')
}

export function partnerActor(req: IncomingMessage, who: Identity): PartnerActor & WorkActor {
  if (who.via !== 'session') return fail(401, 'unauthorized', 'Sign in to use task partners.')
  const claims = verifySession(parseCookies(headerValue(req.headers, 'cookie'))[SESSION_COOKIE]) ??
    verifySession(/^Bearer (.+)$/i.exec(headerValue(req.headers, 'authorization') ?? '')?.[1])
  const authTime = claims?.authenticatedAt
  const freshAuth = !!claims && claims.userId === who.user.id && claims.tenantId === who.tenant.id &&
    who.via === 'session' && typeof authTime === 'number' && authTime <= Date.now() && Date.now() - authTime < 5 * 60_000
  const member = (name: string) => (process.env[name] ?? '').split(',').some(id => id.trim() === who.user.id)
  const incident = member('TASK_PARTNER_INCIDENT_OPERATORS')
  const settlement = member('TASK_PARTNER_SETTLEMENT_OPERATORS')
  return { userId: who.user.id, tenantId: who.tenant.id, operator: !!who.instanceAdmin,
    organizationAdmin: who.role === 'owner' || who.role === 'admin', freshAuth,
    ...(who.instanceAdmin && incident !== settlement ? { recoveryRole: incident ? 'incident' : 'settlement' } : {}) }
}

export async function respond(ctx: Ctx, status: number, run: () => unknown | Promise<unknown>) {
  ctx.res.setHeader('Cache-Control', 'no-store')
  try {
    const result = await run()
    if (!ctx.res.writableEnded) sendJson(ctx.res, result, status)
  } catch (e) {
    if (!(e instanceof PartnerRegistryError)) throw e
    const code: Record<number, string> = { 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found',
      409: 'conflict', 410: 'gone', 413: 'bad_request', 415: 'bad_request', 422: 'bad_request', 429: 'limit_exceeded', 503: 'capability_unavailable' }
    if (e.status === 429 || e.status === 503) ctx.res.setHeader('Retry-After', '30')
    sendJson(ctx.res, { error: { code: code[e.status] ?? 'internal', reason: e.code, message: e.message,
      requestId: String(ctx.res.getHeader?.('X-Request-Id') ?? 'partner-request') } }, e.status)
  }
}
export async function jsonInput(ctx: Ctx) {
  try { return await ctx.body<unknown>({ maxBytes: 262144 }) }
  catch { return fail(400, 'bad_request', 'Supply a valid JSON request within 256 KiB.') }
}
export function requestKey(req: IncomingMessage) {
  const key = req.headers['idempotency-key']
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) return fail(400, 'bad_request', 'Supply a 16–128 character Idempotency-Key for this change.')
  return key
}
export function bearer(req: IncomingMessage): string {
  const token = /^Bearer ([A-Za-z0-9._-]+)$/i.exec(headerValue(req.headers, 'authorization') ?? '')?.[1]
  if (!token) return fail(401, 'unauthorized', 'A scoped partner credential is required.')
  return token
}

export function listPage<T>(url: URL, actorScope: string, rows: T[], sortKey: (row: T) => string, filters: readonly string[] = []) {
  const params = url.searchParams
  for (const key of params.keys()) {
    if (!['limit', 'cursor', ...filters].includes(key) || params.getAll(key).length !== 1) return fail(400, 'bad_request', 'Unrecognized or repeated list parameter.')
  }
  const limit = params.get('limit') ?? '50'
  if (!/^(?:[1-9][0-9]?|100)$/.test(limit)) return fail(400, 'bad_request', 'Choose a page size from 1 to 100.')
  const scope = JSON.stringify([actorScope, url.pathname, filters.map(k => [k, params.get(k)])])
  const sign = (value: string) => deriveServerSecret('partner-list-cursor-v1', scope + '\n' + value).toString('base64url')
  let after = ''
  const cursor = params.get('cursor')
  if (cursor !== null) {
    const parts = /^([A-Za-z0-9_-]{1,900})\.([A-Za-z0-9_-]{43})$/.exec(cursor)
    if (!parts || !timingSafeEqual(Buffer.from(sign(parts[1]!)), Buffer.from(parts[2]!))) return fail(400, 'bad_request', 'Restart this list with its original filters.')
    after = Buffer.from(parts[1]!, 'base64url').toString('utf8')
  }
  const entries = rows.map(row => ({ row, key: sortKey(row) })).filter(item => item.key > after)
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  const page = entries.slice(0, Number(limit))
  const last = page.at(-1)
  const next = last && entries.length > page.length ? Buffer.from(last.key).toString('base64url') : undefined
  return { items: page.map(p => p.row), ...(next ? { nextCursor: next + '.' + sign(next) } : {}) }
}
