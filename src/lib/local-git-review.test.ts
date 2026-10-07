import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gitReviewSide, gitReviewComparison, gitReviewEntries, GIT_CHANGE_LABELS } from './localGitReview.ts'
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

test('rename grouping preserves raw rows and independent unstaged input while comparing old HEAD with new index', () => {
  const side = (text: string): GitReviewSide => ({ kind: 'text', text, mode: '100644' })
  const previous: LocalGitReviewFile = { path: 'old.ts', staged: 'deleted', unstaged: 'unchanged', head: side('before'), index: { kind: 'missing' }, working: { kind: 'missing' } }
  const file: LocalGitReviewFile = { path: 'new.ts', staged: 'added', unstaged: 'modified', head: { kind: 'missing' }, index: side('after'), working: side('working') }
  const files = [file, previous]
  const snapshot = structuredClone(files)
  const suggestion = { fromPath: previous.path, toPath: file.path, match: 'similar' as const, sharedPercent: 85 }
  assert.deepEqual(gitReviewEntries(files, 'staged', [suggestion]), [{ file, previous, suggestion }])
  assert.deepEqual(gitReviewEntries(files, 'staged'), [{ file }, { file: previous }])
  assert.deepEqual(gitReviewEntries(files, 'unstaged', [suggestion]), [{ file }])
  assert.deepEqual(gitReviewComparison(file, 'staged', previous), {
    before: { label: 'HEAD · old.ts · Regular file', text: 'before' },
    after: { label: 'Index · new.ts · Regular file', text: 'after' },
  })
  assert.deepEqual(gitReviewComparison(file, 'unstaged', previous), {
    before: { label: 'Index · Regular file', text: 'after' }, after: { label: 'Working tree · Regular file', text: 'working' },
  })
  assert.deepEqual(files, snapshot)
})

test('staged and unstaged comparison use the exact separate baseline sides and disclose executable mode', () => {
  const side = (text: string, mode = '100644'): GitReviewSide => ({ kind: 'text', text, mode: mode as '100644' | '100755' })
  const file: LocalGitReviewFile = { path: 'main.ts', staged: 'modified', unstaged: 'mode-changed', head: side('head'), index: side('staged'), working: side('staged', '100755') }
  assert.deepEqual(gitReviewComparison(file, 'staged'), { before: { label: 'HEAD · Regular file', text: 'head' }, after: { label: 'Index · Regular file', text: 'staged' } })
  assert.deepEqual(gitReviewComparison(file, 'unstaged'), { before: { label: 'Index · Regular file', text: 'staged' }, after: { label: 'Working tree · Executable', text: 'staged' } })
  assert.deepEqual(Object.keys(GIT_CHANGE_LABELS).sort(), ['added', 'deleted', 'mode-changed', 'modified', 'type-changed', 'unavailable', 'unchanged', 'unmerged'])
})
