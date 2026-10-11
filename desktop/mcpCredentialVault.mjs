import { randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname } from 'node:path'
import { createMcpOAuthCustody, snapshotMcpOAuthCustody } from './mcpOAuthCustody.mjs'
import { oauthResourceUrl } from './mcpOAuthMetadata.mjs'

export const MCP_CREDENTIAL_FILE = 'mcp-credentials.v1.json'
export const MAX_MCP_VAULT_ENTRIES = 64
const MCP_REFERENCE_PREFIX = 'MCP_DESKTOP_'
const MCP_REFERENCE_PATTERN = /^MCP_DESKTOP_[A-F0-9]{32}$/
const MAX_TEXT_CHARS = 256
const MAX_ENDPOINT_CHARS = 2_048
const MAX_SECRET_CHARS = 8_192
// Two bounded tokens plus authority JSON (including escaping and OS encryption
// overhead). The entry count remains shared with bearer credentials.
const MAX_CIPHERTEXT_CHARS = 131_072
const MAX_RECONCILE_ITEMS = 4_096
export const MAX_MCP_VAULT_BYTES = MAX_MCP_VAULT_ENTRIES * (MAX_CIPHERTEXT_CHARS + 256) + 1_024
const MAX_STATE_BYTES = MAX_MCP_VAULT_BYTES
const PAYLOAD_VERSION = 1

function fail(message = 'The MCP credential vault request is invalid.') {
  throw new Error(message)
}

function printable(value, max = MAX_TEXT_CHARS) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return false
  for (const char of value) {
    const code = char.codePointAt(0)
    if (code === undefined || code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0xd800 && code <= 0xdfff)) return false
  }
  return true
}

function validReference(value) {
  return typeof value === 'string' && MCP_REFERENCE_PATTERN.test(value)
}

function validSecret(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SECRET_CHARS && /^[\x21-\x7e]*$/.test(value)
}

function validBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CIPHERTEXT_CHARS || value.length % 4 !== 0) return false
  try {
    return Buffer.from(value, 'base64').toString('base64') === value
  } catch {
    return false
  }
}

function canonicalBinding(binding) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) fail('The MCP credential binding is invalid.')
  const keys = Object.keys(binding)
  if (keys.length !== 3 || !keys.every((key) => ['tenantId', 'connectionId', 'endpoint'].includes(key))) {
    fail('The MCP credential binding is invalid.')
  }
  if (!printable(binding.tenantId) || !printable(binding.connectionId) || !printable(binding.endpoint, MAX_ENDPOINT_CHARS) || binding.endpoint.includes('#')) {
    fail('The MCP credential binding is invalid.')
  }
  let endpoint
  try {
    endpoint = new URL(binding.endpoint)
  } catch {
    fail('The MCP credential endpoint is invalid.')
  }
  if ((endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password || endpoint.hash) {
    fail('The MCP credential endpoint is invalid.')
  }
  const canonical = endpoint.toString()
  if (!printable(canonical, MAX_ENDPOINT_CHARS)) fail('The MCP credential endpoint is invalid.')
  return Object.freeze({
    tenantId: binding.tenantId,
    connectionId: binding.connectionId,
    endpoint: canonical,
  })
}

function sameBinding(left, right) {
  return left.tenantId === right.tenantId && left.connectionId === right.connectionId && left.endpoint === right.endpoint
}

function oauthAudience(oauth, binding) {
  const resource = oauth.state === 'ready' ? oauth.grant.resource : oauth.authority.resource
  if (resource !== oauthResourceUrl(binding.endpoint)) fail('The MCP credential binding does not match.')
  return oauth
}

function emptyState() {
  return { version: 1, entries: {} }
}

function cloneState(state) {
  return {
    version: 1,
    entries: Object.fromEntries(Object.entries(state.entries).map(([reference, entry]) => [reference, { ...entry }])),
  }
}

function parseState(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    fail('The MCP credential vault has an invalid format.')
  }
  if (!parsed || Object.keys(parsed).length !== 2 || !Object.hasOwn(parsed, 'version') || !Object.hasOwn(parsed, 'entries') || parsed.version !== 1 || !parsed.entries || Array.isArray(parsed.entries) || typeof parsed.entries !== 'object') {
    fail('The MCP credential vault has an invalid format.')
  }
  const entries = Object.entries(parsed.entries)
  if (entries.length > MAX_MCP_VAULT_ENTRIES) fail('The MCP credential vault exceeds its entry limit.')
  for (const [reference, entry] of entries) {
    if (!validReference(reference) || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail('The MCP credential vault contains an invalid entry.')
    }
    const entryKeys = Object.keys(entry)
    if (entryKeys.length !== 2 || entryKeys.some((key) => !['ciphertext', 'createdAt'].includes(key)) ||
      !validBase64(entry.ciphertext) || !Number.isSafeInteger(entry.createdAt) || entry.createdAt < 0) {
      fail('The MCP credential vault contains an invalid entry.')
    }
  }
  return parsed
}

const REAL_FS_API = {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  unlink,
  writeFile,
  async syncFile(filePath) {
    const handle = await open(filePath, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
  async syncDirectory(directory) {
    const handle = await open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
}

async function loadState(filePath, fsApi) {
  let handle
  try {
    handle = await fsApi.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyState()
    if (error?.code === 'ELOOP') fail('The MCP credential vault file is not a private regular file.')
    throw error
  }
  try {
    const info = await handle.stat()
    if (!info.isFile() || (info.mode & 0o077) !== 0) fail('The MCP credential vault file is not a private regular file.')
    if (info.size > MAX_STATE_BYTES) fail('The MCP credential vault file exceeds its size limit.')
    const bytes = Buffer.alloc(info.size)
    let offset = 0
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (result.bytesRead === 0) fail('The MCP credential vault file could not be read safely.')
      offset += result.bytesRead
    }
    const after = await handle.stat()
    if (after.size !== info.size) fail('The MCP credential vault file changed while it was being read.')
    return parseState(bytes.toString('utf8'))
  } finally {
    await handle.close()
  }
}

async function saveState(filePath, state, fsApi, beforePublish) {
  const directory = dirname(filePath)
  await fsApi.mkdir(directory, { recursive: true, mode: 0o700 })
  const directoryInfo = await fsApi.lstat(directory)
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) fail('The MCP credential vault directory is invalid.')
  await fsApi.chmod(directory, 0o700)
  const temporary = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  const serialized = `${JSON.stringify(state, null, 2)}\n`
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) fail('The MCP credential vault file exceeds its size limit.')
  let published = false
  try {
    await fsApi.writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await fsApi.syncFile(temporary)
    beforePublish()
    await fsApi.rename(temporary, filePath)
    published = true
    await fsApi.syncDirectory(directory)
  } catch (error) {
    await fsApi.unlink(temporary).catch(() => {})
    if (published) {
      const publishedError = new Error(error?.message || 'The MCP credential vault publication is uncertain.')
      publishedError.cause = error
      publishedError.mcpCredentialPublished = true
      throw publishedError
    }
    throw error
  }
}

function encryptedPayload(reference, binding, credential) {
  return JSON.stringify({ version: credential.oauth ? 2 : PAYLOAD_VERSION, reference, binding, ...credential })
}

async function encryptPayload(encrypt, reference, binding, credential) {
  let ciphertext
  try {
    ciphertext = await encrypt(encryptedPayload(reference, binding, credential))
  } catch {
    fail('The MCP credential could not be encrypted.')
  }
  if (!(ciphertext instanceof Uint8Array) || ciphertext.byteLength === 0) fail('The MCP credential encryption result is invalid.')
  const encoded = Buffer.from(ciphertext).toString('base64')
  if (!validBase64(encoded)) fail('The MCP credential encryption result is invalid.')
  return encoded
}

async function decryptPayload(decrypt, reference, expectedBinding, ciphertext) {
  let plaintext
  try {
    plaintext = await decrypt(Buffer.from(ciphertext, 'base64'))
  } catch {
    fail('The MCP credential could not be decrypted safely.')
  }
  if (typeof plaintext !== 'string' || Buffer.byteLength(plaintext) > 98_304) fail('The MCP credential could not be decrypted safely.')
  let payload
  try {
    payload = JSON.parse(plaintext)
  } catch {
    fail('The MCP credential could not be decrypted safely.')
  }
  const keys = payload?.version === 2 ? ['version', 'reference', 'binding', 'oauth'] : ['version', 'reference', 'binding', 'secret']
  if (!payload || ![PAYLOAD_VERSION, 2].includes(payload.version) || Object.keys(payload).length !== keys.length ||
    !keys.every(key => Object.hasOwn(payload, key)) ||
    !validReference(payload.reference) || payload.reference !== reference || (payload.version === 1 && !validSecret(payload.secret))) {
    fail('The MCP credential could not be decrypted safely.')
  }
  let payloadBinding
  try {
    payloadBinding = canonicalBinding(payload.binding)
  } catch {
    fail('The MCP credential could not be decrypted safely.')
  }
  if (expectedBinding && !sameBinding(payloadBinding, expectedBinding)) fail('The MCP credential binding does not match.')
  if (payload.version === 2) {
    try { return { binding: payloadBinding, oauth: oauthAudience(snapshotMcpOAuthCustody(payload.oauth), payloadBinding) } }
    catch { fail('The MCP credential could not be decrypted safely.') }
  }
  return { binding: payloadBinding, secret: payload.secret }
}

export async function openMcpCredentialVault({ filePath, encrypt, decrypt, now = () => Date.now(), random = randomBytes, fsApi: injectedFsApi }) {
  if (typeof filePath !== 'string' || filePath.length === 0 || typeof encrypt !== 'function' || typeof decrypt !== 'function') {
    fail('MCP credential vault storage and encryption are required.')
  }
  const fsApi = { ...REAL_FS_API, ...(injectedFsApi ?? {}) }
  let state = await loadState(filePath, fsApi)
  let mutationQueue = Promise.resolve()
  let unavailable = false

  const enqueue = (mutation, beforePublish = () => {}) => {
    const operation = mutationQueue.then(async () => {
      if (unavailable) fail('The MCP credential vault is unavailable after an uncertain publication.')
      const next = cloneState(state)
      const result = await mutation(next)
      beforePublish()
      try {
        await saveState(filePath, next, fsApi, beforePublish)
      } catch (error) {
        if (error?.mcpCredentialPublished) unavailable = true
        throw error
      }
      state = next
      return result
    })
    mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  const readEntry = async (reference, binding) => {
    if (!validReference(reference)) fail('The MCP credential reference is invalid.')
    const expected = canonicalBinding(binding)
    await mutationQueue
    if (unavailable) fail('The MCP credential vault is unavailable after an uncertain publication.')
    const entry = state.entries[reference]
    if (!entry) return undefined
    return decryptPayload(decrypt, reference, expected, entry.ciphertext)
  }

  const provision = (binding, credential) => {
    const expected = canonicalBinding(binding)
    if (credential.oauth) oauthAudience(credential.oauth, expected)
    return enqueue(async (next) => {
      if (Object.keys(next.entries).length >= MAX_MCP_VAULT_ENTRIES) fail('The MCP credential vault is full.')
      let reference
      for (let attempt = 0; attempt < 128; attempt += 1) {
        const bytes = random(16)
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 16) fail('The MCP credential reference generator is invalid.')
        reference = `${MCP_REFERENCE_PREFIX}${Buffer.from(bytes).toString('hex').toUpperCase()}`
        if (!next.entries[reference]) break
        reference = undefined
      }
      if (!reference) fail('The MCP credential reference could not be generated.')
      next.entries[reference] = {
        ciphertext: await encryptPayload(encrypt, reference, expected, credential),
        createdAt: now(),
      }
      if (!Number.isSafeInteger(next.entries[reference].createdAt) || next.entries[reference].createdAt < 0) {
        fail('The MCP credential timestamp is invalid.')
      }
      return reference
    })
  }

  const oauth = createMcpOAuthCustody({
    provision,
    read: readEntry,
    mutate(reference, binding, mutation, beforePublish) {
      if (!validReference(reference)) fail('The MCP credential reference is invalid.')
      const expected = canonicalBinding(binding)
      return enqueue(async next => {
        const entry = next.entries[reference]
        if (!entry) fail('The MCP credential reference is unavailable.')
        const payload = await decryptPayload(decrypt, reference, expected, entry.ciphertext)
        const credential = mutation(payload)
        entry.ciphertext = await encryptPayload(encrypt, reference, expected, credential)
      }, beforePublish)
    },
  })

  return {
    ...oauth,
    provision(binding, secret) {
      if (!validSecret(secret)) fail('The MCP credential secret is invalid.')
      return provision(binding, { secret })
    },

    async read(reference, binding) {
      return (await readEntry(reference, binding))?.secret ?? fail('The MCP credential reference is unavailable.')
    },

    discard(reference, binding) {
      if (!validReference(reference)) fail('The MCP credential reference is invalid.')
      const expected = canonicalBinding(binding)
      return enqueue(async (next) => {
        const entry = next.entries[reference]
        if (!entry) return false
        await decryptPayload(decrypt, reference, expected, entry.ciphertext)
        delete next.entries[reference]
        return true
      })
    },

    reconcile(bindings) {
      if (!Array.isArray(bindings) || bindings.length > MAX_RECONCILE_ITEMS) fail('The MCP credential bindings snapshot is invalid.')
      const authoritative = new Map()
      const bindingOwners = new Map()
      for (const item of bindings) {
        if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 2 || !Object.hasOwn(item, 'reference') || !Object.hasOwn(item, 'binding') || !validReference(item.reference)) {
          fail('The MCP credential bindings snapshot is invalid.')
        }
        const expected = canonicalBinding(item.binding)
        const prior = authoritative.get(item.reference)
        if (prior && !sameBinding(prior, expected)) fail('The MCP credential bindings snapshot is contradictory.')
        const bindingKey = JSON.stringify(expected)
        const priorReference = bindingOwners.get(bindingKey)
        if (priorReference && priorReference !== item.reference) fail('The MCP credential bindings snapshot is contradictory.')
        authoritative.set(item.reference, expected)
        bindingOwners.set(bindingKey, item.reference)
      }
      return enqueue(async (next) => {
        for (const [reference, expected] of authoritative) {
          const entry = next.entries[reference]
          if (entry) await decryptPayload(decrypt, reference, expected, entry.ciphertext)
        }
        const removed = []
        for (const reference of Object.keys(next.entries)) {
          if (authoritative.has(reference)) continue
          delete next.entries[reference]
          removed.push(reference)
        }
        return removed
      })
    },
  }
}
