import type { PartnerEnvironment } from '../../contract/taskPartners.ts'

const websites = new Map([
  ['orchard-labs.example.com', 'orchard-labs.localhost'],
  ['orchard-coop.example.com', 'orchard-coop.localhost'],
])

/** The fixture protocol keeps a stable HTTPS audience across local ports and
 * restarts. Browser pages and fixture workers communicate only over loopback. */
export function demoPartnerAudience(environment: PartnerEnvironment) {
  const host = environment === 'sandbox' ? 'sandbox.demo.example.com' : 'commons.demo.example.com'
  return 'https://' + host + '/v1/task-partners'
}

function localCorsOrigin(value: string) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      value === url.origin
  } catch { return false }
}

function withHost(origin: URL, hostname: string) {
  const url = new URL(origin.origin)
  url.hostname = hostname
  return url.origin
}

function localOrigins(backend: URL) {
  return { backendOrigin: backend.origin, webOrigin: withHost(backend, 'partner-profiles.localhost'),
    badgeOrigin: withHost(backend, 'partner-badges.localhost'), sandboxOrigin: null }
}

export function demoPartnerConfiguration(env: Record<string, string | undefined> = process.env) {
  if (env.TASK_PARTNER_DEMO !== '1' || env.DEPLOYMENT_PROFILE || env.NODE_ENV === 'production' ||
      (env.INITIAL_WORLD && env.INITIAL_WORLD !== 'demo') || (env.BACKEND !== undefined && env.BACKEND !== 'mock') ||
      (env.HOST !== undefined && env.HOST !== '127.0.0.1') || (env.CORS_ORIGIN !== undefined && !localCorsOrigin(env.CORS_ORIGIN)) ||
      env.TASK_PARTNER_WEB_ORIGIN || env.TASK_PARTNER_SANDBOX_ORIGIN || env.TASK_PARTNER_BADGE_ORIGIN) return null
  const port = env.PORT ?? '8787'
  if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) return null
  return localOrigins(new URL('http://127.0.0.1:' + port))
}

export function demoPartnerWebsite(domain: string, backendOrigin: string,
  publicOrigins?: { webOrigin: string | null; badgeOrigin: string | null; sandboxOrigin: string | null }): string | undefined {
  const host = websites.get(domain)
  if (!host) return undefined
  let url: URL
  try { url = new URL(backendOrigin) } catch { return undefined }
  if (url.origin !== backendOrigin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return undefined
  if (publicOrigins) {
    const local = localOrigins(url)
    if (publicOrigins.webOrigin !== local.webOrigin || publicOrigins.badgeOrigin !== local.badgeOrigin || publicOrigins.sandboxOrigin !== null)
      return undefined
  }
  return withHost(url, host)
}
