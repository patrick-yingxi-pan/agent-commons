import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { link, mkdir, open, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { secureStorageAvailable } from './credentialVault.mjs'

export const AUTH_ROOT_FILE = 'authentication-root.v1.json'
const MAX_FILE_BYTES = 4096
const validSecret = (secret) => typeof secret === 'string' && /^[A-Za-z0-9_-]{43}$/.test(secret)

/** Deliberately contains no OS exception, path, ciphertext, or secret. */
export class DesktopAuthRootError extends Error {
  constructor() {
    super('Agent Commons could not unlock its saved sign-in key. Unlock your system keychain and reopen the app. Your saved work and sign-in key have not been replaced.')
    this.name = 'DesktopAuthRootError'
  }
}

async function readRoot(filePath, decrypt) {
  let file
  try {
    file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('Invalid root file')
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > MAX_FILE_BYTES) throw new Error('Oversized root file')
    const record = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
    if (
      !record || Object.keys(record).sort().join(',') !== 'ciphertext,version' || record.version !== 1 ||
      typeof record.ciphertext !== 'string' || !record.ciphertext ||
      Buffer.from(record.ciphertext, 'base64').toString('base64') !== record.ciphertext
    ) throw new Error('Invalid root record')
    const secret = await decrypt(Buffer.from(record.ciphertext, 'base64'))
    if (!validSecret(secret)) throw new Error('Invalid decrypted root')
    if (process.platform !== 'win32') await file.chmod(0o600)
    return secret
  } finally {
    await file.close()
  }
}

/** One device root, published durably before a backend can issue credentials.
 * The app's single-instance lock owns its directory; exclusive publication also
 * makes concurrent first opens converge. A present but unreadable root is never
 * replaced. It is separate from provider keys and portable product backups.
 * Encryption uses the same OS-backed safeStorage policy as provider credentials.
 */
export async function loadDesktopAuthSecret({ filePath, storage, platform = process.platform, random = randomBytes }) {
  try {
    if (!secureStorageAvailable({
      platform,
      encryptionAvailable: storage.isEncryptionAvailable(),
      linuxBackend: platform === 'linux' ? storage.getSelectedStorageBackend() : undefined,
    })) throw new Error('Secure storage unavailable')
    const decrypt = (bytes) => storage.decryptString(bytes)
    const existing = await readRoot(filePath, decrypt)
    if (existing !== undefined) return existing

    const secret = random(32).toString('base64url')
    if (!validSecret(secret)) throw new Error('Invalid new root')
    const encrypted = storage.encryptString(secret)
    if (!Buffer.isBuffer(encrypted) || !encrypted.length || await decrypt(encrypted) !== secret) {
      throw new Error('Secure storage round trip failed')
    }
    const payload = `${JSON.stringify({ version: 1, ciphertext: encrypted.toString('base64') })}\n`
    if (Buffer.byteLength(payload) > MAX_FILE_BYTES) throw new Error('Invalid encrypted root')
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
    const temporary = `${filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(payload, 'utf8')
      await file.sync()
      await file.close()
      try {
        await link(temporary, filePath)
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
    } finally {
      await file.close().catch(() => {})
      await unlink(temporary)
    }
    if (process.platform !== 'win32') {
      const directory = await open(dirname(filePath), constants.O_RDONLY)
      try { await directory.sync() } finally { await directory.close() }
    }
    // Read the committed winner, never return an unpublished provisional key.
    const committed = await readRoot(filePath, decrypt)
    if (committed === undefined) throw new Error('Root publication was lost')
    return committed
  } catch {
    throw new DesktopAuthRootError()
  }
}
