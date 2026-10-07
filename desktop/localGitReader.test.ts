import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { bundledGitDirectory } from './bundledGit.mjs'
import { createLocalGitReader, parseGitIndexEntries, localGitCommandEnvironment } from './localGitReader.mjs'
import { buildGitFileTestHelper } from './gitFileTestFixture.mjs'
import { readGitFile } from './gitFileRead.mjs'

const fileExecutable = buildGitFileTestHelper()
const gitExecutable = process.platform === 'darwin' ? join(bundledGitDirectory({ packaged: false }), 'git') : ''

const oid = 'a'.repeat(40)
const row = (name: string, mode = '100644', stage = 0) => `${mode} ${oid} ${stage}\t${name}\0`

test('Git enumeration is strict, bounded, NUL-delimited and retains nested tracked names', () => {
  assert.deepEqual(parseGitIndexEntries(Buffer.from(row('.github/workflows/build.yml') + row('src/app.ts'))), [
    { name: '.github/workflows/build.yml', mode: '100644' }, { name: 'src/app.ts', mode: '100644' },
  ])
  for (const text of [row('../escape.md'), row('/absolute.md'), row('src/.git/config'), row('.GIT/config'), row('src/.g\u200cit/config'), row('.\u200c./outside'), row('a\\b.md'), row('a\nb.md'), row('a.md').slice(0, -1)]) {
    assert.throws(() => parseGitIndexEntries(Buffer.from(text)))
  }
  assert.throws(() => parseGitIndexEntries(Buffer.from(Array.from({ length: 501 }, (_, i) => row(`${i}.md`)).join(''))))
  assert.deepEqual(parseGitIndexEntries(Buffer.from(row('conflict.md', '100644', 1) + row('conflict.md', '100644', 2))), [{ name: 'conflict.md', mode: '100644' }])
})

test('Git operation environment cannot inherit user configuration, loaders or lazy fetching', () => {
  const environment = localGitCommandEnvironment()
  assert.equal(environment.GIT_CONFIG_NOSYSTEM, '1')
  assert.equal(environment.GIT_CONFIG_GLOBAL, '/dev/null')
  assert.equal(environment.GIT_NO_LAZY_FETCH, '1')
  assert.equal(environment.GIT_OPTIONAL_LOCKS, '0')
  for (const key of ['HOME', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_CONFIG_COUNT', 'DYLD_INSERT_LIBRARIES', 'SSH_AUTH_SOCK']) assert.equal(Object.hasOwn(environment, key), false)
})

async function fixture(t) {
  const parent = await fs.mkdtemp(join(tmpdir(), 'local-git-reader-'))
  t.after(() => fs.rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'repository')
  await fs.mkdir(join(root, '.git', 'objects'), { recursive: true })
  await fs.mkdir(join(root, '.git', 'refs'))
  await fs.writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  await fs.writeFile(join(root, '.git', 'config'), '[core]\nrepositoryformatversion=0\n')
  await fs.writeFile(join(root, '.git', 'index'), 'fixture-index')
  await fs.mkdir(join(root, 'src'))
  await fs.writeFile(join(root, 'src', 'app.ts'), 'uncommitted edits\n')
  await fs.writeFile(join(root, 'untracked.md'), 'never captured')
  return { parent, root }
}

test('reader enumerates only private metadata copies and reads only tracked working bytes', { skip: process.platform !== 'darwin' }, async (t) => {
  const { root } = await fixture(t)
  const calls = []
  const reader = createLocalGitReader({
    gitExecutable: '/bundled/git',
    fileExecutable,
    runGit: async (args, options) => {
      calls.push({ args, options })
      assert.equal(options.cwd.includes(root), false)
      assert.equal(args.some(arg => arg.includes(root)), false, 'Git must never receive source paths')
      if (args.includes('config')) return { status: 1, stdout: Buffer.alloc(0) }
      return { status: args.includes('check-ignore') ? 1 : 0, stdout: Buffer.from(args.includes('check-ignore') ? '' : row('src/app.ts')) }
    },
  })
  const pinned = await reader.inspectLocalGitRoot(root)
  const before = await fs.stat(join(root, '.git', 'index'))
  const snapshot = await reader.readLocalGitSnapshot(pinned)
  assert.deepEqual(snapshot.files, [{ path: 'src/app.ts', sizeBytes: 18, snapshot: { text: 'uncommitted edits\n' } }])
  assert.equal((await fs.stat(join(root, '.git', 'index'))).mtimeMs, before.mtimeMs)
  assert.ok(calls.length >= 3)
})

test('connections pin both the selected directory and repository metadata identity', { skip: process.platform !== 'darwin' }, async (t) => {
  const { root, parent } = await fixture(t)
  const reader = createLocalGitReader({ gitExecutable: '/bundled/git', fileExecutable })
  const pinned = await reader.inspectLocalGitRoot(root)
  await fs.rename(join(root, '.git'), join(parent, 'old-git'))
  await fs.mkdir(join(root, '.git'))
  await assert.rejects(reader.readLocalGitSnapshot(pinned), /repository is unavailable or has changed/)
  await fs.symlink(root, join(parent, 'alias'))
  await assert.rejects(reader.inspectLocalGitRoot(join(parent, 'alias')), /repository is unavailable or has changed/)
})

test('actual bundled Git captures current nested text without touching split indexes or running source configuration', { skip: !gitExecutable || !existsSync(gitExecutable) }, async (t) => {
  const { root, parent } = await fixture(t)
  await fs.unlink(join(root, '.git', 'index'))
  const git = (...args: string[]) => {
    const result = spawnSync(gitExecutable, ['--no-pager', '-c', 'core.fsmonitor=false', ...args], { cwd: root, env: localGitCommandEnvironment(), encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  git('init', '--template=', '--initial-branch=main', '.')
  await fs.mkdir(join(root, '.config'))
  await fs.writeFile(join(root, '.config', 'tracked.json'), '{"enabled":true}\n')
  await fs.writeFile(join(root, '.gitignore'), 'ignored.md\n')
  await fs.writeFile(join(root, 'ignored.md'), 'must never enter snapshot')
  await fs.writeFile(join(root, 'removed.md'), 'staged then deleted')
  await fs.symlink(join(parent, 'outside.md'), join(root, 'link.md'))
  await fs.writeFile(join(parent, 'outside.md'), 'outside secret')
  git('add', '--', 'src/app.ts', '.config/tracked.json', '.gitignore', 'removed.md', 'link.md')
  git('add', '-f', '--', 'ignored.md')
  git('update-index', '--split-index')
  await fs.writeFile(join(root, 'src', 'app.ts'), 'edited after staging\n')
  await fs.unlink(join(root, 'removed.md'))
  const marker = join(parent, 'should-not-exist')
  git('config', 'core.fsmonitor', `touch ${marker}`)
  git('config', 'include.path', join(parent, 'missing-config'))
  const metadata = (await fs.readdir(join(root, '.git'))).filter(name => /^(index|sharedindex\.|config|HEAD)/.test(name))
  const before = await Promise.all(metadata.map(async name => ({ name, bytes: await fs.readFile(join(root, '.git', name)), mtime: (await fs.stat(join(root, '.git', name), { bigint: true })).mtimeNs })))
  const reader = createLocalGitReader({ gitExecutable, fileExecutable })
  const captured = await reader.readLocalGitSnapshot(await reader.inspectLocalGitRoot(root))
  assert.deepEqual(captured.files.map(file => [file.path, file.snapshot]), [
    ['.config/tracked.json', { text: '{"enabled":true}\n' }],
    ['.gitignore', { text: 'ignored.md\n' }],
    ['link.md', { omitted: 'unsupported' }],
    ['removed.md', { omitted: 'unreadable' }],
    ['src/app.ts', { text: 'edited after staging\n' }],
  ])
  for (const file of before) {
    assert.deepEqual(await fs.readFile(join(root, '.git', file.name)), file.bytes)
    assert.equal((await fs.stat(join(root, '.git', file.name), { bigint: true })).mtimeNs, file.mtime, file.name)
  }
  assert.equal(existsSync(marker), false)
  assert.equal(await fs.readFile(join(parent, 'outside.md'), 'utf8'), 'outside secret')
})

test('actual linked worktree captures its own index and refuses a changed backlink', { skip: !gitExecutable || !existsSync(gitExecutable) }, async (t) => {
  const parent = await fs.mkdtemp(join(tmpdir(), 'local-git-worktree-'))
  t.after(() => fs.rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'main')
  const linked = join(parent, 'linked')
  await fs.mkdir(root)
  const git = (...args: string[]) => {
    const result = spawnSync(gitExecutable, ['--no-pager', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgSign=false', ...args], { cwd: root, env: localGitCommandEnvironment(), encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  git('init', '--template=', '--initial-branch=main', '.')
  await fs.writeFile(join(root, 'note.md'), 'committed\n')
  git('add', '--', 'note.md')
  git('commit', '-m', 'fixture')
  git('worktree', 'add', '-b', 'linked', linked)
  await fs.writeFile(join(linked, 'note.md'), 'linked working text\n')
  const reader = createLocalGitReader({ gitExecutable, fileExecutable })
  const pinned = await reader.inspectLocalGitRoot(linked)
  assert.equal((await reader.readLocalGitSnapshot(pinned)).files[0].snapshot.text, 'linked working text\n')
  await fs.writeFile(join(pinned.repository.path, 'gitdir'), `${root}/.git\n`)
  await assert.rejects(reader.readLocalGitSnapshot(pinned), /repository is unavailable or has changed/)
})

for (const format of ['sha1', 'sha256']) for (const skipHash of [false, true]) {
  test(`actual ${format} index with skipHash=${skipHash} captures without reading external config`, { skip: !gitExecutable || !existsSync(gitExecutable) }, async (t) => {
    const parent = await fs.mkdtemp(join(tmpdir(), 'local-git-format-'))
    t.after(() => fs.rm(parent, { recursive: true, force: true }))
    const root = join(parent, 'repository')
    await fs.mkdir(root)
    const git = (...args: string[]) => {
      const result = spawnSync(gitExecutable, args, { cwd: root, env: localGitCommandEnvironment(), encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
    }
    git('init', '--template=', `--object-format=${format}`, '.')
    git('config', 'index.skipHash', String(skipHash))
    git('config', 'include.path', join(parent, 'private-unread-config'))
    await fs.writeFile(join(root, 'note.md'), 'working copy\n')
    git('add', '--', 'note.md')
    const index = await fs.readFile(join(root, '.git', 'index'))
    if (skipHash) assert.ok(index.subarray(-(format === 'sha1' ? 20 : 32)).every(byte => byte === 0))
    const reader = createLocalGitReader({ gitExecutable, fileExecutable })
    assert.equal((await reader.readLocalGitSnapshot(await reader.inspectLocalGitRoot(root))).files[0].snapshot.text, 'working copy\n')
    assert.deepEqual(await fs.readFile(join(root, '.git', 'index')), index)
  })
}

test('a changed source after read or cancelled capture yields no snapshot', { skip: process.platform !== 'darwin' }, async (t) => {
  const { root } = await fixture(t)
  const controller = new AbortController()
  let mutate = true
  const reader = createLocalGitReader({ gitExecutable: '/bundled/git', fileExecutable,
    runGit: async args => ({ status: args.includes('config') || args.includes('check-ignore') ? 1 : 0, stdout: Buffer.from(args.includes('ls-files') ? row('src/app.ts') : '') }),
    readFile: async (base, path, options) => {
      const value = await readGitFile(base, path, options)
      if (path === 'src/app.ts' && value.bytes && mutate) {
        mutate = false
        await fs.writeFile(join(root, path), 'changed during capture\n')
      }
      return value
    },
  })
  const pinned = await reader.inspectLocalGitRoot(root)
  await assert.rejects(reader.readLocalGitSnapshot(pinned), /repository is unavailable or has changed/)
  controller.abort()
  await assert.rejects(reader.readLocalGitSnapshot(pinned, { signal: controller.signal }), /repository is unavailable or has changed/)
})

test('a tracked directory replaced with a symlink never exposes its destination', { skip: process.platform !== 'darwin' }, async (t) => {
  const { root, parent } = await fixture(t)
  await fs.rename(join(root, 'src'), join(parent, 'outside'))
  await fs.symlink(join(parent, 'outside'), join(root, 'src'))
  const reader = createLocalGitReader({ gitExecutable: '/bundled/git', fileExecutable,
    runGit: async args => ({ status: args.includes('config') || args.includes('check-ignore') ? 1 : 0, stdout: Buffer.from(args.includes('ls-files') ? row('src/app.ts') : '') }),
  })
  const captured = await reader.readLocalGitSnapshot(await reader.inspectLocalGitRoot(root))
  assert.deepEqual(captured.files, [{ path: 'src/app.ts', sizeBytes: 0, snapshot: { omitted: 'unsupported' } }])
})
