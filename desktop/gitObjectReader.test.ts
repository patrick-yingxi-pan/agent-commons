import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { access, chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { bundledGitDirectory } from './bundledGit.mjs'
import { buildGitFileTestHelper } from './gitFileTestFixture.mjs'
import { listGitPackIndexes, readGitFile, readGitFileRange } from './gitFileRead.mjs'
import { localGitCommandEnvironment, runLocalGit } from './localGitReader.mjs'
import { inspectLocalFolderRoot } from './localFolderReader.mjs'
import { withGitObjectReader } from './gitObjectReader.mjs'

const GIT_EXECUTABLE = process.platform === 'darwin'
  ? join(bundledGitDirectory({ packaged: false }), 'git')
  : undefined
const FILE_EXECUTABLE = buildGitFileTestHelper()
const ACTUAL_GIT_AVAILABLE = !!GIT_EXECUTABLE && !!FILE_EXECUTABLE && existsSync(GIT_EXECUTABLE) && existsSync(FILE_EXECUTABLE)
const MAX_OBJECT_BYTES = 1024 * 1024

function git(root: string, args: string[], input?: Uint8Array): Buffer {
  const result = spawnSync(GIT_EXECUTABLE!, [
    '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.untrackedCache=false', '-c', 'core.excludesFile=/dev/null',
    '-c', 'user.name=Git object fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgSign=false', ...args,
  ], {
    cwd: root,
    env: localGitCommandEnvironment(),
    input: input ? Buffer.from(input) : undefined,
    maxBuffer: 16 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.stderr.toString('utf8'))
  return result.stdout
}

async function metadataSnapshot(root: string): Promise<Array<[string, string, string, string]>> {
  const result: Array<[string, string, string, string]> = []
  const visit = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      const info = await lstat(path, { bigint: true })
      result.push([path.slice(root.length), String(info.ino), String(info.mtimeNs), String(info.size)])
      if (info.isDirectory() && !info.isSymbolicLink()) await visit(path)
    }
  }
  await visit(root)
  return result
}

async function actualRepository(t: any, objectFormat: 'sha1' | 'sha256') {
  assert.ok(ACTUAL_GIT_AVAILABLE, 'the pinned bundled Git and native descriptor helper are available')
  const parent = await mkdtemp(join(tmpdir(), `agent-commons-object-reader-${objectFormat}-`))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const repository = join(parent, 'repository')
  await mkdir(repository)
  git(repository, ['init', '--template=', '--initial-branch=main', `--object-format=${objectFormat}`, '.'])
  const commonText = `${'line shared across revisions\n'.repeat(6_000)}tail-00000000000000000000000000000000\n`
  await writeFile(join(repository, 'large.txt'), commonText)
  await writeFile(join(repository, 'empty.bin'), Buffer.alloc(0))
  git(repository, ['add', '--', 'large.txt', 'empty.bin'])
  git(repository, ['commit', '-m', 'base'])
  await writeFile(join(repository, 'large.txt'), commonText.replace('tail-00000000000000000000000000000000', 'tail-00000000000000000000000000000001'))
  git(repository, ['add', '--', 'large.txt'])
  git(repository, ['commit', '-m', 'small similar edit'])
  git(repository, ['tag', '-a', 'fixture-v1', '-m', 'annotated fixture tag'])

  const oid = (expression: string) => git(repository, ['rev-parse', expression]).toString('ascii').trim()
  const objects = [
    { oid: oid('HEAD'), type: 'commit' as const },
    { oid: oid('HEAD^{tree}'), type: 'tree' as const },
    { oid: oid('HEAD:large.txt'), type: 'blob' as const },
    { oid: oid('HEAD:empty.bin'), type: 'blob' as const },
    { oid: oid('refs/tags/fixture-v1'), type: 'tag' as const },
  ].map((object) => ({ ...object, bytes: git(repository, ['cat-file', object.type, object.oid]) }))
  const metadataRoot = join(repository, '.git')
  return { parent, repository, metadataRoot, root: await inspectLocalFolderRoot(metadataRoot), objectFormat, objects }
}

function readerOptions(rootPath: string, objectFormat: 'sha1' | 'sha256', capture: string[]) {
  return {
    objectFormat,
    fileExecutable: FILE_EXECUTABLE,
    runGit: async (args: string[], options: { cwd: string; signal?: AbortSignal; input?: Uint8Array }) => {
      assert.equal(options.cwd === rootPath || options.cwd.startsWith(`${rootPath}/`), false,
        'Git runs only against private staged metadata, never the selected source')
      assert.equal(args.some((argument) => argument.includes(rootPath)), false,
        'no source path is passed to Git')
      assert.ok(args.includes('--no-replace-objects'), 'replacement refs cannot redirect an object read')
      const gitDirectory = args.find((argument) => argument.startsWith('--git-dir='))?.slice('--git-dir='.length)
      assert.equal(gitDirectory, join(options.cwd, 'metadata'))
      const privateConfig = await readFile(join(gitDirectory!, 'config'), 'utf8')
      assert.match(privateConfig, /\[core\]\n(?:[^\n]*\n)*bare=true/)
      assert.equal(privateConfig.includes(rootPath), false, 'source config is not copied into staging')
      assert.deepEqual(await readdir(join(gitDirectory!, 'refs')), [], 'source refs are not copied into staging')
      capture.push(options.cwd)
      return runLocalGit(GIT_EXECUTABLE, args, options)
    },
  }
}

async function assertStagingRemoved(paths: string[]) {
  for (const path of new Set(paths)) await assert.rejects(access(path))
}

for (const objectFormat of ['sha1', 'sha256'] as const) {
  test(`bundled Git ${objectFormat} loose and packed objects return exact typed bodies without changing source metadata`, {
    skip: !ACTUAL_GIT_AVAILABLE,
  }, async (t) => {
    const fixture = await actualRepository(t, objectFormat)
    for (const object of fixture.objects) {
      assert.match(object.oid, objectFormat === 'sha1' ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/)
    }
    const runPaths: string[] = []
    const options = readerOptions(fixture.metadataRoot, objectFormat, runPaths)
    const readAll = () => withGitObjectReader(fixture.root, options, async ({ readObject }) => {
      for (const object of fixture.objects) {
        const bytes = await readObject(object.oid, object.type, MAX_OBJECT_BYTES)
        assert.ok(bytes instanceof Uint8Array)
        assert.deepEqual(Buffer.from(bytes), object.bytes, `${object.type} ${object.oid}`)
      }
      assert.deepEqual(Buffer.from(await readObject(fixture.objects[3]!.oid, 'blob', 0)), Buffer.alloc(0))
      return 'verified'
    })

    const looseBefore = await metadataSnapshot(fixture.metadataRoot)
    assert.equal(await readAll(), 'verified')
    assert.deepEqual(await metadataSnapshot(fixture.metadataRoot), looseBefore, 'loose reads preserve index/object metadata')
    await assertStagingRemoved(runPaths)

    git(fixture.repository, ['repack', '-adf', '--window=50', '--depth=50'])
    git(fixture.repository, ['prune-packed'])
    const indexNames = await listGitPackIndexes(fixture.root, { executable: FILE_EXECUTABLE })
    assert.ok(indexNames.length > 0, 'fixture objects are actually packed')
    const packDirectory = join(fixture.metadataRoot, 'objects', 'pack')
    const hasDelta = indexNames.some((name) => {
      const output = git(fixture.repository, ['verify-pack', '-v', join(packDirectory, name)])
        .toString('utf8')
      return output.split('\n').some((line) => line.split(' ').length >= 7 && /^[a-f0-9]+ blob /.test(line))
    })
    assert.ok(hasDelta, 'the fixture pack includes a delta-compressed blob')
    const packedBefore = await metadataSnapshot(fixture.metadataRoot)
    assert.equal(await readAll(), 'verified')
    assert.deepEqual(await metadataSnapshot(fixture.metadataRoot), packedBefore, 'packed reads preserve source index and pack metadata')
    await assertStagingRemoved(runPaths)
  })
}

test('Git object reads refuse malformed, missing, mistyped, oversized, cancelled, or caught failures and clean staging', {
  skip: !ACTUAL_GIT_AVAILABLE,
}, async (t) => {
  const fixture = await actualRepository(t, 'sha1')
  const blob = fixture.objects.find((object) => object.type === 'blob' && object.bytes.length > 0)!
  const runPaths: string[] = []
  const options = readerOptions(fixture.metadataRoot, 'sha1', runPaths)
  const failures = [
    { label: 'malformed oid', oid: 'A'.repeat(40), type: 'blob' as const },
    { label: 'missing oid', oid: 'f'.repeat(40), type: 'blob' as const },
    { label: 'wrong expected type', oid: blob.oid, type: 'tree' as const },
  ]
  for (const failure of failures) {
    const before = runPaths.length
    await assert.rejects(withGitObjectReader(fixture.root, options, async ({ readObject }) => {
      try { await readObject(failure.oid, failure.type) } catch {}
      return 'callback caught the invalid read'
    }), /Git baseline/i, failure.label)
    await assertStagingRemoved(runPaths.slice(before))
  }
  const beforeBounds = runPaths.length
  await assert.rejects(withGitObjectReader(fixture.root, options, async ({ readObject }) => {
    await readObject(blob.oid, 'blob', MAX_OBJECT_BYTES + 1)
    return 'oversized object request accepted'
  }), /Git baseline/i, 'readObject enforces its one-MiB maximum')
  await assertStagingRemoved(runPaths.slice(beforeBounds))

  const controller = new AbortController()
  controller.abort()
  const beforeAbort = runPaths.length
  await assert.rejects(withGitObjectReader(fixture.root, { ...options, signal: controller.signal }, async ({ readObject }) => {
    await readObject(blob.oid, 'blob')
  }), /Git baseline/i, 'pre-aborted reads refuse')
  await assertStagingRemoved(runPaths.slice(beforeAbort))
})

test('Git object reads ignore source config, includes, hooks and alternates and never pass source paths to Git', {
  skip: !ACTUAL_GIT_AVAILABLE,
}, async (t) => {
  const fixture = await actualRepository(t, 'sha1')
  const marker = join(fixture.parent, 'must-not-run')
  const hookDirectory = join(fixture.metadataRoot, 'hooks')
  await mkdir(hookDirectory, { recursive: true })
  await writeFile(join(hookDirectory, 'pre-commit'), `#!/bin/sh\ntouch '${marker}'\n`)
  const includeFile = join(fixture.parent, 'included-config')
  await writeFile(includeFile, `[core]\nfsmonitor = touch '${marker}'\n`)
  await writeFile(join(fixture.metadataRoot, 'config'),
    `[core]\nrepositoryformatversion=0\nbare=false\nfsmonitor=touch '${marker}'\nhooksPath=${hookDirectory}\n[include]\npath=${includeFile}\n`)

  const alternate = join(fixture.parent, 'alternate-odb')
  await mkdir(alternate)
  git(alternate, ['init', '--template=', '--object-format=sha1', '.'])
  const alternateOid = git(alternate, ['hash-object', '-w', '--stdin'], Buffer.from('alternate-only secret')).toString('ascii').trim()
  await mkdir(join(fixture.metadataRoot, 'objects', 'info'), { recursive: true })
  await writeFile(join(fixture.metadataRoot, 'objects', 'info', 'alternates'), `${join(alternate, '.git', 'objects')}\n`)

  const calls: string[] = []
  const options = readerOptions(fixture.metadataRoot, 'sha1', calls)
  await assert.rejects(withGitObjectReader(fixture.root, options, async ({ readObject }) => {
    await readObject(fixture.objects[0]!.oid, 'commit')
  }), /Git baseline/i, 'nonempty alternates metadata is refused')
  assert.equal(existsSync(marker), false, 'source core.fsmonitor, includes and hooks never execute')
  assert.equal(calls.some((cwd) => cwd === fixture.metadataRoot), false)
  await assertStagingRemoved(calls)

  await rm(join(fixture.metadataRoot, 'objects', 'info', 'alternates'))
  const alternateCalls: string[] = []
  const alternateOptions = readerOptions(fixture.metadataRoot, 'sha1', alternateCalls)
  await assert.rejects(withGitObjectReader(fixture.root, alternateOptions, async ({ readObject }) => {
    await readObject(alternateOid, 'blob')
  }), /Git baseline/i, 'an object available only in the outside alternate database is unavailable')
  assert.equal(existsSync(marker), false)
  await assertStagingRemoved(alternateCalls)
})

test('a changed loose-object version before final verification poisons the callback result', {
  skip: !ACTUAL_GIT_AVAILABLE,
}, async (t) => {
  const fixture = await actualRepository(t, 'sha1')
  const object = fixture.objects.find((candidate) => candidate.type === 'blob' && candidate.bytes.length > 0)!
  const objectPath = `objects/${object.oid.slice(0, 2)}/${object.oid.slice(2)}`
  const sourceObject = join(fixture.metadataRoot, objectPath)
  const versionChangingRead = async (base: any, relativePath: string, options: any) => {
    const value = await readGitFile(base, relativePath, { ...options, executable: FILE_EXECUTABLE })
    if (relativePath === objectPath && value.status === 'file' && value.bytes) {
      await writeFile(sourceObject, Buffer.from(value.bytes).map((byte: number) => byte ^ 1))
    }
    return value
  }
  const runPaths: string[] = []
  await assert.rejects(withGitObjectReader(fixture.root, {
    ...readerOptions(fixture.metadataRoot, 'sha1', runPaths),
    readFile: versionChangingRead,
    readRange: readGitFileRange,
    listPackIndexes: listGitPackIndexes,
  }, async ({ readObject }) => {
    try { await readObject(object.oid, 'blob') } catch {}
    return 'a caught stale read must not publish a callback value'
  }), /Git baseline/i)
  await assertStagingRemoved(runPaths)
})

test('matching promisor pack metadata refuses partial object stores', {
  skip: !ACTUAL_GIT_AVAILABLE,
}, async (t) => {
  const fixture = await actualRepository(t, 'sha1')
  git(fixture.repository, ['repack', '-adf'])
  git(fixture.repository, ['prune-packed'])
  const indexes = await listGitPackIndexes(fixture.root, { executable: FILE_EXECUTABLE })
  assert.ok(indexes.length > 0)
  const name = indexes[0]!
  const promisor = join(fixture.metadataRoot, 'objects', 'pack', `${name.slice(0, -4)}.promisor`)
  await writeFile(promisor, '')

  const runPaths: string[] = []
  const object = fixture.objects.find((candidate) => candidate.type === 'blob' && candidate.bytes.length > 0)!
  await assert.rejects(withGitObjectReader(fixture.root, readerOptions(fixture.metadataRoot, 'sha1', runPaths),
    async ({ readObject }) => readObject(object.oid, 'blob')), /Git baseline/i)
  await assertStagingRemoved(runPaths)
})

test('decoded bytes that do not match the requested object hash are refused', {
  skip: !ACTUAL_GIT_AVAILABLE,
}, async (t) => {
  const fixture = await actualRepository(t, 'sha1')
  const object = fixture.objects.find((candidate) => candidate.type === 'blob' && candidate.bytes.length > 0)!
  const runPaths: string[] = []
  const options = readerOptions(fixture.metadataRoot, 'sha1', runPaths)
  const run = options.runGit
  options.runGit = async (args, commandOptions) => {
    const result = await run(args, commandOptions)
    if (args.includes('cat-file') && args.includes(object.oid) && !args.some((argument) => argument.startsWith('--batch-check='))) {
      const corrupted = Buffer.from(result.stdout)
      corrupted[0] ^= 1
      return { ...result, stdout: corrupted }
    }
    return result
  }

  await assert.rejects(withGitObjectReader(fixture.root, options, async ({ readObject }) => {
    try { await readObject(object.oid, 'blob') } catch {}
    return 'corrupt decoded bytes must poison the callback result'
  }), /Git baseline/i)
  await assertStagingRemoved(runPaths)
})

test('probeObject labels corrupted metadata as an unverified hint and readObject rejects its body', {
  skip: !ACTUAL_GIT_AVAILABLE,
}, async (t) => {
  const fixture = await actualRepository(t, 'sha1')
  const object = fixture.objects.find((candidate) => candidate.type === 'blob' && candidate.bytes.length > 0)!
  const objectPath = `objects/${object.oid.slice(0, 2)}/${object.oid.slice(2)}`
  const corruptedBody = Buffer.from('wrong-long')
  const corruptedObject = deflateSync(Buffer.concat([
    Buffer.from(`blob ${corruptedBody.length}`),
    Buffer.from([0]),
    corruptedBody,
  ]))
  const sourceObject = join(fixture.metadataRoot, objectPath)
  await chmod(sourceObject, 0o600)
  await writeFile(sourceObject, corruptedObject)

  const probePaths: string[] = []
  const probe = await withGitObjectReader(fixture.root, readerOptions(fixture.metadataRoot, 'sha1', probePaths),
    async ({ probeObject }) => probeObject(object.oid))
  assert.deepEqual(probe, { typeHint: 'blob', sizeHintBytes: corruptedBody.length, contentVerified: false })
  await assertStagingRemoved(probePaths)

  const readPaths: string[] = []
  await assert.rejects(withGitObjectReader(fixture.root, readerOptions(fixture.metadataRoot, 'sha1', readPaths),
    async ({ readObject }) => readObject(object.oid, 'blob')), /Git baseline/i,
  'typed body reads independently check the original object hash')
  await assertStagingRemoved(readPaths)
})

test('packed-object admission compares the exact PACK signature bytes', {
  skip: !ACTUAL_GIT_AVAILABLE,
}, async (t) => {
  const fixture = await actualRepository(t, 'sha1')
  git(fixture.repository, ['repack', '-adf'])
  git(fixture.repository, ['prune-packed'])
  const object = fixture.objects.find((candidate) => candidate.type === 'blob' && candidate.bytes.length > 0)!
  const runPaths: string[] = []
  let rangeCalls = 0
  const options = readerOptions(fixture.metadataRoot, 'sha1', runPaths)
  options.readRange = async (root, relativePath, range) => {
    const result = await readGitFileRange(root, relativePath, { ...range, executable: FILE_EXECUTABLE })
    rangeCalls += 1
    if (rangeCalls !== 1 || result.status !== 'file') return result
    const bytes = Buffer.from(result.bytes)
    bytes[0] |= 0x80
    return { ...result, bytes }
  }

  await assert.rejects(withGitObjectReader(fixture.root, options, async ({ probeObject }) => probeObject(object.oid)), /Git baseline/i)
  assert.equal(rangeCalls, 1)
  await assertStagingRemoved(runPaths)
})
