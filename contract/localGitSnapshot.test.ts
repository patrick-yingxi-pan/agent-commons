import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isGitSnapshotFiles, snapshotGitFiles } from './localGitSnapshot.mjs'

const file = (path: string, text: string, sizeBytes = Buffer.byteLength(text)) => ({ path, sizeBytes, text })

test('Git snapshots retain recursively relative dotfiles, sort paths, and preserve complete text', async () => {
  const input = [file('src/z.ts', 'z\n'), file('.env', 'secret=1'), file('src/a.py', 'a'), file('assets/icon.png', 'bytes')]
  const reads: string[] = []
  const result = await snapshotGitFiles(input, async (entry) => { reads.push(entry.path); return Buffer.from(entry.text) })
  assert.deepEqual(result, [
    { path: '.env', sizeBytes: 8, snapshot: { text: 'secret=1' } },
    { path: 'assets/icon.png', sizeBytes: 5, snapshot: { omitted: 'unsupported' } },
    { path: 'src/a.py', sizeBytes: 1, snapshot: { text: 'a' } },
    { path: 'src/z.ts', sizeBytes: 2, snapshot: { text: 'z\n' } },
  ])
  assert.deepEqual(reads, ['.env', 'src/a.py', 'src/z.ts'])
  assert.equal(isGitSnapshotFiles(result), true)
})

test('Git snapshot validator rejects unsafe, duplicate, unsorted, and excessive entries', async () => {
  const base = [{ path: 'a/file.md', sizeBytes: 1, snapshot: { text: 'x' } }]
  for (const path of ['../secret', '/absolute', 'a/../secret', 'a\\secret', 'a/.git/config', 'a/\u0001x']) {
    assert.equal(isGitSnapshotFiles([{ ...base[0], path }]), false, `reject ${JSON.stringify(path)}`)
  }
  assert.equal(isGitSnapshotFiles([{ ...base[0], path: '.env' }]), true, 'tracked dotfiles are allowed')
  assert.equal(isGitSnapshotFiles([...base, ...base]), false, 'duplicate paths are rejected')
  assert.equal(isGitSnapshotFiles([{ ...base[0], path: 'z' }, { ...base[0], path: 'a' }]), false, 'entries must be sorted')
  assert.equal(isGitSnapshotFiles(Array.from({ length: 501 }, (_, i) => ({ ...base[0], path: `f${String(i).padStart(3, '0')}` }))), false)
  assert.equal(isGitSnapshotFiles([{ path: 'file.md', sizeBytes: 2, snapshot: { text: 'x' } }]), false, 'size must match saved UTF-8 text')
  assert.equal(isGitSnapshotFiles([{ path: 'file.md', sizeBytes: 0, snapshot: { text: 'x'.repeat(65537) } }]), false)
})

test('Git builder shares file, total, and readable-file budgets with local folder captures', async () => {
  const files = Array.from({ length: 25 }, (_, index) => ({ path: `src/${String(index).padStart(2, '0')}.md`, sizeBytes: 1 }))
  const reads: string[] = []
  const snapshots = await snapshotGitFiles(files, async (entry) => { reads.push(entry.path); return Uint8Array.of(0x78) })
  assert.equal(reads.length, 24)
  assert.deepEqual(snapshots[24]?.snapshot, { omitted: 'budget' })
  const tooLarge = await snapshotGitFiles([{ path: 'src/large.ts', sizeBytes: 65537 }], async () => { throw new Error('must not read') })
  assert.deepEqual(tooLarge[0]?.snapshot, { omitted: 'too-large' })
})

test('Git paths refuse case and HFS aliases of metadata and traversal at every depth', async () => {
  const invisible = [0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
    0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f, 0xfeff].map(code => String.fromCodePoint(code))
  const aliases = ['.GIT', '.Git', ...invisible.flatMap(char => [`${char}.git`, `.g${char}it`, `.git${char}`, `.${char}.`, `.${char}`, char])]
  for (const alias of aliases) for (const prefix of ['', 'src/']) {
    const path = `${prefix}${alias}/config`
    assert.equal(isGitSnapshotFiles([{ path, sizeBytes: 1, snapshot: { text: 'x' } }]), false, JSON.stringify(path))
    await assert.rejects(snapshotGitFiles([{ path, sizeBytes: 1 }], async () => {
      assert.fail('metadata and traversal aliases must be refused before reading bytes')
    }), /invalid tracked Git file/)
  }
  for (const path of ['.github/config', '.gitignore', 'src/git/config']) {
    assert.equal(isGitSnapshotFiles([{ path, sizeBytes: 1, snapshot: { text: 'x' } }]), true, path)
  }
})
