import assert from 'node:assert/strict'
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { bundledGitDirectory, bundledGitProbeEnvironment } from './bundledGit.mjs'
import { resolveGitHead } from './gitHead.mjs'

const oid = (format: 'sha1' | 'sha256', char = 'a') => char.repeat(format === 'sha1' ? 40 : 64)
const root = (path: string) => ({ path, identity: { dev: '1', ino: path === '/git' ? '2' : '3' } })

function mapLoader(values: Record<string, string | { status: string }>, calls: Array<[string, string, number | null]> = []) {
  return async (source: ReturnType<typeof root>, name: string, maxBytes: number | null) => {
    calls.push([source.path, name, maxBytes])
    const value = values[`${source.path}:${name}`]
    if (value === undefined) return { status: 'missing' }
    if (typeof value !== 'string') return value
    const bytes = new TextEncoder().encode(value)
    if (maxBytes !== null && bytes.byteLength > maxBytes) return { status: 'too-large', sizeBytes: bytes.byteLength }
    return { status: 'file', sizeBytes: bytes.byteLength, bytes }
  }
}

test('resolve detached HEAD and loose branch refs for both supported object formats', async () => {
  for (const objectFormat of ['sha1', 'sha256'] as const) {
    const git = root('/git')
    const common = root('/common')
    assert.deepEqual(await resolveGitHead({
      git, common, objectFormat,
      load: mapLoader({ '/git:HEAD': `${oid(objectFormat)}\n` }),
    }), { oid: oid(objectFormat), ref: null })

    const branch = `refs/heads/release/${objectFormat}`
    assert.deepEqual(await resolveGitHead({
      git, common, objectFormat,
      load: mapLoader({
        '/git:HEAD': `ref: ${branch}\n`,
        [`/common:${branch}`]: `${oid(objectFormat, 'b')}\n`,
      }),
    }), { oid: oid(objectFormat, 'b'), ref: branch })

    assert.deepEqual(await resolveGitHead({
      git, common, objectFormat,
      load: mapLoader({
        '/git:HEAD': `ref: ${branch}\n`,
        '/common:packed-refs': `# pack-refs with: peeled\n${oid(objectFormat, 'c')} ${branch}\n`,
      }),
    }), { oid: oid(objectFormat, 'c'), ref: branch })
  }
})

test('loose HEAD and refs accept Git LF, CRLF, or no final newline', async () => {
  const branch = 'refs/heads/main'
  for (const [headEnding, refEnding] of [['', ''], ['\n', '\n'], ['\r\n', '\r\n']] as const) {
    assert.deepEqual(await resolveGitHead({
      git: root('/git'), common: root('/common'),
      load: mapLoader({ '/git:HEAD': `ref: ${branch}${headEnding}`, [`/common:${branch}`]: `${oid('sha1', 'b')}${refEnding}` }),
    }), { oid: oid('sha1', 'b'), ref: branch })
  }
})

test('linked-worktree HEAD comes from git metadata while refs and packed-refs come from common metadata', async () => {
  const calls: Array<[string, string, number | null]> = []
  const branch = 'refs/heads/main'
  const git = root('/worktrees/wt')
  const common = root('/common')
  const result = await resolveGitHead({
    git, common,
    load: mapLoader({
      '/worktrees/wt:HEAD': `ref: ${branch}\n`,
      [`/common:${branch}`]: { status: 'missing' },
      '/common:packed-refs': `# pack-refs with: peeled fully-peeled\n${oid('sha1', 'c')} ${branch}\n${oid('sha1', 'd')} refs/tags/v1\n^${oid('sha1', 'e')}\n`,
    }, calls),
  })
  assert.deepEqual(result, { oid: oid('sha1', 'c'), ref: branch })
  assert.deepEqual(calls.map(([path, name]) => [path, name]), [
    ['/common', 'reftable/tables.list'],
    ['/worktrees/wt', 'HEAD'],
    ['/common', branch],
    ['/common', 'packed-refs'],
  ])
  assert.equal(calls[0]?.[2], null, 'reftable probe is metadata-only')
  assert.equal(calls[3]?.[2], 16 * 1024 * 1024, 'packed-refs has a bounded content read')
})

test('missing branch after packed-refs lookup is an unborn branch', async () => {
  const branch = 'refs/heads/new-topic'
  const result = await resolveGitHead({
    git: root('/git'), common: root('/common'),
    load: mapLoader({ '/git:HEAD': `ref: ${branch}\n`, '/common:packed-refs': `# pack-refs with: peeled\n` }),
  })
  assert.deepEqual(result, { oid: null, ref: branch })
})

test('symbolic branch chains are bounded to eight hops and reject cycles', async () => {
  const git = root('/git')
  const common = root('/common')
  const links = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
    `/common:refs/heads/branch-${index}`,
    `ref: refs/heads/branch-${index + 1}\n`,
  ]))
  assert.deepEqual(await resolveGitHead({
    git, common,
    load: mapLoader({ '/git:HEAD': 'ref: refs/heads/branch-0\n', ...links,
      '/common:refs/heads/branch-8': `${oid('sha1', 'f')}\n` }),
  }), { oid: oid('sha1', 'f'), ref: 'refs/heads/branch-8' })

  await assert.rejects(resolveGitHead({
    git, common,
    load: mapLoader({ '/git:HEAD': 'ref: refs/heads/branch-0\n', ...links,
      '/common:refs/heads/branch-8': 'ref: refs/heads/branch-9\n' }),
  }), /Git baseline/)
  await assert.rejects(resolveGitHead({
    git, common,
    load: mapLoader({ '/git:HEAD': 'ref: refs/heads/one\n',
      '/common:refs/heads/one': 'ref: refs/heads/two\n',
      '/common:refs/heads/two': 'ref: refs/heads/one\n' }),
  }), /Git baseline/)
})

test('rejects invalid HEAD/ref syntax, missing HEAD, corruption, and unsupported reftable storage', async () => {
  const git = root('/git')
  const common = root('/common')
  for (const head of [
    { status: 'missing' },
    '',
    `${'A'.repeat(40)}\n`,
    `${'0'.repeat(40)}\n`,
    `\ufeff${oid('sha1')}\n`,
    `${oid('sha1')}\nextra\n`,
    'ref: HEAD\n',
    'ref: refs/tags/v1\n',
    'ref: refs/heads/a/../b\n',
    'ref: refs/heads/a@{b}\n',
    'ref: refs/heads/a.lock\n',
    'ref: refs/heads/a b\n',
    'ref: refs/heads/a:b\n',
    'ref: refs/heads/.hidden\n',
    'ref: refs/heads/.gi\u200ct\n',
    'ref: refs/heads/feature\u202e/../main\n',
  ]) {
    await assert.rejects(resolveGitHead({ git, common, load: mapLoader({ '/git:HEAD': head as any }) }), /Git baseline/)
  }
  await assert.rejects(resolveGitHead({ git, common, load: mapLoader({ '/git:HEAD': { status: 'unreadable' } }) }), /Git baseline/)
  await assert.rejects(resolveGitHead({
    git, common, load: mapLoader({ '/git:HEAD': `ref: refs/heads/main\n`, '/common:refs/heads/main': { status: 'unsupported' } }),
  }), /Git baseline/)
  await assert.rejects(resolveGitHead({
    git, common, load: mapLoader({ '/common:reftable/tables.list': { status: 'file' }, '/git:HEAD': `ref: refs/heads/main\n` }),
  }), /Git baseline/)
  await assert.rejects(resolveGitHead({
    git, common, objectFormat: 'sha256', load: mapLoader({ '/git:HEAD': `ref: refs/heads/main\n`, '/common:refs/heads/main': `${oid('sha1')}\n` }),
  }), /Git baseline/)
  await assert.rejects(resolveGitHead({
    git, common, load: mapLoader({ '/git:HEAD': `ref: refs/heads/main\n`, '/common:refs/heads/main': `${'0'.repeat(40)}\n` }),
  }), /Git baseline/)
})

test('packed-refs parser refuses malformed rows, peeled records, and duplicate names', async () => {
  const branch = 'refs/heads/main'
  for (const packed of [
    '',
    `${oid('sha1')} ${branch}`,
    `${oid('sha1')} ${branch}\n${oid('sha1', 'b')} ${branch}\n`,
    `not-an-oid ${branch}\n`,
    `${oid('sha1')} refs/heads/invalid..name\n`,
    `^${oid('sha1')}\n`,
    `${oid('sha1')} refs/tags/v1\n^bad\n`,
    `${oid('sha1')} refs/tags/v1\n^${oid('sha1')}\n^${oid('sha1', 'b')}\n`,
    `${'0'.repeat(40)} refs/heads/main\n`,
    `\ufeff${oid('sha1')} refs/heads/main\n`,
    `${oid('sha1')} refs/heads/.gi\u200ct\n`,
  ]) {
    await assert.rejects(resolveGitHead({
      git: root('/git'), common: root('/common'),
      load: mapLoader({ '/git:HEAD': `ref: ${branch}\n`, '/common:packed-refs': packed }),
    }), /Git baseline/)
  }
  await assert.rejects(resolveGitHead({
    git: root('/git'), common: root('/common'),
    load: mapLoader({ '/git:HEAD': `ref: ${branch}\n`, '/common:packed-refs': { status: 'too-large', sizeBytes: 16 * 1024 * 1024 + 1 } }),
  }), /Git baseline/)
})

test('packed-refs accepts refs/stash and peeled custom or remote refs', async () => {
  const branch = 'refs/heads/main'
  const packed = [
    '# pack-refs with: peeled fully-peeled',
    `${oid('sha1', 'a')} refs/stash`,
    `${oid('sha1', 'b')} refs/custom/annotated`,
    `^${oid('sha1', 'c')}`,
    `${oid('sha1', 'd')} refs/remotes/origin/annotated`,
    `^${oid('sha1', 'e')}`,
    `${oid('sha1', 'f')} ${branch}`,
    '',
  ].join('\n')
  assert.deepEqual(await resolveGitHead({
    git: root('/git'), common: root('/common'),
    load: mapLoader({ '/git:HEAD': `ref: ${branch}\n`, '/common:packed-refs': packed }),
  }), { oid: oid('sha1', 'f'), ref: branch })
})

test('reads generated .git fixtures for detached, loose and packed refs without invoking Git', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-head-fixture-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const gitPath = join(temporary, '.git')
  await mkdir(join(gitPath, 'refs', 'heads'), { recursive: true })
  const git = root(gitPath)
  const common = git
  const load = async (source: typeof git, name: string, maxBytes: number | null) => {
    const { readFile, stat } = await import('node:fs/promises')
    const path = join(source.path, ...name.split('/'))
    try {
      const info = await stat(path)
      if (maxBytes !== null && info.size > maxBytes) return { status: 'too-large', sizeBytes: info.size }
      return { status: 'file', sizeBytes: info.size, bytes: new Uint8Array(await readFile(path)) }
    } catch (error: any) {
      if (error.code === 'ENOENT') return { status: 'missing' }
      return { status: 'unreadable' }
    }
  }

  await writeFile(join(gitPath, 'HEAD'), `${oid('sha1', '1')}\n`)
  assert.deepEqual(await resolveGitHead({ git, common, load }), { oid: oid('sha1', '1'), ref: null })
  await writeFile(join(gitPath, 'HEAD'), 'ref: refs/heads/main\n')
  await writeFile(join(gitPath, 'refs', 'heads', 'main'), `${oid('sha1', '2')}\n`)
  assert.deepEqual(await resolveGitHead({ git, common, load }), { oid: oid('sha1', '2'), ref: 'refs/heads/main' })
  await rm(join(gitPath, 'refs', 'heads', 'main'))
  await writeFile(join(gitPath, 'packed-refs'), `# pack-refs with: peeled fully-peeled\n${oid('sha1', '3')} refs/heads/main\n`)
  assert.deepEqual(await resolveGitHead({ git, common, load }), { oid: oid('sha1', '3'), ref: 'refs/heads/main' })
})

test('bundled Git packed-refs with refs/stash and a custom peeled ref resolves the branch', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-head-bundled-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const repository = join(temporary, 'repo')
  await mkdir(repository)
  const executable = join(bundledGitDirectory({ packaged: false })!, 'git')
  const env = bundledGitProbeEnvironment()
  const run = (args: string[]) => {
    const result = spawnSync(executable, args, { cwd: repository, env, encoding: 'utf8' })
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  run(['init', '--initial-branch=main'])
  run(['config', 'user.name', 'Git Head Test'])
  run(['config', 'user.email', 'git-head@example.invalid'])
  await writeFile(join(repository, 'tracked.txt'), 'generated fixture')
  run(['add', 'tracked.txt'])
  run(['commit', '-m', 'fixture commit'])
  run(['tag', '--annotate', 'fixture-tag', '--message', 'annotated fixture'])
  const tagOid = run(['rev-parse', 'refs/tags/fixture-tag'])
  run(['update-ref', 'refs/stash', 'HEAD'])
  run(['update-ref', 'refs/custom/annotated', tagOid])
  run(['pack-refs', '--all', '--prune'])

  const gitPath = join(repository, '.git')
  const git = root(gitPath)
  const common = git
  const packed = await readFile(join(gitPath, 'packed-refs'), 'utf8')
  assert.match(packed, /^.* refs\/stash$/m)
  assert.match(packed, /^.* refs\/custom\/annotated\n\^[a-f0-9]{40}$/m)
  const load = async (source: typeof git, name: string, maxBytes: number | null) => {
    const path = join(source.path, ...name.split('/'))
    try {
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) return { status: 'unsupported' }
      if (maxBytes !== null && info.size > maxBytes) return { status: 'too-large', sizeBytes: info.size }
      const bytes = new Uint8Array(await readFile(path))
      return { status: 'file', sizeBytes: bytes.byteLength, bytes }
    } catch (error: any) {
      return error.code === 'ENOENT' ? { status: 'missing' } : { status: 'unreadable' }
    }
  }
  assert.deepEqual(await resolveGitHead({ git, common, load }), {
    oid: run(['rev-parse', 'refs/heads/main']), ref: 'refs/heads/main',
  })
})
