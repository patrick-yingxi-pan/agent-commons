/** Agent provenance is private server state: authenticated Agent creation, forks, and
 * imports bind one exact person, while every Agent wire/event projection omits it. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { signSession } from '../auth.ts'
import { accounts } from '../accounts.ts'
import { store } from '../store/index.ts'
import { buildRouter } from './index.ts'
import { call, callFresh } from '../testkit/http.ts'
import { agentCreationId } from '../agentCreationIdentity.ts'
import { agentForkCreationId } from '../agentCreationIdentity.ts'
import { DEFAULT_PROVIDER_ID } from '../../contract/index.ts'
import { ROOT } from '../../tests/helpers/source.ts'

let sequence = 0
const cookieOf = (response: { headers: Record<string, string> }) => response.headers['set-cookie']?.split(';')[0] ?? ''

async function account(label: string) {
  const tag = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++sequence}`
  const email = `${tag}@agent-ownership.example`
  const response = await call('POST', '/auth/signup', { name: label, email, password: `${tag}-password` })
  assert.equal(response.status, 200, JSON.stringify(response.json))
  return { userId: response.json.user.id as string, email, home: response.json.tenant.id as string, cookie: cookieOf(response) }
}

function headers(userId: string, tenantId: string) {
  return {
    cookie: `uw_session=${signSession({ userId, tenantId, iat: Date.now() })}`,
    'x-account-transition-source': `session:${userId}`,
  }
}

const href = (name: string) => JSON.stringify(new URL(name, import.meta.url).href)

async function sharedOrg() {
  const owner = await account('Agent Steward')
  const peer = await account('Agent Peer')
  const org = await call('POST', '/orgs', { name: `Agent group ${sequence}` }, { cookie: owner.cookie })
  assert.equal(org.status, 201, JSON.stringify(org.json))
  const invite = await call('POST', `/orgs/${org.json.id}/invites`, { email: peer.email }, { cookie: owner.cookie })
  assert.equal(invite.status, 201, JSON.stringify(invite.json))
  assert.equal((await call('POST', `/me/invites/${invite.json.id}/accept`, undefined, { cookie: peer.cookie })).status, 200)
  assert.ok(accounts.identityFor(owner.userId, org.json.id))
  assert.ok(accounts.identityFor(peer.userId, org.json.id))
  return {
    owner,
    peer,
    tenantId: org.json.id as string,
    ownerHeaders: headers(owner.userId, org.json.id),
    peerHeaders: headers(peer.userId, org.json.id),
  }
}

function assertNoPersonProvenance(value: unknown, ...userIds: string[]) {
  const serialized = JSON.stringify(value)
  assert.doesNotMatch(serialized, /ownerUserId|createdByUserId|agentOwner/i)
  for (const userId of userIds) assert.ok(!serialized.includes(userId), `public projection must not contain ${userId}`)
}

async function withCardFetch<T>(payload: string, run: (url: string) => Promise<T>) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(payload, { status: 200, headers: { 'Content-Type': 'application/json' } })
  try { return await run('https://cards.example/card') }
  finally { globalThis.fetch = originalFetch }
}

function eventStream(reqHeaders: Record<string, string>) {
  const router = buildRouter()
  let body = ''
  let ended = false
  const handlers = new Map<string, (arg?: unknown) => void>()
  const req: any = {
    method: 'GET',
    headers: reqHeaders,
    on(name: string, handler: (arg?: unknown) => void) { handlers.set(name, handler); return req },
  }
  const res: any = {
    writeHead() { return res },
    setHeader() {},
    flushHeaders() {},
    write(chunk: string) { body += chunk; return true },
    end(chunk?: string) { if (chunk) body += chunk; ended = true },
    get writableEnded() { return ended },
  }
  return router.handle(req, res, new URL('http://test/events')).then(() => ({
    body: () => body,
    close: () => handlers.get('close')?.(),
  }))
}

test('direct Agent create stamps exact authenticated person privately; replay by another same-org person cannot transfer it', async () => {
  const { owner, peer, tenantId, ownerHeaders, peerHeaders } = await sharedOrg()
  const key = `direct-${sequence}`
  const expectedId = agentCreationId(tenantId, key)
  const body = {
    label: `Private Agent ${sequence}`,
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
    ownerUserId: peer.userId,
    tenantId: peer.home,
  }
  const events: unknown[] = []
  const unsubscribe = store.subscribe((event) => { if (event.type === 'agent.changed' && event.agentId === expectedId) events.push(event) })
  const created = await call('POST', '/agents', body, { ...ownerHeaders, 'idempotency-key': key })
  assert.equal(created.status, 200, JSON.stringify(created.json))
  assert.equal(created.json.id, expectedId)
  assert.deepEqual(store.agentProvenance(expectedId), { agentId: expectedId, tenantId, ownerUserId: owner.userId })
  assertNoPersonProvenance(created.json, owner.userId, peer.userId)
  assertNoPersonProvenance(events, owner.userId, peer.userId)

  const listed = await call('GET', '/agents', undefined, ownerHeaders)
  const byId = await call('GET', `/agents/${expectedId}`, undefined, peerHeaders)
  assert.equal(listed.status, 200)
  assert.equal(byId.status, 200)
  assertNoPersonProvenance(listed.json, owner.userId, peer.userId)
  assertNoPersonProvenance(byId.json, owner.userId, peer.userId)

  // The idempotency identity is tenant-scoped today. A different member may
  // recover its represented row, but cannot become its private principal owner.
  const otherPersonReplay = await callFresh('POST', '/agents', { ...body, label: 'Changed replay body' }, {
    ...peerHeaders,
    'idempotency-key': key,
  })
  assert.equal(otherPersonReplay.status, 200, JSON.stringify(otherPersonReplay.json))
  assert.equal(otherPersonReplay.json.id, expectedId)
  assert.equal(otherPersonReplay.json.label, body.label)
  assert.deepEqual(store.agentProvenance(expectedId), { agentId: expectedId, tenantId, ownerUserId: owner.userId })
  assertNoPersonProvenance(otherPersonReplay.json, owner.userId, peer.userId)

  const changed = await call('PATCH', `/agents/${expectedId}`, { label: 'Published private owner Agent', published: true }, ownerHeaders)
  assert.equal(changed.status, 200)
  assertNoPersonProvenance(changed.json, owner.userId, peer.userId)
  const directory = await call('GET', '/directory/agents', undefined, peerHeaders)
  assert.equal(directory.status, 200)
  assertNoPersonProvenance(directory.json, owner.userId, peer.userId)

  const stream = await eventStream(ownerHeaders)
  try {
    await call('PATCH', `/agents/${expectedId}`, { label: 'Changed again' }, ownerHeaders)
    const frames = stream.body().split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)))
    const agentEvent = frames.find((event) => event.type === 'agent.changed' && event.agentId === expectedId)
    assert.ok(agentEvent, 'the subscribed owner stream receives its Agent invalidation')
    assertNoPersonProvenance(agentEvent, owner.userId, peer.userId)
  } finally {
    stream.close()
  }
  unsubscribe()
})

test('fork binds the authenticated forker and leaves a raw legacy source unbound', async () => {
  const { owner, peer, tenantId, ownerHeaders } = await sharedOrg()
  const source = store.createAgent({ label: `Legacy published ${sequence}`, systemPrompt: 'Source', tools: [], instructions: '' }, owner.home)
  store.updateAgentFromRequest(source.id, { published: true })
  assert.equal(store.agentProvenance(source.id), undefined, 'raw store creation without a person stays unbound')

  const key = `fork-${sequence}`
  const expectedId = agentForkCreationId(peer.home, key)
  const forked = await call('POST', `/agents/${source.id}/fork`, {}, { ...headers(peer.userId, peer.home), 'idempotency-key': key })
  assert.equal(forked.status, 200, JSON.stringify(forked.json))
  assert.equal(forked.json.id, expectedId)
  assert.deepEqual(store.agentProvenance(expectedId), { agentId: expectedId, tenantId: peer.home, ownerUserId: peer.userId })
  assert.equal(store.agentProvenance(source.id), undefined, 'forking never assigns provenance to the source')
  assertNoPersonProvenance(forked.json, owner.userId, peer.userId)

  const retry = await callFresh('POST', `/agents/${source.id}/fork`, {}, { ...headers(peer.userId, peer.home), 'idempotency-key': key })
  assert.equal(retry.status, 200)
  assert.deepEqual(store.agentProvenance(expectedId), { agentId: expectedId, tenantId: peer.home, ownerUserId: peer.userId })
  assertNoPersonProvenance(retry.json, owner.userId, peer.userId)

  const published = await call('POST', '/agents', {
    label: `Bound source ${sequence}`,
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
  }, ownerHeaders)
  assert.equal(published.status, 200, JSON.stringify(published.json))
  assert.deepEqual(store.agentProvenance(published.json.id), {
    agentId: published.json.id,
    tenantId,
    ownerUserId: owner.userId,
  })
  const madePublic = await call('PATCH', `/agents/${published.json.id}`, { published: true }, ownerHeaders)
  assert.equal(madePublic.status, 200)
  const copy = await call('POST', `/agents/${published.json.id}/fork`, {}, {
    ...headers(peer.userId, peer.home),
    'idempotency-key': `fork-bound-${sequence}`,
  })
  assert.equal(copy.status, 200, JSON.stringify(copy.json))
  assert.deepEqual(store.agentProvenance(copy.json.id), {
    agentId: copy.json.id,
    tenantId: peer.home,
    ownerUserId: peer.userId,
  }, 'fork provenance belongs to the authenticated forker, not the bound source owner')
  assertNoPersonProvenance(copy.json, owner.userId, peer.userId)
})

test('development-header creation stays unbound across authenticated same-key replay', async () => {
  const { owner } = await sharedOrg()
  const key = `development-${sequence}`
  const body = {
    label: `Development header Agent ${sequence}`,
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
    ownerUserId: owner.userId,
  }
  const created = await call('POST', '/agents', body, { 'x-tenant-id': owner.home, 'idempotency-key': key })
  assert.equal(created.status, 200, JSON.stringify(created.json))
  assert.equal(created.json.id, agentCreationId(owner.home, key))
  assert.equal(store.agentProvenance(created.json.id), undefined, 'a development tenant header is not person authentication')

  const authenticatedRetry = await callFresh('POST', '/agents', body, {
    ...headers(owner.userId, owner.home),
    'idempotency-key': key,
  })
  assert.equal(authenticatedRetry.status, 200, JSON.stringify(authenticatedRetry.json))
  assert.equal(authenticatedRetry.json.id, created.json.id)
  assert.equal(store.agentProvenance(created.json.id), undefined, 'replaying the same durable creation cannot retroactively bind provenance')
})

test('Agent Card import binds the authenticated person and exposes no provenance', async () => {
  const { owner, tenantId, ownerHeaders } = await sharedOrg()
  await withCardFetch(JSON.stringify({ name: `Imported ${sequence}`, description: 'Remote card' }), async (url) => {
    const imported = await call('POST', '/agents/import-card', { url }, ownerHeaders)
    assert.equal(imported.status, 200, JSON.stringify(imported.json))
    assert.deepEqual(store.agentProvenance(imported.json.id), {
      agentId: imported.json.id,
      tenantId,
      ownerUserId: owner.userId,
    })
    assertNoPersonProvenance(imported.json, owner.userId)
    const list = await call('GET', '/agents', undefined, ownerHeaders)
    assertNoPersonProvenance(list.json, owner.userId)
  })
})

test('Agent Card import refuses provenance if the authenticated org membership disappears during fetch', async () => {
  const { owner, tenantId, ownerHeaders } = await sharedOrg()
  let release!: () => void
  let requested!: () => void
  const responseGate = new Promise<void>((resolve) => { release = resolve })
  const requestSeen = new Promise<void>((resolve) => { requested = resolve })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    requested()
    await responseGate
    return new Response(JSON.stringify({ name: `Revoked import ${sequence}` }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const member = accounts.membership(owner.userId, tenantId)!
  const memberIndex = accounts.memberships.indexOf(member)
  const importing = call('POST', '/agents/import-card', { url: 'https://cards.example/revoked' }, ownerHeaders)
  try {
    await requestSeen
    accounts.memberships.splice(memberIndex, 1)
    release()
    const result = await importing
    assert.notEqual(result.status, 200, 'a principal who lost membership cannot stamp a new private owner binding')
    const stored = store.listAgents(tenantId).find((agent) => agent.label.startsWith('Revoked import'))
    assert.equal(stored, undefined)
    assert.equal(store.agentProvenance(result.json?.id ?? ''), undefined)
  } finally {
    release()
    if (!accounts.membership(owner.userId, tenantId)) accounts.memberships.splice(memberIndex, 0, member)
    globalThis.fetch = originalFetch
  }
})

test('resolved desktop profile binds its trusted local owner after SQLite restart; other default postures stay unbound', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-desktop-ownership-'))
  const db = join(root, 'desktop.sqlite')
  const run = (source: string, env: Record<string, string | undefined> = {}) => spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', source],
    { cwd: ROOT, encoding: 'utf8', timeout: 20_000, env: { ...process.env, ...env } },
  )
  const parse = (result: ReturnType<typeof run>) => {
    assert.equal(result.status, 0, result.stderr || result.stdout)
    return JSON.parse(result.stdout.trim())
  }
  try {
    const desktopSource = [
      'const { resolveRuntimeProfile } = await import(' + href('../runtimeProfile.ts') + ')',
      "Object.assign(process.env, resolveRuntimeProfile('desktop', { PORT: '8787' }, () => 'desktop-test-secret-'.padEnd(48, 'x'))) ",
      'process.env.DATA_FILE = ' + JSON.stringify(db),
      'process.env.DATABASE_PATH = ' + JSON.stringify(db),
      'const { store } = await import(' + href('../store/index.ts') + ')',
      'const { closePersistence } = await import(' + href('../persistence/persist.ts') + ')',
      'const { call } = await import(' + href('../testkit/http.ts') + ')',
      'const { DEFAULT_PROVIDER_ID } = await import(' + href('../../contract/index.ts') + ')',
      'store.initPersistence()',
      'const identity = store.identity({})',
      "const direct = await call('POST', '/agents', { label: 'Desktop owner Agent', providerId: DEFAULT_PROVIDER_ID, systemPromptId: 'sp-default' })",
      'const source = store.getAgent().id',
      "const fork = await call('POST', '/agents/' + source + '/fork')",
      "globalThis.fetch = async () => new Response(JSON.stringify({ name: 'Desktop imported Agent' }), { status: 200 })",
      "const imported = await call('POST', '/agents/import-card', { url: 'https://cards.example/card' })",
      'const responses = [direct, fork, imported]',
      'const provenance = responses.map(response => store.agentProvenance(response.json.id))',
      'const output = { identity: { via: identity.via, local: identity.local, userId: identity.user.id, tenantId: identity.tenant.id }, responses, provenance }',
      'closePersistence()',
      'console.log(JSON.stringify(output))',
    ].join('\n')
    const desktop = parse(run(desktopSource, { DATA_FILE: db, DATABASE_PATH: db }))
    assert.deepEqual(desktop.identity, { via: 'default', local: true, userId: 'user-local', tenantId: 'tenant-personal' })
    assert.deepEqual(desktop.provenance, desktop.responses.map((response: any) => ({
      agentId: response.json.id, tenantId: 'tenant-personal', ownerUserId: 'user-local',
    })))
    for (const response of desktop.responses) {
      assert.equal(response.status, 200, JSON.stringify(response.json))
      assert.equal(Object.hasOwn(response.json, 'ownerUserId'), false)
    }

    const restartSource = [
      'const { resolveRuntimeProfile } = await import(' + href('../runtimeProfile.ts') + ')',
      "Object.assign(process.env, resolveRuntimeProfile('desktop', { PORT: '8787' }, () => 'desktop-test-secret-'.padEnd(48, 'x'))) ",
      'process.env.DATA_FILE = ' + JSON.stringify(db),
      'process.env.DATABASE_PATH = ' + JSON.stringify(db),
      'const { store } = await import(' + href('../store/index.ts') + ')',
      'const { closePersistence, loadState } = await import(' + href('../persistence/persist.ts') + ')',
      'store.initPersistence()',
      'const ids = ' + JSON.stringify(desktop.provenance.map((row: any) => row.agentId)),
      'const output = { provenance: ids.map(id => store.agentProvenance(id)), saved: loadState().agentOwnership }',
      'closePersistence()',
      'console.log(JSON.stringify(output))',
    ].join('\n')
    const restarted = parse(run(restartSource, { DATA_FILE: db, DATABASE_PATH: db }))
    assert.deepEqual(restarted.provenance, desktop.provenance)
    assert.deepEqual(restarted.saved, desktop.provenance)

    // The hosted gate is normally on; turn it off only to exercise its otherwise
    // unreachable default fallback and prove the desktop exception stays scoped.
    for (const posture of ['web', 'default'] as const) {
      const fallbackSource = [
        ...(posture === 'web' ? [
          'const { resolveRuntimeProfile } = await import(' + href('../runtimeProfile.ts') + ')',
          "Object.assign(process.env, resolveRuntimeProfile('web', { AUTH_SECRET: 'hosted-fallback-test-secret-'.padEnd(48, 'x'), CORS_ORIGIN: 'https://app.example' }, () => 'unused'))",
          "process.env.AUTH_GATE = 'off'",
        ] : [
          "Object.assign(process.env, { BACKEND: 'mock', INITIAL_WORLD: 'clean', AUTH_GATE: 'off', IDENTITY_HEADERS: 'deny', AUTH_SECRET: 'default-fallback-test-secret-'.padEnd(48, 'x') })",
          'delete process.env.DEPLOYMENT_PROFILE',
        ]),
        'const { store } = await import(' + href('../store/index.ts') + ')',
        'const { call } = await import(' + href('../testkit/http.ts') + ')',
        'const { DEFAULT_PROVIDER_ID } = await import(' + href('../../contract/index.ts') + ')',
        'const identity = store.identity({})',
        "const created = await call('POST', '/agents', { label: 'Unbound fallback Agent', providerId: DEFAULT_PROVIDER_ID, systemPromptId: 'sp-default' })",
        'console.log(JSON.stringify({ identity: { via: identity.via, local: identity.local }, created, provenance: store.agentProvenance(created.json?.id ?? null) ?? null }))',
      ].join('\n')
      const fallback = parse(run(fallbackSource))
      assert.deepEqual(fallback.identity, { via: 'default', local: posture === 'default' })
      assert.equal(fallback.created.status, 200, JSON.stringify(fallback.created.json))
      assert.equal(fallback.provenance, null, `${posture} default fallback is not a trusted desktop device principal`)
      assert.equal(Object.hasOwn(fallback.created.json, 'ownerUserId'), false)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
