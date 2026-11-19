import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PartnerPublicProfile } from '../../contract/taskPartners.ts'
import { partnerOrigins, servePublicPartner } from './publicHttp.ts'

const origins = partnerOrigins({ TASK_PARTNER_WEB_ORIGIN: 'https://commons.example', TASK_PARTNER_BADGE_ORIGIN: 'https://badges.commons.example' })
const profile: PartnerPublicProfile = {
  partnerId: 'org-1', displayName: 'Orchard & Co', status: 'active', capabilities: ['custodian'], asOf: new Date().toISOString(),
  identity: { domainAscii: 'orchard.example', identityRevision: 1, profilePath: '/partners/org-1',
    verifiedAt: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 3600000).toISOString(),
    collisionSignals: [], relatedPartners: [] },
}
function visit(host: string, path: string, current = profile, healthy = true) {
  let status = 0, body = ''
  let headers: Record<string, string> = {}
  const req = { method: 'GET', headers: { host, referer: 'https://unrelated.example/', 'x-forwarded-host': 'commons.example' } } as IncomingMessage
  const res = {
    writeHead(code: number, fields: Record<string, string>) { status = code; headers = fields },
    end(value: string) { body = value },
  } as ServerResponse
  const served = servePublicPartner(req, res, new URL(path, 'http://localhost'), origins, id => id === current.partnerId ? current : null, healthy)
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
