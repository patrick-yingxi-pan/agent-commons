import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ATTACHMENT_TEXT_FILE_BYTES } from '../../contract/attachmentInput.ts'
import type { GitReviewSide, LocalGitReview, LocalGitReviewFile } from '../../contract/localGitReview.mjs'
import { prepareGitComparisonCopy } from './gitComparisonCopy.ts'

const missing: GitReviewSide = { kind: 'missing' }
const omitted: GitReviewSide = { kind: 'omitted', reason: 'sparse' }
const side = (text: string, mode: '100644' | '100755' = '100644'): GitReviewSide => ({ kind: 'text', text, mode })

function review(files: LocalGitReviewFile[], head = { ref: 'refs/heads/main', oid: 'a'.repeat(40) }): LocalGitReview {
  return { version: 1, comparison: 'raw', head, excludedCount: 0, unchangedCount: 0, files }
}

function file(path: string, values: Partial<LocalGitReviewFile> = {}): LocalGitReviewFile {
  return { path, staged: 'modified', unstaged: 'modified', head: side('head\r\n'), index: side('index\r\n'), working: side('working\r\n'), ...values }
}

function prepare(value: LocalGitReview, options: Partial<Parameters<typeof prepareGitComparisonCopy>[0]> = {}) {
  return prepareGitComparisonCopy({
    review: value, comparison: 'staged', path: 'src/main.ts', readAt: Date.UTC(2026, 9, 14), repositoryName: 'Agent Commons', ...options,
  })
}

test('staged and unstaged copies use their exact comparison sides and preserve CRLF, Unicode and mode', () => {
  const value = review([file('src/main.ts', {
    staged: 'modified', unstaged: 'mode-changed',
    head: side('old\r\n東京\r\n'), index: side('new\r\n猫\r\n'), working: side('new\r\n猫\r\n', '100755'),
  })])
  const staged = prepare(value)
  const unstaged = prepare(value, { comparison: 'unstaged' })
  assert.equal(staged.status, 'ready')
  assert.equal(unstaged.status, 'ready')
  if (staged.status !== 'ready' || unstaged.status !== 'ready') return
  const stagedJson = JSON.parse(staged.text)
  const unstagedJson = JSON.parse(unstaged.text)
  assert.deepEqual(stagedJson.before, { kind: 'text', text: 'old\r\n東京\r\n', mode: '100644' })
  assert.deepEqual(stagedJson.after, { kind: 'text', text: 'new\r\n猫\r\n', mode: '100644' })
  assert.deepEqual(unstagedJson.before, stagedJson.after)
  assert.deepEqual(unstagedJson.after, { kind: 'text', text: 'new\r\n猫\r\n', mode: '100755' })
  assert.equal(staged.name, 'git-staged-src__main.ts.comparison.json')
  assert.equal(staged.sizeBytes, new TextEncoder().encode(staged.text).byteLength)
})

test('missing, empty, and omitted sides remain distinct in the saved copy', () => {
  const value = review([
    file('empty.ts', { staged: 'modified', head: side(''), index: side('') }),
    file('missing.ts', { staged: 'added', head: missing, index: side('') }),
    file('omitted.ts', { staged: 'modified', head: omitted, index: side('known') }),
  ])
  const empty = prepare(value, { path: 'empty.ts' })
  const addedEmpty = prepare(value, { path: 'missing.ts' })
  const sparse = prepare(value, { path: 'omitted.ts' })
  assert.equal(empty.status, 'ready')
  assert.equal(addedEmpty.status, 'ready')
  assert.equal(sparse.status, 'ready')
  if (empty.status === 'ready' && addedEmpty.status === 'ready' && sparse.status === 'ready') {
    assert.deepEqual(JSON.parse(empty.text).before, { kind: 'text', text: '', mode: '100644' })
    assert.deepEqual(JSON.parse(addedEmpty.text).before, { kind: 'missing' })
    assert.deepEqual(JSON.parse(sparse.text).before, { kind: 'omitted', reason: 'sparse' })
  }
})

test('exact and edited rename groupings are labeled as suggestions, never recorded Git operations', () => {
  const common = 'alpha line\nbeta line\ngamma line\ndelta line\n'
  const exact = [
    file('a-old.ts', { staged: 'deleted', head: side(common), index: missing, working: missing }),
    file('b-new.ts', { staged: 'added', head: missing, index: side(common), working: side(common) }),
  ]
  const exactCopy = prepare(review(exact), { path: 'b-new.ts', previousPath: 'a-old.ts' })
  assert.equal(exactCopy.status, 'ready')
  if (exactCopy.status === 'ready') {
    const data = JSON.parse(exactCopy.text)
    assert.deepEqual(data.paths, { before: 'a-old.ts', after: 'b-new.ts' })
    assert.equal(data.provenance, 'possible rename, not recorded Git operation')
    assert.deepEqual(data.before, { kind: 'text', text: common, mode: '100644' })
    assert.deepEqual(data.after, { kind: 'text', text: common, mode: '100644' })
  }

  const edited = [
    file('c-old.ts', { staged: 'deleted', head: side(common), index: missing, working: missing }),
    file('d-new.ts', { staged: 'added', head: missing, index: side(`${common}edited\n`), working: side(`${common}edited\n`) }),
  ]
  const editedCopy = prepare(review(edited), { path: 'd-new.ts', previousPath: 'c-old.ts' })
  assert.equal(editedCopy.status, 'ready')
  if (editedCopy.status === 'ready') assert.equal(JSON.parse(editedCopy.text).provenance, 'possible rename, not recorded Git operation')
  assert.deepEqual(prepare(review(exact), { path: 'b-new.ts', previousPath: 'other.ts' }), { status: 'unavailable' })
  assert.deepEqual(prepare(review(exact), { path: 'b-new.ts', previousPath: 'a-old.ts', comparison: 'unstaged' }), { status: 'unavailable' })
})

test('unchanged, missing, invalid selection and invalid copy metadata are unavailable', () => {
  const unchanged = file('src/main.ts', { staged: 'unchanged' })
  const changed = file('src/main.ts')
  assert.equal(prepare(review([changed])).status, 'ready',
    'each rejection starts from a valid captured review with an existing changed selection')
  assert.deepEqual(prepare(review([unchanged])), { status: 'unavailable' })
  assert.deepEqual(prepare(review([changed]), { path: 'absent.ts' }), { status: 'unavailable' })
  assert.deepEqual(prepare(review([changed]), { comparison: 'head' as 'staged' }), { status: 'unavailable' })
  assert.deepEqual(prepare(review([changed]), { readAt: Number.NaN }), { status: 'unavailable' })
  assert.deepEqual(prepare(review([changed]), { repositoryName: '  ' }), { status: 'unavailable' })
  assert.deepEqual(prepare({ ...review([changed]), head: { ref: null, oid: null } }), { status: 'unavailable' })
})

test('the full pretty UTF-8 JSON, including metadata and escaping, obeys the shared file byte ceiling', () => {
  const base = review([file('src/main.ts', { head: side('before'), index: side('after'), working: side('after') })])
  const ordinary = prepare(base, { repositoryName: 'é" repo' })
  assert.equal(ordinary.status, 'ready')
  if (ordinary.status !== 'ready') return
  assert.equal(ordinary.sizeBytes, new TextEncoder().encode(ordinary.text).byteLength)
  assert.equal(JSON.parse(ordinary.text).repositoryName, 'é" repo')
  // Derive the exact ASCII boundary by measuring the completed JSON, so every
  // fixed field, pretty-print byte, and escaped value contributes to the limit.
  let low = 0
  let high = ATTACHMENT_TEXT_FILE_BYTES
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const result = prepare(base, { repositoryName: 'x'.repeat(middle) })
    if (result.status === 'ready') low = middle
    else high = middle - 1
  }
  const boundary = prepare(base, { repositoryName: 'x'.repeat(low) })
  const over = prepare(base, { repositoryName: 'x'.repeat(low + 1) })
  assert.equal(boundary.status, 'ready')
  if (boundary.status === 'ready') assert.equal(boundary.sizeBytes, ATTACHMENT_TEXT_FILE_BYTES)
  assert.deepEqual(over, { status: 'too-large' })
})

test('long repository-relative paths produce bounded readable attachment labels', () => {
  const longPath = `src/${'a'.repeat(250)}/tail.ts`
  const result = prepare(review([file(longPath)]), { path: longPath })
  assert.equal(result.status, 'ready')
  if (result.status === 'ready') {
    assert.ok(result.name.length <= 160)
    assert.ok(result.name.startsWith('git-staged-src__'))
    assert.ok(result.name.includes('…'))
    assert.ok(result.name.endsWith('__tail.ts.comparison.json'))
  }
})

test('output is detached from later source mutation and contains no review or connection extras', () => {
  const source = review([file('src/main.ts')])
  const snapshot = structuredClone(source)
  const result = prepare(source)
  assert.equal(result.status, 'ready')
  if (result.status !== 'ready') return
  source.files[0].head = side('mutated')
  source.files[0].path = 'changed.ts'
  assert.deepEqual(source.files[0].head, side('mutated'))
  assert.deepEqual(JSON.parse(result.text).before, snapshot.files[0].head)
  assert.deepEqual(Object.keys(JSON.parse(result.text)), [
    'version', 'kind', 'repositoryName', 'capturedAt', 'head', 'comparison', 'paths', 'change', 'before', 'after',
  ])
})
