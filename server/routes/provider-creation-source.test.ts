import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { providerCreationId } from '../providerCreationIdentity.ts'
import { call } from '../testkit/http.ts'

let sequence = 0

const sessionCookie = (response: { headers: Record<string, string> }): string => {
  const token = response.headers['set-cookie']?.match(/uw_session=([^;,]+)/)?.[1] ?? ''
  return `uw_session=${token}`
}

const login = async (email: string, password: string): Promise<string> => {
  const response = await call('POST', '/auth/login', { email, password })
  assert.equal(response.status, 200)
  return sessionCookie(response)
}

test('provider creation refuses a stale browser source before endpoint/session mint or replay', async () => {
  const suffix = `${Date.now().toString(36)}-${sequence += 1}`
  await login('ada@acme.example', 'ada-demo-password')
  const mayaCookie = await login('maya@growthworks.example', 'maya-demo-password')
  const stale = { cookie: mayaCookie, 'x-account-transition-source': 'session:user-ada' }
  const tenantId = 'tenant-growthworks'
  const events: unknown[] = []
  const unsubscribe = store.subscribe(event => events.push(event))
  const before = store.listProviders(tenantId).map(provider => provider.id)

  const endpointKey = `provider-stale-endpoint-${suffix}`
  const sessionKey = `provider-stale-session-${suffix}`
  const endpointBody = {
    label: `Stale endpoint ${suffix}`,
    modelFamily: 'open',
    effortLevels: ['Low'],
  }
  const sessionBody = {
    label: `Stale session ${suffix}`,
    modelFamily: 'claude',
    effortLevels: ['Low'],
    kind: 'session',
  }

  try {
    const staleRead = await call('GET', '/providers', undefined, stale)
    assert.equal(staleRead.status, 409, 'recovery cannot read the cookie-selected account into an older client cache')
    const endpoint = await call('POST', '/providers', endpointBody, { ...stale, 'idempotency-key': endpointKey })
    const session = await call('POST', '/providers', sessionBody, { ...stale, 'idempotency-key': sessionKey })
    assert.equal(endpoint.status, 409)
    assert.equal(session.status, 409)
    assert.equal(endpoint.json.error.code, 'conflict')
    assert.equal(session.json.error.code, 'conflict')

    const representedKey = `provider-stale-replay-${suffix}`
    const represented = await call('POST', '/providers', {
      ...sessionBody,
      label: `Represented session ${suffix}`,
    }, { cookie: mayaCookie, 'idempotency-key': representedKey })
    assert.equal(represented.status, 200)
    assert.match(represented.json.secret, /^rv_live_/)
    const staleDetail = await call('GET', `/providers/${represented.json.id}`, undefined, stale)
    assert.equal(staleDetail.status, 409, 'the by-id projection preserves the collection account-source precondition')
    const replay = await call('POST', '/providers', {
      label: 42,
      modelFamily: null,
      effortLevels: 'not-an-array',
    }, { ...stale, 'idempotency-key': representedKey })
    assert.equal(replay.status, 409)
    assert.equal(replay.json.secret, undefined)

    assert.deepEqual(store.listProviders(tenantId).map(provider => provider.id), [...before, represented.json.id])
    assert.deepEqual(events.filter((event: any) => event.type === 'provider.changed' && event.tenantId === tenantId), [
      { type: 'provider.changed', providerId: represented.json.id, tenantId },
    ])
    assert.equal(store.listProviders(tenantId).some(provider => provider.id === providerCreationId(tenantId, endpointKey)), false)
    assert.equal(store.listProviders(tenantId).some(provider => provider.id === providerCreationId(tenantId, sessionKey)), false)
  } finally {
    unsubscribe()
  }
})

test('provider creation keeps matching and omitted account-source compatibility', async () => {
  const suffix = `${Date.now().toString(36)}-${sequence += 1}`
  const mayaCookie = await login('maya@growthworks.example', 'maya-demo-password')
  const body = {
    label: `Compatible session ${suffix}`,
    modelFamily: 'claude',
    effortLevels: ['Low'],
    kind: 'session',
  }
  const matching = await call('POST', '/providers', body, {
    cookie: mayaCookie,
    'x-account-transition-source': 'session:user-maya',
    'idempotency-key': `provider-matching-${suffix}`,
  })
  assert.equal(matching.status, 200)
  const detail = await call('GET', `/providers/${matching.json.id}`, undefined, {
    cookie: mayaCookie,
    'x-account-transition-source': 'session:user-maya',
  })
  assert.equal(detail.status, 200)
  assert.equal(detail.json.id, matching.json.id)
  const omitted = await call('POST', '/providers', { ...body, label: `Omitted source ${suffix}` }, {
    cookie: mayaCookie,
    'idempotency-key': `provider-omitted-${suffix}`,
  })
  assert.equal(omitted.status, 200)
})
