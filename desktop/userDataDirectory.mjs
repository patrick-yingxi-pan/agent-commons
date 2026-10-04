import { constants, lstatSync, mkdirSync, openSync, realpathSync, fstatSync, closeSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, parse, relative, resolve, sep } from 'node:path'
import { inspectDarwinProfileAcl } from './profileAcl.mjs'

const fileSystem = { lstat: lstatSync, mkdir: mkdirSync, open: openSync, realpath: realpathSync, fstat: fstatSync, close: closeSync }

function containsProtectedPath(candidate, protectedPaths) {
  return protectedPaths.some(path => {
    const child = relative(candidate, path)
    return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  })
}

function canonicalPath(path, fs) {
  try { return fs.realpath(path) }
  catch (error) {
    if (error.code === 'ENOENT') return path
    throw error
  }
}

/** Path-free failure: this is not a database problem and must never offer a
 * restore into a directory that failed the local-storage boundary. */
export class DesktopUserDataError extends Error {
  constructor(platform = process.platform) {
    const requirements = platform === 'win32'
      ? 'Check that the location is an app-specific real directory, and ask your administrator to review its Windows access permissions.'
      : `The folder must belong to your account and be a real directory with mode 0700 (owner access only).${platform === 'darwin' ? ' It must grant no ACL access to other users or groups.' : ''}`
    const inspection = platform === 'darwin' ? ' If access is already private, reinstall the app or ask your administrator to check ACL inspection support.' : ''
    super(`Agent Commons could not safely open its local data folder. Saved files and existing permissions were not changed.\n\nQuit, preserve a backup, and ask the folder owner or your administrator to review access. ${requirements} Repair only the reviewed folder; do not make recursive changes or restore a database to fix permissions.\n\nReopen after repair.${inspection}`)
    this.name = 'DesktopUserDataError'
  }
}

/** Synchronous admission before Electron's ready/instance-lock work. Only an
 * absent leaf is created. Existing modes and ACLs are never repaired. Trusted
 * OS-managed parents and same-user/admin integrity remain assumptions; this
 * checks the profile boundary, not every descendant or Windows ACL policy. */
export function ensureDesktopUserDataDirectory(userDataPath, {
  platform = process.platform,
  uid = process.geteuid?.(),
  protectedPaths = [],
  fs = fileSystem,
  inspectAcl = inspectDarwinProfileAcl,
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
      fs.mkdir(path, { mode: 0o700 })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    // Parent aliases cannot turn a broad directory into an application profile.
    // Resolving here never grants permission to follow a symlinked leaf below.
    const canonical = fs.realpath(path)
    const protectedCanonical = protectedDirectories.map(path => canonicalPath(path, fs))
    if (containsProtectedPath(canonical, protectedCanonical)) throw new Error('Profile path aliases a protected directory')
    if (platform === 'win32') {
      const info = fs.lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid profile directory')
      return
    }
    if (!Number.isSafeInteger(uid) || uid < 0 || !constants.O_NOFOLLOW || !constants.O_DIRECTORY) {
      throw new Error('Secure directory admission is unavailable')
    }
    directory = fs.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const before = fs.fstat(directory)
    if (!before.isDirectory() || before.uid !== uid || (before.mode & 0o7777) !== 0o700) throw new Error('Invalid profile owner, type or permissions')
    if (platform === 'darwin') inspectAcl(directory)
    const after = fs.fstat(directory)
    const named = fs.lstat(path)
    if (!after.isDirectory() || after.uid !== uid || (after.mode & 0o7777) !== 0o700 ||
      before.dev !== after.dev || before.ino !== after.ino || before.ctimeMs !== after.ctimeMs ||
      !named.isDirectory() || named.isSymbolicLink() || named.dev !== after.dev || named.ino !== after.ino ||
      named.uid !== uid || (named.mode & 0o7777) !== 0o700 || named.ctimeMs !== after.ctimeMs) {
      throw new Error('Profile directory changed or could not be admitted')
    }
  } catch {
    throw new DesktopUserDataError(platform)
  } finally {
    try { if (directory !== undefined) fs.close(directory) }
    catch { throw new DesktopUserDataError(platform) }
  }
}
