import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildGitFileHelper, gitFileBuildPlan } from './gitFileBuild.mjs'
import { listGitPackIndexes } from './gitFileRead.mjs'

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function pinnedRoot(path: string) {
  const stat = await lstat(path, { bigint: true })
  return { path, identity: { dev: String(stat.dev), ino: String(stat.ino) } }
}

async function fakeHelper(directory: string, root: { path: string; identity: { dev: string; ino: string } }, response: string) {
  const executable = join(directory, `fake-pack-list-${Math.random().toString(16).slice(2)}`)
  const argsMatch = [
    `[ "$1" = '--list-pack-indexes' ]`,
    `[ "$2" = ${shellQuote(root.path)} ]`,
    `[ "$3" = ${shellQuote(root.identity.dev)} ]`,
    `[ "$4" = ${shellQuote(root.identity.ino)} ]`,
  ].join(' && ')
  await writeFile(executable, [
    '#!/bin/sh',
    `if ${argsMatch}; then`,
    `  printf '%s' ${shellQuote(response)}`,
    'else',
    "  printf 'U\\n'",
    'fi',
    '',
  ].join('\n'))
  await chmod(executable, 0o755)
  return executable
}

test('pack-index listing validates the native protocol, arguments, cap and exact filename grammar', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-pack-list-protocol-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = await pinnedRoot(temporary)
  const longName = `pack-${'b'.repeat(64)}.idx`
  const shortName = `pack-${'a'.repeat(40)}.idx`
  const executable = await fakeHelper(temporary, root, `L 2\n${longName}\n${shortName}\n`)
  assert.deepEqual(await listGitPackIndexes(root, { executable }), [shortName, longName])

  const missing = await fakeHelper(temporary, root, 'M\n')
  assert.deepEqual(await listGitPackIndexes(root, { executable: missing }), [], 'missing objects or pack means an empty list')
  for (const [response, pattern] of [
    ['U\n', /unsupported|listing/i],
    ['R\n', /unreadable/i],
    ['C\n', /changed during capture/i],
  ] as const) {
    const helper = await fakeHelper(temporary, root, response)
    await assert.rejects(listGitPackIndexes(root, { executable: helper }), pattern)
  }

  for (const response of [
    'L 01\n',
    'L 1\n',
    `L 1\npack-${'A'.repeat(40)}.idx\n`,
    `L 2\n${shortName}\n${shortName}\n`,
  ]) {
    const helper = await fakeHelper(temporary, root, response)
    await assert.rejects(listGitPackIndexes(root, { executable: helper }), /invalid directory listing/i, response.slice(0, 80))
  }

  const oversized = await fakeHelper(temporary, root, `L 0\n${'x'.repeat(8 * 1024)}\n`)
  await assert.rejects(listGitPackIndexes(root, { executable: oversized }), /output limit/i)
})

test('native pack-index listing descends only pinned objects/pack and leaves source metadata unchanged', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-pack-list-native-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = join(temporary, 'agent-commons-git-file')
  const plan = gitFileBuildPlan({ targetPlatform: 'darwin', targetArch: process.arch, outputPath: executable })
  assert.equal(plan.compiler, '/usr/bin/clang')
  assert.equal(buildGitFileHelper({ targetPlatform: 'darwin', targetArch: process.arch, outputPath: executable }), executable)

  const repositoryPath = join(temporary, 'repo')
  const rootPath = join(repositoryPath, '.git')
  const objectsPath = join(rootPath, 'objects')
  const packPath = join(objectsPath, 'pack')
  await mkdir(packPath, { recursive: true })
  const names = [`pack-${'a'.repeat(40)}.idx`, `pack-${'b'.repeat(64)}.idx`]
  const filePaths = names.map((name) => join(packPath, name))
  for (const [index, filePath] of filePaths.entries()) await writeFile(filePath, `opaque index bytes ${index}`)
  await writeFile(join(packPath, `pack-${'C'.repeat(40)}.idx`), 'uppercase is excluded')
  await writeFile(join(packPath, `pack-${'d'.repeat(39)}.idx`), 'short hash is excluded')
  await writeFile(join(packPath, `pack-${'e'.repeat(40)}.pack`), 'pack data is excluded')
  await writeFile(join(packPath, '.hidden'), 'hidden names are excluded')
  await mkdir(join(packPath, 'nested'))
  await writeFile(join(packPath, 'nested', `pack-${'f'.repeat(40)}.idx`), 'nested names are excluded')

  const sourcePaths = [repositoryPath, rootPath, objectsPath, packPath, ...filePaths]
  const before = await Promise.all(sourcePaths.map((path) => lstat(path, { bigint: true })))
  const result = await listGitPackIndexes(await pinnedRoot(rootPath), { executable })
  const after = await Promise.all(sourcePaths.map((path) => lstat(path, { bigint: true })))
  assert.deepEqual(result, names)
  for (let index = 0; index < before.length; index += 1) {
    const a = before[index]!
    const b = after[index]!
    assert.deepEqual(
      [b.dev, b.ino, b.mode, b.size, b.mtimeNs, b.ctimeNs],
      [a.dev, a.ino, a.mode, a.size, a.mtimeNs, a.ctimeNs],
      `listing leaves source metadata unchanged: ${sourcePaths[index]}`,
    )
  }

  const missingObjects = join(temporary, 'missing-objects')
  await mkdir(join(missingObjects, '.git'), { recursive: true })
  assert.deepEqual(await listGitPackIndexes(await pinnedRoot(join(missingObjects, '.git')), { executable }), [])
  const missingPack = join(temporary, 'missing-pack')
  await mkdir(join(missingPack, '.git', 'objects'), { recursive: true })
  assert.deepEqual(await listGitPackIndexes(await pinnedRoot(join(missingPack, '.git')), { executable }), [])
})

test('native pack-index listing refuses linked or non-directory roots and parent components', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-pack-list-refusal-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = join(temporary, 'agent-commons-git-file')
  assert.equal(buildGitFileHelper({ targetPlatform: 'darwin', targetArch: process.arch, outputPath: executable }), executable)
  const target = join(temporary, 'target')
  const targetMetadata = join(target, '.git')
  await mkdir(join(targetMetadata, 'objects', 'pack'), { recursive: true })
  await writeFile(join(targetMetadata, 'objects', 'pack', `pack-${'a'.repeat(40)}.idx`), 'target')

  const rootLink = join(temporary, 'root-link')
  await symlink(target, rootLink)
  const targetRoot = await pinnedRoot(targetMetadata)
  await assert.rejects(listGitPackIndexes({ ...targetRoot, path: rootLink }, { executable }), /changed|unreadable/i)

  for (const component of ['objects', 'pack']) {
    const repository = join(temporary, `linked-${component}`)
    const git = join(repository, '.git')
    const realPack = join(repository, 'outside-pack')
    await mkdir(realPack, { recursive: true })
    await mkdir(git, { recursive: true })
    const parent = component === 'objects' ? git : join(git, 'objects')
    await mkdir(parent, { recursive: true })
    await symlink(realPack, join(parent, component === 'objects' ? 'objects' : 'pack'))
    await assert.rejects(listGitPackIndexes(await pinnedRoot(git), { executable }), /invalid directory listing|changed|unreadable/i)
  }

  const nonDirectory = join(temporary, 'not-a-directory')
  await mkdir(join(nonDirectory, '.git'), { recursive: true })
  await writeFile(join(nonDirectory, '.git', 'objects'), 'not a directory')
  await assert.rejects(listGitPackIndexes(await pinnedRoot(join(nonDirectory, '.git')), { executable }), /invalid directory listing|changed|unreadable/i)
})

test('native pack-index listing refuses more than 64 matches or 512 visited entries', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-pack-list-cap-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = join(temporary, 'agent-commons-git-file')
  assert.equal(buildGitFileHelper({ targetPlatform: 'darwin', targetArch: process.arch, outputPath: executable }), executable)

  for (const [label, count, matching] of [['matches', 65, true], ['visited', 513, false]] as const) {
    const repository = join(temporary, label)
    const root = join(repository, '.git')
    const pack = join(root, 'objects', 'pack')
    await mkdir(pack, { recursive: true })
    for (let index = 0; index < count; index += 1) {
      const name = matching
        ? `pack-${String(index + 1).padStart(40, '0')}.idx`
        : `unrelated-entry-${index}`
      await writeFile(join(pack, name), '')
    }
    await assert.rejects(listGitPackIndexes(await pinnedRoot(root), { executable }), /changed during capture/)
  }
})

test('native pack-index listing detects a pack-directory symlink swap before returning names', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-pack-list-race-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = join(temporary, 'agent-commons-git-file')
  assert.equal(buildGitFileHelper({ targetPlatform: 'darwin', targetArch: process.arch, outputPath: executable, testHooks: true }), executable)

  const repository = join(temporary, 'repo')
  const rootPath = join(repository, '.git')
  const objectsPath = join(rootPath, 'objects')
  const packPath = join(objectsPath, 'pack')
  const parkedPackPath = join(objectsPath, 'pack.before-swap')
  const outsidePackPath = join(temporary, 'outside-pack')
  const readyPath = join(temporary, 'ready')
  const releasePath = join(temporary, 'release')
  await mkdir(packPath, { recursive: true })
  await mkdir(outsidePackPath)
  await writeFile(join(packPath, `pack-${'a'.repeat(40)}.idx`), 'pinned pack entry')
  await writeFile(join(outsidePackPath, `pack-${'b'.repeat(40)}.idx`), 'outside entry must not be listed')
  const root = await pinnedRoot(rootPath)

  const child = spawn(executable, [
    '--list-pack-indexes', root.path, root.identity.dev, root.identity.ino,
  ], {
    cwd: '/',
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', AGENT_COMMONS_GIT_FILE_TEST_READY: readyPath,
      AGENT_COMMONS_GIT_FILE_TEST_RELEASE: releasePath },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  t.after(async () => {
    await writeFile(releasePath, 'release').catch(() => {})
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  })
  const outputPromise = new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.once('error', reject)
    child.once('close', (code, signal) => code === 0 && signal === null
      ? resolve(Buffer.concat(chunks).toString('ascii'))
      : reject(new Error(`pack listing helper exited ${signal ?? code}`)))
  })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try { await lstat(readyPath); break } catch {}
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  await lstat(readyPath)
  await rename(packPath, parkedPackPath)
  await symlink(outsidePackPath, packPath)
  await writeFile(releasePath, 'continue')
  assert.equal(await outputPromise, 'C\n', 'a changed parent chain returns no cached or outside names')
})
