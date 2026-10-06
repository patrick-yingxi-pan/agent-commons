import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { bundledGitDirectory } from './bundledGit.mjs'
import { buildGitFileHelper } from './gitFileBuild.mjs'
import { listGitPackIndexes, readGitFile, readGitFileRange } from './gitFileRead.mjs'
import { localGitCommandEnvironment, runLocalGit } from './localGitReader.mjs'
import { inspectLocalFolderRoot } from './localFolderReader.mjs'
import { withGitObjectReader } from './gitObjectReader.mjs'

const GIT_EXECUTABLE = process.platform === 'darwin'
  ? join(bundledGitDirectory({ packaged: false }), 'git')
  : undefined
const FILE_EXECUTABLE = process.platform === 'darwin' ? buildGitFileHelper() : undefined
const ACTUAL_GIT_AVAILABLE = !!GIT_EXECUTABLE && !!FILE_EXECUTABLE && existsSync(GIT_EXECUTABLE) && existsSync(FILE_EXECUTABLE)
const MAX_DECODED_BYTES = 8 * 1024 * 1024
const MAX_STAGED_BYTES = 512 * 1024 * 1024

function git(root: string, args: string[], input?: Uint8Array): Buffer {
  const result = spawnSync(GIT_EXECUTABLE!, [
    '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.untrackedCache=false', '-c', 'core.excludesFile=/dev/null',
    '-c', 'user.name=Git object limits fixture', '-c', 'user.email=fixture@example.invalid',
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

function deterministicBytes(length: number): Buffer {
  const bytes = Buffer.allocUnsafe(length)
  let state = 0x6d2b79f5
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[index] = state & 0xff
  }
  return bytes
}

async function largePackedBlobFixture(t: any) {
  assert.ok(ACTUAL_GIT_AVAILABLE, 'the pinned bundled Git and native descriptor helper are available')
  const parent = await mkdtemp(join(tmpdir(), 'agent-commons-object-reader-limits-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const repository = join(parent, 'repository')
  await mkdir(repository)
  git(repository, ['init', '--template=', '--initial-branch=main', '--object-format=sha1', '.'])
  await writeFile(join(repository, 'large-random.bin'), deterministicBytes(5 * 1024 * 1024))
  git(repository, ['add', '--', 'large-random.bin'])
  git(repository, ['commit', '-m', 'large packed blob fixture'])
  const oid = git(repository, ['rev-parse', 'HEAD:large-random.bin']).toString('ascii').trim()
  git(repository, ['repack', '-adf', '--window=1', '--depth=1'])
  git(repository, ['prune-packed'])
  const metadataRoot = join(repository, '.git')
  const root = await inspectLocalFolderRoot(metadataRoot)
  const indexNames = await listGitPackIndexes(root, { executable: FILE_EXECUTABLE })
  assert.ok(indexNames.length > 0)
  const packPath = join(metadataRoot, 'objects', 'pack', `${indexNames[0]!.slice(0, -4)}.pack`)
  assert.ok((await lstat(packPath)).size > 4 * 1024 * 1024, 'the source pack really exceeds one range')
  return { parent, repository, metadataRoot, root, oid, packPath, indexNames }
}

function actualOptions(metadataRoot: string, capture: string[], overrides: Record<string, unknown> = {}) {
  return {
    objectFormat: 'sha1' as const,
    fileExecutable: FILE_EXECUTABLE,
    runGit: async (args: string[], options: { cwd: string; signal?: AbortSignal; input?: Uint8Array }) => {
      assert.equal(options.cwd === metadataRoot || options.cwd.startsWith(`${metadataRoot}/`), false)
      assert.equal(args.some((argument) => argument.includes(metadataRoot)), false)
      assert.ok(args.includes('--no-replace-objects'))
      capture.push(args.join(' '))
      return runLocalGit(GIT_EXECUTABLE!, args, options)
    },
    ...overrides,
  }
}

test('probeObject returns explicitly unverified size hints while streaming a >4 MiB packed blob', {
  skip: !ACTUAL_GIT_AVAILABLE,
}, async (t) => {
  const fixture = await largePackedBlobFixture(t)
  const calls: string[] = []
  let rangeCalls = 0
  const options = actualOptions(fixture.metadataRoot, calls, {
    readRange: async (root: any, relativePath: string, range: any) => {
      rangeCalls += 1
      return readGitFileRange(root, relativePath, { ...range, executable: FILE_EXECUTABLE })
    },
  })

  const result = await withGitObjectReader(fixture.root, options, async ({ probeObject }) => probeObject(fixture.oid))
  assert.deepEqual(result, { typeHint: 'blob', sizeHintBytes: 5 * 1024 * 1024, contentVerified: false })
  assert.ok(rangeCalls >= 2, `expected multiple 4 MiB reads, got ${rangeCalls}`)
  assert.equal(calls.filter((command) => command.includes('--batch-check=')).length, 1)
  assert.equal(calls.some((command) => command.endsWith(` blob ${fixture.oid}`)), false,
    'inspection does not request a typed object body')
})

test('a changed pack version on a later range rejects the whole inspection', {
  skip: !ACTUAL_GIT_AVAILABLE,
}, async (t) => {
  const fixture = await largePackedBlobFixture(t)
  const calls: string[] = []
  let rangeCalls = 0
  const options = actualOptions(fixture.metadataRoot, calls, {
    readRange: async (root: any, relativePath: string, range: any) => {
      const result = await readGitFileRange(root, relativePath, { ...range, executable: FILE_EXECUTABLE })
      rangeCalls += 1
      return rangeCalls === 2 && result.status === 'file'
        ? { ...result, version: `${result.version}:changed` }
        : result
    },
  })
  await assert.rejects(withGitObjectReader(fixture.root, options, async ({ probeObject }) => {
    try { await probeObject(fixture.oid) } catch {}
    return 'caught stale inspection must not publish'
  }), /Git baseline/i)
  assert.equal(rangeCalls, 2)
})

test('same-version pack bytes that are flipped fail the pack checksum', {
  skip: !ACTUAL_GIT_AVAILABLE,
}, async (t) => {
  const fixture = await largePackedBlobFixture(t)
  const calls: string[] = []
  let rangeCalls = 0
  const options = actualOptions(fixture.metadataRoot, calls, {
    readRange: async (root: any, relativePath: string, range: any) => {
      const result = await readGitFileRange(root, relativePath, { ...range, executable: FILE_EXECUTABLE })
      rangeCalls += 1
      if (rangeCalls !== 2 || result.status !== 'file') return result
      const bytes = new Uint8Array(result.bytes)
      bytes[Math.floor(bytes.length / 2)] ^= 1
      return { ...result, bytes }
    },
  })
  await assert.rejects(withGitObjectReader(fixture.root, options, async ({ probeObject }) => {
    try { await probeObject(fixture.oid) } catch {}
    return 'checksum failure must poison inspection'
  }), /Git baseline/i)
  assert.equal(rangeCalls, 2)
})

test('pack metadata above the 512 MiB staged cap fails before any range read', {
  skip: !ACTUAL_GIT_AVAILABLE,
}, async (t) => {
  const fixture = await largePackedBlobFixture(t)
  const calls: string[] = []
  let rangeCalls = 0
  const packRelativePath = `objects/pack/${fixture.indexNames[0]!.slice(0, -4)}.pack`
  const options = actualOptions(fixture.metadataRoot, calls, {
    readFile: async (root: any, name: string, readOptions: any) => {
      if (name === packRelativePath && readOptions.maxBytes === null) {
        return { status: 'file', sizeBytes: MAX_STAGED_BYTES + 1, version: '1:2:3:4:5:6:7:8' }
      }
      return readGitFile(root, name, { ...readOptions, executable: FILE_EXECUTABLE })
    },
    readRange: async (root: any, name: string, range: any) => {
      rangeCalls += 1
      return readGitFileRange(root, name, { ...range, executable: FILE_EXECUTABLE })
    },
  })
  await assert.rejects(withGitObjectReader(fixture.root, options, async ({ probeObject }) => probeObject(fixture.oid)), /Git baseline/i)
  assert.equal(rangeCalls, 0)
})

test('injected reader enforces the aggregate 8 MiB decoded limit', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-object-reader-decoded-cap-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = await inspectLocalFolderRoot(temporary)
  const bodies = Array.from({ length: 9 }, (_, index) => Buffer.alloc(1024 * 1024, index + 1))
  const entries = bodies.map((body) => {
    const oid = createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex')
    return { oid, body }
  })
  const runGitCalls: string[] = []
  const typedCalls: string[] = []
  const readFile = async (_source: unknown, name: string, options: { maxBytes: number | null }) => {
    if (name === 'objects/info/alternates' || name === 'objects/info/http-alternates') return { status: 'missing' }
    const oid = name.slice('objects/'.length).replace('/', '')
    const entry = entries.find((candidate) => candidate.oid === oid)
    if (!entry) return { status: 'missing' }
    const bytes = Buffer.from('opaque loose object fixture')
    return options.maxBytes === null
      ? { status: 'file', sizeBytes: bytes.length, version: '1:2:3:4:5:6:7:8' }
      : { status: 'file', sizeBytes: bytes.length, version: '1:2:3:4:5:6:7:8', bytes: new Uint8Array(bytes) }
  }
  const runGit = async (args: string[], options: { input?: Uint8Array }) => {
    runGitCalls.push(args.join(' '))
    const oid = args.some((argument) => argument.startsWith('--batch-check='))
      ? Buffer.from(options.input ?? []).toString('ascii').trim()
      : args.at(-1)!
    if (args.some((argument) => argument.startsWith('--batch-check='))) {
      const entry = entries.find((candidate) => candidate.oid === oid)!
      return { status: 0, stdout: Buffer.from(`${oid} blob ${entry.body.length}\n`) }
    }
    typedCalls.push(oid)
    return { status: 0, stdout: entries.find((candidate) => candidate.oid === oid)!.body }
  }

  await assert.rejects(withGitObjectReader(root, { readFile, runGit }, async ({ readObject }) => {
    for (let index = 0; index < 8; index += 1) await readObject(entries[index]!.oid, 'blob')
    await readObject(entries[8]!.oid, 'blob')
  }), /Git baseline/i)
  assert.equal(typedCalls.length, 8)
  assert.equal(runGitCalls.filter((command) => command.includes('--batch-check=')).length, 9,
    'the ninth object is size-preflighted but its typed body is never requested')
})

test('injected reader refuses the 1025th object metadata request before invoking Git', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-object-reader-metadata-cap-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = await inspectLocalFolderRoot(temporary)
  const oids = Array.from({ length: 1025 }, (_, index) => (index + 1).toString(16).padStart(40, '0'))
  let gitCalls = 0
  const readFile = async (_source: unknown, name: string, options: { maxBytes: number | null }) => {
    if (name === 'objects/info/alternates' || name === 'objects/info/http-alternates') return { status: 'missing' }
    const oid = name.slice('objects/'.length).replace('/', '')
    if (!oids.includes(oid)) return { status: 'missing' }
    const bytes = Buffer.from('opaque loose object fixture')
    return options.maxBytes === null
      ? { status: 'file', sizeBytes: bytes.length, version: '1:2:3:4:5:6:7:8' }
      : { status: 'file', sizeBytes: bytes.length, version: '1:2:3:4:5:6:7:8', bytes: new Uint8Array(bytes) }
  }
  const runGit = async (args: string[], options: { input?: Uint8Array }) => {
    gitCalls += 1
    const oid = Buffer.from(options.input ?? []).toString('ascii').trim()
    return { status: 0, stdout: Buffer.from(`${oid} blob 0\n`) }
  }
  await assert.rejects(withGitObjectReader(root, { readFile, runGit }, async ({ probeObject }) => {
    for (const oid of oids) await probeObject(oid)
  }), /Git baseline/i)
  assert.equal(gitCalls, 1024, 'the 1025th metadata request does not spawn Git')
})
