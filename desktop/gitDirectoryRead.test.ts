import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildGitFileHelper } from './gitFileBuild.mjs'
import { buildGitFileTestHelper } from './gitFileTestFixture.mjs'
import { listLocalGitDirectory } from './gitFileRead.mjs'

const native = { skip: process.platform !== 'darwin' }
const fileExecutable = buildGitFileTestHelper()
const version = '1:2:33188:3:4:5:6:7'
const directoryVersion = '1:3:16877:0:4:5:6:7'
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-directory-test-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const rootPath = join(temporary, 'repo')
  await mkdir(rootPath)
  const rootStat = await lstat(rootPath, { bigint: true })
  return {
    temporary,
    executable: fileExecutable,
    rootPath,
    root: { path: rootPath, identity: { dev: String(rootStat.dev), ino: String(rootStat.ino) } },
  }
}

test('directory reader rejects invalid roots and relative selections before invoking the helper', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-directory-sentinel-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const marker = join(temporary, 'spawned')
  const executable = join(temporary, 'sentinel-helper')
  await writeFile(executable, `#!/bin/sh\nprintf spawned > ${quote(marker)}\n`)
  await chmod(executable, 0o755)
  const root = { path: '/tmp', identity: { dev: '1', ino: '2' } }
  for (const relativeDirectory of [
    '/etc', '../outside', 'a/../b', 'a//b', './a', 'a\\b', 'a/\nb', `${'a/'.repeat(65)}leaf`, 'x'.repeat(4097),
    '.git', '.GIT', 'nested/.git', 'nested/.GIT', '\ud800',
  ]) {
    await assert.rejects(listLocalGitDirectory(root, relativeDirectory, { executable }), /unavailable|limit/i, relativeDirectory)
  }
  await assert.rejects(lstat(marker), { code: 'ENOENT' })
})

test('directory reader accepts only the closed bounded UTF-8 one-directory protocol', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-directory-protocol-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = { path: temporary, identity: { dev: '1', ino: '2' } }
  let index = 0
  async function helper(response: string, binary = false) {
    const executable = join(temporary, `fixture-${index++}`)
    const print = binary ? `printf '%b' ${quote(response)}` : `printf '%s' ${quote(response)}`
    await writeFile(executable, `#!/bin/sh\nif [ "$#" = 5 ] && [ "$1" = '--list-directory' ] && [ "$2" = ${quote(root.path)} ] && [ "$3" = '1' ] && [ "$4" = '2' ] && [ "$5" = '' ]; then ${print}; else exit 64; fi\n`)
    await chmod(executable, 0o755)
    return executable
  }

  const good = `L 2 3 ${directoryVersion}\nF 3 ${version}\tfile.md\nD 9 ${directoryVersion}\tdir\n`
  assert.deepEqual(await listLocalGitDirectory(root, '', { executable: await helper(good) }), {
    version: directoryVersion,
    visited: 3,
    entries: [
      { name: 'dir', kind: 'D', sizeBytes: 9, version: directoryVersion },
      { name: 'file.md', kind: 'F', sizeBytes: 3, version },
    ],
  })

  const invalid = [
    `L 0 1 ${directoryVersion}\nF 3 ${version}\tfile.md\n`,
    `L 2 1 ${directoryVersion}\nF 3 ${version}\tfile.md\n`,
    `L 01 1 ${directoryVersion}\n`,
    `L 1 1 ${directoryVersion}\nF 3 ${version}\tfile.md\textra\n`,
    `L 2 2 ${directoryVersion}\nF 3 ${version}\tfile.md\nF 3 ${version}\tfile.md\n`,
    `L 1 1 ${directoryVersion}\nF 9007199254740992 ${version}\tfile.md\n`,
    `L 1 1 ${directoryVersion}\nF -1 ${version}\tfile.md\n`,
    `L 1 1 ${directoryVersion}\nU 3 ${version}\t../outside\n`,
    `L 1 1 ${directoryVersion}\nF 3 ${version}\ta/b\n`,
    `L 1 1 ${directoryVersion}\nF 3 ${version}\ta\\b\n`,
    `L 1 1 ${directoryVersion}\nF 3 ${version}\t.\n`,
    `L 1 1 ${directoryVersion}\nF 3 ${version}\t..\n`,
    `L 1 1 ${directoryVersion}\nF 3 ${version}\tbad\u0001name\n`,
    `L 1 1 ${directoryVersion}\nF 3 ${version}\tfile.md\nextra\n`,
    `L 1 1 ${directoryVersion}\nF 3 ${version}\tbad\\377name\n`,
  ]
  for (const response of invalid) {
    const binary = response.includes('\\377')
    await assert.rejects(listLocalGitDirectory(root, '', { executable: await helper(response, binary) }), /invalid|unavailable|limit/i)
  }
})

test('directory reader lists sorted hidden and nested metadata without reading file bodies', { skip: native.skip }, async (t) => {
  const { executable, rootPath, root } = await fixture(t)
  const nestedPath = join(rootPath, 'nested')
  await mkdir(nestedPath)
  await writeFile(join(rootPath, '.hidden'), 'hidden body')
  await writeFile(join(rootPath, 'ordinary'), 'ordinary body')
  await writeFile(join(nestedPath, 'inside'), 'nested body')
  const unreadablePath = join(rootPath, 'unreadable')
  await writeFile(unreadablePath, 'still metadata only')
  await chmod(unreadablePath, 0)

  const listing = await listLocalGitDirectory(root, '', { executable })
  assert.equal(typeof listing.version, 'string')
  assert.match(listing.version, /^\d+:\d+:\d+:-?\d+:/)
  assert.equal(listing.visited, 4)
  assert.deepEqual(listing.entries.map(entry => entry.name), ['.hidden', 'nested', 'ordinary', 'unreadable'])
  assert.deepEqual(listing.entries.map(entry => entry.kind), ['F', 'D', 'F', 'F'])
  assert.deepEqual(listing.entries.filter(entry => entry.kind === 'F').map(entry => entry.sizeBytes), [11, 13, 19])
  assert.ok(Number.isSafeInteger(listing.entries[1].sizeBytes) && listing.entries[1].sizeBytes >= 0)
  for (const entry of listing.entries) {
    assert.match(entry.version, /^\d+:\d+:\d+:-?\d+:/)
    assert.deepEqual(Object.keys(entry).sort(), ['kind', 'name', 'sizeBytes', 'version'])
  }

  const nested = await listLocalGitDirectory(root, 'nested', { executable })
  assert.equal(nested.visited, 1)
  assert.deepEqual(nested.entries.map(entry => ({ name: entry.name, kind: entry.kind })), [{ name: 'inside', kind: 'F' }])
})

test('directory reader reports symlinks as metadata-only unsupported entries and never follows them', { skip: native.skip }, async (t) => {
  const { executable, rootPath, root, temporary } = await fixture(t)
  const outside = join(temporary, 'outside')
  const outsideDirectory = join(temporary, 'outside-directory')
  await writeFile(outside, 'outside body')
  await mkdir(outsideDirectory)
  await writeFile(join(outsideDirectory, 'secret'), 'must not be visited')
  await symlink(outside, join(rootPath, 'file-link'))
  await symlink(outsideDirectory, join(rootPath, 'directory-link'))

  const listing = await listLocalGitDirectory(root, '', { executable })
  assert.equal(listing.visited, 2)
  assert.deepEqual(listing.entries.map(entry => ({ name: entry.name, kind: entry.kind })), [
    { name: 'directory-link', kind: 'U' },
    { name: 'file-link', kind: 'U' },
  ])
  await assert.rejects(listLocalGitDirectory(root, 'directory-link', { executable }))
  assert.equal(await readFile(join(outsideDirectory, 'secret'), 'utf8'), 'must not be visited')
})

test('directory reader refuses a symlink ancestor and changed pinned roots', { skip: native.skip }, async (t) => {
  const { executable, rootPath, root, temporary } = await fixture(t)
  const outside = join(temporary, 'outside-directory')
  await mkdir(outside)
  await writeFile(join(outside, 'secret'), 'outside')
  await symlink(outside, join(rootPath, 'link'))
  await assert.rejects(listLocalGitDirectory(root, 'link', { executable }))
  await assert.rejects(listLocalGitDirectory({ ...root, identity: { dev: '0', ino: '0' } }, '', { executable }))
})

test('directory reader rejects an oversized raw listing instead of returning a prefix', { skip: native.skip }, async (t) => {
  const { executable, rootPath, root } = await fixture(t)
  for (let index = 0; index < 10_001; index += 1) {
    await writeFile(join(rootPath, `entry-${String(index).padStart(5, '0')}`), '')
  }
  await assert.rejects(listLocalGitDirectory(root, '', { executable }), /exceeds|limit|changed|unavailable/i)
})

test('directory reader rejects a returned basename-byte budget overflow instead of returning a prefix', { skip: native.skip }, async (t) => {
  const { executable, rootPath, root } = await fixture(t)
  const basename = (index: number) => `${String(index).padStart(4, '0')}-${'x'.repeat(245)}`
  for (let index = 0; index < 4_200; index += 1) await writeFile(join(rootPath, basename(index)), '')
  await assert.rejects(listLocalGitDirectory(root, '', { executable }), /exceeds|limit|changed|unavailable/i)
})

test('an abort during listener registration cannot leave helper spawn errors unhandled', async () => {
  let aborted = false
  let abortedChecks = 0
  const signal = {
    get aborted() {
      abortedChecks += 1
      return aborted
    },
    addEventListener(type: string, listener: () => void) {
      assert.equal(type, 'abort')
      aborted = true
      listener()
    },
    removeEventListener() {},
  }
  const root = { path: '/tmp', identity: { dev: '1', ino: '2' } }
  await assert.rejects(listLocalGitDirectory(root, '', { executable: '/does/not/exist', signal }), /cancelled/i)
  assert.equal(abortedChecks, 2)
})

test('native directory reader reports mutation during enumeration as changed, never partial metadata', { skip: native.skip }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-directory-hooks-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = join(temporary, 'agent-commons-git-file-hooks')
  assert.equal(buildGitFileHelper({ outputPath: executable, testHooks: true }), executable)
  const rootPath = join(temporary, 'repo')
  await mkdir(rootPath)
  const rootStat = await lstat(rootPath, { bigint: true })
  const root = { path: rootPath, identity: { dev: String(rootStat.dev), ino: String(rootStat.ino) } }
  const filePath = join(rootPath, 'entry')
  const replacementPath = join(rootPath, 'replacement')
  const outsidePath = join(temporary, 'outside')
  const readyPath = join(temporary, 'ready')
  const releasePath = join(temporary, 'release')
  await writeFile(filePath, 'before')
  await writeFile(outsidePath, 'outside')

  // The wrapper adds only the test-owned pause variables; the native helper
  // still receives its normal closed environment from the production reader.
  const wrapper = join(temporary, 'paused-helper')
  await writeFile(wrapper, `#!/bin/sh\nAGENT_COMMONS_GIT_FILE_TEST_READY='${readyPath}' AGENT_COMMONS_GIT_FILE_TEST_RELEASE='${releasePath}' exec '${executable}' "$@"\n`)
  await chmod(wrapper, 0o755)

  const listing = listLocalGitDirectory(root, '', { executable: wrapper })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try { await lstat(readyPath); break } catch {}
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  await lstat(readyPath)
  await rm(filePath)
  await writeFile(replacementPath, 'replacement')
  await writeFile(releasePath, 'continue')
  await assert.rejects(listing, /changed|unavailable/i)
})

test('native directory reader fences mutations to root and intermediate ancestors during nested enumeration', { skip: native.skip }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-directory-ancestor-hooks-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = join(temporary, 'agent-commons-git-file-hooks')
  assert.equal(buildGitFileHelper({ outputPath: executable, testHooks: true }), executable)
  const rootPath = join(temporary, 'repo')
  const parentPath = join(rootPath, 'parent')
  const targetPath = join(parentPath, 'target')
  await mkdir(targetPath, { recursive: true })
  const rootStat = await lstat(rootPath, { bigint: true })
  const root = { path: rootPath, identity: { dev: String(rootStat.dev), ino: String(rootStat.ino) } }
  await writeFile(join(targetPath, 'entry'), 'stable target listing')

  for (const changedAncestor of ['root', 'parent']) {
    const readyPath = join(temporary, `${changedAncestor}-ready`)
    const releasePath = join(temporary, `${changedAncestor}-release`)
    const wrapper = join(temporary, `${changedAncestor}-paused-helper`)
    await writeFile(wrapper, `#!/bin/sh\nAGENT_COMMONS_GIT_FILE_TEST_READY='${readyPath}' AGENT_COMMONS_GIT_FILE_TEST_RELEASE='${releasePath}' exec '${executable}' "$@"\n`)
    await chmod(wrapper, 0o755)

    const listing = listLocalGitDirectory(root, 'parent/target', { executable: wrapper })
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      try { await lstat(readyPath); break } catch {}
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    await lstat(readyPath)
    const changedDirectory = changedAncestor === 'root' ? rootPath : parentPath
    await writeFile(join(changedDirectory, `${changedAncestor}-sibling-created-during-scan`), 'mutates the ancestor directory')
    await writeFile(releasePath, 'continue')
    await assert.rejects(listing, /changed|unavailable/i)
  }
})

