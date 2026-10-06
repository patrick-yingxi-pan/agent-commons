import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseGitIndexStages, prepareGitIndex } from './gitIndex.mjs'
import { parseGitIndexEntries } from './localGitReader.mjs'

const oid1 = 'a'.repeat(40)
const oid2 = 'b'.repeat(40)
const row = (name: string, mode = '100644', oid = oid1, stage = 0) => `${mode} ${oid} ${stage}\t${name}\0`

function configBytes(objectFormat: string) {
  return Buffer.from(`[include]\npath = /private/config\n[extensions]\nobjectFormat = ${objectFormat}\nworktreeConfig = true\n`)
}

function checksummedIndex(algorithm: 'sha1' | 'sha256') {
  const body = Buffer.from('bounded-index-checksum-fixture')
  return Buffer.concat([body, createHash(algorithm).update(body).digest()])
}

async function prepareFixture(t: any, {
  index,
  config = { status: 'missing' },
  configLookupStatus = 0,
  configLookupOutput = 'sha256\n',
}: {
  index?: Uint8Array
  config?: { status: string; bytes?: Uint8Array }
  configLookupStatus?: number
  configLookupOutput?: string
} = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'agent-commons-git-index-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const metadata = join(parent, 'metadata')
  const staging = join(parent, 'staging')
  await mkdir(metadata)
  await mkdir(staging)
  const git = { path: join(parent, 'private-git'), identity: { dev: '1', ino: '2' } }
  const common = { path: join(parent, 'private-common'), identity: { dev: '1', ino: '3' } }
  const calls: any[] = []
  const objectFormat = await prepareGitIndex({
    git,
    common,
    metadata,
    staging,
    load: async (...args: any[]) => {
      calls.push(['load', ...args])
      return config
    },
    copyMetadata: async (...args: any[]) => {
      calls.push(['copy', ...args])
      return args[1] === 'index' ? index : Buffer.from('shared index fixture')
    },
    listSharedIndexes: async (...args: any[]) => {
      calls.push(['list', ...args])
      return ['sharedindex.fixture']
    },
    fileExecutable: '/bundled/git-file-helper',
    runGit: async (...args: any[]) => {
      calls.push(['git', ...args])
      return { status: configLookupStatus, stdout: Buffer.from(configLookupOutput) }
    },
    signal: undefined,
  })
  return { objectFormat, calls, metadata, staging, git, common }
}

test('stage parser returns sorted lossless entries and strips the sparse-directory suffix', () => {
  const parsed = parseGitIndexStages(Buffer.from(
    row('z/file.txt', '100755', oid2) +
    row('sparse/tree/', '040000', oid1) +
    row('a/file.txt', '100644', oid1),
  ))
  assert.deepEqual(parsed, [
    { name: 'a/file.txt', mode: '100644', oid: oid1, stage: 0 },
    { name: 'sparse/tree', mode: '040000', oid: oid1, stage: 0 },
    { name: 'z/file.txt', mode: '100755', oid: oid2, stage: 0 },
  ])
})

test('stage parser preserves unmerged records, orders conflict stages, and legacy projection remains compatible', () => {
  const conflict = Buffer.from(
    row('conflict.md', '100644', oid1, 1) +
    row('conflict.md', '100755', oid2, 2) +
    row('conflict.md', '100644', 'c'.repeat(64), 3),
  )
  assert.deepEqual(parseGitIndexStages(conflict), [
    { name: 'conflict.md', mode: '100644', oid: oid1, stage: 1 },
    { name: 'conflict.md', mode: '100755', oid: oid2, stage: 2 },
    { name: 'conflict.md', mode: '100644', oid: 'c'.repeat(64), stage: 3 },
  ])
  assert.deepEqual(parseGitIndexEntries(conflict), [{ name: 'conflict.md', mode: 'mixed' }])
  assert.deepEqual(parseGitIndexEntries(Buffer.from(row('clean.md'))), [{ name: 'clean.md', mode: '100644' }])
})

test('tagged stage parser preserves skip-worktree and rejects inconsistent or unknown tags', () => {
  assert.deepEqual(parseGitIndexStages(Buffer.from(`S ${row('skipped.txt')}H ${row('present.txt')}M ${row('conflict.txt', '100644', oid2, 2)}`), { tagged: true }), [
    { name: 'conflict.txt', mode: '100644', oid: oid2, stage: 2, skipWorktree: false },
    { name: 'present.txt', mode: '100644', oid: oid1, stage: 0, skipWorktree: false },
    { name: 'skipped.txt', mode: '100644', oid: oid1, stage: 0, skipWorktree: true },
  ])
  for (const invalid of [row('untagged'), `X ${row('unknown')}`, `M ${row('merged')}`,
    `S ${row('conflict', '100644', oid1, 1)}`, `H ${row('conflict', '100644', oid1, 2)}`]) {
    assert.throws(() => parseGitIndexStages(Buffer.from(invalid), { tagged: true }))
  }
})

test('stage parser rejects malformed UTF-8, missing NUL, unsafe paths, duplicate stages and stage-zero conflicts', () => {
  for (const bytes of [
    Buffer.from([0xff, 0x00]),
    Buffer.from('\uFEFF' + row('unexpected-bom')),
    Buffer.from(row('missing-nul').slice(0, -1)),
    Buffer.from(row('../outside')),
    Buffer.from(row('.git/config')),
    Buffer.from(row('a\\b')),
    Buffer.from(row('same.md', '100644', oid1, 2) + row('same.md', '100755', oid2, 2)),
    Buffer.from(row('same.md', '100644', oid1, 0) + row('same.md', '100755', oid2, 1)),
    Buffer.from(row('same.md', '100644', oid1, 1) + row('same.md', '100755', oid2, 0)),
  ]) assert.throws(() => parseGitIndexStages(bytes))

  assert.throws(() => parseGitIndexStages(Buffer.from(Array.from({ length: 501 }, (_, index) => row(`${index}.md`)).join(''))))
  assert.throws(() => parseGitIndexStages(Buffer.from(Array.from({ length: 2001 }, (_, index) => row(`conflict-${Math.floor(index / 4)}.md`, '100644', oid1, index % 4)).join(''))))
})

test('index preparation detects checksummed index formats without reading config and copies only bounded metadata', async (t) => {
  for (const format of ['sha1', 'sha256'] as const) {
    const { objectFormat, calls, metadata, staging, git } = await prepareFixture(t, { index: checksummedIndex(format) })
    assert.equal(objectFormat, format)
    assert.deepEqual(await readFile(join(metadata, 'config'), 'utf8'),
      `[core]\nrepositoryformatversion=${format === 'sha256' ? 1 : 0}\nbare=false\nsparseCheckout=true\nsparseCheckoutCone=true\n[index]\nsparse=true\n${format === 'sha256' ? '[extensions]\nobjectformat=sha256\n' : ''}`)
    assert.equal(await readFile(join(metadata, 'info', 'sparse-checkout'), 'utf8'), '/*\n!/*/\n')
    assert.equal(calls.some(([kind]) => kind === 'load'), false)
    const copied = calls.filter(([kind]) => kind === 'copy')
    assert.deepEqual(copied.map(([, base, name, destination, limit, optional]) => [base.path, name, destination, limit, optional]), [
      [git.path, 'index', join(metadata, 'index'), 16 * 1024 * 1024, true],
      [git.path, 'sharedindex.fixture', join(metadata, 'sharedindex.fixture'), 16 * 1024 * 1024, undefined],
    ])
    assert.deepEqual(calls.find(([kind]) => kind === 'list')[2], { signal: undefined, executable: '/bundled/git-file-helper' })
    assert.equal(staging.length > 0, true)
  }
})

test('an absent or skip-hash index infers either format from bounded no-includes config', async (t) => {
  for (const [format, withIndex] of [['sha1', false], ['sha256', false], ['sha256', true]] as const) {
    const zeroChecksumIndex = withIndex ? Buffer.concat([Buffer.from('index-with-zero-checksum'), Buffer.alloc(20)]) : undefined
    const config = { status: 'file', bytes: configBytes(format) }
    const { objectFormat, calls, common, staging } = await prepareFixture(t, {
      index: zeroChecksumIndex,
      config,
      configLookupStatus: 0,
      configLookupOutput: `${format}\n`,
    })
    assert.equal(objectFormat, format)
    const loadCall = calls.find(([kind]) => kind === 'load')
    assert.deepEqual(loadCall.slice(1), [common, 'config', 128 * 1024])
    const gitCall = calls.find(([kind]) => kind === 'git')
    assert.deepEqual(gitCall[1], ['config', '--file', '-', '--no-includes', '--get', 'extensions.objectformat'])
    assert.equal(gitCall[2].cwd, staging)
    assert.deepEqual(gitCall[2].input, config.bytes)
    assert.equal(gitCall[2].input.toString().includes('/private/config'), true)
  }
})

test('an absent or no-hash index defaults to SHA-1 when config omits the object-format key', async (t) => {
  for (const index of [undefined, Buffer.concat([Buffer.from('index-with-zero-checksum'), Buffer.alloc(20)])]) {
    const { objectFormat, calls } = await prepareFixture(t, {
      index,
      config: { status: 'file', bytes: Buffer.from('[core]\nrepositoryformatversion=0\n') },
      configLookupStatus: 1,
      configLookupOutput: '',
    })
    assert.equal(objectFormat, 'sha1')
    assert.equal(calls.some(([kind]) => kind === 'git'), true)
  }
})

test('index preparation defaults SHA-1 when no index or source config exists', async (t) => {
  const { objectFormat, calls } = await prepareFixture(t)
  assert.equal(objectFormat, 'sha1')
  assert.equal(calls.some(([kind]) => kind === 'git'), false)
})
