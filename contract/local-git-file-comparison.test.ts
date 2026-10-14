import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseLocalGitFileComparison,
  parseLocalGitFileComparisonCancel,
  parseLocalGitFileComparisonRequest,
  parseLocalGitFileComparisonSelection,
} from './localGitFileComparison.mjs'

const operationId = '4ca5af48-2a21-4c80-9bfe-f627ef872e23'
const head = { oid: 'a'.repeat(40), ref: 'refs/heads/main' }
const text = (body: string, mode: '100644' | '100755' = '100644') => ({ kind: 'text', text: body, mode })
const missing = () => ({ kind: 'missing' })
const omitted = (reason: string) => ({ kind: 'omitted', reason })
const ready = (overrides: Record<string, unknown> = {}) => ({
  version: 1, scope: 'file-comparison', path: 'src/a.txt', comparison: 'staged', head,
  status: 'ready', change: 'modified', before: text('before\r\n'), after: text('after\r\n'), ...overrides,
})

test('file comparison selections, requests, and cancellations are closed and detached', () => {
  const selection = { path: 'src/a.txt', comparison: 'unstaged' }
  assert.deepEqual(parseLocalGitFileComparisonSelection(selection), selection)
  assert.deepEqual(parseLocalGitFileComparisonRequest({ scope: 'file-comparison', operationId, ...selection }),
    { scope: 'file-comparison', operationId, ...selection })
  assert.deepEqual(parseLocalGitFileComparisonCancel({ scope: 'file-comparison', operationId }),
    { scope: 'file-comparison', operationId })
  for (const value of [
    { ...selection, extra: true }, { path: '../secret', comparison: 'staged' },
    { path: 'src/a.txt', comparison: 'raw' }, { path: `x/${'é'.repeat(2048)}.txt`, comparison: 'staged' },
    { path: 'bad\ud800.txt', comparison: 'staged' },
  ]) assert.equal(parseLocalGitFileComparisonSelection(value), undefined)
  for (const value of [
    { scope: 'wrong', operationId, ...selection }, { scope: 'file-comparison', operationId: 'not-uuid', ...selection },
    { scope: 'file-comparison', operationId, ...selection, extra: true },
  ]) assert.equal(parseLocalGitFileComparisonRequest(value), undefined)
  for (const value of [
    { scope: 'wrong', operationId }, { scope: 'file-comparison', operationId: 'not-uuid' },
    { scope: 'file-comparison', operationId, extra: true },
  ]) assert.equal(parseLocalGitFileComparisonCancel(value), undefined)
  const accessor = Object.defineProperty({ scope: 'file-comparison', operationId, ...selection }, 'path', {
    enumerable: true, get() { throw new Error('must not invoke') },
  })
  assert.equal(parseLocalGitFileComparisonRequest(accessor), undefined)
})

test('ready comparisons preserve exact selected sides, missing-vs-empty, and detach nested values', () => {
  const value = ready({ change: 'added', before: missing(), after: text('') })
  const parsed = parseLocalGitFileComparison(value)
  assert.deepEqual(parsed, value)
  assert.notStrictEqual(parsed, value)
  assert.notStrictEqual(parsed?.head, value.head)
  assert.notStrictEqual(parsed?.after, value.after)
  value.after.text = 'changed later'
  value.head.oid = 'b'.repeat(40)
  assert.equal(parsed?.after.kind, 'text')
  if (parsed?.after.kind === 'text') assert.equal(parsed.after.text, '')
  assert.equal(parsed?.head.oid, 'a'.repeat(40))
})

test('unavailable results are closed, typed, and keep explicit request identity', () => {
  for (const reason of ['ignored', 'not-tracked', 'not-in-index', 'sparse', 'unmerged']) {
    const value = { version: 1, scope: 'file-comparison', path: 'a.txt', comparison: reason === 'not-tracked' ? 'staged' : 'unstaged',
      head: { oid: null, ref: 'refs/heads/main' }, status: 'unavailable', reason }
    assert.deepEqual(parseLocalGitFileComparison(value), value)
  }
  for (const reason of ['unsupported', 'changed', 'budget', '']) {
    assert.equal(parseLocalGitFileComparison({ version: 1, scope: 'file-comparison', path: 'a.txt', comparison: 'staged',
      head, status: 'unavailable', reason }), undefined)
  }
  assert.equal(parseLocalGitFileComparison({ version: 1, scope: 'file-comparison', path: 'a.txt', comparison: 'unstaged',
    head, status: 'unavailable', reason: 'not-tracked' }), undefined)
  assert.equal(parseLocalGitFileComparison({ version: 1, scope: 'file-comparison', path: 'a.txt', comparison: 'staged',
    head, status: 'unavailable', reason: 'not-in-index' }), undefined)
  assert.equal(parseLocalGitFileComparison({ ...ready(), extra: 'not allowed' }), undefined)
  assert.equal(parseLocalGitFileComparison({ version: 1, scope: 'file-comparison', path: 'a.txt', comparison: 'staged',
    head, status: 'unavailable', reason: 'ignored', before: missing() }), undefined)
})

test('ready sides permit only honest content omissions and enforce UTF-8 budgets per side and in total', () => {
  for (const reason of ['unsupported', 'too-large', 'unreadable']) {
    assert.ok(parseLocalGitFileComparison(ready({ change: 'deleted', before: omitted(reason), after: missing() })), reason)
  }
  for (const reason of ['budget', 'not-needed', 'sparse', 'unmerged', 'unknown']) {
    assert.equal(parseLocalGitFileComparison(ready({ before: omitted(reason), after: missing() })), undefined, reason)
  }
  const max = 'x'.repeat(64 * 1024)
  assert.ok(parseLocalGitFileComparison(ready({ change: 'unchanged', before: text(max), after: text(max) })), 'two exact 64 KiB sides fit')
  assert.equal(parseLocalGitFileComparison(ready({ before: text(`${max}x`), after: missing() })), undefined)
  assert.equal(parseLocalGitFileComparison(ready({ before: text('é'.repeat(32 * 1024 + 1)), after: missing() })), undefined,
    'UTF-8 bytes, not JS character count, determine side limits')
  assert.equal(parseLocalGitFileComparison(ready({ before: text('\ud800'), after: missing() })), undefined)
  assert.equal(parseLocalGitFileComparison(ready({ before: text('bad\0text'), after: missing() })), undefined)
})

test('ready change labels must agree with exact side presence, mode, and text while allowing omitted staged bodies', () => {
  assert.ok(parseLocalGitFileComparison(ready({ change: 'added', before: missing(), after: text('new') })))
  assert.ok(parseLocalGitFileComparison(ready({ change: 'deleted', before: text('old'), after: missing() })))
  assert.ok(parseLocalGitFileComparison(ready({ change: 'deleted', before: omitted('too-large'), after: missing() })))
  assert.ok(parseLocalGitFileComparison(ready({ change: 'modified', before: omitted('unreadable'), after: omitted('too-large') })),
    'staged change metadata remains usable when both content bodies are omitted')
  assert.equal(parseLocalGitFileComparison(ready({ before: missing(), after: text('new') })), undefined)
  assert.equal(parseLocalGitFileComparison(ready({ change: 'modified', before: missing(), after: missing() })), undefined)
  assert.equal(parseLocalGitFileComparison(ready({ change: 'modified', before: text('same'), after: text('same') })), undefined)
  assert.equal(parseLocalGitFileComparison(ready({ change: 'unchanged', before: text('left'), after: text('right') })), undefined)
  assert.equal(parseLocalGitFileComparison(ready({ change: 'modified', before: text('same', '100644'), after: text('same', '100755') })), undefined)
  assert.equal(parseLocalGitFileComparison(ready({ change: 'unavailable' })), undefined,
    'staged comparisons cannot have an unavailable change label')
  assert.equal(parseLocalGitFileComparison(ready({ change: 'unmerged' })), undefined,
    'unmerged is a top-level unavailable result, never a ready comparison')
  assert.equal(parseLocalGitFileComparison(ready({ comparison: 'unstaged', change: 'added', before: missing(), after: text('new') })), undefined,
    'an unstaged comparison requires an index-side before value')
})

test('selected paths enforce the native 64-component traversal cap', () => {
  const path64 = [...Array.from({ length: 63 }, (_, index) => `d${index}`), 'file.txt'].join('/')
  const path65 = [...Array.from({ length: 64 }, (_, index) => `d${index}`), 'file.txt'].join('/')
  assert.ok(parseLocalGitFileComparisonSelection({ path: path64, comparison: 'staged' }))
  assert.equal(parseLocalGitFileComparisonSelection({ path: path65, comparison: 'staged' }), undefined)
})

test('file comparison rejects accessors, inherited keys, invalid sides, modes, and changes', () => {
  let calls = 0
  const accessor = Object.defineProperty(ready(), 'before', { enumerable: true, get() { calls += 1; return missing() } })
  assert.equal(parseLocalGitFileComparison(accessor), undefined)
  assert.equal(calls, 0)
  const inherited = ready()
  Object.setPrototypeOf(inherited, { secret: true })
  assert.equal(parseLocalGitFileComparison(inherited), undefined)
  for (const value of [
    ready({ change: 'renamed' }), ready({ comparison: 'raw' }), ready({ path: '../escape' }),
    ready({ before: { kind: 'text', text: 'x', mode: '100664' } }),
    ready({ after: { kind: 'missing', hidden: true } }),
  ]) assert.equal(parseLocalGitFileComparison(value), undefined)
})
