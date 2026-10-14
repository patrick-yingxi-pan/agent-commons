import assert from 'node:assert/strict'
import { test } from 'node:test'
import { discoverUntrackedGitFiles } from './gitUntracked.mjs'

const entry = (name: string, kind = 'F') => ({ name, kind, sizeBytes: 1, version: 'private-version' })
const scan = (entries: ReturnType<typeof entry>[], visited = entries.length) => ({ version: 'private-directory', entries, visited })
const noIgnores = async () => new Set<string>()

test('untracked discovery subtracts index authority and prunes ignores before any child descent', async () => {
  const reads: string[] = []
  const batches: string[][] = []
  const result = await discoverUntrackedGitFiles({
    list: async browse => { assert.equal(browse, true); return [{ name: 'indexed' }] },
    directory: async path => {
      reads.push(path)
      if (!path) return scan([entry('.git', 'D'), entry('indexed', 'D'), entry('ignored', 'D'), entry('new', 'D'), entry('.env')])
      assert.equal(path, 'new')
      return scan([entry('b.md'), entry('a.md'), entry('link.md', 'U')])
    },
    ignoredPaths: async (entries, maxEntries, options) => {
      batches.push(entries.map(item => item.name))
      assert.equal(maxEntries, 10_000)
      assert.deepEqual(options, { isolated: true, readCandidateDirectoryIgnores: false })
      return new Set(entries.filter(item => item.name === 'ignored').map(item => item.name))
    },
  })
  assert.deepEqual(reads, ['', 'new'])
  assert.deepEqual(batches, [['ignored', 'new', '.env'], ['new/b.md', 'new/a.md', 'new/link.md']])
  assert.equal(result.excludedCount, 1)
  assert.deepEqual(result.files.map(({ path, kind }) => ({ path, kind })), [
    { path: '.env', kind: 'file' }, { path: 'new/a.md', kind: 'file' },
    { path: 'new/b.md', kind: 'file' }, { path: 'new/link.md', kind: 'unsupported' },
  ])
})

test('untracked discovery caps aggregate raw enumeration, not only candidate or per-directory counts', async () => {
  let reads = 0
  const options = {
    list: async () => [], ignoredPaths: noIgnores,
    directory: async (path: string) => { reads++; return path ? scan([], 5000) : scan([entry('child', 'D')], 5000) },
  }
  assert.deepEqual((await discoverUntrackedGitFiles(options)).files, [])
  assert.equal(reads, 2)
  await assert.rejects(discoverUntrackedGitFiles({ ...options,
    directory: async path => path ? scan([], 5001) : scan([entry('child', 'D')], 5000),
  }), /exceeds its read limits/)
})

test('untracked discovery counts empty directories and root against one finite traversal budget', async () => {
  const options = (children: number) => ({
    list: async () => [], ignoredPaths: noIgnores,
    directory: async path => path ? scan([]) : scan(Array.from({ length: children }, (_, i) => entry(`d-${i}`, 'D'))),
  })
  assert.deepEqual((await discoverUntrackedGitFiles(options(1023))).files, [])
  await assert.rejects(discoverUntrackedGitFiles(options(1024)), /exceeds its read limits/)
})

test('untracked discovery caps depth after ignore pruning and never treats overflow as a partial result', async () => {
  const options = (maximum: number) => ({
    list: async () => [], ignoredPaths: noIgnores,
    directory: async path => scan(path.split('/').filter(Boolean).length < maximum ? [entry('d', 'D')] : [entry('leaf.md')]),
  })
  assert.equal((await discoverUntrackedGitFiles(options(64))).files[0].path, `${'d/'.repeat(64)}leaf.md`)
  await assert.rejects(discoverUntrackedGitFiles(options(65)), /exceeds its read limits/)
  assert.deepEqual((await discoverUntrackedGitFiles({ ...options(65),
    ignoredPaths: async entries => new Set(entries.filter(item => item.name.split('/').length === 65).map(item => item.name)),
  })).files, [])
})

test('untracked discovery has a cumulative relative-path byte cap across directories', async () => {
  const options = {
    list: async () => [], ignoredPaths: noIgnores,
    directory: async path => !path ? scan([entry('a', 'D'), entry('b', 'D')]) :
      scan(Array.from({ length: 2200 }, (_, i) => entry(`${String(i).padStart(4, '0')}${'x'.repeat(240)}`))),
  }
  await assert.rejects(discoverUntrackedGitFiles(options), /exceeds its read limits/)
})

test('nested repository metadata aliases prevent all child admission regardless of marker type', async () => {
  for (const marker of ['.git', '.GIT', '.g\u200cit']) {
    let ignoreCalls = 0
    const result = await discoverUntrackedGitFiles({
      list: async () => [],
      directory: async path => scan(path ? [entry(marker, 'U'), entry('secret.md')] : [entry('nested', 'D')]),
      ignoredPaths: async () => { ignoreCalls++; return new Set() },
    })
    assert.equal(ignoreCalls, 1, 'the nested repository must not read its ignore files')
    assert.deepEqual(result.files, [])
  }
})
