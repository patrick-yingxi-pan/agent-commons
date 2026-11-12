import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { bundledGitDirectory } from './bundledGit.mjs'
import { buildGitFileTestHelper } from './gitFileTestFixture.mjs'
import { readGitFile } from './gitFileRead.mjs'
import { createLocalGitReader, localGitCommandEnvironment } from './localGitReader.mjs'
import { localBrowseFileByteLimit } from '../contract/localFileBrowse.mjs'

const fileExecutable = buildGitFileTestHelper()
const gitExecutable = process.platform === 'darwin' ? join(bundledGitDirectory({ packaged: false }), 'git') : ''
const native = { skip: process.platform !== 'darwin' }

async function fixture(t, readHook = async (_base, _name, _options, _value) => {}) {
  const parent = await fs.mkdtemp(join(tmpdir(), 'ac-git-browse-'))
  t.after(() => fs.rm(parent, { recursive: true, force: true }))
  const selected = join(parent, 'repository')
  await fs.mkdir(selected)
  const root = await fs.realpath(selected)
  const git = (...args) => {
    const result = spawnSync(gitExecutable, ['-c', 'core.fsmonitor=false', ...args], { cwd: root, env: localGitCommandEnvironment(), encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  git('init', '--template=', '--initial-branch=main', '.')
  await fs.mkdir(join(root, 'src'))
  for (const [name, content] of Object.entries({ 'src/a.ts': 'working A\n', 'b.md': 'working B\n', 'empty.txt': '',
    'binary.txt': '\u0000binary', 'image.png': 'not text', 'ignored.md': 'ignored secret', 'untracked.md': 'untracked secret',
    '.gitignore': 'ignored.md\n' })) await fs.writeFile(join(root, name), content)
  git('add', '--', 'src/a.ts', 'b.md', 'empty.txt', 'binary.txt', 'image.png', '.gitignore')
  git('add', '-f', '--', 'ignored.md')
  const reads = []
  const reader = createLocalGitReader({ gitExecutable, fileExecutable, readFile: async (base, name, options) => {
    const value = await readGitFile(base, name, options)
    reads.push({ base: base.path, name, body: options.maxBytes !== null })
    await readHook(base, name, options, value)
    return value
  } })
  const pinned = await reader.inspectLocalGitRoot(root)
  reads.length = 0
  return { parent, root, git, reads, reader, pinned }
}

test('native browse lists metadata only; one selected read uses current tracked working bytes', native, async t => {
  const { root, reader, pinned, reads } = await fixture(t)
  const listed = await reader.listLocalGitFiles(pinned)
  assert.deepEqual(listed.files.map(file => file.path), ['.gitignore', 'b.md', 'binary.txt', 'empty.txt', 'image.png', 'src/a.ts'])
  assert.equal(listed.excludedCount, 1)
  assert.equal(listed.files.find(file => file.path === 'image.png').kind, 'file')
  assert.deepEqual(reads.filter(read => read.base === root && read.body).map(read => read.name), ['.gitignore', 'src/.gitignore'])
  reads.length = 0
  await fs.writeFile(join(root, 'src/a.ts'), 'edited after listing\n')
  const preview = await reader.readLocalGitFile(pinned, { selection: { path: 'src/a.ts' } })
  assert.equal(preview.snapshot.text, 'edited after listing\n')
  assert.deepEqual(reads.filter(read => read.base === root && read.body && !read.name.endsWith('.gitignore')).map(read => read.name), ['src/a.ts'])
  assert.equal((await reader.readLocalGitFile(pinned, { selection: { path: 'empty.txt' } })).snapshot.text, '')
  assert.deepEqual((await reader.readLocalGitFile(pinned, { selection: { path: 'image.png' } })).snapshot,
    { image: { bytes: new TextEncoder().encode('not text') } })
  assert.deepEqual((await reader.readLocalGitFile(pinned, { selection: { path: 'binary.txt' } })).snapshot, { omitted: 'unsupported' })
})

test('native selected reads recheck membership and ignores, and refuse arbitrary paths without body reads', native, async t => {
  const { root, reader, pinned, reads, git } = await fixture(t)
  await reader.listLocalGitFiles(pinned)
  git('rm', '--cached', '--', 'b.md')
  await fs.appendFile(join(root, '.gitignore'), 'src/a.ts\n')
  for (const path of ['b.md', 'src/a.ts', 'ignored.md', 'untracked.md', '../outside.md', '.git/config', '/etc/passwd']) {
    reads.length = 0
    await assert.rejects(reader.readLocalGitFile(pinned, { selection: { path } }), /unavailable or has changed/)
    assert.equal(reads.some(read => read.base === root && read.name === path && read.body), false, path)
  }
})

test('native browse preserves conflict, sparse, links and omissions rather than implying readable or deleted files', native, async t => {
  const { parent, root, reader, pinned, reads, git } = await fixture(t)
  git('update-index', '--skip-worktree', '--', 'b.md')
  const oid = git('rev-parse', ':src/a.ts').trim()
  git('update-index', '--force-remove', '--', 'src/a.ts')
  const result = spawnSync(gitExecutable, ['update-index', '--index-info'], { cwd: root, env: localGitCommandEnvironment(), input: `100644 ${oid} 1\tsrc/a.ts\n100644 ${oid} 2\tsrc/a.ts\n`, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  await fs.writeFile(join(parent, 'outside.md'), 'outside secret')
  await fs.symlink(join(parent, 'outside.md'), join(root, 'link.md'))
  git('add', '--', 'link.md')
  const listing = await reader.listLocalGitFiles(pinned)
  assert.equal(listing.files.find(file => file.path === 'b.md').kind, 'sparse')
  assert.equal(listing.files.find(file => file.path === 'src/a.ts').kind, 'conflict')
  assert.equal(listing.files.find(file => file.path === 'link.md').kind, 'unsupported')
  for (const path of ['src/a.ts', 'b.md']) await assert.rejects(reader.readLocalGitFile(pinned, { selection: { path } }))
  assert.deepEqual((await reader.readLocalGitFile(pinned, { selection: { path: 'link.md' } })).snapshot, { omitted: 'unsupported' })
  assert.equal(reads.some(read => read.base === root && ['src/a.ts', 'b.md', 'link.md'].includes(read.name) && read.body), false)
  await fs.writeFile(join(root, 'empty.txt'), 'x'.repeat(65537))
  assert.deepEqual((await reader.readLocalGitFile(pinned, { selection: { path: 'empty.txt' } })).snapshot, { omitted: 'too-large' })
  await fs.unlink(join(root, 'empty.txt'))
  assert.deepEqual((await reader.readLocalGitFile(pinned, { selection: { path: 'empty.txt' } })).snapshot, { omitted: 'unreadable' })
})

test('native browse never follows a tracked ancestor replaced by a symlink', native, async t => {
  const { parent, root, reader, pinned } = await fixture(t)
  await fs.rename(join(root, 'src'), join(parent, 'elsewhere'))
  await fs.symlink(join(parent, 'elsewhere'), join(root, 'src'))
  assert.deepEqual((await reader.readLocalGitFile(pinned, { selection: { path: 'src/a.ts' } })).snapshot, { omitted: 'unsupported' })
})

for (const changed of ['file', 'index', 'ignore', 'root', 'cancel']) {
  test(`native selected read fences ${changed} changes before publication`, native, async t => {
    let once = false
    const abort = new AbortController()
    const data = await fixture(t, async (base, name, options) => {
      if (!once && name === 'src/a.ts' && options.maxBytes !== null) {
        once = true
        if (changed === 'file') await fs.writeFile(join(base.path, name), 'changed\n')
        if (changed === 'index') await fs.appendFile(join(base.path, '.git/index'), 'changed')
        if (changed === 'ignore') await fs.appendFile(join(base.path, '.gitignore'), 'src/a.ts\n')
        if (changed === 'root') await fs.rename(base.path, `${base.path}-moved`)
        if (changed === 'cancel') abort.abort()
      }
    })
    await assert.rejects(data.reader.readLocalGitFile(data.pinned, { signal: abort.signal, selection: { path: 'src/a.ts' } }), /unavailable or has changed/)
    assert.equal(once, true, 'the chosen working body was actually read before the fence')
  })
}

test('native browse leaves split indexes unchanged and never executes repository configuration', native, async t => {
  const { root, parent, reader, pinned, git } = await fixture(t)
  git('update-index', '--split-index')
  const marker = join(parent, 'must-not-run')
  git('config', 'core.fsmonitor', `touch ${marker}`)
  git('config', 'include.path', join(parent, 'private-unread-config'))
  const names = (await fs.readdir(join(root, '.git'))).filter(name => /^(index|sharedindex\.|config|HEAD)/.test(name))
  const before = await Promise.all(names.map(async name => ({ name, bytes: await fs.readFile(join(root, '.git', name)), mtime: (await fs.stat(join(root, '.git', name), { bigint: true })).mtimeNs })))
  await reader.listLocalGitFiles(pinned)
  await reader.readLocalGitFile(pinned, { selection: { path: 'src/a.ts' } })
  for (const item of before) {
    assert.deepEqual(await fs.readFile(join(root, '.git', item.name)), item.bytes)
    assert.equal((await fs.stat(join(root, '.git', item.name), { bigint: true })).mtimeNs, item.mtime)
  }
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' })
})

test('native browse supports repositories beyond the legacy 500-path bulk-capture ceiling', native, async t => {
  const { root, reader, pinned, git } = await fixture(t)
  for (let i = 0; i < 501; i++) await fs.writeFile(join(root, `large-${i}.ts`), 'untouched')
  git('add', '--', '.')
  const listing = await reader.listLocalGitFiles(pinned)
  assert.equal(listing.files.length, 508)
  assert.equal((await reader.readLocalGitFile(pinned, { selection: { path: 'large-500.ts' } })).snapshot.text, 'untouched')
  await assert.rejects(reader.readLocalGitSnapshot(pinned), /unavailable or has changed/)
})

test('Git document browsing lists candidates without body reads and transports only selected current bytes', native, async t => {
  const { root, reader, pinned, reads, git } = await fixture(t)
  const paths = ['src/document.docx', 'src/document.pdf', 'src/document.pptx', 'src/document.xlsx']
  const imagePath = 'src/photo.png'
  const bytes = new Uint8Array(65537).fill(255)
  for (const path of paths) await fs.writeFile(join(root, path), bytes)
  const imageBytes = new Uint8Array([0, 255, 1, 2])
  await fs.writeFile(join(root, imagePath), imageBytes)
  git('add', '--', ...paths, imagePath)
  const listing = await reader.listLocalGitFiles(pinned)
  assert.deepEqual(listing.files.filter(file => paths.includes(file.path) || file.path === imagePath),
    [...paths.map(path => ({ path, kind: 'file' })), { path: imagePath, kind: 'file' }])
  assert.equal(reads.some(read => paths.includes(read.name) && read.body), false)
  for (const path of paths) {
    reads.length = 0
    const preview = await reader.readLocalGitFile(pinned, { selection: { path } })
    assert.deepEqual(preview.snapshot, { document: { format: path.split('.').at(-1), bytes } })
    assert.deepEqual(reads.filter(read => paths.includes(read.name) && read.body).map(read => read.name), [path])
  }
  reads.length = 0
  assert.deepEqual((await reader.readLocalGitFile(pinned, { selection: { path: imagePath } })).snapshot, { image: { bytes: imageBytes } })
  assert.deepEqual(reads.filter(read => read.base === root && read.body && read.name === imagePath).map(read => read.name), [imagePath])
  await fs.writeFile(join(root, imagePath), new Uint8Array(localBrowseFileByteLimit(imagePath) + 1))
  assert.deepEqual((await reader.readLocalGitFile(pinned, { selection: { path: imagePath } })).snapshot, { omitted: 'too-large' })
  await fs.writeFile(join(root, paths[0]), new Uint8Array(localBrowseFileByteLimit(paths[0]) + 1))
  assert.deepEqual((await reader.readLocalGitFile(pinned, { selection: { path: paths[0] } })).snapshot, { omitted: 'too-large' })
})

test('Git selected document publication retains current-file and ignore-version fences', native, async t => {
  for (const change of ['file', 'ignore']) {
    let observed = false
    const data = await fixture(t, async (base, name, options) => {
      if (!observed && name === 'src/document.pdf' && options.maxBytes !== null) {
        observed = true
        if (change === 'file') await fs.writeFile(join(base.path, name), 'changed after document read')
        else await fs.appendFile(join(base.path, '.gitignore'), 'src/document.pdf\n')
      }
    })
    await fs.writeFile(join(data.root, 'src/document.pdf'), new Uint8Array([0, 255, 1]))
    data.git('add', '--', 'src/document.pdf')
    await assert.rejects(data.reader.readLocalGitFile(data.pinned, { selection: { path: 'src/document.pdf' } }), /unavailable or has changed/)
    assert.equal(observed, true)
  }
})
