/** Native-only custody for reviewed local MCP launch descriptions.
 * This module does not establish user consent, launch a process, or expose IPC.
 * Its caller must authenticate the person and review the detached description.
 * Saved grants are device-local, not portable workspace configuration. */
import { randomBytes } from 'node:crypto'
import { secureStorageAvailable } from './credentialVault.mjs'
import { openPrivateTextFile } from './privateTextFile.mjs'
import { snapshotMcpStdioLaunch } from './mcpStdioLaunch.mjs'

export const MCP_STDIO_GRANT_FILE = 'mcp-stdio-grants.v1.json'
export const MCP_STDIO_GRANT_LIMITS = Object.freeze({
  entries: 64, pending: 8, plaintextBytes: 1_048_576, fileBytes: 2_097_152,
})
const REFERENCE = /^MCP_STDIO_[A-F0-9]{32}$/
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const CONNECTION = /^mcp-connection-[a-f0-9]{32}$/
const CODES = new Set(['invalid', 'unavailable', 'capacity', 'stale', 'cancelled'])
export class McpStdioGrantError extends Error {
  constructor(code = 'unavailable') {
    const safe = CODES.has(code) ? code : 'unavailable'
    super(`The local MCP launch grant is unavailable (${safe}).`)
    this.name = 'McpStdioGrantError'
    this.code = safe
  }
}
const fail = code => { throw new McpStdioGrantError(code) }
function exactRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
  const own = Reflect.ownKeys(value)
  return own.length === keys.length && own.every(key => keys.includes(key) &&
    Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
}

/** No endpoint, executable or renderer-supplied account authority belongs in a
 * binding. These identifiers must come from the authenticated native source. */
export function snapshotMcpStdioGrantBinding(value) {
  try {
    if (!exactRecord(value, ['tenantId', 'ownerUserId', 'connectionId']) ||
        ![value.tenantId, value.ownerUserId].every(id => typeof id === 'string' && IDENTITY.test(id)) ||
        typeof value.connectionId !== 'string' || !CONNECTION.test(value.connectionId)) return null
    return Object.freeze({ tenantId: value.tenantId, ownerUserId: value.ownerUserId, connectionId: value.connectionId })
  } catch { return null }
}
const sameBinding = (left, right) => left.tenantId === right.tenantId &&
  left.ownerUserId === right.ownerUserId && left.connectionId === right.connectionId
function permitted(check) {
  try {
    const value = check()
    if (value === true) return true
    try { void Promise.resolve(value).catch(() => {}) } catch { /* fixed refusal */ }
  } catch { /* fixed refusal */ }
  return false
}
function secure(storage, platform) {
  try {
    return platform === 'darwin' && secureStorageAvailable({ platform, encryptionAvailable: storage.isEncryptionAvailable() === true,
      linuxBackend: storage.getSelectedStorageBackend?.() }) &&
      typeof storage.encryptString === 'function' && typeof storage.decryptString === 'function'
  } catch { return false }
}
function parseEncrypted(text, storage) {
  const outer = JSON.parse(text)
  if (!exactRecord(outer, ['version', 'ciphertext']) || outer.version !== 1 ||
      typeof outer.ciphertext !== 'string' || !outer.ciphertext) fail('unavailable')
  const bytes = Buffer.from(outer.ciphertext, 'base64')
  if (bytes.toString('base64') !== outer.ciphertext) fail('unavailable')
  const plaintext = storage.decryptString(bytes)
  if (typeof plaintext !== 'string' || Buffer.byteLength(plaintext, 'utf8') > MCP_STDIO_GRANT_LIMITS.plaintextBytes) fail('unavailable')
  const parsed = JSON.parse(plaintext)
  if (!exactRecord(parsed, ['version', 'entries']) || parsed.version !== 1 || !Array.isArray(parsed.entries) ||
      parsed.entries.length > MCP_STDIO_GRANT_LIMITS.entries) fail('unavailable')
  const entries = new Map()
  for (const row of parsed.entries) {
    if (!exactRecord(row, ['reference', 'binding', 'launch']) || typeof row.reference !== 'string' ||
        !REFERENCE.test(row.reference) || entries.has(row.reference)) fail('unavailable')
    const binding = snapshotMcpStdioGrantBinding(row.binding)
    const launch = snapshotMcpStdioLaunch(row.launch)
    if (!binding || !launch) fail('unavailable')
    entries.set(row.reference, { reference: row.reference, binding, launch, controller: new AbortController() })
  }
  return entries
}

/** Open only within an already admitted, single-instance private profile.
 * OS encryption is mandatory even for an empty store. One disk queue outlives
 * caller timeouts; final source/cancel fences precede rename. A durable write
 * always returns its reference, even if cancellation arrives during fsync, so
 * its caller can retain/reconcile that exact provisional grant. */
export async function openMcpStdioGrantVault({ filePath, storage, platform = process.platform, fsApi } = {}) {
  if (!secure(storage, platform)) fail('unavailable')
  let file, entries
  try {
    file = await openPrivateTextFile({ filePath, maxBytes: MCP_STDIO_GRANT_LIMITS.fileBytes, platform, ...(fsApi ? { fsApi } : {}) })
    entries = file.text === undefined ? new Map() : parseEncrypted(file.text, storage)
  } catch { fail('unavailable') }
  let closed = false
  let poisoned = false
  let pendingCount = 0
  let queue = Promise.resolve()
  function abortAll() { for (const entry of entries.values()) entry.controller.abort() }
  function ready() {
    if (closed) fail('cancelled')
    if (poisoned || file.unavailable || !secure(storage, platform)) {
      poisoned = true
      abortAll()
      fail('unavailable')
    }
  }
  function current(options) {
    ready()
    if (options.signal?.aborted) fail('cancelled')
    if (!permitted(options.isCurrent)) fail('stale')
    // The synchronous callback may itself close custody or abort its caller.
    ready()
    if (options.signal?.aborted) fail('cancelled')
  }
  function enqueue(task) {
    if (pendingCount >= MCP_STDIO_GRANT_LIMITS.pending) fail('capacity')
    pendingCount += 1
    const pending = queue.then(() => { ready(); return task() })
    queue = pending.catch(() => {})
    return pending.catch(error => {
      if (file.unavailable) { poisoned = true; abortAll() }
      if (error instanceof McpStdioGrantError) throw error
      fail('unavailable')
    }).finally(() => { pendingCount -= 1 })
  }
  function optionsSnapshot(options) {
    try {
      if (!options || typeof options !== 'object') fail('invalid')
      const keys = Reflect.ownKeys(options)
      if (!keys.includes('isCurrent') || !exactRecord(options, keys) ||
          keys.some(key => !['isCurrent', 'signal'].includes(key)) || typeof options.isCurrent !== 'function' ||
          (options.signal !== undefined && !(options.signal instanceof AbortSignal))) fail('invalid')
      return { isCurrent: options.isCurrent, signal: options.signal }
    } catch { fail('invalid') }
  }
  function inputs(reference, rawBinding) {
    const binding = snapshotMcpStdioGrantBinding(rawBinding)
    if (typeof reference !== 'string' || !REFERENCE.test(reference) || !binding) fail('invalid')
    return binding
  }
  async function publish(next, options) {
    current(options)
    const plaintext = JSON.stringify({ version: 1, entries: [...next.values()].map(({ reference, binding, launch }) => ({ reference, binding, launch })) })
    if (Buffer.byteLength(plaintext, 'utf8') > MCP_STDIO_GRANT_LIMITS.plaintextBytes) fail('capacity')
    let encrypted
    try {
      const bytes = storage.encryptString(plaintext)
      if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MCP_STDIO_GRANT_LIMITS.fileBytes ||
          storage.decryptString(bytes) !== plaintext) fail('unavailable')
      encrypted = JSON.stringify({ version: 1, ciphertext: bytes.toString('base64') })
    } catch { fail('unavailable') }
    if (Buffer.byteLength(encrypted, 'utf8') > MCP_STDIO_GRANT_LIMITS.fileBytes) fail('capacity')
    try {
      await file.replace(encrypted, { beforePublish: () => { current(options); return true } })
    } catch (error) {
      if (file.unavailable) { poisoned = true; abortAll() }
      if (!file.unavailable && error?.code === 'stale') {
        // Preserve the source/cancellation reason without exposing file errors.
        current(options)
        fail('stale')
      }
      fail('unavailable')
    }
    const previous = entries
    entries = next
    for (const [reference, entry] of previous) if (!next.has(reference)) entry.controller.abort()
    if (closed || poisoned) abortAll()
  }

  return Object.freeze({
    get unavailable() { return closed || poisoned || file.unavailable || !secure(storage, platform) },
    async provision(rawBinding, rawLaunch, rawOptions) {
      // Snapshot the whole intent before crossing any asynchronous boundary.
      const binding = snapshotMcpStdioGrantBinding(rawBinding)
      const launch = snapshotMcpStdioLaunch(rawLaunch)
      const options = optionsSnapshot(rawOptions)
      if (!binding || !launch) fail('invalid')
      current(options)
      return enqueue(async () => {
        current(options)
        if (entries.size >= MCP_STDIO_GRANT_LIMITS.entries) fail('capacity')
        let reference
        do { reference = `MCP_STDIO_${randomBytes(16).toString('hex').toUpperCase()}` } while (entries.has(reference))
        const next = new Map(entries)
        next.set(reference, { reference, binding, launch, controller: new AbortController() })
        await publish(next, options)
        return reference
      })
    },
    async read(reference, rawBinding) {
      const binding = inputs(reference, rawBinding)
      await queue
      ready()
      const entry = entries.get(reference)
      if (!entry || !sameBinding(entry.binding, binding)) return null
      // Native-only lease: it never crosses IPC. Revocation closes already-open
      // processes when the composition owner forwards this signal.
      return Object.freeze({ launch: entry.launch, signal: entry.controller.signal,
        isCurrent: () => {
          try { ready(); return entries.get(reference) === entry && !entry.controller.signal.aborted } catch { return false }
        },
      })
    },
    async discard(reference, rawBinding, rawOptions) {
      const binding = inputs(reference, rawBinding)
      const options = optionsSnapshot(rawOptions)
      current(options)
      return enqueue(async () => {
        current(options)
        const entry = entries.get(reference)
        if (!entry || !sameBinding(entry.binding, binding)) return
        const next = new Map(entries)
        next.delete(reference)
        await publish(next, options)
      })
    },
    async reconcile(rawBindings, rawOptions) {
      const options = optionsSnapshot(rawOptions)
      const keep = new Map()
      try {
        if (!Array.isArray(rawBindings) || Object.getPrototypeOf(rawBindings) !== Array.prototype ||
            rawBindings.length > MCP_STDIO_GRANT_LIMITS.entries ||
            Reflect.ownKeys(rawBindings).length !== rawBindings.length + 1) fail('invalid')
        for (let index = 0; index < rawBindings.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(rawBindings, String(index))
          if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') ||
              !exactRecord(descriptor.value, ['reference', 'binding'])) fail('invalid')
          const row = descriptor.value, binding = inputs(row.reference, row.binding)
          if (keep.has(row.reference)) fail('invalid')
          keep.set(row.reference, binding)
        }
      } catch { fail('invalid') }
      current(options)
      // Retire leases before the disk queue: failure to erase custody cannot
      // revive a process whose authoritative binding has already been removed.
      for (const [reference, entry] of entries) {
        const binding = keep.get(reference)
        if (!binding || !sameBinding(entry.binding, binding)) entry.controller.abort()
      }
      return enqueue(async () => {
        current(options)
        const next = new Map()
        for (const [reference, binding] of keep) {
          const entry = entries.get(reference)
          if (entry && sameBinding(entry.binding, binding)) next.set(reference, entry)
        }
        if (next.size !== entries.size) await publish(next, options)
        // Missing, mismatched, or already-retired custody is not a usable grant.
        return next.size === keep.size && [...next.values()].every(entry => !entry.controller.signal.aborted)
      })
    },
    close() { closed = true; abortAll() },
  })
}
