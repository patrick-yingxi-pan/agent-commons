import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PartnerPublicProfile } from '../../contract/taskPartners.ts'
import { partnerOrigins, servePublicPartner, type PartnerOrigins } from './publicHttp.ts'
import { demoPartnerConfiguration } from './demoConfiguration.ts'

const origins = partnerOrigins({ TASK_PARTNER_WEB_ORIGIN: 'https://commons.example', TASK_PARTNER_BADGE_ORIGIN: 'https://badges.commons.example' })
const profile: PartnerPublicProfile = {
  partnerId: 'org-1', displayName: 'Orchard & Co', status: 'active', capabilities: ['custodian'], asOf: new Date().toISOString(),
  identity: { domainAscii: 'orchard.example', identityRevision: 1, profilePath: '/partners/org-1',
    verifiedAt: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 3600000).toISOString(),
    collisionSignals: [], relatedPartners: [] },
}
function visit(host: string, path: string, current = profile, healthy = true, deployment: PartnerOrigins = origins, demo?: {backendOrigin: string}) {
  let status = 0, body = ''
  let headers: Record<string, string> = {}
  const req = { method: 'GET', headers: { host, referer: 'https://unrelated.example/', 'x-forwarded-host': 'commons.example' } } as IncomingMessage
  const res = {
    writeHead(code: number, fields: Record<string, string>) { status = code; headers = fields },
    end(value: string) { body = value },
  } as ServerResponse
  const served = servePublicPartner(req, res, new URL(path, 'http://localhost'), deployment, id => id === current.partnerId ? current : null, healthy, demo)
  return { served, status, body, headers }
}
test('the public profile, public API and restricted badge use exact configured hosts and current identity', () => {
  const base = '/v1/task-partners/public/partners/org-1'
  const path = base + '/badge?domain=orchard.example'
  const result = visit('badges.commons.example', path)
  assert.equal(result.status, 200)
  assert.match(result.headers['Content-Security-Policy']!, /frame-ancestors https:\/\/orchard\.example$/)
  assert.equal(result.headers['X-Frame-Options'], undefined)
  assert.equal(result.headers['Cache-Control'], 'no-store')
  assert.match(result.body, /href="https:\/\/commons\.example\/partners\/org-1"/)
  assert.match(result.body, /Orchard &amp; Co/)
  assert.doesNotMatch(result.body, /<script|unrelated\.example/)
  assert.deepEqual(JSON.parse(visit('commons.example', base).body), profile)
  assert.match(visit('commons.example', '/partners/org-1').body, /Reward custodian/)
  assert.equal(visit('badges.commons.example', '/api/v1/me').status, 404)
  assert.equal(visit('commons.example', path).status, 404)
  assert.equal(visit('another.example', '/partners/org-1').status, 404)
  assert.equal(visit('commons.example', '/partners/org-hidden').status, 404)
  assert.equal(visit('commons.example', '/projects/p-test').served, false)
  const lapsed = { ...profile, identity: { ...profile.identity, validUntil: profile.identity.verifiedAt } }
  assert.match(visit('commons.example', '/partners/org-1', lapsed).body, /Verification inactive/)
  const expiredApi = JSON.parse(visit('commons.example', base, lapsed).body)
  assert.equal(expiredApi.status, 'verification_lapsed')
  assert.deepEqual(expiredApi.capabilities, [])
  for (const r of [visit('badges.commons.example', path, { ...profile, status: 'suspended' }), visit('badges.commons.example', path, lapsed),
    visit('badges.commons.example', path.replace('domain=orchard.', 'domain=other.')), visit('badges.commons.example', path + '&domain=orchard.example'),
    visit('badges.commons.example', path, profile, false)]) {
    assert.match(r.headers['Content-Security-Policy']!, /frame-ancestors 'none'/)
    assert.doesNotMatch(r.body, /View active profile/)
  }
})
test('trusted partner origins reject paths, credentials, mixed environments and shared cookie hosts', () => {
  for (const s of ['https://name:secret@commons.example', 'http://commons.example', 'https://commons.example/next']) {
    assert.throws(() => partnerOrigins({ TASK_PARTNER_WEB_ORIGIN: s }))
  }
  assert.throws(() => partnerOrigins({ TASK_PARTNER_WEB_ORIGIN: 'https://commons.example', TASK_PARTNER_BADGE_ORIGIN: 'https://commons.example:8443' }))
})

test('demo badges grant framing only to their own mapped website and require the same local public configuration', () => {
  const base = '/v1/task-partners/public/partners/org-1'
  for (const port of ['80', '8787']) {
    const local = demoPartnerConfiguration({ TASK_PARTNER_DEMO: '1', PORT: port })!
    const badgeHost = new URL(local.badgeOrigin).host, webHost = new URL(local.webOrigin).host
    for (const org of ['orchard-labs', 'orchard-coop']) {
      const domain = org + '.example.com', path = base + '/badge?domain=' + domain
      const current = { ...profile, demo: true as const, identity: { ...profile.identity, domainAscii: domain } }
      const site = 'http://' + org + '.localhost' + (port === '80' ? '' : ':' + port)
      const badge = visit(badgeHost, path, current, true, local, local)
      assert.equal(badge.status, 200)
      assert.equal(badge.headers['Content-Security-Policy'].split('; ').at(-1), 'frame-ancestors ' + site)
      assert.ok(badge.body.includes('href="' + local.webOrigin + '/partners/org-1"'))
      assert.match(badge.body, /Demo organization/)
      const page = visit(webHost, '/partners/org-1', current, true, local, local)
      assert.ok(page.body.includes('href="' + site + '/"'))
      assert.equal(JSON.parse(visit(webHost, base, current, true, local, local).body).status, 'active')
      const other = org === 'orchard-labs' ? 'orchard-coop' : 'orchard-labs'
      for (const response of [
        visit(badgeHost, base + '/badge?domain=' + other + '.example.com', current, true, local, local),
        visit(badgeHost, path, current, true, local), visit('badges.commons.example', path, current, true, origins, local),
        visit(badgeHost, path, current, true, local, {backendOrigin: 'http://127.0.0.1:1'}),
      ]) {
        assert.equal(response.headers['X-Frame-Options'], 'DENY')
        assert.doesNotMatch(response.body, /View active profile/)
      }
      const inactive = JSON.parse(visit('commons.example', base, current, true, origins, local).body)
      assert.equal(inactive.status, 'verification_lapsed')
      assert.deepEqual(inactive.capabilities, [])
      const real = { ...profile, identity: current.identity }
      const verified = visit('badges.commons.example', path, real, true, origins, local)
      assert.equal(verified.headers['Content-Security-Policy'].split('; ').at(-1), 'frame-ancestors https://' + domain)
      assert.doesNotMatch(verified.body, /Demo organization|\.localhost/)
    }
  }
})

test('active website badges and public profiles identify the actual collision and preserve the exact host', () => {
  const comparisons: [PartnerPublicProfile['identity']['collisionSignals'], string][] = [
    [[], ''],
    [['exact_name'], 'Identical name'],
    [['normalized_name'], 'Similar name'],
    [['confusable_name'], 'Similar name'],
    [['similar_name'], 'Similar name'],
    [['confusable_domain'], 'Similar website domain'],
    [['confusable_domain', 'similar_name', 'normalized_name', 'exact_name'], 'Identical name · Similar name · Similar website domain'],
  ]
  for (const [collisionSignals, label] of comparisons) {
    const current = { ...profile, identity: { ...profile.identity, collisionSignals, domainAscii: 'xn--pple-43d.example' } }
    const badge = visit('badges.commons.example', '/v1/task-partners/public/partners/org-1/badge?domain=' + current.identity.domainAscii, current)
    const publicPage = visit('commons.example', '/partners/org-1', current)
    for (const result of [badge, publicPage]) {
      assert.equal(result.status, 200)
      assert.match(result.body, /<bdi dir="ltr">xn--pple-43d\.example<\/bdi>/)
      // The profile may summarize more matches than can be listed as public peers.
      assert.deepEqual(result.body.match(/Identical name|Similar name|Similar website domain/g) ?? [], label ? label.split(' · ') : [])
    }
    assert.match(badge.headers['Content-Security-Policy']!, /frame-ancestors https:\/\/xn--pple-43d\.example$/)
  }
})
