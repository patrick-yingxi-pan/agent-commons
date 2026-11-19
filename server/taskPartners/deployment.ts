import type { PartnerEnvironment, PartnerPublicKey } from '../../contract/taskPartners.ts'
import { fail, publicKey, verifiedJws } from './protocol.ts'
import { partnerOrigins } from './publicHttp.ts'

export function deploymentAudience(env: PartnerEnvironment) {
  const origins = partnerOrigins()
  const origin = env === 'sandbox' ? origins.sandboxOrigin : origins.webOrigin
  if (!origin) return fail(503, 'deployment_unconfigured',
    'The site operator must configure the ' + env + ' partner origin before this service can issue credentials.')
  return origin + '/v1/task-partners'
}

/** Recovery evidence uses a separately provisioned offline trust root. Online
 * enrollment changes cannot issue or replace a recovery signatory. */
export function verifyOfflineStatement(env: PartnerEnvironment, partnerId: string, jws: string) {
  const config = process.env.TASK_PARTNER_RECOVERY_KEYS
  if (!config) return fail(503, 'recovery_unconfigured', 'No independent recovery signatory has been configured.')
  let raw: unknown
  try { raw = JSON.parse(config) } catch { return fail(503, 'recovery_unconfigured', 'Invalid recovery key configuration.') }
  if (!Array.isArray(raw) || raw.length > 1000) return fail(503, 'recovery_unconfigured', 'Invalid recovery key configuration.')
  const keys = new Map<string, PartnerPublicKey>()
  for (const entry of raw) {
    if (entry?.environment !== env || entry?.partnerId !== partnerId) continue
    const key = publicKey(entry.publicKey)
    if (keys.has(key.kid)) return fail(503, 'recovery_unconfigured', 'Ambiguous recovery key configuration.')
    keys.set(key.kid, key)
  }
  return verifiedJws(jws, 'partner-recovery+jwt', kid => keys.get(kid))
}
