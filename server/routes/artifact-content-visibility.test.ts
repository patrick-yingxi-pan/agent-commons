/** The artifact body library is a tenant projection, not a public seed dump. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from '../testkit/http.ts'

let rpcId = 0
async function toolCall(name: string, args: Record<string, unknown> = {}, headers?: Record<string, string>) {
  const response = await call('POST', '/mcp', {
    jsonrpc: '2.0', id: ++rpcId, method: 'tools/call',
    params: { name, arguments: args },
  }, headers)
  const result = response.json.result
  return { isError: result.isError === true, ...(JSON.parse(result.content[0].text) as { status: number; body: any }) }
}

async function bearer(email: string, password: string) {
  const login = await call('POST', '/auth/login', { email, password, transport: 'bearer' })
  assert.equal(login.status, 200)
  return { authorization: `Bearer ${login.json.token}` }
}

test('artifact content hides seed names from other tenants and follows exact artifact grants on HTTP and MCP', async () => {
  const priorAuthGate = process.env.AUTH_GATE
  process.env.AUTH_GATE = 'require'
  try {
    const owner = await bearer('ada@acme.example', 'ada-demo-password')
    const foreign = await bearer('grace@acme.example', 'grace-demo-password')
    const seedId = 'a1'
    const seedName = 'insights-onepager.md'

    const ownerHttp = await call('GET', '/artifact-content', undefined, owner)
    const ownerMcp = await toolCall('get_artifact_content', {}, owner)
    assert.equal(ownerHttp.status, 200)
    assert.equal(ownerMcp.status, 200)
    assert.equal(ownerMcp.isError, false)
    assert.ok(ownerHttp.json[seedId], 'owner retains the seeded body under its exact id')
    assert.deepEqual(ownerHttp.json[seedName], ownerHttp.json[seedId], 'the unique owner body retains its filename alias')
    assert.deepEqual(ownerMcp.body, ownerHttp.json, 'MCP is the same authorized projection')

    const foreignHttp = await call('GET', '/artifact-content', undefined, foreign)
    const foreignMcp = await toolCall('get_artifact_content', {}, foreign)
    assert.equal(foreignHttp.status, 200)
    assert.equal(foreignMcp.status, 200)
    assert.equal(foreignMcp.isError, false)
    assert.equal(foreignHttp.json[seedId], undefined, 'foreign tenant has no seeded exact id')
    assert.equal(foreignHttp.json[seedName], undefined, 'foreign tenant has no seeded filename alias')
    assert.equal(foreignMcp.body[seedId], undefined)
    assert.equal(foreignMcp.body[seedName], undefined)
    assert.deepEqual(foreignMcp.body, foreignHttp.json)

    // The development identity seam can name a tenant absent from the demo
    // roster. It must still receive a tenant projection, never the seed library.
    delete process.env.AUTH_GATE
    const unknown = { 'x-user-id': 'user-unknown-artifact-reader', 'x-tenant-id': 'tenant-unknown-artifact-reader' }
    const unknownHttp = await call('GET', '/artifact-content', undefined, unknown)
    const unknownMcp = await toolCall('get_artifact_content', {}, unknown)
    assert.equal(unknownHttp.status, 200)
    assert.equal(unknownMcp.status, 200)
    assert.equal(unknownMcp.isError, false)
    assert.equal(unknownHttp.json[seedId], undefined)
    assert.equal(unknownHttp.json[seedName], undefined)
    assert.deepEqual(unknownMcp.body, unknownHttp.json)
    process.env.AUTH_GATE = 'require'

    const grant = await call('POST', '/grants', {
      subject: { kind: 'artifact', id: seedId },
      audience: { kind: 'org', orgId: 'tenant-beta' },
      tier: 'view',
    }, owner)
    assert.equal(grant.status, 200, 'owner can share the exact seeded artifact')
    try {
      const grantedHttp = await call('GET', '/artifact-content', undefined, foreign)
      const grantedMcp = await toolCall('get_artifact_content', {}, foreign)
      assert.equal(grantedHttp.status, 200)
      assert.equal(grantedMcp.status, 200)
      assert.equal(grantedMcp.isError, false)
      assert.ok(grantedHttp.json[seedId], 'the granted exact body appears by id')
      assert.deepEqual(grantedHttp.json[seedName], grantedHttp.json[seedId], 'the unique granted body keeps its compatibility alias')
      assert.deepEqual(grantedMcp.body, grantedHttp.json)
    } finally {
      const revoked = await call('DELETE', `/grants/${grant.json.id}`, undefined, owner)
      assert.equal(revoked.status, 200)
    }

    const revokedHttp = await call('GET', '/artifact-content', undefined, foreign)
    const revokedMcp = await toolCall('get_artifact_content', {}, foreign)
    assert.equal(revokedHttp.status, 200)
    assert.equal(revokedMcp.status, 200)
    assert.equal(revokedMcp.isError, false)
    assert.equal(revokedHttp.json[seedId], undefined, 'revocation withdraws the exact body')
    assert.equal(revokedHttp.json[seedName], undefined, 'revocation withdraws its alias')
    assert.equal(revokedMcp.body[seedId], undefined)
    assert.equal(revokedMcp.body[seedName], undefined)
    assert.deepEqual(revokedMcp.body, revokedHttp.json)
  } finally {
    if (priorAuthGate === undefined) delete process.env.AUTH_GATE
    else process.env.AUTH_GATE = priorAuthGate
  }
})
