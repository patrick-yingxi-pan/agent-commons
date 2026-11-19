import { randomBytes } from 'node:crypto'
import type { PartnerEnvironment, PartnerPublicKey } from '../../contract/taskPartners.ts'
import { fail, fields, identifier, sha256, verifiedJws } from './protocol.ts'

const scopes = ['commands:read','receipts:write','artifacts:read','artifacts:write','handoffs:write','domains:renew'] as const
interface WorkerToken {
  hash: string; partnerId: string; kid: string; environment: PartnerEnvironment
  audience: string; scopes: string[]; expires: number
}
interface WorkerSnapshot { assertions: [string, number][]; tokens: WorkerToken[] }
const rejected = (): never => fail(401, 'invalid_client', 'Partner credentials were rejected.')
export class PartnerWorkerTokens {
  private assertions = new Map<string, number>()
  private tokens = new Map<string, WorkerToken>()
  snapshot(): WorkerSnapshot {
    return { assertions: [...this.assertions.entries()], tokens: [...this.tokens.values()].map(t => ({...t, scopes: [...t.scopes]})) }
  }
  restore(snapshot?: WorkerSnapshot, belongs?: (env: PartnerEnvironment, partnerId: string, kid: string) => boolean) {
    if (snapshot && (!Array.isArray(snapshot.assertions) || !Array.isArray(snapshot.tokens) ||
        snapshot.tokens.length > 20000 || snapshot.assertions.length > 20000)) throw new Error('Invalid persisted partner token state.')
    const assertions = new Map(snapshot?.assertions), tokens = new Map<string, WorkerToken>()
    if (snapshot && assertions.size !== snapshot.assertions.length) throw new Error('Duplicate partner assertion.')
    for (const [key, expiry] of assertions) {
      const parts: unknown = JSON.parse(key)
      if (!Array.isArray(parts) || parts.length !== 3 || !['production','sandbox'].includes(parts[0]) ||
          !parts.slice(1).every(p=>typeof p==='string' && identifier.test(p)) || !Number.isSafeInteger(expiry) || expiry<0)
        throw new Error('Invalid partner assertion.')
    }
    for (const token of snapshot?.tokens ?? []) {
      if (!/^[0-9a-f]{64}$/.test(token.hash) || tokens.has(token.hash) || !['production','sandbox'].includes(token.environment) ||
          !identifier.test(token.partnerId) || !identifier.test(token.kid) || !Array.isArray(token.scopes) || !token.scopes.length ||
          new Set(token.scopes).size !== token.scopes.length || !token.scopes.every(s => scopes.some(known => known === s)) ||
          !Number.isSafeInteger(token.expires) || token.expires<0 || belongs && !belongs(token.environment,token.partnerId,token.kid))
        throw new Error('Invalid partner token.')
      // A prior-format token has no deployment identity. Its holder can
      // obtain a new one by authenticating with the current site's audience.
      if (token.audience === undefined) continue
      const origin=new URL(token.audience)
      if (origin.protocol!=='https:' || token.audience!==origin.origin+'/v1/task-partners') throw new Error('Invalid partner token audience.')
      tokens.set(token.hash, structuredClone(token))
    }
    this.assertions = assertions
    this.tokens = tokens
  }
  invalidatePartner(partnerId:string) {
    for (const [hash,token] of this.tokens) if (token.partnerId===partnerId) this.tokens.delete(hash)
  }
  issue(env: PartnerEnvironment, raw: unknown, audience: string, now: number,
    keys: (id: string, kid: string) => PartnerPublicKey | undefined,
    allow: (id: string, scopes: string[]) => void) {
    const body = fields(raw, ['grant_type','client_id','client_assertion_type','client_assertion','scope'])
    if (body.grant_type !== 'client_credentials' ||
        body.client_assertion_type !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer' ||
        typeof body.client_id !== 'string' || !identifier.test(body.client_id)) return rejected()
    const partnerId = body.client_id
    if (typeof body.scope !== 'string' || !body.scope || body.scope.length > 256) fail(400, 'invalid_scope', 'Select valid worker scopes.')
    const requested = body.scope.split(' ')
    if (new Set(requested).size !== requested.length || !requested.every(s => scopes.some(known => known === s)))
      fail(400, 'invalid_scope', 'Select valid worker scopes.')
    const { kid, claims } = verifiedJws(body.client_assertion, 'partner-client-auth+jwt', k => keys(partnerId, k))
    fields(claims, ['iss','aud','jti','iat','sub','exp'])
    const seconds = Math.floor(now / 1000), { iat, exp, jti } = claims
    if (claims.iss !== partnerId || claims.sub !== partnerId || claims.aud !== audience + '/oauth/token' ||
        typeof iat !== 'number' || !Number.isSafeInteger(iat) || iat > seconds + 60 ||
        typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp <= seconds || exp <= iat || exp - iat > 300 ||
        typeof jti !== 'string' || !identifier.test(jti)) return rejected()
    allow(partnerId, requested)
    for (const [hash, t] of this.tokens) if (t.expires <= now) this.tokens.delete(hash)
    for (const [key, until] of this.assertions) if (until <= now) this.assertions.delete(key)
    const binding = JSON.stringify([env,partnerId,jti])
    if (this.assertions.has(binding)) return rejected()
    if (this.tokens.size >= 20_000 || this.assertions.size >= 20_000) fail(429, 'capacity', 'Worker token capacity reached.')
    const token = 'acp_' + randomBytes(32).toString('base64url'), hash = sha256(token)
    this.assertions.set(binding, exp * 1000)
    this.tokens.set(hash, { hash, partnerId, kid, environment: env, audience, scopes: requested, expires: now + 300_000 })
    return { access_token: token, token_type: 'Bearer' as const, expires_in: 300, scope: requested.join(' ') }
  }
  authorize(env: PartnerEnvironment, audience: string, token: string, scope: string, now: number) {
    if (typeof token !== 'string' || !/^acp_[A-Za-z0-9_-]{43}$/.test(token)) return rejected()
    const grant = this.tokens.get(sha256(token))
    if (!grant || grant.environment !== env || grant.audience !== audience || grant.expires <= now) return rejected()
    if (!grant.scopes.includes(scope)) return fail(403, 'insufficient_scope', 'The worker is missing the required scope.')
    return grant
  }
}
