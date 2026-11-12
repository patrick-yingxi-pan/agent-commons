import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { bundledGitDirectory } from './bundledGit.mjs'
import { buildGitFileTestHelper } from './gitFileTestFixture.mjs'
import { listLocalGitDirectory, readGitFile } from './gitFileRead.mjs'
import { createLocalGitReader, localGitCommandEnvironment, runLocalGit } from './localGitReader.mjs'
import { localBrowseFileByteLimit } from '../contract/localFileBrowse.mjs'

const fileExecutable = buildGitFileTestHelper()
const gitExecutable = process.platform === 'darwin' ? join(bundledGitDirectory({ packaged: false }), 'git') : ''
const native = { skip: process.platform !== 'darwin' }

async function fixture(t, {
  readHook = async (_base, _name, _options, _value) => {},
  directoryHook = async (_base, _relativePath, _options, _value) => {},
} = {}) {
  const parent = await fs.mkdtemp(join(tmpdir(), 'ac-git-untracked-'))
  t.after(() => fs.rm(parent, { recursive: true, force: true }))
  const selected = join(parent, 'repository')
  await fs.mkdir(selected)
  const root = await fs.realpath(selected)
  const git = (...args: string[]) => {
    const result = spawnSync(gitExecutable, ['-c', 'core.fsmonitor=false', ...args], { cwd: root, env: localGitCommandEnvironment(), encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  git('init', '--template=', '--initial-branch=main', '.')
  await fs.writeFile(join(root, 'tracked.md'), 'tracked body\n')
  await fs.writeFile(join(root, '.gitignore'), 'ignored.md\nignored-dir/\n')
  git('add', '--', 'tracked.md', '.gitignore')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'fixture')
  const reads: Array<{ base: string; name: string; body: boolean }> = []
  const directoryReads: string[] = []
  const commands: Array<{ args: string[]; cwd: string }> = []
  const reader = createLocalGitReader({
    gitExecutable,
    fileExecutable,
    readFile: async (base, name, options) => {
      const value = await readGitFile(base, name, { ...options, executable: fileExecutable })
      reads.push({ base: base.path, name, body: options.maxBytes !== null })
      await readHook(base, name, options, value)
      return value
    },
    listDirectory: async (base, relativePath, options) => {
      directoryReads.push(relativePath)
      const value = await listLocalGitDirectory(base, relativePath, { ...options, executable: fileExecutable })
      await directoryHook(base, relativePath, options, value)
      return value
    },
    runGit: async (args, options) => {
      commands.push({ args: [...args], cwd: options.cwd })
      return runLocalGit(gitExecutable, args, options)
    },
  })
  const pinned = await reader.inspectLocalGitRoot(root)
  reads.length = 0
  directoryReads.length = 0
  commands.length = 0
  return { parent, root, git, reads, directoryReads, commands, reader, pinned }
}

test('untracked listing returns only eligible file metadata, keeps dotfiles, and prunes ignored or nested Git trees', native, async t => {
  const { root, reader, pinned, reads, directoryReads } = await fixture(t)
  await fs.writeFile(join(root, '.env'), 'visible dotfile\n')
  await fs.mkdir(join(root, 'nested'))
  await fs.writeFile(join(root, 'nested', 'new.md'), 'nested body\n')
  await fs.writeFile(join(root, 'ignored.md'), 'ignored body\n')
  await fs.mkdir(join(root, 'ignored-dir'))
  await fs.writeFile(join(root, 'ignored-dir', '.gitignore'), 'unread-rule.md\n')
  await fs.writeFile(join(root, 'ignored-dir', 'secret.md'), 'ignored subtree body\n')
  await fs.mkdir(join(root, 'nested-repository'))
  await fs.mkdir(join(root, 'nested-repository', '.git'))
  await fs.writeFile(join(root, 'nested-repository', '.git', 'config'), 'metadata')
  await fs.writeFile(join(root, 'nested-repository', 'secret.md'), 'nested repository body\n')

  const listing = await reader.listLocalGitUntrackedFiles(pinned)
  assert.deepEqual(listing.files, [
    { path: '.env', kind: 'file' },
    { path: 'nested/new.md', kind: 'file' },
  ])
  assert.equal(listing.version, 1)
  assert.equal(listing.excludedCount, 2, 'one ignored file and one pruned ignored directory')
  assert.equal(directoryReads.includes('ignored-dir'), false, 'ignored directory is pruned before descent')
  assert.equal(directoryReads.includes('nested-repository'), true, 'the boundary directory is inspected for a nested .git marker')
  assert.equal(directoryReads.includes('nested-repository/.git'), false, 'nested Git metadata is never descended into')
  assert.equal(reads.some(read => read.name.startsWith('ignored-dir/')), false, 'ignored subtree metadata and bodies are not read')
  assert.equal(reads.some(read => read.name.startsWith('nested-repository/')), false, 'nested repository metadata and bodies are not read')
  assert.equal(reads.some(read => read.base === root && read.body && !read.name.endsWith('.gitignore')), false, 'listing reads no candidate bodies')
})

test('untracked ignore evaluation honors nested negations and .git/info/exclude without reading pruned rules', native, async t => {
  const { root, reader, pinned, reads, directoryReads } = await fixture(t)
  await fs.writeFile(join(root, '.gitignore'), 'ignored.md\nignored-dir/\nnested/*.md\n!nested/keep.md\n')
  await fs.mkdir(join(root, '.git', 'info'), { recursive: true })
  await fs.writeFile(join(root, '.git', 'info', 'exclude'), 'private.md\n')
  await fs.writeFile(join(root, 'ignored.md'), 'ignored')
  await fs.writeFile(join(root, 'private.md'), 'private')
  await fs.mkdir(join(root, 'ignored-dir'))
  await fs.writeFile(join(root, 'ignored-dir', '.gitignore'), 'nested-rule.md\n')
  await fs.writeFile(join(root, 'ignored-dir', 'nested-rule.md'), 'must not read')
  await fs.mkdir(join(root, 'nested'))
  await fs.writeFile(join(root, 'nested', '.gitignore'), 'drop.md\n!keep-local.md\n')
  await fs.writeFile(join(root, 'nested', 'drop.md'), 'nested ignore')
  await fs.writeFile(join(root, 'nested', 'ignored.md'), 'parent ignore')
  await fs.writeFile(join(root, 'nested', 'keep.md'), 'parent negation')
  await fs.writeFile(join(root, 'nested', 'keep-local.md'), 'nested negation')
  await fs.writeFile(join(root, 'nested', 'plain.txt'), 'visible')

  const listing = await reader.listLocalGitUntrackedFiles(pinned)
  assert.deepEqual(listing.files.map(file => file.path), [
    'nested/.gitignore',
    'nested/keep-local.md',
    'nested/keep.md',
    'nested/plain.txt',
  ])
  assert.equal(listing.excludedCount, 5, 'ignored file candidates, the ignored directory, and info/exclude matches count once each')
  assert.equal(directoryReads.includes('ignored-dir'), false)
  assert.equal(reads.some(read => read.name.startsWith('ignored-dir/')), false, 'an ignored directory’s own ignore file and descendants stay unread')
  assert.equal(reads.some(read => read.base.endsWith('/.git') && read.name === 'info/exclude' && read.body), true, 'the private exclude file supplies ignore policy')
})

test('untracked scan subtracts indexed paths and never descends beneath indexed file, conflict, sparse, or submodule entries', native, async t => {
  const { root, reader, pinned, git, directoryReads } = await fixture(t)
  await fs.writeFile(join(root, 'blocked-file'), 'indexed then replaced')
  await fs.writeFile(join(root, 'conflict'), 'conflict base')
  await fs.mkdir(join(root, 'sparse-placeholder'))
  await fs.writeFile(join(root, 'sparse-placeholder', 'tracked.md'), 'sparse child')
  git('add', '--', 'blocked-file', 'conflict', 'sparse-placeholder/tracked.md')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'indexed paths')
  const conflictOid = git('rev-parse', ':conflict').trim()
  const headOid = git('rev-parse', 'HEAD').trim()
  git('sparse-checkout', 'init', '--cone', '--sparse-index')
  git('sparse-checkout', 'set', 'visible')
  git('update-index', '--force-remove', '--', 'conflict')
  const conflictStages = spawnSync(gitExecutable, ['update-index', '--index-info'], {
    cwd: root,
    env: localGitCommandEnvironment(),
    input: `100644 ${conflictOid} 1\tconflict\n100644 ${conflictOid} 2\tconflict\n`,
    encoding: 'utf8',
  })
  assert.equal(conflictStages.status, 0, conflictStages.stderr)
  git('update-index', '--add', '--cacheinfo', `160000,${headOid},submodule`)
  await fs.mkdir(join(root, 'sparse-placeholder'))
  await fs.writeFile(join(root, 'sparse-placeholder', 'new.md'), 'must be pruned')
  await fs.rm(join(root, 'blocked-file'))
  await fs.mkdir(join(root, 'blocked-file'))
  await fs.writeFile(join(root, 'blocked-file', 'new.md'), 'must be pruned')
  await fs.rm(join(root, 'conflict'))
  await fs.mkdir(join(root, 'conflict'))
  await fs.writeFile(join(root, 'conflict', 'new.md'), 'must be pruned')
  await fs.mkdir(join(root, 'submodule'))
  await fs.writeFile(join(root, 'submodule', 'new.md'), 'must be pruned')

  const listing = await reader.listLocalGitUntrackedFiles(pinned)
  for (const path of ['blocked-file/new.md', 'conflict/new.md', 'submodule/new.md', 'sparse-placeholder/new.md']) {
    assert.equal(listing.files.some(file => file.path === path), false, path)
  }
  assert.equal(directoryReads.includes('blocked-file'), false)
  assert.equal(directoryReads.includes('conflict'), false)
  assert.equal(directoryReads.includes('submodule'), false)
  assert.equal(directoryReads.includes('sparse-placeholder'), false)
})

test('selected untracked reads re-admit the exact current untracked path and read only the selected body', native, async t => {
  const { root, reader, pinned, reads, git } = await fixture(t)
  await fs.writeFile(join(root, 'chosen.md'), 'selected body\n')
  await fs.writeFile(join(root, 'other.md'), 'other body\n')
  await fs.writeFile(join(root, 'ignored.md'), 'ignored body\n')
  const listing = await reader.listLocalGitUntrackedFiles(pinned)
  assert.deepEqual(listing.files.map(file => file.path), ['chosen.md', 'other.md'])

  reads.length = 0
  const preview = await reader.readLocalGitUntrackedFile(pinned, { selection: { path: 'chosen.md' } })
  assert.equal(preview.path, 'chosen.md')
  assert.equal(preview.snapshot.text, 'selected body\n')
  assert.deepEqual(reads.filter(read => read.base === root && read.body && !read.name.endsWith('.gitignore')).map(read => read.name), ['chosen.md'])

  await fs.writeFile(join(root, 'staged-after-listing.md'), 'now tracked\n')
  git('add', '--', 'staged-after-listing.md')
  for (const path of ['tracked.md', 'ignored.md', 'staged-after-listing.md', 'directory', '../outside.md', '.git/config']) {
    if (path === 'directory') await fs.mkdir(join(root, 'directory'))
    reads.length = 0
    await assert.rejects(reader.readLocalGitUntrackedFile(pinned, { selection: { path } }), /unavailable or has changed/i, path)
    assert.equal(reads.some(read => read.base === root && read.name === path && read.body), false, path)
  }
})

test('staging and removing an index entry moves one path between tracked and untracked reads without widening bulk capture', native, async t => {
  const { root, reader, pinned, git } = await fixture(t)
  await fs.writeFile(join(root, 'promote.md'), 'promoted body\n')
  const initialSnapshot = await reader.readLocalGitSnapshot(pinned)
  assert.equal(initialSnapshot.files.some(file => file.path === 'promote.md'), false)
  assert.equal((await reader.listLocalGitFiles(pinned)).files.some(file => file.path === 'promote.md'), false)
  assert.equal((await reader.listLocalGitUntrackedFiles(pinned)).files.some(file => file.path === 'promote.md'), true)
  assert.equal((await reader.readLocalGitUntrackedFile(pinned, { selection: { path: 'promote.md' } })).snapshot.text, 'promoted body\n')
  await assert.rejects(reader.readLocalGitFile(pinned, { selection: { path: 'promote.md' } }), /unavailable or has changed/i)

  git('add', '--', 'promote.md')
  assert.equal((await reader.listLocalGitFiles(pinned)).files.some(file => file.path === 'promote.md'), true)
  assert.equal((await reader.listLocalGitUntrackedFiles(pinned)).files.some(file => file.path === 'promote.md'), false)
  assert.equal((await reader.readLocalGitFile(pinned, { selection: { path: 'promote.md' } })).snapshot.text, 'promoted body\n')
  await assert.rejects(reader.readLocalGitUntrackedFile(pinned, { selection: { path: 'promote.md' } }), /unavailable or has changed/i)
  assert.equal((await reader.readLocalGitSnapshot(pinned)).files.some(file => file.path === 'promote.md'), true, 'tracked snapshots preserve existing tracked capture semantics')

  git('rm', '--cached', '--', 'promote.md')
  assert.equal((await reader.listLocalGitFiles(pinned)).files.some(file => file.path === 'promote.md'), false)
  assert.equal((await reader.listLocalGitUntrackedFiles(pinned)).files.some(file => file.path === 'promote.md'), true)
  assert.equal((await reader.readLocalGitUntrackedFile(pinned, { selection: { path: 'promote.md' } })).snapshot.text, 'promoted body\n')
  await assert.rejects(reader.readLocalGitFile(pinned, { selection: { path: 'promote.md' } }), /unavailable or has changed/i)
  assert.equal((await reader.readLocalGitSnapshot(pinned)).files.some(file => file.path === 'promote.md'), false, 'bulk capture still excludes untracked files')
})

test('untracked discovery refuses a child creation or replacement after its initial directory scan', native, async t => {
  for (const mutation of ['create', 'replace']) {
    let mutated = false
    const data = await fixture(t, {
      directoryHook: async (base, relativePath) => {
        if (mutated || relativePath !== '') return
        mutated = true
        if (mutation === 'create') await fs.writeFile(join(base.path, 'late.md'), 'late')
        else {
          await fs.rename(join(base.path, 'existing.md'), join(base.path, 'parked.md'))
          await fs.writeFile(join(base.path, 'existing.md'), 'replacement')
        }
      },
    })
    if (mutation === 'replace') await fs.writeFile(join(data.root, 'existing.md'), 'original')
    else await fs.writeFile(join(data.root, 'initial.md'), 'initial')
    await assert.rejects(data.reader.listLocalGitUntrackedFiles(data.pinned), /unavailable or has changed/i, mutation)
    assert.equal(mutated, true)
  }
})

test('selected untracked symlink is an explicit omission and never reads its target', native, async t => {
  const { parent, root, reader, pinned, reads } = await fixture(t)
  const outside = join(parent, 'outside.md')
  await fs.writeFile(outside, 'outside secret')
  await fs.symlink(outside, join(root, 'link.md'))
  const listing = await reader.listLocalGitUntrackedFiles(pinned)
  assert.deepEqual(listing.files, [{ path: 'link.md', kind: 'unsupported' }])
  reads.length = 0
  const preview = await reader.readLocalGitUntrackedFile(pinned, { selection: { path: 'link.md' } })
  assert.deepEqual(preview.snapshot, { omitted: 'unsupported' })
  assert.equal(reads.some(read => read.base === root && read.name === 'link.md' && read.body), false)
})

test('untracked document previews return only selected bounded original bytes and unsupported names stay unavailable', native, async t => {
  const { root, reader, pinned, reads } = await fixture(t)
  const documentBytes = new Uint8Array(65_537).fill(255)
  const imageBytes = new Uint8Array([0, 255, 1, 2])
  await fs.writeFile(join(root, 'document.pdf'), documentBytes)
  await fs.writeFile(join(root, 'photo.WebP'), imageBytes)
  await fs.writeFile(join(root, 'archive.zip'), 'not supported')
  const listing = await reader.listLocalGitUntrackedFiles(pinned)
  assert.deepEqual(listing.files, [
    { path: 'archive.zip', kind: 'unsupported' },
    { path: 'document.pdf', kind: 'file' },
    { path: 'photo.WebP', kind: 'file' },
  ])
  assert.equal(reads.some(read => read.base === root && read.name === 'photo.WebP' && read.body), false)
  reads.length = 0
  const preview = await reader.readLocalGitUntrackedFile(pinned, { selection: { path: 'document.pdf' } })
  assert.deepEqual(preview.snapshot, { document: { format: 'pdf', bytes: documentBytes } })
  assert.deepEqual(reads.filter(read => read.base === root && read.body && !read.name.endsWith('.gitignore')).map(read => read.name), ['document.pdf'])
  reads.length = 0
  const image = await reader.readLocalGitUntrackedFile(pinned, { selection: { path: 'photo.WebP' } })
  assert.deepEqual(image.snapshot, { image: { bytes: imageBytes } })
  assert.deepEqual(reads.filter(read => read.base === root && read.body && !read.name.endsWith('.gitignore')).map(read => read.name), ['photo.WebP'])
  reads.length = 0
  const unsupported = await reader.readLocalGitUntrackedFile(pinned, { selection: { path: 'archive.zip' } })
  assert.deepEqual(unsupported.snapshot, { omitted: 'unsupported' })
  assert.equal(reads.some(read => read.base === root && read.name === 'archive.zip' && read.body), false)

  await fs.writeFile(join(root, 'oversized.pdf'), new Uint8Array(localBrowseFileByteLimit('oversized.pdf') + 1))
  assert.deepEqual((await reader.readLocalGitUntrackedFile(pinned, { selection: { path: 'oversized.pdf' } })).snapshot, { omitted: 'too-large' })
  await fs.writeFile(join(root, 'oversized.png'), new Uint8Array(localBrowseFileByteLimit('oversized.png') + 1))
  reads.length = 0
  assert.deepEqual((await reader.readLocalGitUntrackedFile(pinned, { selection: { path: 'oversized.png' } })).snapshot, { omitted: 'too-large' })
  assert.equal(reads.some(read => read.base === root && read.name === 'oversized.png' && read.body), true)
})

for (const changed of ['body', 'index', 'ignore', 'root', 'cancel']) {
  test(`selected untracked read fences ${changed} changes before publication`, native, async t => {
    let once = false
    const abort = new AbortController()
    const data = await fixture(t, {
      readHook: async (base, name, options) => {
        if (!once && name === 'new.md' && options.maxBytes !== null) {
          once = true
          if (changed === 'body') await fs.writeFile(join(base.path, name), 'changed body\n')
          if (changed === 'index') await fs.appendFile(join(base.path, '.git/index'), 'changed')
          if (changed === 'ignore') await fs.appendFile(join(base.path, '.gitignore'), 'new.md\n')
          if (changed === 'root') await fs.rename(base.path, `${base.path}-moved`)
          if (changed === 'cancel') abort.abort()
        }
      },
    })
    await fs.writeFile(join(data.root, 'new.md'), 'original body\n')
    await assert.rejects(data.reader.readLocalGitUntrackedFile(data.pinned, {
      signal: abort.signal,
      selection: { path: 'new.md' },
    }), /unavailable or has changed/i)
    assert.equal(once, true, 'the selected candidate body was reached before the transaction fence')
  })
}

test('untracked Git reads preserve split index bytes and mtime and never execute source configuration', native, async t => {
  const { root, parent, reader, pinned, git, commands } = await fixture(t)
  await fs.writeFile(join(root, 'new.md'), 'safe body\n')
  git('update-index', '--split-index')
  const marker = join(parent, 'must-not-run')
  git('config', 'core.fsmonitor', `touch ${marker}`)
  git('config', 'include.path', join(parent, 'private-unread-config'))
  const names = (await fs.readdir(join(root, '.git'))).filter(name => /^(index|sharedindex\.|config|HEAD)/.test(name))
  const before = await Promise.all(names.map(async name => ({
    name,
    bytes: await fs.readFile(join(root, '.git', name)),
    mtime: (await fs.stat(join(root, '.git', name), { bigint: true })).mtimeNs,
  })))
  await reader.listLocalGitUntrackedFiles(pinned)
  await reader.readLocalGitUntrackedFile(pinned, { selection: { path: 'new.md' } })
  assert.ok(commands.length > 0)
  for (const command of commands) {
    assert.notEqual(command.cwd, root, 'Git is never run in the source worktree')
    assert.ok(command.args.some(argument => argument.startsWith('--git-dir=') && !argument.startsWith(`--git-dir=${join(root, '.git')}`)), 'Git uses copied private metadata')
    assert.ok(command.args.some(argument => argument.startsWith('--work-tree=') && !argument.startsWith(`--work-tree=${root}`)), 'Git uses a private empty worktree')
  }
  for (const item of before) {
    assert.deepEqual(await fs.readFile(join(root, '.git', item.name)), item.bytes)
    assert.equal((await fs.stat(join(root, '.git', item.name), { bigint: true })).mtimeNs, item.mtime)
  }
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' })
})

test('untracked traversal counts raw entries and fails closed at per-directory, depth, and path-byte bounds', native, async t => {
  const { root, reader, pinned } = await fixture(t)
  const wide = join(root, 'wide')
  await fs.mkdir(wide)
  for (let index = 0; index < 10_001; index += 1) await fs.writeFile(join(wide, `entry-${String(index).padStart(5, '0')}`), '')
  await assert.rejects(reader.listLocalGitUntrackedFiles(pinned), /unavailable or has changed|limit|exceed/i)
})

test('untracked traversal refuses depth and aggregate candidate-path overflow', native, async t => {
  const depthFixture = await fixture(t)
  const chain: string[] = []
  let current = depthFixture.root
  for (let index = 0; index < 65; index += 1) {
    current = join(current, 'd')
    chain.push(current)
    await fs.mkdir(current)
  }
  await fs.writeFile(join(current, 'leaf.md'), '')
  await assert.rejects(depthFixture.reader.listLocalGitUntrackedFiles(depthFixture.pinned), /unavailable or has changed|limit|exceed/i)

  const pathFixture = await fixture(t)
  for (const directory of ['a', 'b', 'c']) {
    const parent = join(pathFixture.root, directory)
    await fs.mkdir(parent)
    for (let index = 0; index < 1_450; index += 1) {
      const name = `${String(index).padStart(4, '0')}-${'x'.repeat(240)}`
      await fs.writeFile(join(parent, name), '')
    }
  }
  await assert.rejects(pathFixture.reader.listLocalGitUntrackedFiles(pathFixture.pinned), /unavailable or has changed|limit|exceed/i)
})
