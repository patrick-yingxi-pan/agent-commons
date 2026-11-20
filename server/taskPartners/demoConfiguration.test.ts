import assert from 'node:assert/strict'
import test from 'node:test'
import { demoPartnerConfiguration, demoPartnerWebsite } from './demoConfiguration.ts'

const local = { TASK_PARTNER_DEMO: '1' }
test('development partner origins require an opted-in local demo listener and canonical loopback browser policy', () => {
  assert.equal(demoPartnerConfiguration({}), null)
  const normal = demoPartnerConfiguration(local)!
  assert.equal(normal.backendOrigin, 'http://127.0.0.1:8787')
  for (const change of [
    { HOST: '' }, { HOST: '0.0.0.0' }, { HOST: '::' }, { BACKEND: 'remote' }, { BACKEND: 'unknown' },
    { DEPLOYMENT_PROFILE: 'desktop-release' }, { NODE_ENV: 'production' }, { INITIAL_WORLD: 'clean' },
    { CORS_ORIGIN: '*' }, { CORS_ORIGIN: 'null' }, { CORS_ORIGIN: 'https://site.example' },
    { CORS_ORIGIN: 'http://127.0.0.1:5173/path' }, { CORS_ORIGIN: 'http://partner.localhost:5173' },
    { TASK_PARTNER_WEB_ORIGIN: 'https://web.example' }, { TASK_PARTNER_BADGE_ORIGIN: 'https://badges.example' },
    { TASK_PARTNER_SANDBOX_ORIGIN: 'https://sandbox.example' },
  ]) assert.equal(demoPartnerConfiguration({ ...local, ...change }), null, JSON.stringify(change))
  for (const PORT of ['', '0', '65536', '1.5', '0x50', ' 80', '-1'])
    assert.equal(demoPartnerConfiguration({ ...local, PORT }), null)
  for (const CORS_ORIGIN of ['http://127.0.0.1:5173', 'https://localhost', 'http://[::1]:5173'])
    assert.deepEqual(demoPartnerConfiguration({ ...local, BACKEND: 'mock', INITIAL_WORLD: 'demo', HOST: '127.0.0.1', CORS_ORIGIN }), normal)
})

test('local site mapping uses the canonical effective HTTP port and two known website identities', () => {
  const config = demoPartnerConfiguration({ ...local, PORT: '80' })!
  assert.deepEqual(config, { backendOrigin: 'http://127.0.0.1', webOrigin: 'http://partner-profiles.localhost',
    badgeOrigin: 'http://partner-badges.localhost', sandboxOrigin: null })
  assert.equal(demoPartnerWebsite('orchard-labs.example.com', config.backendOrigin, config), 'http://orchard-labs.localhost')
  assert.equal(demoPartnerWebsite('orchard-coop.example.com', config.backendOrigin, config), 'http://orchard-coop.localhost')
  assert.equal(demoPartnerWebsite('orchard.example.com', config.backendOrigin, config), undefined)
  for (const backend of ['invalid', 'https://127.0.0.1', 'http://orchard-labs.example.com', 'http://localhost',
    'http://127.0.0.1/account', 'http://127.0.0.1/?p=1', 'http://user@127.0.0.1'])
    assert.equal(demoPartnerWebsite('orchard-labs.example.com', backend), undefined)
  assert.equal(demoPartnerWebsite('orchard-labs.example.com', 'http://127.0.0.1:8787', config), undefined)
  assert.equal(demoPartnerWebsite('orchard-labs.example.com', config.backendOrigin, { ...config, webOrigin: 'https://commons.example' }), undefined)
})
