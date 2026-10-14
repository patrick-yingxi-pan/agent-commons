import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LocalGitFileComparison } from '../../contract/localGitFileComparison.mjs'
import { ATTACHMENT_TEXT_FILE_BYTES } from '../../contract/attachmentInput.ts'
import { prepareGitFileComparisonCopy } from './gitFileComparisonCopy.ts'

function comparison(overrides: Partial<LocalGitFileComparison> = {}): LocalGitFileComparison {
  return {
    version: 1, scope: 'file-comparison', path: 'src/selected.ts', comparison: 'staged',
    head: { oid: 'a'.repeat(40), ref: 'refs/heads/main' },
    status: 'ready', change: 'modified',
    before: { kind: 'text', text: '', mode: '100644' },
    after: { kind: 'text', text: 'new', mode: '100644' },
    ...overrides,
  }
}

test('file comparison copy preserves captured metadata and exact empty/text sides within the ordinary limit', () => {
  const result = prepareGitFileComparisonCopy({ comparison: comparison(), readAt: 123, repositoryName: 'Project repo' })
  assert.equal(result.status, 'ready')
  if (result.status !== 'ready') return
  assert.equal(result.name, 'git-staged-src__selected.ts.comparison.json')
  assert.equal(result.sizeBytes, new TextEncoder().encode(result.text).byteLength)
  assert.ok(result.sizeBytes <= ATTACHMENT_TEXT_FILE_BYTES)
  const serialized = JSON.parse(result.text)
  assert.equal(serialized.kind, 'git-file-comparison-copy')
  assert.equal(serialized.repositoryName, 'Project repo')
  assert.equal(serialized.capturedAt, new Date(123).toISOString())
  assert.equal(serialized.path, 'src/selected.ts')
  assert.equal(serialized.comparison, 'staged')
  assert.equal(serialized.change, 'modified')
  assert.deepEqual(serialized.before, { kind: 'text', text: '', mode: '100644' })
  assert.deepEqual(serialized.after, { kind: 'text', text: 'new', mode: '100644' })
})

test('file comparison copy retains unchanged and missing/omitted side distinctions', () => {
  const unchanged = prepareGitFileComparisonCopy({ comparison: comparison({
    comparison: 'unstaged', change: 'unchanged',
    before: { kind: 'text', text: '', mode: '100644' }, after: { kind: 'text', text: '', mode: '100644' },
  }), readAt: 456, repositoryName: 'repo' })
  assert.equal(unchanged.status, 'ready', 'an unchanged capture is still an honest explicit comparison')
  if (unchanged.status !== 'ready') return
  const serialized = JSON.parse(unchanged.text)
  assert.equal(serialized.change, 'unchanged')
  assert.deepEqual(serialized.before, { kind: 'text', text: '', mode: '100644' })
  assert.deepEqual(serialized.after, serialized.before)
  const deleted = prepareGitFileComparisonCopy({ comparison: comparison({
    change: 'deleted', before: { kind: 'omitted', reason: 'unsupported' }, after: { kind: 'missing' },
  }), readAt: 456, repositoryName: 'repo' })
  assert.equal(deleted.status, 'ready')
  assert.deepEqual(JSON.parse(deleted.text).before, { kind: 'omitted', reason: 'unsupported' })
  assert.deepEqual(JSON.parse(deleted.text).after, { kind: 'missing' })
})

test('file comparison copy refuses unavailable, malformed, or oversized captures without truncation', () => {
  const unavailable = comparison({ status: 'unavailable', reason: 'ignored' })
  assert.deepEqual(prepareGitFileComparisonCopy({ comparison: unavailable, readAt: 1, repositoryName: 'repo' }), { status: 'unavailable' })
  const malformed = { ...comparison(), untrusted: true } as unknown as LocalGitFileComparison
  assert.deepEqual(prepareGitFileComparisonCopy({ comparison: malformed, readAt: 1, repositoryName: 'repo' }), { status: 'unavailable' })
  const large = comparison({
    before: { kind: 'text', text: 'x'.repeat(33_000), mode: '100644' },
    after: { kind: 'text', text: 'y'.repeat(33_000), mode: '100644' },
  })
  assert.deepEqual(prepareGitFileComparisonCopy({ comparison: large, readAt: 1, repositoryName: 'repo' }), { status: 'too-large' })
})
