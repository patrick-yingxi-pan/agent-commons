/** ── The maintainer console (`/admin/*` — contract/admin.ts) ─────────────────
 *  Locks the instance-operator plane end to end:
 *   - the GRANT: `MAINTAINERS` (ids or emails) stamps `Identity.instanceAdmin`
 *     on verified resolutions only — never on the anonymous default. (On the
 *     native backend the dev header seam always resolves the LOCAL user — only
 *     the tenant switches — so these suites authenticate with real bearer
 *     sessions, the production path.)
 *   - the WALL: every `/admin` route answers 404 to non-maintainers
 *     (existence-hiding) and 401 anonymously under the auth gate (the prefix is
 *     NOT gate-open);
 *   - the READS: cross-tenant projections that never carry credential fields;
 *   - the MUTATIONS: deactivate (seeded refused, login + bearer tokens die,
 *     survives a persistence round-trip), token revoke, invite revoke;
 *   - the OPS face: `/admin/ops` derives from the same sources `/metrics`
 *     renders. */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { call, callRaw } from '../testkit/http.ts'
import { accounts } from '../accounts.ts'
import { store } from '../store/index.ts'

const ADMIN_GETS = ['/admin/users', '/admin/tenants', '/admin/invites', '/admin/tokens', '/admin/audit', '/admin/ops']

const asMaintainers = async <T>(list: string, fn: () => Promise<T>): Promise<T> => {
  process.env.MAINTAINERS = list
  try {
    return await fn()
  } finally {
    delete process.env.MAINTAINERS
  }
}

/** A real bearer session per demo account — the production resolution path
 *  (the grant is read per REQUEST, so one login serves listed and unlisted
 *  phases alike). */
const bearer = async (email: string, password: string) => {
  const r = await call('POST', '/auth/login', { email, password, transport: 'bearer' })
  assert.equal(r.status, 200, `login ${email}`)
  return { authorization: `Bearer ${r.json.token}` }
}
let ada: Record<string, string>
let grace: Record<string, string>
before(async () => {
  ada = await bearer('ada@acme.example', 'ada-demo-password')
  grace = await bearer('grace@acme.example', 'grace-demo-password')
})

test('the wall: without MAINTAINERS every /admin route 404s for everyone', async () => {
  for (const path of ADMIN_GETS) {
    const r = await call('GET', path, undefined, ada)
    assert.equal(r.status, 404, `GET ${path} hides without a grant`)
    assert.equal(r.json.error.code, 'not_found')
  }
  assert.equal((await call('POST', '/admin/users/user-1/deactivate', undefined, ada)).status, 404)
  assert.equal((await call('DELETE', '/admin/tokens/user-1/t-1', undefined, ada)).status, 404)
  assert.equal((await call('DELETE', '/admin/invites/i-1', undefined, ada)).status, 404)
})

test('the wall: a listed maintainer passes; an unlisted signed-in principal still 404s', async () => {
  await asMaintainers('user-ada', async () => {
    for (const path of ADMIN_GETS) {
      assert.equal((await call('GET', path, undefined, ada)).status, 200, `GET ${path} opens for the maintainer`)
      assert.equal((await call('GET', path, undefined, grace)).status, 404, `GET ${path} hides from everyone else`)
    }
  })
})

test('the grant: /me carries instanceAdmin for allowlisted principals only, matched by id or email', async () => {
  await asMaintainers('ada@acme.example, user-grace', async () => {
    assert.equal((await call('GET', '/me', undefined, ada)).json.instanceAdmin, true, 'email match')
    assert.equal((await call('GET', '/me', undefined, grace)).json.instanceAdmin, true, 'id match')
  })
  await asMaintainers('user-ada', async () => {
    const unlisted = await call('GET', '/me', undefined, grace)
    assert.equal(unlisted.json.instanceAdmin, undefined, 'absent (not false) off the list — INV-9 absence')
  })
})

test('an unregistered listed EMAIL is not claimable by open signup — email entries grant seeded accounts only', async () => {
  // Signup is open and unverified, so `MAINTAINERS=ops@example.test` set before
  // anyone bears that address must NOT be inheritable by whoever registers it.
  await asMaintainers('ops-claim@example.test', async () => {
    const signup = await call('POST', '/auth/signup', { name: 'Claimer', email: 'ops-claim@example.test', password: 'claimers-password', transport: 'bearer' })
    assert.equal(signup.status, 200)
    assert.equal(signup.json.identity.instanceAdmin, undefined, 'the claimed email carries no grant')
    const auth = { authorization: `Bearer ${signup.json.token}` }
    assert.equal((await call('GET', '/admin/users', undefined, auth)).status, 404, 'the wall holds')
  })
})

test('the grant never lands on the anonymous default — even when the default principal is listed', async () => {
  await asMaintainers('user-local,user-ada', async () => {
    const me = await call('GET', '/me')
    assert.equal(me.json.via, 'default')
    assert.equal(me.json.instanceAdmin, undefined, 'a bare boot is not a maintainer')
    assert.equal((await call('GET', '/admin/users')).status, 404, 'and the wall holds for it')
  })
})

test('the login mint itself names the grant (the UI needs no second read)', async () => {
  await asMaintainers('ada@acme.example', async () => {
    const login = await call('POST', '/auth/login', { email: 'ada@acme.example', password: 'ada-demo-password', transport: 'bearer' })
    assert.equal(login.status, 200)
    assert.equal(login.json.identity.instanceAdmin, true)
  })
})

test('gated: /admin is NOT on the gate-open list — anonymous callers meet the 401 first', async () => {
  process.env.AUTH_GATE = 'require'
  process.env.MAINTAINERS = 'user-ada'
  try {
    const r = await call('GET', '/admin/users')
    assert.equal(r.status, 401, 'the auth gate wall answers before the maintainer wall')
    assert.equal(r.json.error.code, 'unauthorized')
  } finally {
    delete process.env.AUTH_GATE
    delete process.env.MAINTAINERS
  }
})

test('the reads: cross-tenant projections, and NO credential material ever crosses', async () => {
  await asMaintainers('user-ada', async () => {
    const users = await call('GET', '/admin/users', undefined, ada)
    const ids = users.json.map((u: any) => u.user.id)
    assert.ok(ids.includes('user-ada') && ids.includes('user-grace') && ids.includes('user-local'), 'every account, all tenants')
    const adaRow = users.json.find((u: any) => u.user.id === 'user-ada')
    assert.equal(adaRow.seeded, true)
    assert.equal(adaRow.homeTenant.id, 'tenant-acme')
    const tenants = await call('GET', '/admin/tenants', undefined, ada)
    assert.ok(tenants.json.some((t: any) => t.tenant.id === 'tenant-beta'), 'foreign namespaces are listed')
    const acme = tenants.json.find((t: any) => t.tenant.id === 'tenant-acme')
    assert.equal(acme.namespace, true, 'an org-KIND seed world still reads as a namespace — kind alone cannot tell')
    for (const path of ADMIN_GETS) {
      const body = JSON.stringify((await call('GET', path, undefined, ada)).json)
      assert.ok(!body.includes('passwordHash') && !body.includes('passwordSalt'), `${path} carries no credential fields`)
    }
  })
})

test('the audit read is the instance-wide (unscoped) trail — entries from every tenant', async () => {
  store.recordAudit({ tenantId: 'tenant-acme', channel: 'proxy', actorAgentId: 'agent-x', capability: 'connector.read', target: 'a', outcome: 'fulfilled' })
  store.recordAudit({ tenantId: 'tenant-beta', channel: 'proxy', actorAgentId: 'agent-y', capability: 'connector.read', target: 'b', outcome: 'denied' })
  await asMaintainers('user-ada', async () => {
    const r = await call('GET', '/admin/audit', undefined, ada)
    const tenants = new Set(r.json.map((e: any) => e.tenantId))
    assert.ok(tenants.has('tenant-acme') && tenants.has('tenant-beta'), 'the one unscoped audit read crosses tenants')
  })
})

test('the ops face derives from the same sources /metrics renders', async () => {
  await asMaintainers('user-ada', async () => {
    const ops = await call('GET', '/admin/ops', undefined, ada)
    assert.equal(ops.status, 200)
    assert.equal(ops.json.epoch, store.epoch)
    assert.equal(ops.json.backend, store.capabilities().backend)
    assert.equal(typeof ops.json.uptimeSeconds, 'number')
    for (const k of ['runnersByStatus', 'dispatchByStatus', 'turnsByOutcome', 'requestsByMethod']) {
      assert.equal(typeof ops.json[k], 'object', `${k} present`)
    }
    assert.deepEqual(Object.keys(ops.json.dispatchByStatus).sort(), ['done', 'failed', 'running'], 'every series present from the start')
    const metrics = await callRaw('GET', '/metrics', undefined, ada)
    assert.match(metrics.body, new RegExp(`store_epoch_info\\{epoch="${ops.json.epoch}"\\} 1`), 'one derivation, two faces')
    assert.match(metrics.body, /dispatch_runs\{status="running"\}/)
  })
})

test('deactivate: refused on seeded accounts (409) and unknown ids (404)', async () => {
  await asMaintainers('user-ada', async () => {
    const seeded = await call('POST', '/admin/users/user-grace/deactivate', undefined, ada)
    assert.equal(seeded.status, 409, 'the demo roster is code-owned')
    assert.equal((await call('POST', '/admin/users/user-nope/deactivate', undefined, ada)).status, 404)
  })
})

test('deactivate kills sign-in AND live bearer credentials, and survives a persistence round-trip', async () => {
  const email = 'temp-admin-test@example.test'
  const signup = await call('POST', '/auth/signup', { name: 'Temp', email, password: 'temp-password-1', transport: 'bearer' })
  assert.equal(signup.status, 200)
  const userId = signup.json.identity.user.id
  const auth = { authorization: `Bearer ${signup.json.token}` }
  assert.equal((await call('GET', '/me', undefined, auth)).json.via, 'session', 'the fresh bearer resolves')

  await asMaintainers('user-ada', async () => {
    assert.deepEqual((await call('POST', `/admin/users/${userId}/deactivate`, undefined, ada)).json, { ok: true })
  })
  // The lockout is the existing stale-credential fall-through: the bearer no
  // longer resolves (falls to the default principal), and login refuses.
  assert.equal((await call('GET', '/me', undefined, auth)).json.via, 'default', 'the live credential died with the account')
  const relogin = await call('POST', '/auth/login', { email, password: 'temp-password-1' })
  assert.equal(relogin.status, 401, 'the credential was stripped')

  // The flag round-trips persistence wholesale (a non-seed row), so a restart
  // cannot resurrect the account.
  const snapshot = accounts.toPersisted()
  accounts.rehydrate(JSON.parse(JSON.stringify(snapshot)))
  assert.equal(accounts.users.get(userId)?.deactivated, true, 'deactivation survives rehydrate')
  assert.equal((await call('POST', '/auth/login', { email, password: 'temp-password-1' })).status, 401)
})

test('deactivated rows read honestly in the console projection', async () => {
  await asMaintainers('user-ada', async () => {
    const users = await call('GET', '/admin/users', undefined, ada)
    const row = users.json.find((u: any) => u.user.email === 'temp-admin-test@example.test')
    assert.ok(row, 'the deactivated account still lists (an honest ledger, not a hole)')
    assert.equal(row.deactivated, true)
    assert.equal(row.tokenCount, 0, 'its token registry was emptied')
  })
})

test('token revoke from the instance view kills the credential immediately; unknown ids 404', async () => {
  const login = await call('POST', '/auth/login', { email: 'grace@acme.example', password: 'grace-demo-password', transport: 'bearer' })
  const graceAuth = { authorization: `Bearer ${login.json.token}` }
  const jti = login.json.tokenId
  assert.ok(jti, 'a bearer mint is registry-backed')
  await asMaintainers('user-ada', async () => {
    const rows = await call('GET', '/admin/tokens', undefined, ada)
    const row = rows.json.find((t: any) => t.id === jti)
    assert.equal(row?.userId, 'user-grace', 'the instance list names the owner')
    assert.equal((await call('DELETE', `/admin/tokens/user-grace/${jti}`, undefined, ada)).status, 200)
    assert.equal((await call('DELETE', `/admin/tokens/user-grace/${jti}`, undefined, ada)).status, 404, 'gone is gone')
  })
  assert.equal((await call('GET', '/me', undefined, graceAuth)).json.via, 'default', 'the revoked bearer stops resolving')
})

test('invite revoke from the instance view: pending closes, resolved 409s, unknown 404s', async () => {
  // Found an org as Ada and invite an address (the org-owner face), then
  // revoke from the instance view (the maintainer face).
  const org = await call('POST', '/orgs', { name: 'Console Test Org' }, ada)
  assert.ok(org.status === 200 || org.status === 201, `org founds (${org.status})`)
  const invite = await call('POST', `/orgs/${org.json.id}/invites`, { email: 'invitee@example.test' }, ada)
  assert.ok(invite.status === 200 || invite.status === 201, `invite mints (${invite.status})`)
  await asMaintainers('user-ada', async () => {
    const list = await call('GET', '/admin/invites', undefined, ada)
    const row = list.json.find((i: any) => i.id === invite.json.id)
    assert.equal(row?.orgName, 'Console Test Org', 'the instance view names the org')
    assert.equal((await call('DELETE', `/admin/invites/${invite.json.id}`, undefined, ada)).status, 200)
    assert.equal((await call('DELETE', `/admin/invites/${invite.json.id}`, undefined, ada)).status, 409, 'already resolved')
    assert.equal((await call('DELETE', '/admin/invites/invite-nope', undefined, ada)).status, 404)
  })
})
