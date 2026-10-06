import test from 'node:test'
import assert from 'node:assert/strict'
import { diffLines } from './lineDiff.ts'
import { DIFF_PAGE_ROWS, textDiffInput, textDiffPages } from './textDiff.ts'

test('line review treats only declared absence as empty, never unknown or omitted text', () => {
  const text = { label: 'New', text: 'body\n' }
  const missing = { label: 'Old', notice: 'Not present', missing: true as const }
  const omitted = { label: 'Old', notice: 'Unreadable' }
  assert.deepEqual(textDiffInput({ before: missing, after: text }), ['', 'body\n'])
  assert.deepEqual(textDiffInput({ before: text, after: missing }), ['body\n', ''])
  assert.deepEqual(textDiffInput({ before: { label: 'Empty', text: '' }, after: text }), ['', 'body\n'])
  assert.equal(textDiffInput({ before: omitted, after: text }), undefined)
  assert.equal(textDiffInput({ before: text, after: omitted }), undefined)
  assert.equal(textDiffInput({ before: missing, after: omitted }), undefined)
})

test('bounded review pages retain every exact row and repeat original hunk ranges on continuations', () => {
  const before = Array.from({ length: 250 }, (_, i) => `old-${i}\n`).join('')
  const after = Array.from({ length: 250 }, (_, i) => `new-${i}\n`).join('')
  const result = diffLines(before, after)
  assert.equal(result.status, 'ready')
  if (result.status !== 'ready') throw new Error('Missing test prerequisite')
  const pages = textDiffPages(result.hunks)
  assert.equal(DIFF_PAGE_ROWS, 200)
  assert.deepEqual(pages.map(page => page.reduce((count, part) => count + part.rows.length, 0)), [200, 200, 100])
  assert.deepEqual(pages.flatMap(page => page.flatMap(part => part.rows)), result.hunks.flatMap(hunk => hunk.rows))
  assert.deepEqual(pages.map(page => page[0].offset), [0, 200, 400])
  for (const page of pages) for (const part of page) assert.equal(part.hunk, result.hunks[0])
  assert.deepEqual(textDiffPages([]), [])
})

test('pagination spans separate hunks without duplicating, dropping or inventing line numbers', () => {
  const rows = Array.from({ length: 60 }, (_, i) => `line-${i}\n`)
  const next = [...rows]
  next[1] = 'first\n'; next[30] = 'middle\n'; next[59] = 'last\n'
  const result = diffLines(rows.join(''), next.join(''))
  assert.equal(result.status, 'ready')
  if (result.status !== 'ready') throw new Error('Missing test prerequisite')
  assert.equal(result.hunks.length, 3)
  const pages = textDiffPages(result.hunks)
  assert.equal(pages.length, 1)
  assert.equal(pages[0].length, 3)
  assert.deepEqual(pages[0].map(part => part.hunk), result.hunks)
  assert.ok(pages[0].every(part => part.offset === 0))
})
