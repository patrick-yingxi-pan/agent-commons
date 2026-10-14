import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LocalGitReview } from '../../contract/localGitReview.mjs'
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
