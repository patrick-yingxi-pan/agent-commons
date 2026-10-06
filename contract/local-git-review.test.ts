import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseLocalGitReview } from './localGitReview.mjs'

const oid = 'a'.repeat(40)
const textSide = (text = 'review text\n', mode: '100644' | '100755' = '100644') => ({ kind: 'text', text, mode })
const missing = () => ({ kind: 'missing' })
const omitted = (reason: string) => ({ kind: 'omitted', reason })
const file = (path = 'src/readme.txt', staged = 'modified', unstaged = 'modified') => ({
  path, staged, unstaged,
  head: textSide('before\n'), index: textSide('staged\n', '100755'), working: textSide('working\n'),
})
const review = (overrides: any = {}) => ({
  version: 1,
  comparison: 'raw',
  head: { oid, ref: 'refs/heads/main' },
  excludedCount: 0,
  unchangedCount: 0,
  files: [file()],
  ...overrides,
})

test('accepts reader-shaped changed, omitted, missing, sparse, conflict, and unborn/detached results', () => {
  const value = review({
    head: { oid: null, ref: 'refs/heads/feature/review' },
    excludedCount: 3,
    unchangedCount: 2,
    files: [
      { path: 'a.txt', staged: 'added', unstaged: 'deleted', head: missing(), index: textSide('new'), working: missing() },
      { path: 'b.txt', staged: 'unavailable', unstaged: 'unavailable', head: omitted('sparse'), index: omitted('sparse'), working: omitted('sparse') },
      { path: 'c.txt', staged: 'unmerged', unstaged: 'unmerged', head: omitted('unmerged'), index: omitted('unmerged'), working: omitted('unmerged') },
      { path: 'd.txt', staged: 'type-changed', unstaged: 'mode-changed', head: omitted('not-needed'), index: omitted('unsupported'), working: omitted('too-large') },
      { path: 'e.txt', staged: 'modified', unstaged: 'unavailable', head: omitted('budget'), index: omitted('unreadable'), working: omitted('unsupported') },
    ],
  })
  const parsed = parseLocalGitReview(value)
  assert.ok(parsed)
  assert.deepEqual(parsed, value)
  assert.notEqual(parsed, value)
  assert.notEqual(parsed.files, value.files)
  assert.notEqual(parsed.files[0], value.files[0])
  assert.equal(parseLocalGitReview(review({ head: { oid, ref: null } }))?.head.ref, null,
    'a detached HEAD is represented by a nonzero object id and no branch ref')
})

test('returns a fully detached projection', () => {
  const value = review()
  const parsed = parseLocalGitReview(value)
  assert.ok(parsed)
  value.files[0].head.text = 'mutated after parse'
  value.files[0].path = 'changed.txt'
  value.head.oid = 'b'.repeat(40)
  value.files.push(file('z.txt'))
  assert.equal(parsed.files[0].head.kind, 'text')
  if (parsed.files[0].head.kind === 'text') assert.equal(parsed.files[0].head.text, 'before\n')
  assert.equal(parsed.files[0].path, 'src/readme.txt')
  assert.equal(parsed.head.oid, oid)
  assert.equal(parsed.files.length, 1)
})

test('enforces exact closed records, valid relative paths, and sorted unique file order', () => {
  assert.equal(parseLocalGitReview(review({ private: 'secret' })), undefined)
  assert.equal(parseLocalGitReview(review({ files: [file('a'), { ...file('b'), extra: true }] })), undefined)
  for (const path of ['/absolute', '../escape', 'a/../b', '.git/config', 'A/.g\u200cit/config', 'bad\\path', 'bad\npath']) {
    assert.equal(parseLocalGitReview(review({ files: [file(path)] })), undefined, `refuses ${JSON.stringify(path)}`)
  }
  assert.equal(parseLocalGitReview(review({ files: [file('b.txt'), file('a.txt')] })), undefined)
  assert.equal(parseLocalGitReview(review({ files: [file('same.txt'), file('same.txt')] })), undefined)
  assert.equal(parseLocalGitReview(review({ files: [{ ...file(), head: { kind: 'missing', leaked: true } }] })), undefined)
  assert.equal(parseLocalGitReview(review({ files: [{ ...file(), index: omitted('unknown') }] })), undefined)
  assert.equal(parseLocalGitReview(review({ files: [{ ...file(), working: { kind: 'text', text: 'x', mode: '100664' } }] })), undefined)
  assert.equal(parseLocalGitReview(review({ files: [file('ok.txt', 'renamed', 'unchanged')] })), undefined)
})

test('bounds counters, path union, side UTF-8 bytes, and aggregate display bytes', () => {
  assert.equal(parseLocalGitReview(review({ excludedCount: -1 })), undefined)
  assert.equal(parseLocalGitReview(review({ unchangedCount: 0.5 })), undefined)
  assert.equal(parseLocalGitReview(review({ excludedCount: 500, files: [file()] })), undefined)
  assert.equal(parseLocalGitReview(review({ files: Array.from({ length: 501 }, (_, i) => file(`f${String(i).padStart(3, '0')}`)) })), undefined)

  const limit = 'x'.repeat(64 * 1024)
  const exactSide = review({ files: [{ ...file(), head: textSide(limit), index: textSide(limit), working: missing() }] })
  assert.ok(parseLocalGitReview(exactSide), 'two exact 64 KiB sides fit the 128 KiB display budget')
  assert.equal(parseLocalGitReview(review({ files: [{ ...file(), head: textSide(limit), index: textSide(limit), working: textSide('x') }] })), undefined)
  assert.equal(parseLocalGitReview(review({ files: [{ ...file(), head: textSide(`${limit}x`), index: missing(), working: missing() }] })), undefined)
  assert.ok(parseLocalGitReview(review({ files: [{ ...file(), head: textSide('é'.repeat(32 * 1024)), index: missing(), working: missing() }] })))
  assert.equal(parseLocalGitReview(review({ files: [{ ...file(), head: textSide('é'.repeat(32 * 1024 + 1)), index: missing(), working: missing() }] })), undefined)
  assert.equal(parseLocalGitReview(review({ files: [{ ...file(), head: textSide('bad\0text'), index: missing(), working: missing() }] })), undefined)
  assert.equal(parseLocalGitReview(review({ files: [{ ...file(), head: textSide('\ud800'), index: missing(), working: missing() }] })), undefined)
})

test('requires nonzero SHA-1/SHA-256 identity and a safe branch ref consistent with unborn HEAD', () => {
  const longRef = `refs/heads/${Array.from({ length: 8 }, () => 'branch'.repeat(30)).join('/')}`
  assert.equal(parseLocalGitReview(review({ head: { oid, ref: longRef } }))?.head.ref, longRef,
    'the portable boundary accepts the native reader’s bounded multi-component branch refs')
  assert.ok(parseLocalGitReview(review({ head: { oid: 'f'.repeat(64), ref: null } })))
  assert.ok(parseLocalGitReview(review({ head: { oid: null, ref: 'refs/heads/main' } })))
  for (const head of [
    { oid: null, ref: null },
    { oid: '0'.repeat(40), ref: 'refs/heads/main' },
    { oid: 'A'.repeat(40), ref: 'refs/heads/main' },
    { oid: 'f'.repeat(39), ref: null },
    { oid, ref: 'refs/tags/v1' },
    { oid, ref: 'refs/heads/../main' },
    { oid, ref: 'refs/heads/a.lock' },
    { oid, ref: 'refs/heads/.hidden' },
    { oid, ref: 'refs/heads/a b' },
  ]) assert.equal(parseLocalGitReview(review({ head })), undefined, `refuses ${JSON.stringify(head)}`)
})

test('rejects getters, inherited fields, symbols, sparse arrays, and accessor array entries without invoking getters', () => {
  let calls = 0
  const withGetter = review()
  Object.defineProperty(withGetter, 'files', { enumerable: true, get() { calls += 1; return [] } })
  assert.equal(parseLocalGitReview(withGetter), undefined)
  assert.equal(calls, 0)

  const sideGetter = review()
  Object.defineProperty(sideGetter.files[0].head, 'kind', { enumerable: true, get() { calls += 1; return 'missing' } })
  assert.equal(parseLocalGitReview(sideGetter), undefined)
  assert.equal(calls, 0)

  const arrayGetter = review({ files: [file()] })
  Object.defineProperty(arrayGetter.files, '0', { enumerable: true, get() { calls += 1; return file() } })
  assert.equal(parseLocalGitReview(arrayGetter), undefined)
  assert.equal(calls, 0)

  const inherited = review()
  Object.setPrototypeOf(inherited, { secret: true })
  assert.equal(parseLocalGitReview(inherited), undefined)
  const inheritedFile = review()
  Object.setPrototypeOf(inheritedFile.files[0], { owner: 'hidden' })
  assert.equal(parseLocalGitReview(inheritedFile), undefined)

  const symbol = review()
  symbol[Symbol('extra')] = true
  assert.equal(parseLocalGitReview(symbol), undefined)
  const sparse = review({ files: Array(1) })
  assert.equal(parseLocalGitReview(sparse), undefined)
  const arrayExtra = review({ files: [file()] })
  ;(arrayExtra.files as any).extra = true
  assert.equal(parseLocalGitReview(arrayExtra), undefined)
})
