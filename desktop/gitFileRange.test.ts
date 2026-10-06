import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildGitFileHelper } from './gitFileBuild.mjs'
import { readGitFileRange } from './gitFileRead.mjs'

const MAX_RANGE_BYTES = 16 * 1024 * 1024

async function pinnedRoot(path: string) {
  const stat = await lstat(path, { bigint: true })
  return { path, identity: { dev: String(stat.dev), ino: String(stat.ino) } }
}

function objectPath(hashLength: 40 | 64 = 40) {
  const hash = 'a'.repeat(hashLength)
  return `objects/${hash.slice(0, 2)}/${hash.slice(2)}`
}

test('Git object range rejects invalid numeric bounds and non-object paths before helper startup', async () => {
  const root = { path: '/tmp', identity: { dev: '1', ino: '2' } }
  const validPath = objectPath()
  for (const [offset, length] of [
    [-1, 1],
    [Number.MAX_SAFE_INTEGER + 1, 1],
    [Number.MAX_SAFE_INTEGER, 1],
    [0, 0],
    [0, -1],
    [0, 1.5],
    [0, MAX_RANGE_BYTES + 1],
    [Number.MAX_SAFE_INTEGER - 1, 2],
  ]) {
    await assert.rejects(
      readGitFileRange(root, validPath, { offset, length, executable: '/does/not/exist' }),
      /range|offset|length|integer|safe/i,
    )
  }

  for (const relativePath of [
    '',
    '../outside',
    'objects/AA/' + 'a'.repeat(38),
    'objects/ab/' + 'A'.repeat(38),
    'objects/ab/' + 'a'.repeat(37),
    'objects/ab/' + 'a'.repeat(39),
    'objects/pack/pack-' + 'a'.repeat(40) + '.rev',
    'objects/pack/pack-' + 'a'.repeat(39) + '.idx',
    'objects/pack/pack-' + 'A'.repeat(40) + '.pack',
    'objects/pack/pack-' + 'a'.repeat(40) + '.pack/extra',
    'objects/pack/pack-' + 'a'.repeat(64) + '.keep',
  ]) {
    assert.deepEqual(
      await readGitFileRange(root, relativePath, { offset: 0, length: 1, executable: '/does/not/exist' }),
      { status: 'unsupported' },
      relativePath,
    )
  }
})

test('range helper invocation uses the bounded protocol and rejects malformed responses', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-range-fake-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = join(temporary, 'fake-helper')
  const argsPath = join(temporary, 'args')
  await writeFile(executable, [
    '#!/bin/sh',
    `printf '%s\\n' "$@" > '${argsPath}'`,
    'printf "B 4 1 2 1:2:3:4:5:6:7:8\\nxy"',
    '',
  ].join('\n'))
  await chmod(executable, 0o755)
  const root = await pinnedRoot(temporary)
  const relativePath = objectPath()
  const result = await readGitFileRange(root, relativePath, { offset: 1, length: 2, executable })
  assert.equal(result.status, 'file')
  if (result.status !== 'file') return
  assert.equal(result.sizeBytes, 4)
  assert.equal(result.offset, 1)
  assert.deepEqual(Buffer.from(result.bytes), Buffer.from('xy'))
  assert.equal(result.version, '1:2:3:4:5:6:7:8')
  assert.deepEqual((await readFile(argsPath, 'utf8')).trimEnd().split('\n'), [
    '--read-range',
    root.path,
    root.identity.dev,
    root.identity.ino,
    relativePath,
    '1',
    '2',
  ])

  await writeFile(executable, '#!/bin/sh\nprintf "B 4 1 2 1:2:3:4:5:6:7:8\\nshort"\n')
  await chmod(executable, 0o755)
  await assert.rejects(
    readGitFileRange(root, relativePath, { offset: 1, length: 2, executable }),
    /invalid range/,
  )
})

test('range response parser accepts only self-consistent file, EOF, and status responses', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-range-parser-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = join(temporary, 'fake-helper')
  const root = await pinnedRoot(temporary)
  const relativePath = objectPath()
  const validVersion = '1:2:3:4:5:6:7:8'
  const cases = [
    { name: 'valid EOF response', response: `E 2 ${validVersion}\n`, expected: 'out-of-range' },
    { name: 'B response with wrong offset', response: `B 4 0 2 ${validVersion}\nxy`, rejects: true },
    { name: 'B response with wrong length', response: `B 4 1 1 ${validVersion}\nx`, rejects: true },
    { name: 'B response with unsafe whole size', response: `B 9007199254740992 1 2 ${validVersion}\nxy`, rejects: true },
    { name: 'impossible EOF response', response: `E 4 ${validVersion}\n`, rejects: true },
    { name: 'EOF response with unexpected payload', response: `E 2 ${validVersion}\nx`, rejects: true },
    { name: 'missing status with unexpected payload', response: 'M\nx', rejects: true },
    { name: 'unsupported status with unexpected payload', response: 'U\nx', rejects: true },
    { name: 'unreadable status with unexpected payload', response: 'R\nx', rejects: true },
    { name: 'changed status with unexpected payload', response: 'C\nx', rejects: true },
  ]

  for (const entry of cases) {
    await writeFile(executable, `#!/bin/sh\nprintf '%s' '${entry.response}'\n`)
    await chmod(executable, 0o755)
    const read = readGitFileRange(root, relativePath, { offset: 1, length: 2, executable })
    if (entry.rejects) {
      await assert.rejects(read, /invalid range|invalid response/, entry.name)
    } else {
      const result = await read
      assert.equal(result.status, entry.expected, entry.name)
      if (result.status === 'out-of-range') {
        assert.equal(result.sizeBytes, 2, entry.name)
        assert.equal(result.version, validVersion, entry.name)
      }
    }
  }
})

test('native Git object ranges return exact slices, whole-file versions, and explicit EOF conflicts', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-range-native-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = join(temporary, 'agent-commons-git-file')
  assert.equal(buildGitFileHelper({ targetPlatform: 'darwin', targetArch: process.arch, outputPath: executable }), executable)

  const rootPath = join(temporary, 'repo')
  const fanout = join(rootPath, 'objects', 'aa')
  const packDirectory = join(rootPath, 'objects', 'pack')
  await mkdir(fanout, { recursive: true })
  await mkdir(packDirectory, { recursive: true })
  const regularRelativePath = objectPath()
  const regularPath = join(rootPath, regularRelativePath)
  const contents = Buffer.from([0, 1, 2, 3, 4, 5, 6, 255])
  await writeFile(regularPath, contents)
  const root = await pinnedRoot(rootPath)
  const options = { executable }

  const slice = await readGitFileRange(root, regularRelativePath, { ...options, offset: 2, length: 4 })
  assert.equal(slice.status, 'file')
  if (slice.status !== 'file') return
  assert.equal(slice.sizeBytes, contents.length)
  assert.equal(slice.offset, 2)
  assert.deepEqual(Buffer.from(slice.bytes), contents.subarray(2, 6))
  assert.match(slice.version, /^\d+:\d+:\d+:-?\d+:-?\d+:-?\d+:-?\d+:-?\d+$/)

  const eof = await readGitFileRange(root, regularRelativePath, { ...options, offset: 6, length: 3 })
  assert.equal(eof.status, 'out-of-range')
  if (eof.status !== 'out-of-range') return
  assert.equal(eof.sizeBytes, contents.length)
  assert.equal(eof.version, slice.version)

  const packRelativePath = `objects/pack/pack-${'b'.repeat(40)}.idx`
  const packContents = Buffer.from('pack-index')
  await writeFile(join(rootPath, packRelativePath), packContents)
  const packSlice = await readGitFileRange(root, packRelativePath, { ...options, offset: 4, length: 3 })
  assert.equal(packSlice.status, 'file')
  if (packSlice.status === 'file') assert.deepEqual(Buffer.from(packSlice.bytes), Buffer.from('-in'))

  const sha256ObjectRelativePath = objectPath(64)
  const sha256ObjectPath = join(rootPath, sha256ObjectRelativePath)
  await writeFile(sha256ObjectPath, Buffer.from('sha256 loose object'))
  const sha256ObjectSlice = await readGitFileRange(root, sha256ObjectRelativePath, { ...options, offset: 7, length: 5 })
  assert.equal(sha256ObjectSlice.status, 'file')
  if (sha256ObjectSlice.status === 'file') assert.deepEqual(Buffer.from(sha256ObjectSlice.bytes), Buffer.from('loose'))

  const sha256PackBase = `objects/pack/pack-${'d'.repeat(64)}`
  const sha256PackBytes = Buffer.from('sha256 pack data')
  const sha256PackIdxRelativePath = `${sha256PackBase}.idx`
  const sha256PackRelativePath = `${sha256PackBase}.pack`
  await writeFile(join(rootPath, sha256PackIdxRelativePath), sha256PackBytes)
  await writeFile(join(rootPath, sha256PackRelativePath), sha256PackBytes)
  for (const sha256PackRelative of [sha256PackIdxRelativePath, sha256PackRelativePath]) {
    const sha256PackSlice = await readGitFileRange(root, sha256PackRelative, { ...options, offset: 7, length: 4 })
    assert.equal(sha256PackSlice.status, 'file', sha256PackRelative)
    if (sha256PackSlice.status === 'file') {
      assert.deepEqual(Buffer.from(sha256PackSlice.bytes), Buffer.from('pack'), sha256PackRelative)
    }
  }

  const largeRelativePath = `objects/${'cd'}/${'c'.repeat(38)}`
  const largePath = join(rootPath, largeRelativePath)
  await mkdir(join(rootPath, 'objects', 'cd'), { recursive: true })
  await writeFile(largePath, '')
  await truncate(largePath, MAX_RANGE_BYTES + 4096)
  const tail = await readGitFileRange(root, largeRelativePath, {
    ...options,
    offset: MAX_RANGE_BYTES + 17,
    length: 23,
  })
  assert.equal(tail.status, 'file')
  if (tail.status === 'file') {
    assert.equal(tail.sizeBytes, MAX_RANGE_BYTES + 4096)
    assert.equal(tail.offset, MAX_RANGE_BYTES + 17)
    assert.deepEqual(Buffer.from(tail.bytes), Buffer.alloc(23))
  }

  const changedBefore = await readGitFileRange(root, regularRelativePath, { ...options, offset: 0, length: 2 })
  await writeFile(regularPath, Buffer.from([9, 8, 7, 6, 5, 4, 3, 2]))
  const changedAfter = await readGitFileRange(root, regularRelativePath, { ...options, offset: 0, length: 2 })
  assert.equal(changedBefore.status, 'file')
  assert.equal(changedAfter.status, 'file')
  if (changedBefore.status === 'file' && changedAfter.status === 'file') {
    assert.notEqual(changedBefore.version, changedAfter.version)
    assert.deepEqual(Buffer.from(changedAfter.bytes), Buffer.from([9, 8]))
  }

  const outsidePath = join(temporary, 'outside-object')
  await writeFile(outsidePath, 'outside')
  await rm(regularPath)
  await symlink(outsidePath, regularPath)
  assert.deepEqual(await readGitFileRange(root, regularRelativePath, { ...options, offset: 0, length: 1 }), { status: 'unsupported' })
  await rm(regularPath)
  await mkdir(join(rootPath, 'objects'), { recursive: true })
  await symlink(join(temporary, 'elsewhere'), join(rootPath, 'objects', 'ef'))
  assert.deepEqual(await readGitFileRange(root, `objects/ef/${'e'.repeat(38)}`, { ...options, offset: 0, length: 1 }), { status: 'unsupported' })
  assert.equal(await readFile(outsidePath, 'utf8'), 'outside')

  for (const [path, offset, length] of [
    ['objects/not-an-object', '0', '1'],
    [regularRelativePath, '0', '0'],
    [regularRelativePath, String(Number.MAX_SAFE_INTEGER), '1'],
  ]) {
    const direct = spawnSync(executable, [
      '--read-range', root.path, root.identity.dev, root.identity.ino, path, offset, length,
    ], { cwd: '/', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, encoding: 'buffer' })
    assert.equal(direct.status, 64)
    assert.equal(direct.stdout.length, 0)
  }
})

test('native range reader reports a symlink-swap race as changed, never as range bytes', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-range-race-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = join(temporary, 'agent-commons-git-file-test')
  assert.equal(buildGitFileHelper({ targetPlatform: 'darwin', targetArch: process.arch, outputPath: executable, testHooks: true }), executable)

  const rootPath = join(temporary, 'repo')
  const relativePath = objectPath()
  const objectFile = join(rootPath, relativePath)
  const objectDirectory = join(objectFile, '..')
  const backupPath = join(temporary, 'object.original')
  const outsidePath = join(temporary, 'outside-object')
  const readyPath = join(temporary, 'ready')
  const releasePath = join(temporary, 'release')
  await mkdir(objectDirectory, { recursive: true })
  await writeFile(objectFile, 'in-repository bytes')
  await writeFile(outsidePath, 'outside bytes')
  const root = await pinnedRoot(rootPath)

  const child = spawn(executable, [
    '--read-range', root.path, root.identity.dev, root.identity.ino, relativePath, '0', '4',
  ], {
    cwd: '/',
    env: {
      PATH: '/usr/bin:/bin',
      LC_ALL: 'C',
      AGENT_COMMONS_GIT_FILE_TEST_READY: readyPath,
      AGENT_COMMONS_GIT_FILE_TEST_RELEASE: releasePath,
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const outputPromise = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0 && !signal) resolve(Buffer.concat(chunks))
      else reject(new Error(`helper exited ${code ?? signal}`))
    })
  })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try { await lstat(readyPath); break } catch {}
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  await lstat(readyPath)
  await rename(objectFile, backupPath)
  await symlink(outsidePath, objectFile)
  await writeFile(releasePath, 'continue')
  assert.equal((await outputPromise).toString('ascii'), 'C\n')
  assert.equal(await readFile(outsidePath, 'utf8'), 'outside bytes')
})
