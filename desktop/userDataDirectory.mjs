import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, parse, relative, resolve, sep } from 'node:path'

const fileSystem = { lstat, mkdir, open, realpath }

function containsProtectedPath(candidate, protectedPaths) {
  return protectedPaths.some(path => {
    const child = relative(candidate, path)
    return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  })
}

async function canonicalPath(path, fs) {
  try { return await fs.realpath(path) }
  catch (error) {
    if (error.code === 'ENOENT') return path
    throw error
  }
}

/** Path-free failure: this is not a database problem and must never offer a
 * restore into a directory that failed the local-storage boundary. */
export class DesktopUserDataError extends Error {
  constructor() {
    super('Agent Commons could not protect its local data folder. Check that the folder is a real directory owned by your account with private permissions, then reopen the app. Your saved work has not been replaced.')
    this.name = 'DesktopUserDataError'
  }
}

/** Protect the profile itself, never recursively rewrite its contents or parent
 * directories. POSIX repairs act on a no-follow descriptor; ownership, mode and
 * path identity are rechecked before application credentials or SQLite open.
 * Parents must be trusted OS-managed directories. This does not inspect or
 * remove extended ACLs, nor protect against administrators or same-user access.
 * Windows retains OS-managed ACL permissions; POSIX mode bits are not its ACL. */
export async function ensureDesktopUserDataDirectory(userDataPath, {
  platform = process.platform,
  uid = process.geteuid?.(),
  protectedPaths = [],
  fs = fileSystem,
} = {}) {
  fs = { ...fileSystem, ...fs }
  let directory
  try {
    if (typeof userDataPath !== 'string' || !isAbsolute(userDataPath)) throw new Error('Invalid profile path')
    const path = resolve(userDataPath)
    const sharedTemporaryDirectories = platform === 'win32' ? [] : ['/tmp', '/var/tmp']
    if (platform === 'darwin') sharedTemporaryDirectories.push('/private/tmp', '/private/var/tmp')
    const protectedDirectories = [parse(path).root, homedir(), tmpdir(), ...sharedTemporaryDirectories, ...protectedPaths].map((path) => resolve(path))
    if (containsProtectedPath(path, protectedDirectories)) throw new Error('Profile path is not application-specific')
    try {
      await fs.mkdir(path, { mode: 0o700 })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    // Resolve aliases before any chmod, including a symlinked parent that names
    // a protected directory. This does not grant permission to follow the leaf.
    const canonical = await fs.realpath(path)
    const protectedCanonical = await Promise.all(protectedDirectories.map(path => canonicalPath(path, fs)))
    if (containsProtectedPath(canonical, protectedCanonical)) throw new Error('Profile path aliases a protected directory')
    if (platform === 'win32') {
      const info = await fs.lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid profile directory')
      return
    }
    if (!Number.isSafeInteger(uid) || uid < 0 || !constants.O_NOFOLLOW || !constants.O_DIRECTORY) {
      throw new Error('Secure directory admission is unavailable')
    }
    directory = await fs.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const before = await directory.stat()
    if (!before.isDirectory() || before.uid !== uid) throw new Error('Invalid profile owner or type')
    if ((before.mode & 0o7777) !== 0o700) await directory.chmod(0o700)
    const after = await directory.stat()
    const named = await fs.lstat(path)
    if (!after.isDirectory() || after.uid !== uid || (after.mode & 0o7777) !== 0o700 ||
      !named.isDirectory() || named.isSymbolicLink() || named.dev !== after.dev || named.ino !== after.ino ||
      named.uid !== uid || (named.mode & 0o7777) !== 0o700) {
      throw new Error('Profile directory changed or could not be protected')
    }
  } catch {
    throw new DesktopUserDataError()
  } finally {
    try { await directory?.close() }
    catch { throw new DesktopUserDataError() }
  }
}
