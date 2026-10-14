import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { bundledGitDirectory } from './bundledGit.mjs'
import { buildGitFileTestHelper } from './gitFileTestFixture.mjs'
import { withLocalGitBaseline, withLocalGitFileBaseline, parseGitTree } from './gitBaselineReader.mjs'
import { readGitFile } from './gitFileRead.mjs'
import { createLocalGitReader, localGitCommandEnvironment, runLocalGit } from './localGitReader.mjs'

const GIT_EXECUTABLE = process.platform === 'darwin'
  ? join(bundledGitDirectory({ packaged: false }), 'git')
  : undefined
const FILE_EXECUTABLE = buildGitFileTestHelper()
const AVAILABLE = !!GIT_EXECUTABLE && !!FILE_EXECUTABLE && existsSync(GIT_EXECUTABLE) && existsSync(FILE_EXECUTABLE)

function git(root: string, args: string[], input?: Uint8Array): Buffer {
  const result = spawnSync(GIT_EXECUTABLE!, [
    '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.untrackedCache=false', '-c', 'core.excludesFile=/dev/null',
    '-c', 'user.name=Git selected baseline fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgSign=false', ...args,
  ], {
    cwd: root,
    env: localGitCommandEnvironment(),
    input: input === undefined ? undefined : Buffer.from(input),
    maxBuffer: 16 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.stderr.toString('utf8'))
  return result.stdout
}

async function repository(t: any, files: Record<string, string> = {
  'src/nested/selected.txt': 'HEAD selected\n',
  'src/nested/other.txt': 'unrelated body\n',
  'other/deep/secret.txt': 'unrelated subtree\n',
  'deleted.txt': 'HEAD-only body\n',
}) {
  assert.ok(AVAILABLE, 'the pinned bundled Git and native descriptor helper are available')
  const parent = await mkdtemp(join(tmpdir(), 'agent-commons-git-file-baseline-test-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const path = join(parent, 'repository')
  await mkdir(path)
  git(path, ['init', '--template=', '--initial-branch=main', '.'])
  for (const [name, body] of Object.entries(files)) {
    await mkdir(join(path, name, '..'), { recursive: true })
    await writeFile(join(path, name), body)
  }
  git(path, ['add', '--all'])
  git(path, ['commit', '-m', 'initial'])
  return { parent, path }
}

function baselineOptions(path: string, extra: Record<string, unknown> = {}, gitCalls: string[] = [], lsFilesOutput?: Buffer) {
  const reader = createLocalGitReader({ gitExecutable: GIT_EXECUTABLE, fileExecutable: FILE_EXECUTABLE })
  return {
    reader,
    options: {
      gitExecutable: GIT_EXECUTABLE,
      fileExecutable: FILE_EXECUTABLE,
      ...extra,
      runGit: async (args: string[], options: { cwd: string; signal?: AbortSignal; input?: Uint8Array }) => {
        const absolute = resolve(path)
        assert.notEqual(options.cwd, absolute)
        assert.equal(options.cwd.startsWith(`${absolute}/`), false, 'Git works only in private staging')
        assert.equal(args.some((argument) => argument.includes(absolute)), false, 'source paths never reach Git')
        gitCalls.push(args.join(' '))
        const result = await runLocalGit(GIT_EXECUTABLE, args, options)
        return lsFilesOutput && args.includes('ls-files') ? { ...result, stdout: lsFilesOutput } : result
      },
    },
  }
}

async function pinned(path: string, settings: ReturnType<typeof baselineOptions>) {
  return settings.reader.inspectLocalGitRoot(path)
}

const selected = 'src/nested/selected.txt'

test('selected HEAD tree parsing has an explicit ceiling without changing the whole-tree default', () => {
  const tree = (count: number) => Buffer.concat(Array.from({ length: count }, (_, index) => Buffer.concat([
    Buffer.from(`100644 file-${index}.txt\0`), Buffer.alloc(20, 1),
  ])))
  const wide = tree(501)
  assert.throws(() => parseGitTree(wide, 'sha1'), /Git baseline/i)
  assert.equal(parseGitTree(wide, 'sha1', { maxEntries: 10_000 }).length, 501)
  assert.equal(parseGitTree(tree(10_000), 'sha1', { maxEntries: 10_000 }).length, 10_000)
  assert.throws(() => parseGitTree(tree(10_001), 'sha1', { maxEntries: 10_000 }), /Git baseline/i)
  assert.throws(() => parseGitTree(new Uint8Array(1024 * 1024 + 1), 'sha1', { maxEntries: 10_000 }), /Git baseline/i)
  for (const maxEntries of [0, 10_001, 1.5, Infinity, NaN]) {
    assert.throws(() => parseGitTree(wide, 'sha1', { maxEntries }), /Git baseline/i)
  }
})

test('selected mode handles repositories over the whole-baseline cap and returns only the selected path', {
  skip: !AVAILABLE,
}, async (t) => {
  const files: Record<string, string> = {}
  for (let index = 0; index < 510; index += 1) files[`file-${String(index).padStart(4, '0')}.txt`] = `body ${index}\n`
  const repositoryValue = await repository(t, files)
  const settings = baselineOptions(repositoryValue.path)
  const root = await pinned(repositoryValue.path, settings)
  const path = 'file-0509.txt'
  let wholeCallbackReached = false
  await assert.rejects(withLocalGitBaseline(root, settings.options, async () => {
    wholeCallbackReached = true
    return 'whole baseline cap still applies'
  }), /Git baseline/i)
  assert.equal(wholeCallbackReached, false, 'whole mode refuses before callback publication')
  const result = await withLocalGitFileBaseline(root, path, settings.options, async ({ headEntries, indexEntries, selection, readBlob }: any) => ({
    selection,
    headEntries: headEntries.map((entry: any) => entry.name),
    indexEntries: indexEntries.map((entry: any) => entry.name),
    body: Buffer.from(await readBlob(headEntries[0].oid)).toString('utf8'),
  }))
  assert.deepEqual(result, {
    selection: { path, sparse: false },
    headEntries: [path],
    indexEntries: [path],
    body: 'body 509\n',
  })
})

test('selected mode enforces the 10,000-entry copied-index limit', {
  skip: !AVAILABLE,
}, async (t) => {
  const repositoryValue = await repository(t)
  const oid = git(repositoryValue.path, ['rev-parse', 'HEAD:src/nested/selected.txt']).toString('ascii').trim()
  const output = Buffer.from(Array.from({ length: 10_001 }, (_, index) =>
    `H 100644 ${oid} 0\tentry-${String(index).padStart(5, '0')}.txt\0`).join(''))
  const settings = baselineOptions(repositoryValue.path, {}, [], output)
  const root = await pinned(repositoryValue.path, settings)
  let callbackReached = false
  await assert.rejects(withLocalGitFileBaseline(root, selected, settings.options, async () => {
    callbackReached = true
    return 'oversized copied index'
  }), /Git baseline/i)
  assert.equal(callbackReached, false, 'oversized copied index is rejected before callback')
})

test('selected mode enforces the 1 MiB aggregate unique index path limit', {
  skip: !AVAILABLE,
}, async (t) => {
  const repositoryValue = await repository(t)
  const oid = git(repositoryValue.path, ['rev-parse', 'HEAD:src/nested/selected.txt']).toString('ascii').trim()
  const output = Buffer.from(Array.from({ length: 9_000 }, (_, index) =>
    `H 100644 ${oid} 0\tp${String(index).padStart(5, '0')}-${'x'.repeat(120)}.txt\0`).join(''))
  assert.ok(output.byteLength < 2 * 1024 * 1024, 'synthetic ls-files output stays within its existing parser cap')
  const settings = baselineOptions(repositoryValue.path, {}, [], output)
  const root = await pinned(repositoryValue.path, settings)
  let callbackReached = false
  await assert.rejects(withLocalGitFileBaseline(root, selected, settings.options, async () => {
    callbackReached = true
    return 'oversized aggregate paths'
  }), /Git baseline/i)
  assert.equal(callbackReached, false, 'aggregate path budget is checked before callback')
})

test('selected HEAD and index stay distinct while unrelated blobs and working paths have no authority', {
  skip: !AVAILABLE,
}, async (t) => {
  const repositoryValue = await repository(t)
  await writeFile(join(repositoryValue.path, selected), 'staged selected\n')
  git(repositoryValue.path, ['add', '--', selected])
  await writeFile(join(repositoryValue.path, selected), 'working selected\n')
  const settings = baselineOptions(repositoryValue.path, { includeWorkingTree: true })
  const root = await pinned(repositoryValue.path, settings)
  const knownOutsideOid = git(repositoryValue.path, ['rev-parse', 'HEAD:src/nested/other.txt']).toString('ascii').trim()
  const selectedData = await withLocalGitFileBaseline(root, selected, settings.options, async ({ headEntries, indexEntries, readBlob, readWorkingFile }: any) => {
    const headBody = Buffer.from(await readBlob(headEntries[0].oid)).toString('utf8')
    const indexBody = Buffer.from(await readBlob(indexEntries[0].oid)).toString('utf8')
    const working = await readWorkingFile(selected)
    return {
      headNames: headEntries.map((entry: any) => entry.name),
      indexNames: indexEntries.map((entry: any) => entry.name),
      sameOid: headEntries[0].oid === indexEntries[0].oid,
      headBody,
      indexBody,
      workingStatus: working.status,
      workingBody: Buffer.from(working.bytes).toString('utf8'),
    }
  })
  assert.deepEqual(selectedData, {
    headNames: [selected], indexNames: [selected], sameOid: false,
    headBody: 'HEAD selected\n', indexBody: 'staged selected\n',
    workingStatus: 'file', workingBody: 'working selected\n',
  })

  let blobRefused = false
  await assert.rejects(withLocalGitFileBaseline(root, selected, settings.options, async ({ readBlob }: any) => {
    try { await readBlob(knownOutsideOid) } catch { blobRefused = true }
    return 'caught unrelated refusal must poison transaction'
  }), /Git baseline/i)
  assert.equal(blobRefused, true, 'unrelated blob request was actually refused inside callback')

  let workingRefused = false
  await assert.rejects(withLocalGitFileBaseline(root, selected, settings.options, async ({ readWorkingFile }: any) => {
    try { await readWorkingFile('src/nested/other.txt') } catch { workingRefused = true }
    return 'caught unrelated working refusal must poison transaction'
  }), /Git baseline/i)
  assert.equal(workingRefused, true, 'unrelated working path was actually refused inside callback')
})

test('a HEAD-only staged deletion does not admit a recreated untracked working file', {
  skip: !AVAILABLE,
}, async (t) => {
  const repositoryValue = await repository(t)
  git(repositoryValue.path, ['rm', '--', 'deleted.txt'])
  await writeFile(join(repositoryValue.path, 'deleted.txt'), 'untracked replacement\n')
  const settings = baselineOptions(repositoryValue.path, { includeWorkingTree: true })
  const root = await pinned(repositoryValue.path, settings)
  const entries = await withLocalGitFileBaseline(root, 'deleted.txt', settings.options, async ({ headEntries, indexEntries }: any) => ({
    head: headEntries.map((entry: any) => entry.name), index: indexEntries,
  }))
  assert.deepEqual(entries, { head: ['deleted.txt'], index: [] })
  let workingRefused = false
  await assert.rejects(withLocalGitFileBaseline(root, 'deleted.txt', settings.options, async ({ readWorkingFile }: any) => {
    try { await readWorkingFile('deleted.txt') } catch { workingRefused = true }
    return 'caught HEAD-only working refusal must poison transaction'
  }), /Git baseline/i)
  assert.equal(workingRefused, true, 'HEAD-only selected path never admitted the untracked replacement')
})

test('ignored selected paths retain metadata but grant no blob or working-file content', {
  skip: !AVAILABLE,
}, async (t) => {
  const repositoryValue = await repository(t, {
    '.gitignore': `${selected}\n`,
    [selected]: 'ignored tracked body\n',
  })
  git(repositoryValue.path, ['add', '--force', '--', selected])
  git(repositoryValue.path, ['commit', '-m', 'track ignored fixture path'])
  const settings = baselineOptions(repositoryValue.path, { includeWorkingTree: true })
  const root = await pinned(repositoryValue.path, settings)
  const metadata = await withLocalGitFileBaseline(root, selected, settings.options, async ({ headEntries, indexEntries, ignoredPaths }: any) => ({
    head: headEntries.map((entry: any) => ({ name: entry.name, oid: entry.oid })),
    index: indexEntries.map((entry: any) => entry.name),
    ignoredPaths,
  }))
  assert.deepEqual(metadata.head.map((entry: any) => entry.name), [selected])
  assert.deepEqual(metadata.index, [selected])
  assert.ok(metadata.ignoredPaths.includes(selected))

  const metadataOnly = await withLocalGitFileBaseline(root, selected, { ...settings.options, includeWorkingTree: false },
    async ({ ignoredPaths, readWorkingFile }: any) => ({ ignoredPaths, hasWorkingReader: typeof readWorkingFile === 'function' }))
  assert.deepEqual(metadataOnly, { ignoredPaths: [selected], hasWorkingReader: false },
    'selected HEAD/index-only reads also enforce current ignores without granting a working reader')
  let metadataBlobRefused = false
  await assert.rejects(withLocalGitFileBaseline(root, selected, { ...settings.options, includeWorkingTree: false }, async ({ readBlob }: any) => {
    try { await readBlob(metadata.head[0].oid) } catch { metadataBlobRefused = true }
    return 'ignore applies even without working-tree reads'
  }), /Git baseline/i)
  assert.equal(metadataBlobRefused, true)

  let blobRefused = false
  let workingRefused = false
  await assert.rejects(withLocalGitFileBaseline(root, selected, settings.options, async ({ readBlob, readWorkingFile }: any) => {
    try { await readBlob(metadata.head[0].oid) } catch { blobRefused = true }
    try { await readWorkingFile(selected) } catch { workingRefused = true }
    return 'ignored selected path has metadata only'
  }), /Git baseline/i)
  assert.equal(blobRefused, true, 'ignored tracked blob was refused')
  assert.equal(workingRefused, true, 'ignored selected working file was refused')
})

for (const transition of ['file-to-directory', 'directory-to-file'] as const) {
  test(`selected ignore evaluation preserves ${transition} structure without granting content`, {
    skip: !AVAILABLE,
  }, async (t) => {
    const wasFile = transition === 'file-to-directory'
    const repositoryValue = await repository(t, wasFile
      ? { a: 'original file\n' } : { 'a/child.txt': 'original child\n' })
    const path = repositoryValue.path
    await writeFile(join(path, '.gitignore'), 'a/\n')
    if (wasFile) {
      git(path, ['rm', '--', 'a'])
      await mkdir(join(path, 'a'))
      await writeFile(join(path, 'a/child.txt'), 'replacement child\n')
      git(path, ['add', '--force', '--', 'a/child.txt'])
    } else {
      git(path, ['rm', '--', 'a/child.txt'])
      await writeFile(join(path, 'a'), 'replacement file\n')
      git(path, ['add', '--force', '--', 'a'])
    }
    const settings = baselineOptions(path, { includeWorkingTree: true })
    const root = await pinned(path, settings)
    const wholeIgnored = await withLocalGitBaseline(root, settings.options, async ({ ignoredPaths }: any) => ignoredPaths)
    assert.ok(wholeIgnored.includes('a'), 'whole review conservatively treats the transition as a directory')
    const metadata = await withLocalGitFileBaseline(root, 'a', settings.options, async ({ headEntries, indexEntries, ignoredPaths }: any) => ({
      head: headEntries.map((entry: any) => entry.name),
      index: indexEntries.map((entry: any) => entry.name),
      ignoredPaths,
      oid: (wasFile ? headEntries : indexEntries)[0].oid,
    }))
    assert.deepEqual(metadata.head, wasFile ? ['a'] : [], 'structural HEAD trees never grant content authority')
    assert.deepEqual(metadata.index, wasFile ? [] : ['a'], 'index descendants never grant content authority')
    assert.deepEqual(metadata.ignoredPaths, ['a'], 'selected review preserves the whole-review ignore policy')
    let blobRefused = false
    let workingRefused = false
    await assert.rejects(withLocalGitFileBaseline(root, 'a', settings.options, async ({ readBlob, readWorkingFile }: any) => {
      try { await readBlob(metadata.oid) } catch { blobRefused = true }
      try { await readWorkingFile('a') } catch { workingRefused = true }
      return 'caught transition refusals must poison the transaction'
    }), /Git baseline/i)
    assert.equal(blobRefused, true, 'the exact regular side is still ignored')
    assert.equal(workingRefused, true, 'structural context grants no working-file read')
  })
}

test('directory-only ignore rules do not exclude a selected ordinary file without a transition', {
  skip: !AVAILABLE,
}, async (t) => {
  const repositoryValue = await repository(t, { a: 'ordinary file\n' })
  await writeFile(join(repositoryValue.path, '.gitignore'), 'a/\n')
  const settings = baselineOptions(repositoryValue.path, { includeWorkingTree: true })
  const root = await pinned(repositoryValue.path, settings)
  const result = await withLocalGitFileBaseline(root, 'a', settings.options, async ({ headEntries, ignoredPaths, readBlob, readWorkingFile }: any) => ({
    ignoredPaths,
    head: Buffer.from(await readBlob(headEntries[0].oid)).toString('utf8'),
    working: Buffer.from((await readWorkingFile('a')).bytes).toString('utf8'),
  }))
  assert.deepEqual(result, { ignoredPaths: [], head: 'ordinary file\n', working: 'ordinary file\n' })
})

test('conflicted selected paths retain stage metadata but grant no blob or working-file content', {
  skip: !AVAILABLE,
}, async (t) => {
  const repositoryValue = await repository(t)
  const path = selected
  git(repositoryValue.path, ['checkout', '-b', 'conflict-side'])
  await writeFile(join(repositoryValue.path, path), 'side version\n')
  git(repositoryValue.path, ['add', '--', path])
  git(repositoryValue.path, ['commit', '-m', 'side version'])
  git(repositoryValue.path, ['checkout', 'main'])
  await writeFile(join(repositoryValue.path, path), 'main version\n')
  git(repositoryValue.path, ['add', '--', path])
  git(repositoryValue.path, ['commit', '-m', 'main version'])
  const merge = spawnSync(GIT_EXECUTABLE!, [
    '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.untrackedCache=false', '-c', 'core.excludesFile=/dev/null',
    '-c', 'user.name=Git selected baseline fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgSign=false', 'merge', 'conflict-side',
  ], { cwd: repositoryValue.path, env: localGitCommandEnvironment(), maxBuffer: 16 * 1024 * 1024 })
  assert.equal(merge.status, 1, merge.stderr.toString('utf8'))

  const settings = baselineOptions(repositoryValue.path, { includeWorkingTree: true })
  const root = await pinned(repositoryValue.path, settings)
  const metadata = await withLocalGitFileBaseline(root, path, settings.options, async ({ headEntries, indexEntries }: any) => ({
    head: headEntries.map((entry: any) => ({ name: entry.name, oid: entry.oid })),
    index: indexEntries.map((entry: any) => ({ name: entry.name, stage: entry.stage })),
  }))
  assert.deepEqual(metadata.head.map((entry: any) => entry.name), [path])
  assert.deepEqual(metadata.index, [1, 2, 3].map(stage => ({ name: path, stage })))

  let blobRefused = false
  let workingRefused = false
  await assert.rejects(withLocalGitFileBaseline(root, path, settings.options, async ({ readBlob, readWorkingFile }: any) => {
    try { await readBlob(metadata.head[0].oid) } catch { blobRefused = true }
    try { await readWorkingFile(path) } catch { workingRefused = true }
    return 'conflict selected path has metadata only'
  }), /Git baseline/i)
  assert.equal(blobRefused, true, 'conflicted HEAD blob was refused')
  assert.equal(workingRefused, true, 'conflicted working file was refused')
})

test('invalid selection is rejected before Git work and selected source changes fail the final fence', {
  skip: !AVAILABLE,
}, async (t) => {
  const repositoryValue = await repository(t)
  const gitCalls: string[] = []
  const settings = baselineOptions(repositoryValue.path, {}, gitCalls)
  const root = await pinned(repositoryValue.path, settings)
  for (const invalid of ['../src/nested/selected.txt', '/absolute.txt', 'bad\\name', `x/${'é'.repeat(2048)}.txt`]) {
    await assert.rejects(withLocalGitFileBaseline(root, invalid, settings.options, async () => 'invalid path'), /Git baseline/i)
  }
  assert.deepEqual(gitCalls, [], 'invalid path starts no Git operation')
  const workingSettings = baselineOptions(repositoryValue.path, { includeWorkingTree: true })
  const workingRoot = await pinned(repositoryValue.path, workingSettings)
  let workingRead = false
  let sourceMutated = false
  await assert.rejects(withLocalGitFileBaseline(workingRoot, selected, workingSettings.options, async ({ readWorkingFile }: any) => {
    const value = await readWorkingFile(selected)
    workingRead = value.status === 'file' && Buffer.from(value.bytes).toString('utf8') === 'HEAD selected\n'
    await writeFile(join(repositoryValue.path, selected), 'changed during callback\n')
    sourceMutated = true
    return 'changed source must not publish'
  }), /Git baseline/i)
  assert.equal(workingRead, true, 'selected working file was read before the mutation')
  assert.equal(sourceMutated, true, 'source mutation occurred inside the callback')
})

test('selected HEAD traversal reads only the requested nested tree path', {
  skip: !AVAILABLE,
}, async (t) => {
  const repositoryValue = await repository(t)
  const objectReads: string[] = []
  const settings = baselineOptions(repositoryValue.path, {
    readFile: async (base: any, name: string, options: any) => {
      if (name.startsWith('objects/')) objectReads.push(name)
      return readGitFile(base, name, options)
    },
  })
  const root = await pinned(repositoryValue.path, settings)
  const unrelatedTreeOid = git(repositoryValue.path, ['rev-parse', 'HEAD:other/deep']).toString('ascii').trim()
  const unrelatedTreePath = `objects/${unrelatedTreeOid.slice(0, 2)}/${unrelatedTreeOid.slice(2)}`
  const result = await withLocalGitFileBaseline(root, selected, settings.options, async ({ headEntries }: any) => headEntries.map((entry: any) => entry.name))
  assert.deepEqual(result, [selected])
  assert.equal(objectReads.includes(unrelatedTreePath), false, 'the unrelated subtree tree object was never read')
})

test('selected paths traverse through 64 components and refuse a 65th', {
  skip: !AVAILABLE,
}, async (t) => {
  const components64 = [...Array.from({ length: 63 }, (_, index) => `d${String(index).padStart(2, '0')}`), 'file64.txt']
  const components65 = [...Array.from({ length: 64 }, (_, index) => `e${String(index).padStart(2, '0')}`), 'file65.txt']
  const path64 = components64.join('/')
  const path65 = components65.join('/')
  const repositoryValue = await repository(t, { [path64]: 'at the limit\n', [path65]: 'over the limit\n' })
  const settings = baselineOptions(repositoryValue.path)
  const root = await pinned(repositoryValue.path, settings)
  const names = await withLocalGitFileBaseline(root, path64, settings.options, async ({ headEntries, indexEntries }: any) => ({
    head: headEntries.map((entry: any) => entry.name), index: indexEntries.map((entry: any) => entry.name),
  }))
  assert.deepEqual(names, { head: [path64], index: [path64] })
  let tooDeepCallbackReached = false
  await assert.rejects(withLocalGitFileBaseline(root, path65, settings.options, async () => {
    tooDeepCallbackReached = true
    return 'over-depth tree result'
  }), /Git baseline/i)
  assert.equal(tooDeepCallbackReached, false, '65 path components refuse before callback')
})

test('cancellation during a selected callback prevents publishing its result', {
  skip: !AVAILABLE,
}, async (t) => {
  const repositoryValue = await repository(t)
  const controller = new AbortController()
  const settings = baselineOptions(repositoryValue.path, { signal: controller.signal })
  const root = await pinned(repositoryValue.path, settings)
  let callbackReached = false
  await assert.rejects(withLocalGitFileBaseline(root, selected, settings.options, async () => {
    callbackReached = true
    controller.abort()
    return 'cancelled output'
  }), /Git baseline/i)
  assert.equal(callbackReached, true, 'cancellation was triggered after selected callback admission')
})

test('selected mode refuses a path beneath a sparse-index directory without granting content', {
  skip: !AVAILABLE,
}, async (t) => {
  const repositoryValue = await repository(t)
  git(repositoryValue.path, ['sparse-checkout', 'init', '--cone', '--sparse-index'])
  git(repositoryValue.path, ['sparse-checkout', 'set', 'other'])
  const settings = baselineOptions(repositoryValue.path)
  const root = await pinned(repositoryValue.path, settings)
  const sparseMetadata = await withLocalGitFileBaseline(root, selected, settings.options, async ({ selection, headEntries, indexEntries }: any) => ({
    sparse: selection.sparse,
    head: headEntries.map((entry: any) => entry.name),
    index: indexEntries,
  }))
  assert.deepEqual(sparseMetadata, { sparse: true, head: [selected], index: [] })
  let blobRefused = false
  await assert.rejects(withLocalGitFileBaseline(root, selected, settings.options, async ({ headEntries, readBlob }: any) => {
    try { await readBlob(headEntries[0].oid) } catch { blobRefused = true }
    return 'sparse selection never grants content'
  }), /Git baseline/i)
  assert.equal(blobRefused, true, 'sparse ancestor selected blob was actually refused')
})

test('an absent selected path and a selected directory produce empty entry arrays', {
  skip: !AVAILABLE,
}, async (t) => {
  const repositoryValue = await repository(t)
  const settings = baselineOptions(repositoryValue.path)
  const root = await pinned(repositoryValue.path, settings)
  for (const path of ['missing.txt', 'src/nested']) {
    const value = await withLocalGitFileBaseline(root, path, settings.options, async ({ headEntries, indexEntries, selection }: any) => ({
      selection, headEntries, indexEntries,
    }))
    assert.deepEqual(value, { selection: { path, sparse: false }, headEntries: [], indexEntries: [] })
  }
})
