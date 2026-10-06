import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gitReviewSide, gitReviewComparison, GIT_CHANGE_LABELS } from './localGitReview.ts'
import type { GitReviewSide, LocalGitReviewFile } from '../../contract/localGitReview.mjs'

test('review projection distinguishes missing, empty and unavailable text without fabricating deletions', () => {
  assert.deepEqual(gitReviewSide({ kind: 'missing' }, 'HEAD'), { label: 'HEAD', notice: 'Not present in this version.', missing: true })
  assert.deepEqual(gitReviewSide({ kind: 'text', text: '', mode: '100644' }, 'Index'), { label: 'Index · Regular file', text: '' })
  const reasons = ['unsupported', 'too-large', 'budget', 'unreadable', 'unmerged', 'sparse', 'not-needed'] as const
  for (const reason of reasons) {
    const side = gitReviewSide({ kind: 'omitted', reason }, 'Working tree')
    assert.equal(side.text, undefined)
    assert.equal(typeof side.notice, 'string')
    assert.ok(side.notice!.length > 20)
  }
  assert.equal(new Set(reasons.map(reason => gitReviewSide({ kind: 'omitted', reason }, 'Working tree').notice)).size, reasons.length)
})

test('staged and unstaged comparison use the exact separate baseline sides and disclose executable mode', () => {
  const side = (text: string, mode = '100644'): GitReviewSide => ({ kind: 'text', text, mode: mode as '100644' | '100755' })
  const file: LocalGitReviewFile = { path: 'main.ts', staged: 'modified', unstaged: 'mode-changed', head: side('head'), index: side('staged'), working: side('staged', '100755') }
  assert.deepEqual(gitReviewComparison(file, 'staged'), { before: { label: 'HEAD · Regular file', text: 'head' }, after: { label: 'Index · Regular file', text: 'staged' } })
  assert.deepEqual(gitReviewComparison(file, 'unstaged'), { before: { label: 'Index · Regular file', text: 'staged' }, after: { label: 'Working tree · Executable', text: 'staged' } })
  assert.deepEqual(Object.keys(GIT_CHANGE_LABELS).sort(), ['added', 'deleted', 'mode-changed', 'modified', 'type-changed', 'unavailable', 'unchanged', 'unmerged'])
})
