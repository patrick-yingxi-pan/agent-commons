import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LocalGitReview } from '../../contract/localGitReview.mjs'
import type { LocalGitFileComparison } from '../../contract/localGitFileComparison.mjs'
import { createGitComparisonReceiptsCore } from './gitComparisonReceiptsCore.ts'

function review(text: string): LocalGitReview {
  return {
    version: 1,
    comparison: 'raw',
    head: { oid: null, ref: null },
    excludedCount: 0,
    unchangedCount: 0,
    files: [{
      path: 'selected.txt', staged: 'modified', unstaged: 'modified',
      head: { kind: 'text', text, mode: '100644' },
      index: { kind: 'text', text, mode: '100644' },
      working: { kind: 'text', text, mode: '100644' },
    }],
  }
}

function fileComparison(path: string, comparison: 'staged' | 'unstaged' = 'staged'): LocalGitFileComparison {
  return { version: 1, scope: 'file-comparison', path, comparison,
    head: { oid: null, ref: 'refs/heads/main' }, status: 'ready', change: 'modified',
    before: { kind: 'text', text: 'old', mode: '100644' }, after: { kind: 'text', text: 'new', mode: '100644' } }
}

test('comparison receipt reuses identity when switching away and back within one review', () => {
  const core = createGitComparisonReceiptsCore()
  const captured = review('private file bytes are not a receipt key')
  const first = core.receipt(captured, 'staged', 'selected.txt')
  const other = core.receipt(captured, 'unstaged', 'selected.txt')
  assert.notEqual(first, other, 'staged and unstaged selections have separate namespaces')
  assert.equal(core.receipt(captured, 'staged', 'selected.txt'), first,
    'returning to the exact comparison and path retains its in-memory retry identity')
})

test('comparison receipts distinguish review object lifetime, including an identical clone', () => {
  const core = createGitComparisonReceiptsCore()
  const captured = review('same text')
  const clone = structuredClone(captured)
  assert.notStrictEqual(clone, captured)
  const originalReceipt = core.receipt(captured, 'staged', 'selected.txt')
  const clonedReceipt = core.receipt(clone, 'staged', 'selected.txt')
  assert.notEqual(clonedReceipt, originalReceipt,
    'a fresh capture object cannot inherit a prior capture receipt even when its content is identical')
  assert.equal(core.receipt(captured, 'staged', 'selected.txt'), originalReceipt)
  assert.equal(core.receipt(clone, 'staged', 'selected.txt'), clonedReceipt)
})

test('comparison receipt keys distinguish paths and optional rename previous paths without delimiter collisions', () => {
  const core = createGitComparisonReceiptsCore()
  const captured = review('not retained by selection metadata')
  const selections = [
    core.receipt(captured, 'staged', 'folder:name', 'old'),
    core.receipt(captured, 'staged', 'folder', 'name:old'),
    core.receipt(captured, 'staged', 'folder:name'),
    core.receipt(captured, 'staged', 'folder:name', ''),
    core.receipt(captured, 'unstaged', 'folder:name', 'old'),
  ]
  assert.equal(new Set(selections).size, selections.length,
    'delimiter-bearing paths, absent versus present rename source, and comparison namespace cannot collide')
  assert.ok(selections.every(receipt => Number.isSafeInteger(receipt) && receipt > 0))
})

test('selection receipt numbers increase globally and content changes do not change a review selection identity', () => {
  const core = createGitComparisonReceiptsCore()
  const captured = review('first contents')
  const receipt = core.receipt(captured, 'staged', 'selected.txt')
  captured.files[0]!.working = { kind: 'text', text: 'changed contents', mode: '100644' }
  assert.equal(core.receipt(captured, 'staged', 'selected.txt'), receipt,
    'the receipt key depends only on review object identity and selection metadata')
  const next = core.receipt(captured, 'staged', 'another.txt')
  const otherReview = core.receipt(review('other contents'), 'staged', 'selected.txt')
  assert.ok(next > receipt)
  assert.ok(otherReview > next)
})

test('single-file and whole-review receipts share one global allocator without retaining captured bytes', () => {
  const core = createGitComparisonReceiptsCore()
  const reviewReceipt = core.receipt(review('review bytes'), 'staged', 'file.txt')
  const captured = fileComparison('file.txt')
  const fileReceipt = core.fileReceipt(captured)
  const unstagedReceipt = core.fileReceipt(fileComparison('file.txt', 'unstaged'))
  assert.ok(reviewReceipt < fileReceipt && fileReceipt < unstagedReceipt,
    'all Git comparison kinds use the same monotonic receipt sequence')
  assert.equal(core.fileReceipt(captured), fileReceipt, 'the exact captured object retains its retry identity')
  assert.notEqual(core.fileReceipt(structuredClone(captured)), fileReceipt,
    'a fresh capture cannot inherit an earlier selection receipt')
  assert.deepEqual(Object.keys(captured).sort(), ['comparison', 'head', 'path', 'scope', 'status', 'version', 'before', 'after', 'change'].sort(),
    'receipt creation does not add metadata or bytes to the captured object')
})
