import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CREDENTIAL_VAULT_FILE,
  MAX_VAULT_ENTRIES,
  openCredentialVault,
  secureStorageAvailable,
} from './credentialVault.mjs'

const mask = (value: string): Buffer => Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5)
const unmask = (value: Buffer): string => Buffer.from(value).map((byte) => byte ^ 0xa5).toString('utf8')

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-vault-test-'))
  const filePath = join(directory, CREDENTIAL_VAULT_FILE)
  const vault = await openCredentialVault({ filePath, encrypt: mask, decrypt: unmask, now: () => 1234 })
  return { directory, filePath, vault }
}

test('secure credential availability rejects missing encryption and Linux basic_text', () => {
  assert.equal(secureStorageAvailable({ platform: 'darwin', encryptionAvailable: true }), true)
  assert.equal(secureStorageAvailable({ platform: 'win32', encryptionAvailable: false }), false)
  assert.equal(secureStorageAvailable({ platform: 'linux', encryptionAvailable: true, linuxBackend: 'gnome_libsecret' }), true)
  assert.equal(secureStorageAvailable({ platform: 'linux', encryptionAvailable: true, linuxBackend: 'basic_text' }), false)
  assert.equal(secureStorageAvailable({ platform: 'linux', encryptionAvailable: true, linuxBackend: 'unknown' }), false)
})

test('the vault persists ciphertext only, restores ephemeral environment values, and removes by provider', async () => {
  const { directory, filePath, vault } = await fixture()
  try {
    const secret = 'sk-device-secret-that-must-not-land-on-disk'
    const reference = await vault.provision(secret)
    assert.match(reference, /^PROVIDER_DESKTOP_[A-F0-9]{32}$/)
    assert.equal((await readFile(filePath, 'utf8')).includes(secret), false)
    assert.deepEqual(await vault.environment(), { [reference]: secret })

    await vault.bind(reference, 'provider-42')
    const reopened = await openCredentialVault({ filePath, encrypt: mask, decrypt: unmask })
    assert.deepEqual(await reopened.environment(), { [reference]: secret })
    assert.deepEqual(await reopened.removeProvider('provider-42'), [reference])
    assert.deepEqual(await reopened.environment(), {})
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('startup reconciliation binds referenced credentials and deletes abandoned or removed entries', async () => {
  const { directory, filePath, vault } = await fixture()
  try {
    const live = await vault.provision('live-key')
    const orphan = await vault.provision('abandoned-before-provider-create')
    await vault.reconcile([{ reference: live, providerId: 'provider-7' }])
    assert.deepEqual(await vault.environment(), { [live]: 'live-key' })
    assert.equal((await readFile(filePath, 'utf8')).includes(orphan), false)
    assert.deepEqual(await vault.removeProvider('provider-7'), [live], 'reconciliation repaired the provider binding')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('binding a replacement leaves exactly one credential for a provider', async () => {
  const { directory, vault } = await fixture()
  try {
    const previous = await vault.provision('previous-key')
    const replacement = await vault.provision('replacement-key')
    assert.deepEqual(await vault.bind(previous, 'provider-9'), [])
    assert.deepEqual(await vault.bind(replacement, 'provider-9'), [previous])
    assert.deepEqual(await vault.environment(), { [replacement]: 'replacement-key' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the vault fails closed on corrupt structure, invalid secrets, and a full entry set', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-vault-corrupt-'))
  const filePath = join(directory, CREDENTIAL_VAULT_FILE)
  try {
    await writeFile(filePath, '{"version":1,"entries":{"ANTHROPIC_API_KEY":{}}}')
    await assert.rejects(() => openCredentialVault({ filePath, encrypt: mask, decrypt: unmask }), /invalid entry/)

    await writeFile(filePath, JSON.stringify({ version: 1, entries: {} }))
    let sequence = 0
    const vault = await openCredentialVault({ filePath, encrypt: mask, decrypt: unmask, random: (size: number) => {
      const value = Buffer.alloc(size)
      value.writeUInt32BE((sequence += 1), Math.max(0, size - 4))
      return value
    } })
    await assert.rejects(() => vault.provision(''), /1–8,192/)
    await assert.rejects(() => vault.provision(`bad\0key`), /1–8,192/)
    for (let index = 0; index < MAX_VAULT_ENTRIES; index += 1) await vault.provision(`secret-${index}`)
    await assert.rejects(() => vault.provision('one-too-many'), /already holds/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
