import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  DESKTOP_CREDENTIAL_PREFIX,
  isDesktopCredentialReference,
  isProviderId,
  validCredentialSecret,
} from './credentialProtocol.mjs'

export const CREDENTIAL_VAULT_FILE = 'provider-credentials.v1.json'
export const MAX_VAULT_ENTRIES = 64
const MAX_CIPHERTEXT_CHARS = 32_768

function emptyState() {
  return { version: 1, entries: {} }
}

function cloneState(state) {
  return { version: 1, entries: Object.fromEntries(Object.entries(state.entries).map(([key, value]) => [key, { ...value }])) }
}

function validBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CIPHERTEXT_CHARS || value.length % 4 !== 0) return false
  try {
    return Buffer.from(value, 'base64').toString('base64') === value
  } catch {
    return false
  }
}

function parseState(raw) {
  const parsed = JSON.parse(raw)
  if (!parsed || parsed.version !== 1 || !parsed.entries || Array.isArray(parsed.entries) || typeof parsed.entries !== 'object') {
    throw new Error('The desktop credential vault has an unsupported format.')
  }
  const entries = Object.entries(parsed.entries)
  if (entries.length > MAX_VAULT_ENTRIES) throw new Error('The desktop credential vault exceeds its entry limit.')
  for (const [reference, entry] of entries) {
    if (
      !isDesktopCredentialReference(reference) ||
      !entry ||
      typeof entry !== 'object' ||
      !validBase64(entry.ciphertext) ||
      !Number.isSafeInteger(entry.createdAt) ||
      entry.createdAt < 0 ||
      (entry.providerId !== undefined && !isProviderId(entry.providerId))
    ) {
      throw new Error('The desktop credential vault contains an invalid entry.')
    }
  }
  return parsed
}

async function loadState(filePath) {
  try {
    return parseState(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyState()
    throw error
  }
}

async function saveState(filePath, state) {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, filePath)
    await chmod(filePath, 0o600)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

/** Electron safeStorage is useful only when it resolves to an OS-backed key.
 * Linux is fail-closed unless Electron reports a known secure backend. */
export function secureStorageAvailable({ platform = process.platform, encryptionAvailable, linuxBackend }) {
  if (!encryptionAvailable) return false
  if (platform !== 'linux') return true
  return ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(linuxBackend)
}

/** An encrypted write-only vault. Its public surface has no list/read/decrypt
 * operation: decryption is used only to construct the supervised backend's
 * ephemeral environment at boot. */
export async function openCredentialVault({ filePath, encrypt, decrypt, now = () => Date.now(), random = randomBytes }) {
  if (!filePath || typeof encrypt !== 'function' || typeof decrypt !== 'function') {
    throw new Error('Credential vault storage and encryption are required.')
  }
  let state = await loadState(filePath)
  let mutationQueue = Promise.resolve()

  const mutate = (mutation) => {
    const operation = mutationQueue.then(async () => {
      const next = cloneState(state)
      const result = await mutation(next)
      await saveState(filePath, next)
      state = next
      return result
    })
    mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  return {
    async environment() {
      await mutationQueue
      const environment = {}
      for (const [reference, entry] of Object.entries(state.entries)) {
        const secret = await decrypt(Buffer.from(entry.ciphertext, 'base64'))
        if (!validCredentialSecret(secret)) throw new Error('A stored desktop credential could not be decrypted safely.')
        environment[reference] = secret
      }
      return environment
    },
    provision(secret) {
      if (!validCredentialSecret(secret)) return Promise.reject(new Error('API keys must contain 1–8,192 characters.'))
      return mutate(async (next) => {
        if (Object.keys(next.entries).length >= MAX_VAULT_ENTRIES) {
          throw new Error(`This device already holds ${MAX_VAULT_ENTRIES} provider credentials.`)
        }
        let reference
        do reference = `${DESKTOP_CREDENTIAL_PREFIX}${random(16).toString('hex').toUpperCase()}`
        while (next.entries[reference])
        const ciphertext = (await encrypt(secret)).toString('base64')
        if (!validBase64(ciphertext)) throw new Error('The operating system returned an invalid encrypted credential.')
        next.entries[reference] = { ciphertext, createdAt: now() }
        return reference
      })
    },
    bind(reference, providerId) {
      if (!isDesktopCredentialReference(reference) || !isProviderId(providerId)) {
        return Promise.reject(new Error('Credential binding is invalid.'))
      }
      return mutate((next) => {
        if (!next.entries[reference]) throw new Error('The credential is no longer available on this device.')
        next.entries[reference].providerId = providerId
        const removed = []
        for (const [candidate, entry] of Object.entries(next.entries)) {
          if (candidate === reference || entry.providerId !== providerId) continue
          delete next.entries[candidate]
          removed.push(candidate)
        }
        return removed
      })
    },
    discard(reference) {
      if (!isDesktopCredentialReference(reference)) return Promise.reject(new Error('Credential reference is invalid.'))
      return mutate((next) => {
        delete next.entries[reference]
      })
    },
    removeProvider(providerId) {
      if (!isProviderId(providerId)) return Promise.reject(new Error('Provider identity is invalid.'))
      return mutate((next) => {
        const removed = []
        for (const [reference, entry] of Object.entries(next.entries)) {
          if (entry.providerId !== providerId) continue
          delete next.entries[reference]
          removed.push(reference)
        }
        return removed
      })
    },
    reconcile(bindings) {
      return mutate((next) => {
        const live = new Map(
          (Array.isArray(bindings) ? bindings : [])
            .filter((binding) => isDesktopCredentialReference(binding?.reference) && isProviderId(binding?.providerId))
            .map((binding) => [binding.reference, binding.providerId]),
        )
        const removed = []
        for (const reference of Object.keys(next.entries)) {
          const providerId = live.get(reference)
          if (!providerId) {
            delete next.entries[reference]
            removed.push(reference)
          } else {
            next.entries[reference].providerId = providerId
          }
        }
        return removed
      })
    },
  }
}
