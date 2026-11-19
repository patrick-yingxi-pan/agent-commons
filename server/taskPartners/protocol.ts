import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'
import type { PartnerCatalog, PartnerPublicKey } from '../../contract/taskPartners.ts'

export class PartnerRegistryError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new PartnerRegistryError(status, code, message)
}
export const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
export const id = (prefix: string) => prefix + '-' + randomBytes(16).toString('hex')
export const iso = (ms: number) => new Date(ms).toISOString()
export const day = 86_400_000
export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export function catalogDigest(catalog: PartnerCatalog) {
  // Keep catalog ordering independent of the originating JSON implementation.
  return sha256(JSON.stringify({
    models: catalog.models.map(m => [m.model, [...m.efforts].sort()]).sort(),
    assets: catalog.assets.map(a => [a.assetId, a.unit]).sort(),
    rules: catalog.rules.map(r => [r.ruleId, r.version, r.digest]).sort(),
  }))
}
export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(400, 'bad_request', 'Supply a JSON object.')
  return value as Record<string, unknown>
}
export function fields(value: unknown, required: string[], optional: string[] = []) {
  const input = record(value)
  if (!required.every(key => Object.hasOwn(input, key)) ||
      !Object.keys(input).every(key => required.includes(key) || optional.includes(key)))
    fail(400, 'bad_request', 'Check required fields and remove unrecognized fields.')
  return input
}
export function label(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || [...value].length > max ||
      /[\p{Cc}\p{Cs}\p{Bidi_Control}\p{Zl}\p{Zp}]/u.test(value)) fail(400, 'bad_request', 'Check the ' + field + '.')
  return value
}
export function tokenId(value: unknown): string {
  if (typeof value !== 'string' || !identifier.test(value)) return fail(400, 'bad_request', 'An identifier is invalid.')
  return value
}
export function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2_147_483_647)
    return fail(400, 'bad_request', 'Supply a positive integer revision.')
  return value
}
export function publicKey(value: unknown): PartnerPublicKey {
  const key = fields(value, ['kid', 'kty', 'crv', 'x'])
  if (key.kty !== 'OKP' || key.crv !== 'Ed25519' || typeof key.x !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(key.x) || Buffer.from(key.x, 'base64url').toString('base64url') !== key.x)
    return fail(400, 'bad_request', 'Use an Ed25519 public JWK.')
  // RFC 8032 encodes the y coordinate little-endian with x's sign in bit
  // 255. A key must have a canonical, non-small-order point to establish
  // possession. Importing an OKP container alone does not enforce this.
  const encoded = Buffer.from(key.x, 'base64url')
  encoded[31] &= 0x7f
  const y = BigInt('0x' + encoded.reverse().toString('hex'))
  const prime = (1n << 255n) - 19n
  if (y >= prime - 1n || y <= 1n ||
      y === 2707385501144840649318225287225658788936804267575313519463743609750303402022n ||
      y === 55188659117513257062467267217118295137698188065244968500265048394206261417927n)
    return fail(400, 'bad_request', 'Generate a new Ed25519 signing key.')
  const jwk: PartnerPublicKey = { kid: tokenId(key.kid), kty: 'OKP', crv: 'Ed25519', x: key.x }
  try { createPublicKey({ key: { ...jwk }, format: 'jwk' }) }
  catch { return fail(400, 'bad_request', 'The public signing key is invalid.') }
  return jwk
}
export function thumbprint(key: PartnerPublicKey) {
  return createHash('sha256').update(JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x })).digest('base64url')
}
const invalidProof = (): never => fail(401, 'invalid_proof', 'The signature or its bound claims are invalid.')
function decoded(segment: string) {
  const bytes = Buffer.from(segment, 'base64url')
  if (!segment || bytes.toString('base64url') !== segment) return invalidProof()
  return bytes
}
/** JSON.parse validates the grammar. Its normal duplicate-member behavior is
 * lossy, so separately check decoded member names in every nested object. */
function signedObject(segment: string) {
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(decoded(segment))
    const value = JSON.parse(source)
    const tokens = source.match(/"(?:\\.|[^"\\])*"|[{}[\]:,]|[^\s{}[\]:,"]+/gu) ?? []
    const levels: Set<string>[] = []
    for (const [i, token] of tokens.entries()) {
      if (token === '{') levels.push(new Set())
      else if (token === '}') levels.pop()
      else if (token.startsWith('"') && tokens[i + 1] === ':') {
        const key = JSON.parse(token) as string, names = levels.at(-1)
        if (!names || names.has(key)) return invalidProof()
        names.add(key)
      }
    }
    return record(value)
  } catch { return invalidProof() }
}
export function verifiedJws(value: unknown, typ: string, find: (kid: string) => PartnerPublicKey | undefined) {
  if (typeof value !== 'string' || value.length > 16_384) return invalidProof()
  const parts = value.split('.')
  if (parts.length !== 3) return invalidProof()
  const head = signedObject(parts[0])
  if (Object.keys(head).length !== 3 || head.alg !== 'Ed25519' || head.typ !== typ ||
      typeof head.kid !== 'string' || !identifier.test(head.kid)) return invalidProof()
  const key = find(head.kid)
  const signature = decoded(parts[2])
  if (!key || signature.length !== 64 || !verify(null, Buffer.from(parts[0] + '.' + parts[1]),
      createPublicKey({ key: { ...key }, format: 'jwk' }), signature)) return invalidProof()
  return { kid: head.kid, claims: signedObject(parts[1]) }
}
