import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'

const source = (path: string) => stripComments(read(join(ROOT, path)))

test('single-file compare stays reachable independently of whole-review capture and reads only on explicit submit', () => {
  const review = source('src/components/LocalGitReview.tsx')
  const panel = source('src/components/LocalGitFileComparison.tsx')
  assert.ok(review.includes('<LocalGitFileComparison id={id}'), 'the input is rendered outside the conditional captured-review result')
  assert.ok(review.indexOf('<LocalGitFileComparison id={id}') < review.indexOf('{result && <div data-local-git-review-result'),
    'the selected-file action remains available when whole-repository review is absent or failed')
  assert.ok(panel.includes('onSubmit={compare}'))
  assert.ok(panel.includes('void localGitFileComparisons.read(id)'))
  assert.ok(panel.includes('onChange={event => localGitFileComparisons.setDraftPath(id, event.target.value)}'))
  assert.ok(panel.includes('localGitFileComparisons.setComparison(id, event.target.value as GitComparison)'))
  assert.ok(!/onChange=\{[^}]*localGitFileComparisons\.read/.test(panel), 'editing never performs an implicit native read')
  assert.ok(panel.includes('result.status === \'unavailable\''), 'the UI preserves explicit unavailable states')
  assert.ok(panel.includes('result.change === \'unchanged\''), 'unchanged differs from unavailable')
  assert.ok(panel.includes('sides={{'))
  assert.ok(review.includes('data-local-git-whole-review') && review.includes('Whole-repository review'),
    'the independent whole-repository action and failure have a named scope beside successful single-file output')
})

test('single-file Attach uses captured comparison identity and the shared conversation-only saved-copy funnel', () => {
  const panel = source('src/components/LocalGitFileComparison.tsx')
  const receipts = source('src/controller/gitComparisonReceiptsCore.ts')
  assert.ok(panel.includes('gitComparisonReceipts.fileReceipt(result)'))
  assert.ok(panel.includes('live.result === result && live.status === \'ready\''))
  assert.ok(panel.includes('live.draftPath === result?.path && live.comparison === result?.comparison'))
  assert.ok(panel.includes('<LocalSavedCopyAction source="git-review"'))
  assert.ok(panel.includes('actionLabel="Attach this comparison"'))
  assert.ok(panel.includes('does not send a message or call the model'))
  assert.ok(receipts.includes('const receiptsByFileComparison = new WeakMap<LocalGitFileComparison, Map<string, number>>()'))
  assert.ok(receipts.includes('const created = nextReceipt++'))
})
