import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MCP_CREDENTIAL_FILE, openMcpCredentialVault } from './mcpCredentialVault.mjs'

const encrypt = (value: string): Buffer => Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5)
const decrypt = (value: Buffer): string => Buffer.from(value).map((byte) => byte ^ 0xa5).toString('utf8')

function binding(index = 'one', endpoint = 'HTTPS://Example.com:443/mcp'): { tenantId: string; connectionId: string; endpoint: string } {
  return { tenantId: 'tenant-alpha', connectionId: `connection-${index}`, endpoint }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-mcp-vault-'))
  const filePath = join(directory, MCP_CREDENTIAL_FILE)
  const vault = await openMcpCredentialVault({ filePath, encrypt, decrypt, now: () => 1234 })
  return { directory, filePath, vault }
}

async function close(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true })
}

test('provision is immediately bound, survives restart, canonicalizes endpoints, and stores ciphertext only', async () => {
  const { directory, filePath, vault } = await fixture()
  try {
    const secret = 'mcp-bearer-secret-rotated'
    const reference = await vault.provision(binding(), secret)
    assert.match(reference, /^MCP_DESKTOP_[A-F0-9]{32}$/)
    assert.equal(await vault.read(reference, binding('one', 'https://example.com/mcp')), secret)

    const raw = await readFile(filePath, 'utf8')
    assert.equal(raw.includes(secret), false)
    assert.equal(raw.includes('tenant-alpha'), false)
    assert.equal(raw.includes('connection-one'), false)
    assert.equal(raw.includes('example.com'), false)
    const parsed = JSON.parse(raw)
    assert.deepEqual(Object.keys(parsed.entries[reference]).sort(), ['ciphertext', 'createdAt'])
    assert.equal((await stat(directory)).mode & 0o777, 0o700)
    assert.equal((await stat(filePath)).mode & 0o777, 0o600)

    const reopened = await openMcpCredentialVault({ filePath, encrypt, decrypt })
    assert.equal(await reopened.read(reference, binding('one', 'https://EXAMPLE.com:443/mcp')), secret)
    assert.equal(await reopened.discard(reference, binding('one', 'https://example.com/mcp')), true)
    assert.equal(await reopened.discard(reference, binding('one', 'https://example.com/mcp')), false)
  } finally {
    await close(directory)
  }
})

test('bindings, references, secrets, controls, and endpoint schemes are strictly bounded', async () => {
  const { directory, vault } = await fixture()
  try {
    const valid = binding()
    for (const bad of [
      { ...valid, tenantId: '' },
      { ...valid, tenantId: 'bad\nname' },
      { ...valid, connectionId: 'x'.repeat(257) },
      { ...valid, endpoint: 'ftp://example.com/mcp' },
      { ...valid, endpoint: 'https://user:secret@example.com/mcp' },
      { ...valid, endpoint: 'https://example.com/mcp#fragment' },
      { ...valid, endpoint: 'https://example.com/mcp#' },
      { ...valid, endpoint: 'https://example.com/\u0000mcp' },
    ]) assert.throws(() => vault.provision(bad, 'secret'))
    const endpointPrefix = 'https://example.com/'
    const longEndpoint = `${endpointPrefix}${'x'.repeat(2_048 - endpointPrefix.length)}`
    const longReference = await vault.provision({ ...valid, connectionId: 'long-endpoint', endpoint: longEndpoint }, 'long-endpoint-secret')
    assert.equal(await vault.read(longReference, { ...valid, connectionId: 'long-endpoint', endpoint: longEndpoint }), 'long-endpoint-secret')
    assert.throws(() => vault.provision({ ...valid, connectionId: 'too-long-endpoint', endpoint: `${longEndpoint}x` }, 'secret'))
    assert.throws(() => vault.provision(valid, ''))
    assert.throws(() => vault.provision(valid, ' leading-space'))
    assert.throws(() => vault.provision(valid, 'trailing-space '))
    assert.throws(() => vault.provision(valid, 'bad\rsecret'))
    assert.throws(() => vault.provision(valid, 'x'.repeat(8_193)))
    await assert.rejects(vault.read('MCP_DESKTOP_bad', valid))
    assert.throws(() => vault.discard('MCP_DESKTOP_bad', valid))
  } finally {
    await close(directory)
  }
})

test('allows multiple immediately bound references during credential rotation', async () => {
  const { directory, vault } = await fixture()
  try {
    const target = binding('rotation')
    const oldReference = await vault.provision(target, 'old-bearer-secret')
    const newReference = await vault.provision(target, 'new-bearer-secret')
    assert.notEqual(oldReference, newReference)
    assert.equal(await vault.read(oldReference, target), 'old-bearer-secret')
    assert.equal(await vault.read(newReference, target), 'new-bearer-secret')
  } finally {
    await close(directory)
  }
})

test('cross-tenant reads, binding mismatch, and ciphertext substitution fail closed', async () => {
  const { directory, filePath, vault } = await fixture()
  try {
    const first = binding('first')
    const second = { ...binding('second'), tenantId: 'tenant-beta' }
    const firstReference = await vault.provision(first, 'first-secret')
    const secondReference = await vault.provision(second, 'second-secret')
    await assert.rejects(vault.read(firstReference, second), /binding/i)
    assert.equal(await vault.read(firstReference, first), 'first-secret')

    const parsed = JSON.parse(await readFile(filePath, 'utf8'))
    const firstCiphertext = parsed.entries[firstReference].ciphertext
    parsed.entries[firstReference].ciphertext = parsed.entries[secondReference].ciphertext
    parsed.entries[secondReference].ciphertext = firstCiphertext
    await writeFile(filePath, JSON.stringify(parsed))
    const reopened = await openMcpCredentialVault({ filePath, encrypt, decrypt })
    await assert.rejects(reopened.read(firstReference, first), /decrypted|binding/i)
    await assert.rejects(reopened.read(secondReference, second), /decrypted|binding/i)
  } finally {
    await close(directory)
  }
})

test('reconcile rejects contradictory snapshots before mutation and removes only absent bindings', async () => {
  const { directory, filePath, vault } = await fixture()
  try {
    const live = binding('live')
    const orphan = binding('orphan')
    const liveReference = await vault.provision(live, 'live-secret')
    const orphanReference = await vault.provision(orphan, 'orphan-secret')
    const before = await readFile(filePath)
    const conflicting = { ...live, tenantId: 'tenant-beta' }
    assert.throws(() => vault.reconcile([{ reference: liveReference, binding: live, extra: true }]), /invalid/i)
    assert.throws(() => vault.reconcile(Array.from({ length: 4_097 }, () => ({ reference: liveReference, binding: live }))), /invalid/i)
    assert.throws(() => vault.reconcile([
      { reference: liveReference, binding: live },
      { reference: liveReference, binding: conflicting },
    ]), /contradictory/i)
    assert.deepEqual(await readFile(filePath), before)
    assert.throws(() => vault.reconcile([
      { reference: liveReference, binding: live },
      { reference: `MCP_DESKTOP_${'F'.repeat(32)}`, binding: live },
    ]), /contradictory/i)
    assert.deepEqual(await readFile(filePath), before)

    assert.deepEqual(await vault.reconcile([{ reference: liveReference, binding: live }]), [orphanReference])
    assert.equal(await vault.read(liveReference, live), 'live-secret')
    await assert.rejects(vault.read(orphanReference, orphan))
  } finally {
    await close(directory)
  }
})

test('decrypt failure never rotates or deletes the stored ciphertext', async () => {
  const { directory, filePath, vault } = await fixture()
  try {
    const target = binding('corrupt')
    const reference = await vault.provision(target, 'protected-secret')
    const parsed = JSON.parse(await readFile(filePath, 'utf8'))
    parsed.entries[reference].ciphertext = Buffer.from('not-json-after-decrypt').toString('base64')
    await writeFile(filePath, JSON.stringify(parsed))
    const before = await readFile(filePath)
    const reopened = await openMcpCredentialVault({ filePath, encrypt, decrypt })
    await assert.rejects(reopened.read(reference, target), /decrypted/i)
    await assert.rejects(reopened.reconcile([{ reference, binding: target }]), /decrypted/i)
    assert.deepEqual(await readFile(filePath), before)
  } finally {
    await close(directory)
  }
})

test('failed encryption leaves the prior state intact and the vault remains mutable', async () => {
  const { directory, filePath, vault } = await fixture()
  try {
    const target = binding('write-failure')
    const firstReference = await vault.provision(target, 'first-secret')
    const before = await readFile(filePath)
    let shouldFail = true
    const failing = await openMcpCredentialVault({
      filePath,
      encrypt: async (value: string) => {
        if (shouldFail) throw new Error('simulated encryption failure')
        return encrypt(value)
      },
      decrypt,
    })
    await assert.rejects(failing.provision(binding('failed'), 'second-secret'), /encrypted/i)
    assert.deepEqual(await readFile(filePath), before)
    shouldFail = false
    const secondReference = await failing.provision(binding('recovered'), 'second-secret')
    assert.notEqual(firstReference, secondReference)
    assert.equal(await failing.read(firstReference, target), 'first-secret')
  } finally {
    await close(directory)
  }
})

test('post-publication directory-sync failure fences the vault until reopen', async () => {
  const { directory, filePath } = await fixture()
  try {
    let failDirectorySync = true
    const target = binding('publication-failure')
    const vault = await openMcpCredentialVault({
      filePath,
      encrypt,
      decrypt,
      fsApi: {
        syncDirectory: async () => {
          if (failDirectorySync) throw new Error('simulated directory sync failure')
        },
      },
    })
    await assert.rejects(vault.provision(target, 'published-secret'), /directory sync failure/i)
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const [reference] = Object.keys(persisted.entries)
    await assert.rejects(vault.read(reference, target), /unavailable/i)
    failDirectorySync = false
    await assert.rejects(vault.provision(binding('blocked'), 'blocked-secret'), /unavailable/i)

    const reopened = await openMcpCredentialVault({ filePath, encrypt, decrypt })
    assert.equal(await reopened.read(reference, target), 'published-secret')
  } finally {
    await close(directory)
  }
})

test('invalid and symlinked vault files fail closed, while concurrent provisioning is serialized and bounded', async () => {
  const { directory, filePath, vault } = await fixture()
  try {
    const references = await Promise.all(Array.from({ length: 64 }, (_, index) =>
      vault.provision(binding(`capacity-${index}`, `https://example.com/mcp/${index}`), `secret-${index}`)))
    assert.equal(new Set(references).size, 64)
    await assert.rejects(vault.provision(binding('overflow'), 'overflow-secret'), /full/i)
    assert.equal(Object.keys(JSON.parse(await readFile(filePath)).entries).length, 64)
  } finally {
    await close(directory)
  }

  const invalidDirectory = await mkdtemp(join(tmpdir(), 'agent-commons-mcp-vault-invalid-'))
  try {
    const invalidPath = join(invalidDirectory, MCP_CREDENTIAL_FILE)
    await writeFile(invalidPath, '{"version":1,"entries":[]}', { mode: 0o600 })
    await assert.rejects(openMcpCredentialVault({ filePath: invalidPath, encrypt, decrypt }), /invalid format/i)
    await chmod(invalidPath, 0o644)
    await assert.rejects(openMcpCredentialVault({ filePath: invalidPath, encrypt, decrypt }), /private regular file/i)
    await chmod(invalidPath, 0o600)
    await writeFile(invalidPath, JSON.stringify({ version: 1, entries: {}, extra: true }), { mode: 0o600 })
    await assert.rejects(openMcpCredentialVault({ filePath: invalidPath, encrypt, decrypt }), /invalid format/i)
    await writeFile(invalidPath, JSON.stringify({ version: 1, entries: { [`MCP_DESKTOP_${'A'.repeat(32)}`]: { ciphertext: 'AAAA', createdAt: 0, extra: true } } }), { mode: 0o600 })
    await assert.rejects(openMcpCredentialVault({ filePath: invalidPath, encrypt, decrypt }), /invalid entry/i)
    await writeFile(invalidPath, 'x'.repeat(3_000_000), { mode: 0o600 })
    await assert.rejects(openMcpCredentialVault({ filePath: invalidPath, encrypt, decrypt }), /size limit/i)
    await rm(invalidPath)
    const target = join(invalidDirectory, 'target.json')
    await writeFile(target, '{"version":1,"entries":{}}', { mode: 0o600 })
    await symlink(target, invalidPath)
    await assert.rejects(openMcpCredentialVault({ filePath: invalidPath, encrypt, decrypt }), /private regular file/i)
  } finally {
    await close(invalidDirectory)
  }
})
