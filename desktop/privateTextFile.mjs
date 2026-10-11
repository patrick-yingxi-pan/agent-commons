import { constants } from 'node:fs'
import { lstat, open, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

export const PRIVATE_TEXT_FILE_LIMITS = Object.freeze({
  maxPathBytes: 4_096,
  maxBytes: 16 * 1024 * 1024,
})

const REAL_FS = { lstat, open, rename, unlink }
const NOFOLLOW = constants.O_NOFOLLOW ?? 0
const NONBLOCK = constants.O_NONBLOCK ?? 0

export class PrivateTextFileError extends Error {
  constructor(code = 'unavailable') {
    const safe = ['invalid', 'unavailable', 'busy', 'stale'].includes(code) ? code : 'unavailable'
    super(`The private text file is unavailable (${safe}).`)
    this.name = 'PrivateTextFileError'
    this.code = safe
  }
}

const fail = (code = 'unavailable') => { throw new PrivateTextFileError(code) }
const sameStat = (left, right) => ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs', 'uid', 'nlink']
  .every(key => left[key] === right[key])

function validUtf8Text(value) {
  if (typeof value !== 'string') return false
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false
  }
  return true
}

function observeRejectedThenable(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return
  try { void Promise.resolve(value).catch(() => {}) } catch { /* fixed refusal below */ }
}

function readOptions(value, allowed) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail('invalid')
    const keys = Reflect.ownKeys(value)
    if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) fail('invalid')
    const result = Object.create(null)
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('invalid')
      result[key] = descriptor.value
    }
    return result
  } catch (error) {
    if (error instanceof PrivateTextFileError) throw error
    fail('invalid')
  }
}

function validateArguments(filePath, maxBytes, fsApi) {
  if (typeof filePath !== 'string' || !validUtf8Text(filePath) || !filePath || filePath.includes('\0') ||
    !isAbsolute(filePath) || resolve(filePath) !== filePath || filePath === dirname(filePath) ||
    Buffer.byteLength(filePath, 'utf8') > PRIVATE_TEXT_FILE_LIMITS.maxPathBytes ||
    !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > PRIVATE_TEXT_FILE_LIMITS.maxBytes ||
    !fsApi || typeof fsApi.lstat !== 'function' || typeof fsApi.open !== 'function' ||
    typeof fsApi.rename !== 'function' || typeof fsApi.unlink !== 'function') fail('invalid')
}

function checkPrivateDirectory(info, platform) {
  if (!info?.isDirectory?.() || info.isSymbolicLink?.() ||
    (platform !== 'win32' && ((info.mode & 0o7777) !== 0o700 || info.uid !== process.geteuid()))) fail('unavailable')
  return { dev: info.dev, ino: info.ino }
}

function checkPrivateFile(info, maxBytes, platform) {
  if (!info?.isFile?.() || info.isSymbolicLink?.() ||
    (platform !== 'win32' && ((info.mode & 0o7777) !== 0o600 || info.uid !== process.geteuid())) ||
    !Number.isSafeInteger(info.size) || info.size < 0 || info.size > maxBytes) fail('unavailable')
}

function samePathFile(info, opened) {
  return !info.isSymbolicLink?.() && sameStat(info, opened)
}

/** Open one compare-and-swap private text file. This assumes the admitted
 * profile parent and same-user process are trusted; it grants no sandbox or
 * cross-user integrity beyond the directory/file checks. */
export async function openPrivateTextFile(rawOptions = {}) {
  const options = readOptions(rawOptions, ['filePath', 'maxBytes', 'fsApi', 'platform'])
  const { filePath, maxBytes, fsApi = REAL_FS, platform = process.platform } = options
  if (typeof platform !== 'string' || !platform || (platform !== 'win32' && typeof process.geteuid !== 'function')) fail('invalid')
  validateArguments(filePath, maxBytes, fsApi)
  const directoryPath = dirname(filePath)
  const readDiskState = async (expectedDirectory) => {
    let directoryInfo
    try { directoryInfo = checkPrivateDirectory(await fsApi.lstat(directoryPath), platform) }
    catch { fail('stale') }
    if (expectedDirectory && (directoryInfo.dev !== expectedDirectory.dev || directoryInfo.ino !== expectedDirectory.ino)) fail('stale')

    let file
    try { file = await fsApi.open(filePath, constants.O_RDONLY | NOFOLLOW | NONBLOCK) }
    catch (error) {
      if (error?.code !== 'ENOENT') fail('stale')
      try {
        await fsApi.lstat(filePath)
        fail('stale')
      } catch (pathError) {
        if (pathError instanceof PrivateTextFileError) throw pathError
        if (pathError?.code !== 'ENOENT') fail('stale')
      }
      try {
        const after = checkPrivateDirectory(await fsApi.lstat(directoryPath), platform)
        if (after.dev !== directoryInfo.dev || after.ino !== directoryInfo.ino) fail('stale')
      } catch { fail('stale') }
      return { text: undefined, fileStat: undefined }
    }

    try {
      const before = await file.stat()
      checkPrivateFile(before, maxBytes, platform)
      const bytes = Buffer.alloc(before.size + 1)
      let offset = 0
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
        if (!bytesRead) break
        offset += bytesRead
      }
      const after = await file.stat()
      if (offset !== before.size || !sameStat(before, after)) fail('stale')
      const pathInfo = await fsApi.lstat(filePath)
      if (!samePathFile(pathInfo, before)) fail('stale')
      const afterDirectory = checkPrivateDirectory(await fsApi.lstat(directoryPath), platform)
      if (afterDirectory.dev !== directoryInfo.dev || afterDirectory.ino !== directoryInfo.ino) fail('stale')
      let text
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset)) }
      catch { fail('unavailable') }
      return { text, fileStat: before }
    } catch (error) {
      if (error instanceof PrivateTextFileError) throw error
      fail('stale')
    } finally {
      try { await file.close() } catch { fail('unavailable') }
    }
  }

  let directoryIdentity
  let acknowledged
  try {
    directoryIdentity = checkPrivateDirectory(await fsApi.lstat(directoryPath), platform)
    acknowledged = await readDiskState(directoryIdentity)
  } catch {
    fail('unavailable')
  }

  let poisoned = false
  let writing = false
  let acknowledgedText = acknowledged.text
  let acknowledgedFileStat = acknowledged.fileStat
  const unavailable = () => { if (poisoned) fail('unavailable') }
  const requireCurrent = async () => {
    unavailable()
    let current
    try { current = await readDiskState(directoryIdentity) }
    catch {
      poisoned = true
      fail('stale')
    }
    if (current.text !== acknowledgedText || Boolean(current.fileStat) !== Boolean(acknowledgedFileStat) ||
      (current.fileStat && !sameStat(current.fileStat, acknowledgedFileStat))) {
      poisoned = true
      fail('stale')
    }
  }

  async function replace(text, rawOptions = {}) {
    const options = readOptions(rawOptions, ['beforePublish'])
    const { beforePublish } = options
    if (writing) fail('busy')
    if (poisoned) fail('unavailable')
    if (!validUtf8Text(text) || Buffer.byteLength(text, 'utf8') > maxBytes ||
      (beforePublish !== undefined && typeof beforePublish !== 'function')) fail('invalid')
    writing = true
    const temporary = `${filePath}.${randomBytes(16).toString('hex')}.tmp`
    let file
    let tempCreated = false
    let published = false
    try {
      await requireCurrent()
      file = await fsApi.open(temporary, 'wx', 0o600)
      tempCreated = true
      checkPrivateFile(await file.stat(), maxBytes, platform)
      await file.writeFile(text, 'utf8')
      await file.sync()
      await file.close()
      file = undefined

      // Finish the asynchronous parent/file compare first. The authority
      // callback is then the final synchronous decision immediately before
      // invoking rename, so no awaited work can stale its result.
      await requireCurrent()
      if (beforePublish) {
        let allowed = false
        try {
          const result = beforePublish()
          if (result === true) allowed = true
          else observeRejectedThenable(result)
        } catch { /* fixed stale refusal */ }
        if (!allowed) fail('stale')
      }

      await fsApi.rename(temporary, filePath)
      published = true
      if (platform !== 'win32') {
        const directory = await fsApi.open(directoryPath, constants.O_RDONLY | NOFOLLOW)
        try { await directory.sync() }
        finally { await directory.close() }
      }
      const current = await readDiskState(directoryIdentity)
      if (current.text !== text || !current.fileStat) fail('stale')
      acknowledgedText = text
      acknowledgedFileStat = current.fileStat
    } catch (error) {
      if (published) poisoned = true
      if (error instanceof PrivateTextFileError) throw error
      fail('unavailable')
    } finally {
      let cleanupFailed = false
      if (file) {
        try { await file.close() } catch { cleanupFailed = true }
      }
      if (tempCreated && !published) {
        try {
          const parent = checkPrivateDirectory(await fsApi.lstat(directoryPath), platform)
          if (parent.dev !== directoryIdentity.dev || parent.ino !== directoryIdentity.ino) cleanupFailed = true
          else await fsApi.unlink(temporary)
        } catch (error) { if (error?.code !== 'ENOENT') cleanupFailed = true }
      }
      if (cleanupFailed) poisoned = true
      writing = false
      if (cleanupFailed) fail('unavailable')
    }
  }

  return Object.freeze({
    get text() { return acknowledgedText },
    get unavailable() { return poisoned },
    replace,
  })
}
