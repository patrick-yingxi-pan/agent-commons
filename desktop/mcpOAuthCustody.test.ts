import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MCP_CREDENTIAL_FILE, openMcpCredentialVault } from './mcpCredentialVault.mjs'

const encrypt = (text: string) => Buffer.from(text).map(byte => byte ^ 0xa5)
const decrypt = (bytes: Buffer) => Buffer.from(bytes).map(byte => byte ^ 0xa5).toString('utf8')
const binding = { tenantId: 'tenant-oauth', connectionId: 'mcp-oauth', endpoint: 'https://mcp.example/tools' }
const ownerId = 'owner-oauth'
const grant = () => ({ issuer: 'https://login.example/issuer', tokenEndpoint: 'https://login.example/token',
  clientId: 'native client', resource: 'https://mcp.example/tools', scopes: ['read', 'offline_access'],
  accessToken: 'private-access', refreshToken: 'private refresh', expiresAt: 1000 })

async function fixture(run, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-oauth-custody-'))
  const filePath = join(directory, MCP_CREDENTIAL_FILE)
  const reopen = () => openMcpCredentialVault({ filePath, encrypt, decrypt, ...options })
  try { await run({ vault: await reopen(), filePath, reopen }) }
  finally { await rm(directory, { recursive: true, force: true }) }
}
async function stored(filePath: string, reference: string) {
  const state = JSON.parse(await readFile(filePath, 'utf8'))
  return JSON.parse(decrypt(Buffer.from(state.entries[reference].ciphertext, 'base64')))
}

test('an OAuth resource must be the canonical audience of the stored MCP endpoint', async () => {
  await fixture(async ({ vault }) => {
    for (const resource of ['https://other.example/tools', 'https://mcp.example', 'https://mcp.example/tools?other=1']) {
      await assert.rejects(Promise.resolve().then(() => vault.provisionOAuth(binding, ownerId, { ...grant(), resource })))
    }
    const root = { ...binding, endpoint: 'https://mcp.example/' }
    const reference = await vault.provisionOAuth(root, ownerId, { ...grant(), resource: 'https://mcp.example' })
    assert.equal((await vault.readOAuth(reference, root, ownerId)).grant.resource, 'https://mcp.example')
  })
})

test('OAuth grants remain encrypted, detached, owner-bound and unavailable through generic bearer resolution', async () => {
  await fixture(async ({ vault, filePath, reopen }) => {
    const raw = grant()
    const reference = await vault.provisionOAuth(binding, ownerId, raw)
    raw.scopes.push('write'); raw.refreshToken = 'changed'
    const value = await vault.readOAuth(reference, binding, ownerId)
    assert.deepEqual(value, { ownerId, generation: 0, state: 'ready', grant: grant() })
    assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.grant)); assert.ok(Object.isFrozen(value.grant.scopes))
    const disk = await readFile(filePath, 'utf8')
    for (const privateText of [ownerId, binding.tenantId, binding.endpoint, ...Object.values(grant()).filter(value => typeof value === 'string')]) {
      assert.equal(disk.includes(privateText), false)
    }
    await assert.rejects(vault.read(reference, binding), /unavailable/)
    for (const foreign of [ { ...binding, tenantId: 'other' }, { ...binding, connectionId: 'other' }, { ...binding, endpoint: 'https://other.example/tools' } ]) {
      await assert.rejects(vault.readOAuth(reference, foreign, ownerId))
    }
    await assert.rejects(vault.readOAuth(reference, binding, 'other-owner'))
    assert.deepEqual(await (await reopen()).readOAuth(reference, binding, ownerId), value)
    assert.equal(await readFile(filePath, 'utf8'), disk, 'reads and refusals cannot rewrite credentials')
  })
})

test('initial OAuth custody rechecks its native authority before encryption and at atomic publication', async () => {
  for (const phase of ['queued', 'encrypt', 'file']) {
    let current = true, armed = false, encryptions = 0
    await fixture(async ({ vault, filePath }) => {
      await vault.provision({ ...binding, connectionId: 'unrelated' }, 'unrelated-token')
      const before = await readFile(filePath, 'utf8')
      const count = encryptions
      armed = true
      const pending = vault.provisionOAuth(binding, ownerId, grant(), () => current)
      if (phase === 'queued') current = false
      await assert.rejects(pending)
      assert.equal(await readFile(filePath, 'utf8'), before, phase)
      if (phase === 'queued') assert.equal(encryptions, count, 'stale queued work never encrypts')
    }, {
      encrypt: async text => { encryptions++; if (armed && phase === 'encrypt') current = false; return encrypt(text) },
      fsApi: { async syncFile(filePath) {
        const fs = await import('node:fs/promises')
        const file = await fs.open(filePath, 'r+')
        try { await file.sync() } finally { await file.close() }
        if (armed && phase === 'file') current = false
      } },
    })
  }
})

test('reservation atomically removes tokens before returning them, and restart cannot reserve or complete again', async () => {
  await fixture(async ({ vault, filePath, reopen }) => {
    const reference = await vault.provisionOAuth(binding, ownerId, grant())
    const { ticket, grant: prior } = await vault.reserveOAuthRefresh(reference, binding, ownerId, 0, () => true)
    assert.deepEqual(prior, grant()); assert.ok(Object.isFrozen(ticket))
    const payload = await stored(filePath, reference)
    assert.equal(payload.oauth.state, 'refreshing')
    assert.equal(payload.oauth.generation, 1)
    assert.equal(JSON.stringify(payload).includes('private-access'), false)
    assert.equal(JSON.stringify(payload).includes('private refresh'), false)
    assert.equal((await vault.readOAuth(reference, binding, ownerId)).state, 'refreshing')
    await assert.rejects(vault.reserveOAuthRefresh(reference, binding, ownerId, 1, () => true))
    const restarted = await reopen()
    assert.equal((await restarted.readOAuth(reference, binding, ownerId)).state, 'reauthorization-required')
    for (const stale of [ticket, {}, undefined, null]) {
      await assert.rejects(restarted.completeOAuthRefresh(reference, binding, ownerId, stale, grant(), () => true))
    }
    await assert.rejects(restarted.reserveOAuthRefresh(reference, binding, ownerId, 1, () => true))
  })
})

test('completion requires exact live ticket, owner, audience and scope ceiling and rotates one full bundle', async () => {
  await fixture(async ({ vault, reopen }) => {
    const reference = await vault.provisionOAuth(binding, ownerId, grant())
    const { ticket } = await vault.reserveOAuthRefresh(reference, binding, ownerId, 0, () => true)
    for (const change of [ { issuer: 'https://other.example' }, { tokenEndpoint: 'https://other.example/token' },
      { clientId: 'other' }, { resource: 'https://other.example/tools' }, { scopes: ['admin'] } ]) {
      await assert.rejects(vault.completeOAuthRefresh(reference, binding, ownerId, ticket, { ...grant(), ...change }, () => true))
    }
    await assert.rejects(vault.completeOAuthRefresh(reference, binding, 'other-owner', ticket, grant(), () => true))
    await assert.rejects(vault.completeOAuthRefresh(reference, binding, ownerId, {}, grant(), () => true))
    await assert.rejects(vault.completeOAuthRefresh(reference, binding, ownerId, ticket, grant(), () => false))
    const next = { ...grant(), accessToken: 'new.access', refreshToken: 'rotated.refresh', expiresAt: 5000, scopes: ['read'] }
    await vault.completeOAuthRefresh(reference, binding, ownerId, ticket, next, () => true)
    assert.deepEqual((await (await reopen()).readOAuth(reference, binding, ownerId)).grant, next)
    await assert.rejects(vault.completeOAuthRefresh(reference, binding, ownerId, ticket, grant(), () => true))
    await assert.rejects(vault.reserveOAuthRefresh(reference, binding, ownerId, 0, () => true))
    const second = await vault.reserveOAuthRefresh(reference, binding, ownerId, 1, () => true)
    assert.notEqual(second.ticket, ticket)
    vault.abandonOAuthRefresh(reference, ticket)
    assert.equal((await vault.readOAuth(reference, binding, ownerId)).state, 'refreshing')
    vault.abandonOAuthRefresh(reference, second.ticket)
    await assert.rejects(vault.completeOAuthRefresh(reference, binding, ownerId, second.ticket, next, () => true))
    assert.equal((await vault.readOAuth(reference, binding, ownerId)).state, 'reauthorization-required')
  })
})

test('concurrent reservations admit exactly one generation and never return the same refresh authority twice', async () => {
  await fixture(async ({ vault }) => {
    const reference = await vault.provisionOAuth(binding, ownerId, grant())
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => vault.reserveOAuthRefresh(reference, binding, ownerId, 0, () => true)))
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(attempts.filter(result => result.status === 'rejected').length, 7)
  })
})

test('ordinary startup reconciliation and discard validate both credential kinds without exposing or resurrecting OAuth', async () => {
  await fixture(async ({ vault, reopen }) => {
    const reference = await vault.provisionOAuth(binding, ownerId, grant())
    const bearerBinding = { ...binding, connectionId: 'bearer' }
    const bearer = await vault.provision(bearerBinding, 'plain-bearer')
    const reopened = await reopen()
    assert.deepEqual(await reopened.reconcile([{ reference, binding }, { reference: bearer, binding: bearerBinding }]), [])
    assert.equal(await reopened.read(bearer, bearerBinding), 'plain-bearer')
    await assert.rejects(reopened.readOAuth(bearer, bearerBinding, ownerId))
    const { ticket } = await reopened.reserveOAuthRefresh(reference, binding, ownerId, 0, () => true)
    assert.equal(await reopened.discard(reference, binding), true)
    await assert.rejects(reopened.completeOAuthRefresh(reference, binding, ownerId, ticket, grant(), () => true))
    assert.deepEqual(await reopened.reconcile([]), [bearer])
    await assert.rejects((await reopen()).readOAuth(reference, binding, ownerId))
  })
})

test('corrupt typed payloads and ciphertext substitution fail closed without modifying disk', async () => {
  for (const corrupt of [ value => { value.oauth.extra = true }, value => { value.oauth.grant.scopes = ['bad scope'] },
    value => { value.oauth.grant.resource = 'https://other.example/tools' },
    value => { value.oauth.generation = -1 }, value => { value.oauth.state = 'ready'; delete value.oauth.grant },
    value => { value.version = 3 }, value => { value.reference = `MCP_DESKTOP_${'0'.repeat(32)}` },
    value => { value.oauth.state = 'refreshing'; value.oauth.authority = {}; } ]) {
    await fixture(async ({ vault, filePath, reopen }) => {
      const reference = await vault.provisionOAuth(binding, ownerId, grant())
      const state = JSON.parse(await readFile(filePath, 'utf8'))
      const payload = await stored(filePath, reference)
      corrupt(payload)
      state.entries[reference].ciphertext = encrypt(JSON.stringify(payload)).toString('base64')
      await writeFile(filePath, JSON.stringify(state))
      const before = await readFile(filePath)
      const reopened = await reopen()
      await assert.rejects(reopened.readOAuth(reference, binding, ownerId))
      await assert.rejects(reopened.reconcile([{ reference, binding }]))
      await assert.rejects(reopened.discard(reference, binding))
      assert.deepEqual(await readFile(filePath), before)
    })
  }
})

test('pre-publication reservation failure retains unsubmitted tokens; uncertain publication retires them after reopen', async () => {
  let failure: string | undefined
  await fixture(async ({ vault, filePath, reopen }) => {
    const reference = await vault.provisionOAuth(binding, ownerId, grant())
    const before = await readFile(filePath)
    failure = 'rename'
    await assert.rejects(vault.reserveOAuthRefresh(reference, binding, ownerId, 0, () => true))
    assert.deepEqual(await readFile(filePath), before)
    assert.equal((await vault.readOAuth(reference, binding, ownerId)).state, 'ready')
    failure = 'directory'
    await assert.rejects(vault.reserveOAuthRefresh(reference, binding, ownerId, 0, () => true))
    await assert.rejects(vault.readOAuth(reference, binding, ownerId), /unavailable/)
    failure = undefined
    assert.equal((await (await reopen()).readOAuth(reference, binding, ownerId)).state, 'reauthorization-required')
  }, { fsApi: {
    async rename(from, to) { if (failure === 'rename') throw new Error('fixture'); const fs = await import('node:fs/promises'); await fs.rename(from, to) },
    async syncDirectory() { if (failure === 'directory') throw new Error('fixture') },
  } })
})

test('publication fence is rechecked after asynchronous encryption and a late stale result cannot restore tokens', async () => {
  let current = true
  let staleOnEncrypt = false
  await fixture(async ({ vault, reopen }) => {
    const reference = await vault.provisionOAuth(binding, ownerId, grant())
    const { ticket } = await vault.reserveOAuthRefresh(reference, binding, ownerId, 0, () => true)
    staleOnEncrypt = true
    await assert.rejects(vault.completeOAuthRefresh(reference, binding, ownerId, ticket, grant(), () => current))
    assert.equal((await (await reopen()).readOAuth(reference, binding, ownerId)).state, 'reauthorization-required')
  }, { encrypt: async text => { if (staleOnEncrypt) current = false; return encrypt(text) } })
})

test('largest admitted token pair and authority fit the encrypted entry without raising the shared entry count', async () => {
  await fixture(async ({ vault, reopen }) => {
    const large = { ...grant(), accessToken: '"'.repeat(8192), refreshToken: '\\'.repeat(8192), clientId: '"'.repeat(2048) }
    const reference = await vault.provisionOAuth(binding, ownerId, large)
    assert.deepEqual((await (await reopen()).readOAuth(reference, binding, ownerId)).grant, large)
  })
})

test('publication fence rechecks after temporary-file I/O, before the atomic rename', async () => {
  let current = true
  let staleOnSync = false
  await fixture(async ({ vault, reopen }) => {
    const reference = await vault.provisionOAuth(binding, ownerId, grant())
    const { ticket } = await vault.reserveOAuthRefresh(reference, binding, ownerId, 0, () => true)
    staleOnSync = true
    await assert.rejects(vault.completeOAuthRefresh(reference, binding, ownerId, ticket, grant(), () => current))
    assert.equal((await (await reopen()).readOAuth(reference, binding, ownerId)).state, 'reauthorization-required')
  }, { fsApi: { async syncFile() { if (staleOnSync) current = false } } })
})
