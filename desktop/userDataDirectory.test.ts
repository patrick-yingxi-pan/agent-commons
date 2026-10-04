import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile, chmod } from 'node:fs/promises'
import { tmpdir, homedir, userInfo } from 'node:os'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DesktopUserDataError, ensureDesktopUserDataDirectory } from './userDataDirectory.mjs'
import { closeSync, fstatSync, lstatSync, openSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { desktopProfileAclHelperPath, inspectDarwinProfileAcl } from './profileAcl.mjs'
import { buildDesktopProfileHelper } from './profileHelperBuild.mjs'

const helper = process.platform === 'darwin' ? buildDesktopProfileHelper() : undefined

const posix = process.platform !== 'win32'
async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'agent-commons-profile-mode-'))
  try { await work(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test('a missing profile is private; a permissive owned profile refuses without changing contents or permissions', { skip: !posix }, async () => {
  await fixture(async root => {
    const profile = join(root, 'profile')
    await ensureDesktopUserDataDirectory(profile)
    assert.equal((await stat(profile)).mode & 0o7777, 0o700)
    const sentinel = join(profile, 'saved-work')
    await writeFile(sentinel, 'Keep the exact saved work.')
    await chmod(profile, 0o755)
    assert.throws(() => ensureDesktopUserDataDirectory(profile), DesktopUserDataError)
    assert.equal((await stat(profile)).mode & 0o7777, 0o755)
    assert.equal(await readFile(sentinel, 'utf8'), 'Keep the exact saved work.')
    await chmod(profile, 0o700) // Explicit repair of this disposable fixture only.
    await ensureDesktopUserDataDirectory(profile)
    assert.equal(await readFile(sentinel, 'utf8'), 'Keep the exact saved work.', 'repeat admission is nondestructive')
  })
})

test('file, dangling symlink, directory symlink and trailing-separator aliases refuse without changing the target', { skip: !posix }, async () => {
  await fixture(async root => {
    const target = join(root, 'target')
    await mkdir(target, { mode: 0o755 })
    await chmod(target, 0o755)
    const file = join(root, 'file')
    await writeFile(file, 'Do not replace')
    const link = join(root, 'link')
    const dangling = join(root, 'dangling')
    await symlink(target, link)
    await symlink(join(root, 'absent'), dangling)
    for (const path of [file, link, `${link}/`, `${link}/.`, dangling]) {
      assert.throws(() => ensureDesktopUserDataDirectory(path), DesktopUserDataError)
    }
    assert.equal((await stat(target)).mode & 0o7777, 0o755)
    assert.equal(await readFile(file, 'utf8'), 'Do not replace')
    assert.equal((await lstat(dangling)).isSymbolicLink(), true)
  })
})

test('wrong owner refuses unchanged; missing POSIX identity fails closed', { skip: !posix }, async () => {
  await fixture(async root => {
    await chmod(root, 0o700)
    for (const uid of [process.getuid!() + 1, -1, NaN]) {
      assert.throws(() => ensureDesktopUserDataDirectory(root, { uid }), DesktopUserDataError)
      assert.equal((await stat(root)).mode & 0o7777, 0o700)
    }
  })
})

test('refuses broad or relative paths before filesystem access', async () => {
  let calls = 0
  const fs = { mkdir: () => { calls++; throw new Error('Must not reach disk') } }
  for (const path of ['', 'relative', parse(homedir()).root, homedir(), tmpdir(), join(tmpdir(), 'protected')]) {
    assert.throws(() => ensureDesktopUserDataDirectory(path, { fs, protectedPaths: [join(tmpdir(), 'protected')] }), DesktopUserDataError)
  }
  assert.equal(calls, 0, 'invalid scope must refuse before attempting directory creation')
})

test('a protected directory through a parent alias refuses unchanged', { skip: !posix }, async () => {
  await fixture(async root => {
    const protectedDirectory = join(root, 'protected')
    await mkdir(protectedDirectory)
    await chmod(protectedDirectory, 0o755)
    const parentAlias = join(root, 'alias')
    await symlink(root, parentAlias)
    assert.throws(() => ensureDesktopUserDataDirectory(join(parentAlias, 'protected'), {
      protectedPaths: [protectedDirectory],
    }), DesktopUserDataError)
    assert.equal((await stat(protectedDirectory)).mode & 0o7777, 0o755)
  })
})

test('protected ancestors and shared macOS temp roots refuse before filesystem access', { skip: !posix }, async () => {
  let calls = 0
  const fs = { mkdir: () => { calls++; throw new Error('Must not reach disk') } }
  for (const path of [dirname(homedir()), dirname(tmpdir()), '/tmp', '/var/tmp', '/private/tmp', '/private/var/tmp']) {
    assert.throws(() => ensureDesktopUserDataDirectory(path, { fs, platform: 'darwin' }), DesktopUserDataError)
  }
  assert.equal(calls, 0)
})

test('a canonical ancestor through a parent alias refuses without tightening unrelated data', { skip: !posix }, async () => {
  await fixture(async root => {
    const container = join(root, 'container')
    const candidate = join(container, 'parent')
    const protectedDirectory = join(candidate, 'protected')
    await mkdir(protectedDirectory, { recursive: true })
    await chmod(candidate, 0o755)
    const alias = join(root, 'alias')
    await symlink(container, alias)
    assert.throws(() => ensureDesktopUserDataDirectory(join(alias, 'parent'), {
      protectedPaths: [protectedDirectory],
    }), DesktopUserDataError)
    assert.equal((await stat(candidate)).mode & 0o7777, 0o755)
  })
})

test('missing parents are not created or repaired recursively', async () => {
  await fixture(async root => {
    assert.throws(() => ensureDesktopUserDataDirectory(join(root, 'missing-parent', 'profile')), DesktopUserDataError)
    await assert.rejects(stat(join(root, 'missing-parent')), { code: 'ENOENT' })
  })
})

test('ACL inspection failure, changed permissions or identity and close failure refuse with a path-free error', { skip: !posix }, async () => {
  await fixture(async root => {
    for (const fault of ['acl-error', 'mode', 'identity', 'ctime', 'close']) {
      await chmod(root, 0o700)
      let closed = false
      let stats = 0
      const fs = {
        lstat: path => {
          const info = lstatSync(path)
          return fault === 'identity' ? { ...info, ino: info.ino + 1, isDirectory: () => true, isSymbolicLink: () => false } : info
        },
        fstat: fd => {
          const info = fstatSync(fd)
          if (++stats > 1 && ['mode', 'ctime'].includes(fault)) {
            return { ...info, ...(fault === 'mode' ? { mode: 0o755 } : { ctimeMs: info.ctimeMs + 1 }), isDirectory: () => true }
          }
          return info
        },
        close: fd => {
          closed = true
          closeSync(fd)
          if (fault === 'close') throw new Error(`Private OS close detail ${root}`)
        },
      }
      assert.throws(() => ensureDesktopUserDataDirectory(root, { fs, platform: 'darwin', inspectAcl: () => {
        if (fault === 'acl-error') throw new Error(`Private OS ACL detail ${root}`)
      } }), error => {
        assert.ok(error instanceof DesktopUserDataError)
        assert.ok(!String(error).includes(root))
        return true
      })
      assert.equal(closed, true)
    }
  })
})

test('Windows keeps OS-managed permissions and rejects a non-directory', async () => {
  await fixture(async root => {
    const profile = join(root, 'windows-profile')
    await ensureDesktopUserDataDirectory(profile, { platform: 'win32' })
    const file = join(root, 'file')
    await writeFile(file, 'Keep')
    assert.throws(() => ensureDesktopUserDataDirectory(file, { platform: 'win32' }), error => {
      assert.ok(error instanceof DesktopUserDataError)
      assert.match(error.message, /Windows access permissions/)
      assert.doesNotMatch(error.message, /0700|ACL inspection/)
      return true
    })
    assert.equal(await readFile(file, 'utf8'), 'Keep')
  })
})

test('repair guidance describes only the current platform policy', () => {
  assert.match(new DesktopUserDataError('darwin').message, /grant no ACL access/)
  assert.match(new DesktopUserDataError('linux').message, /0700/)
  assert.doesNotMatch(new DesktopUserDataError('linux').message, /ACL/)
})

test('macOS ACL grants to others refuse unchanged; deny-only and owner-only ACLs remain admissible', { skip: process.platform !== 'darwin' }, async () => {
  await fixture(async root => {
    const sentinel = join(root, 'saved-work')
    await writeFile(sentinel, 'preserve exact bytes')
    const acl = () => execFileSync('/bin/ls', ['-lde', root], { encoding: 'utf8' })
    execFileSync('/bin/chmod', ['+a', 'everyone allow read,search', root])
    const before = acl()
    assert.throws(() => ensureDesktopUserDataDirectory(root), DesktopUserDataError)
    assert.equal(acl(), before)
    assert.equal(await readFile(sentinel, 'utf8'), 'preserve exact bytes')
    // Repair only the ACL installed above on this uniquely owned fixture.
    execFileSync('/bin/chmod', ['-N', root])
    ensureDesktopUserDataDirectory(root)
    try {
      execFileSync('/bin/chmod', ['+a', 'everyone deny delete', root])
      ensureDesktopUserDataDirectory(root)
      execFileSync('/bin/chmod', ['+a', `user:${userInfo().username} allow read,search`, root])
      ensureDesktopUserDataDirectory(root)
    } finally { execFileSync('/bin/chmod', ['-N', root]) }
    execFileSync('/bin/chmod', ['+a', 'everyone allow read,search,file_inherit,directory_inherit,only_inherit', root])
    try {
      const inherited = join(root, 'inherited')
      await mkdir(inherited, { mode: 0o700 })
      assert.throws(() => ensureDesktopUserDataDirectory(root), DesktopUserDataError, 'inherit-only grants are unsafe for newly created data')
      assert.throws(() => ensureDesktopUserDataDirectory(inherited), DesktopUserDataError, 'inherited grants are not ignored')
      execFileSync('/bin/chmod', ['-N', inherited])
    } finally { execFileSync('/bin/chmod', ['-N', root]) }
  })
})

test('ACL helper is descriptor-bound, bounded and fail-closed on unavailable or ambiguous output', () => {
  const ok = { status: 0, signal: null, stdout: 'private\n', stderr: '' }
  inspectDarwinProfileAcl(41, { helperPath: '/bundle/profile-acl', run: (path, args, options) => {
    assert.equal(path, '/bundle/profile-acl')
    assert.deepEqual(args, [])
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe', 41])
    assert.deepEqual(options.env, {})
    assert.equal(options.timeout, 5_000)
    assert.equal(options.maxBuffer, 1_024)
    return ok
  } })
  for (const result of [
    { ...ok, error: new Error('missing binary') }, { ...ok, status: 2 }, { ...ok, status: 3 },
    { ...ok, signal: 'SIGTERM' }, { ...ok, stdout: '' }, { ...ok, stdout: 'private\nextra\n' }, { ...ok, stderr: 'inspection failed' },
  ]) assert.throws(() => inspectDarwinProfileAcl(41, { run: () => result }))
})

test('ACL helper location follows packaged status, not Electron resourcesPath presence', () => {
  assert.equal(desktopProfileAclHelperPath({ packaged: true, resourcesPath: '/signed/Resources' }), '/signed/Resources/profile-acl')
  assert.equal(desktopProfileAclHelperPath({ packaged: false, resourcesPath: '/Electron.app/Contents/Resources' }),
    fileURLToPath(new URL('./bin/profile-acl', import.meta.url)))
})

test('native ACL inspection cannot substitute a path for the inherited directory', { skip: process.platform !== 'darwin' }, async () => {
  await fixture(async root => {
    const fd = openSync(root, 'r')
    try { inspectDarwinProfileAcl(fd, { helperPath: helper }) } finally { closeSync(fd) }
    assert.throws(() => inspectDarwinProfileAcl(-1, { helperPath: helper }))
  })
})
