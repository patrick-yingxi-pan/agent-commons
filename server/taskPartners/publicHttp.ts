import type { IncomingMessage, ServerResponse } from 'node:http'
import { partnerCollisionLabel, type PartnerPublicProfile } from '../../contract/taskPartners.ts'
import { demoPartnerWebsite } from './demoConfiguration.ts'

export interface PartnerOrigins {
  webOrigin: string | null
  badgeOrigin: string | null
  sandboxOrigin: string | null
}

/** Only deployment configuration may choose the destination for a grant or seal. */
export function partnerOrigins(env: Record<string, string | undefined> = process.env): PartnerOrigins {
  function origin(key: string) {
    const value = env[key]
    if (!value) return null
    let url: URL
    try { url = new URL(value) } catch { throw new Error(`Invalid ${key} origin`) }
    if (url.protocol !== 'https:' || url.username || url.password || (value !== url.origin && value !== url.origin + '/')) {
      throw new Error(`${key} must be a canonical HTTPS origin`)
    }
    return url.origin
  }
  const webOrigin = origin('TASK_PARTNER_WEB_ORIGIN')
  const badgeOrigin = origin('TASK_PARTNER_BADGE_ORIGIN')
  const sandboxOrigin = origin('TASK_PARTNER_SANDBOX_ORIGIN')
  const configuredHosts = [webOrigin, badgeOrigin, sandboxOrigin].filter(v => v !== null).map(v => new URL(v).hostname)
  if (new Set(configuredHosts).size !== configuredHosts.length) throw new Error('Task partner origins require distinct hostnames.')
  return { webOrigin, badgeOrigin, sandboxOrigin }
}

const labels = { 'model-provider': 'Model provider', custodian: 'Reward custodian', verifier: 'Work verifier' } as const
const statuses = { active: 'Active', verification_lapsed: 'Verification inactive', suspended: 'Suspended', revoked: 'Revoked' } as const
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const isolate = (s: string) => '<bdi>' + escape(s) + '</bdi>'
const hostText = (s: string) => '<bdi dir="ltr">' + escape(s) + '</bdi>'
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const profilePath = (id: string) => '/partners/' + encodeURIComponent(id)
const canonicalHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
const css = 'html{font:100%/1.55 system-ui,sans-serif;color:#192830;background:#fff}body{max-width:42rem;margin:0 auto;padding:clamp(1rem,5vw,3rem);overflow-wrap:anywhere}h1{font-size:2rem;line-height:1.15}h2{font-size:1.2rem}dt{font-weight:650;margin-top:.8rem}dd{margin:0}a{color:#075b83}a:focus-visible{outline:3px solid currentColor;outline-offset:3px}'
function html(title: string, body: string, styled = false) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
    escape(title) + ' · Agent Commons</title>' + (styled ? '<style>' + css + '</style>' : '') + '</head><body>' + body + '</body></html>'
}

type Lookup = (id: string) => PartnerPublicProfile | null | undefined
/** The badge host never falls through to cookies, private APIs, or the application shell.
 * The reverse proxy terminates TLS and preserves the canonical Host. */
export function servePublicPartner(req: IncomingMessage, res: ServerResponse, url: URL, origins: PartnerOrigins,
  lookup: Lookup, healthy: boolean, demo?: {backendOrigin: string}): boolean {
  const host = typeof req.headers.host === 'string' ? req.headers.host.toLowerCase() : undefined
  const badgeHost = origins.badgeOrigin !== null && host === new URL(origins.badgeOrigin).host
  const profilePage = /^\/partners\/([A-Za-z0-9_-]{1,160})$/.exec(url.pathname)
  const publicApi = /^\/v1\/task-partners\/public\/partners\/([A-Za-z0-9_-]{1,160})(\/badge)?$/.exec(url.pathname)
  if (!badgeHost && !url.pathname.startsWith('/partners/') && !url.pathname.startsWith('/v1/task-partners/public/')) return false
  function send(status: number, body: string, type = 'text/html', ancestor?: string, style = false) {
    res.writeHead(status, { ...canonicalHeaders, 'Content-Type': type + '; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; " +
        (style ? "style-src 'unsafe-inline'; " : '') + 'frame-ancestors ' + (ancestor ?? "'none'"),
      ...(ancestor ? {} : { 'X-Frame-Options': 'DENY' }) })
    res.end(req.method === 'HEAD' ? undefined : body)
    return true
  }
  const neutral = html('Partner badge unavailable', '<p>Partner badge unavailable</p>')
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, neutral)
  const servingBadge = !!publicApi?.[2] && badgeHost
  const servingWeb = origins.webOrigin && host === new URL(origins.webOrigin).host && (profilePage || (publicApi && !publicApi[2]))
  if (!origins.webOrigin || (!servingBadge && !servingWeb)) return send(404, neutral)
  if (!healthy) return send(503, neutral)
  const id = (profilePage ?? publicApi)![1]!
  const profile = lookup(id)
  if (!profile) return publicApi && !publicApi[2] ? send(404, JSON.stringify({ code: 'not_found' }), 'application/json') : send(404, neutral)
  const domain = profile.identity.domainAscii
  if (!domainPattern.test(domain) || profile.partnerId !== id) return send(503, neutral)
  const websiteOrigin = profile.demo ? demo && demoPartnerWebsite(domain, demo.backendOrigin, origins) : 'https://' + domain
  const demoLabel = profile.demo ? 'Demo organization · ' : ''
  const roles = profile.capabilities.map(c => labels[c]).join(', ')
  const active = !!websiteOrigin && profile.status === 'active' && !!roles && Date.parse(profile.identity.verifiedAt) <= Date.now() && Date.now() < Date.parse(profile.identity.validUntil)
  const currentStatus = profile.status === 'active' && !active ? 'verification_lapsed' : profile.status
  const collision = partnerCollisionLabel(profile.identity.collisionSignals)
  if (servingBadge) {
    const supplied = url.searchParams.get('domain')
    if (!supplied || !domainPattern.test(supplied) || [...url.searchParams.keys()].length !== 1) return send(400, neutral)
    if (!active || supplied !== domain || !websiteOrigin) return send(200, neutral)
    const link = escape(origins.webOrigin + profilePath(id))
    const body = '<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="' + link + '"><strong>' + isolate(profile.displayName) +
      '</strong><br>' + hostText(domain) + (collision ? '<br>' + escape(collision) : '') + '<br>' + demoLabel + 'Agent Commons · ' + escape(roles) + ' · View active profile</a>'
    return send(200, html(profile.displayName, body), 'text/html', websiteOrigin)
  }
  if (publicApi) return send(200, JSON.stringify({ ...profile, status: currentStatus, capabilities: active ? profile.capabilities : [] }), 'application/json')
  const peers = profile.identity.relatedPartners.map(lookup).filter(p => !!p).map(p =>
    '<li><a href="' + escape(profilePath(p.partnerId)) + '">' + isolate(p.displayName) + ' · ' + hostText(p.identity.domainAscii) + '</a></li>')
  const website = active && websiteOrigin ? '<a href="' + escape(websiteOrigin) + '/" rel="noreferrer">' + hostText(domain) + '</a>' : hostText(domain)
  const contents = '<main><header>' + demoLabel + 'Agent Commons · Partner directory</header><h1>' + isolate(profile.displayName) +
    '</h1><dl><dt>Website</dt><dd>' + website + '</dd><dt>Partner status</dt><dd>' + escape(statuses[currentStatus]) +
    '</dd><dt>Current approvals</dt><dd>' + (active ? escape(roles) : 'No active approvals') + '</dd><dt>Permanent partner ID</dt><dd>' + escape(id) + '</dd></dl>' +
    (collision ? '<section><h2>' + escape(collision) + '</h2><p>Check the full website address before choosing a partner.</p>' +
      (peers.length ? '<ul>' + peers.join('') + '</ul>' : '') + '</section>' : '') + '</main>'
  return send(200, html(profile.displayName, contents, true), 'text/html', undefined, true)
}
