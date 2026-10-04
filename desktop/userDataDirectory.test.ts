import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lstat, mkdir, mkdtemp, open, readFile, rm, stat, symlink, writeFile, chmod } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import { DesktopUserDataError, ensureDesktopUserDataDirectory } from './userDataDirectory.mjs'

const posix = process.platform !== 'win32'
async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'agent-commons-profile-mode-'))
  try { await work(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test('a missing profile is private; a permissive owned profile is tightened without changing contents', { skip: !posix }, async () => {
  await fixture(async root => {
    const profile = join(root, 'profile')
    await ensureDesktopUserDataDirectory(profile)
    assert.equal((await stat(profile)).mode & 0o7777, 0o700)
    const sentinel = join(profile, 'saved-work')
    await writeFile(sentinel, 'Keep the exact saved work.')
    await chmod(profile, 0o755)
    await ensureDesktopUserDataDirectory(profile)
    assert.equal((await stat(profile)).mode & 0o7777, 0o700)
    assert.equal(await readFile(sentinel, 'utf8'), 'Keep the exact saved work.')
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
      await assert.rejects(ensureDesktopUserDataDirectory(path), DesktopUserDataError)
    }
    assert.equal((await stat(target)).mode & 0o7777, 0o755)
    assert.equal(await readFile(file, 'utf8'), 'Do not replace')
    assert.equal((await lstat(dangling)).isSymbolicLink(), true)
  })
})

test('wrong owner refuses before chmod; missing POSIX identity fails closed', { skip: !posix }, async () => {
  await fixture(async root => {
    await chmod(root, 0o755)
    for (const uid of [process.getuid!() + 1, -1, NaN]) {
      await assert.rejects(ensureDesktopUserDataDirectory(root, { uid }), DesktopUserDataError)
      assert.equal((await stat(root)).mode & 0o7777, 0o755)
    }
  })
})

test('refuses broad or relative paths before filesystem access', async () => {
  let calls = 0
  const fs = { mkdir: () => { calls++; throw new Error('Must not reach disk') } }
  for (const path of ['', 'relative', parse(homedir()).root, homedir(), tmpdir(), join(tmpdir(), 'protected')]) {
    await assert.rejects(ensureDesktopUserDataDirectory(path, { fs, protectedPaths: [join(tmpdir(), 'protected')] }), DesktopUserDataError)
  }
  assert.equal(calls, 0, 'invalid scope must refuse before attempting directory creation')
})

test('a protected directory through a parent alias refuses before chmod', { skip: !posix }, async () => {
  await fixture(async root => {
    const protectedDirectory = join(root, 'protected')
    await mkdir(protectedDirectory)
    await chmod(protectedDirectory, 0o755)
    const parentAlias = join(root, 'alias')
    await symlink(root, parentAlias)
    await assert.rejects(ensureDesktopUserDataDirectory(join(parentAlias, 'protected'), {
      protectedPaths: [protectedDirectory],
    }), DesktopUserDataError)
    assert.equal((await stat(protectedDirectory)).mode & 0o7777, 0o755)
  })
})

test('protected ancestors and shared macOS temp roots refuse before filesystem access', { skip: !posix }, async () => {
  let calls = 0
  const fs = { mkdir: () => { calls++; throw new Error('Must not reach disk') } }
  for (const path of [dirname(homedir()), dirname(tmpdir()), '/tmp', '/var/tmp', '/private/tmp', '/private/var/tmp']) {
    await assert.rejects(ensureDesktopUserDataDirectory(path, { fs, platform: 'darwin' }), DesktopUserDataError)
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
    await assert.rejects(ensureDesktopUserDataDirectory(join(alias, 'parent'), {
      protectedPaths: [protectedDirectory],
    }), DesktopUserDataError)
    assert.equal((await stat(candidate)).mode & 0o7777, 0o755)
  })
})

test('missing parents are not created or repaired recursively', async () => {
  await fixture(async root => {
    await assert.rejects(ensureDesktopUserDataDirectory(join(root, 'missing-parent', 'profile')), DesktopUserDataError)
    await assert.rejects(stat(join(root, 'missing-parent')), { code: 'ENOENT' })
  })
})

test('chmod failure, ignored repair, replacement identity and close failure refuse with a path-free error', { skip: !posix }, async () => {
  await fixture(async root => {
    for (const fault of ['chmod-error', 'ignored-repair', 'identity', 'close']) {
      await chmod(root, 0o755)
      let closed = false
      const fs = {
        mkdir,
        lstat: async path => {
          const info = await lstat(path)
          return fault === 'identity' ? { ...info, ino: info.ino + 1, isDirectory: () => true, isSymbolicLink: () => false } : info
        },
        open: async (...args) => {
          const handle = await open(...args)
          return {
            stat: () => handle.stat(),
            chmod: async mode => {
              if (fault === 'chmod-error') throw new Error(`Private OS detail ${root}`)
              if (fault !== 'ignored-repair') await handle.chmod(mode)
            },
            close: async () => {
              closed = true
              await handle.close()
              if (fault === 'close') throw new Error(`Private OS close detail ${root}`)
            },
          }
        },
      }
      await assert.rejects(ensureDesktopUserDataDirectory(root, { fs }), error => {
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
    await assert.rejects(ensureDesktopUserDataDirectory(file, { platform: 'win32' }), DesktopUserDataError)
    assert.equal(await readFile(file, 'utf8'), 'Keep')
  })
})
