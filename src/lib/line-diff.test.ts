import assert from 'node:assert/strict'
import test from 'node:test'
import { diffLines, type LineDiffHunk } from './lineDiff.ts'

function sourceLines(value: string): string[] {
  if (value === '') return []
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function applyHunks(before: string, hunks: LineDiffHunk[]): string {
  const lines = sourceLines(before)
  const output: string[] = []
  let cursor = 0
  for (const hunk of hunks) {
    const start = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1
    output.push(...lines.slice(cursor, start))
    cursor = start
    for (const row of hunk.rows) {
      const exact = row.text + row.eol
      if (row.kind === 'context') {
        assert.equal(lines[cursor], exact, 'context rows match the original at their line position')
        output.push(exact)
        cursor++
      } else if (row.kind === 'delete') {
        assert.equal(lines[cursor], exact, 'deleted rows match the original at their line position')
        cursor++
      } else output.push(exact)
    }
  }
  output.push(...lines.slice(cursor))
  return output.join('')
}

test('line diff covers additions, deletions, empty input, and exact hunk ranges', () => {
  const added = diffLines('', 'first\nsecond\n')
  assert.equal(added.status, 'ready')
  if (added.status !== 'ready') return
  assert.equal(added.added, 2)
  assert.equal(added.deleted, 0)
  assert.deepEqual(added.hunks.map(({ oldStart, oldCount, newStart, newCount }) => ({ oldStart, oldCount, newStart, newCount })), [
    { oldStart: 0, oldCount: 0, newStart: 1, newCount: 2 },
  ])
  assert.equal(applyHunks('', added.hunks), 'first\nsecond\n')

  const removed = diffLines('first\nsecond\n', '')
  assert.equal(removed.status, 'ready')
  if (removed.status !== 'ready') return
  assert.equal(removed.deleted, 2)
  assert.equal(removed.added, 0)
  assert.equal(applyHunks('first\nsecond\n', removed.hunks), '')
})

test('line diff merges touching context windows and separates distant edits', () => {
  const before = Array.from({ length: 24 }, (_, i) => `line ${i}\n`).join('')
  const afterLines = Array.from({ length: 24 }, (_, i) => `line ${i}\n`)
  afterLines[2] = 'changed 2\n'
  afterLines[8] = 'changed 8\n'
  afterLines[20] = 'changed 20\n'
  const result = diffLines(before, afterLines.join(''))
  assert.equal(result.status, 'ready')
  if (result.status !== 'ready') return
  assert.equal(result.hunks.length, 2, 'edits six equal rows apart share one 3-line context window')
  assert.deepEqual(result.hunks.map(hunk => [hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount]), [
    [1, 12, 1, 12],
    [18, 7, 18, 7],
  ])
  assert.equal(result.added, 3)
  assert.equal(result.deleted, 3)
  assert.equal(applyHunks(before, result.hunks), afterLines.join(''))
})

test('line diff preserves CRLF and final-newline differences exactly', () => {
  const before = 'alpha\r\nbeta\r\nlast'
  const after = 'alpha\r\nbeta\nlast\n'
  const result = diffLines(before, after)
  assert.equal(result.status, 'ready')
  if (result.status !== 'ready') return
  assert.equal(applyHunks(before, result.hunks), after)
  assert.ok(result.hunks.some(hunk => hunk.rows.some(row => row.kind === 'delete' && row.eol === '\r\n')))
  assert.ok(result.hunks.some(hunk => hunk.rows.some(row => row.kind === 'add' && row.eol === '\n')))
})

test('line diff is deterministic for repeated lines and ambiguous edits', () => {
  const before = 'same\nrepeat\nrepeat\nend\n'
  const after = 'same\nrepeat\nnew\nrepeat\nend\n'
  const first = diffLines(before, after)
  assert.deepEqual(diffLines(before, after), first)
  assert.equal(first.status, 'ready')
  if (first.status === 'ready') assert.equal(applyHunks(before, first.hunks), after)
})

test('line diff handles 8,000-line whole-file additions and deletions without fallback', () => {
  const wholeFile = 'a\n'.repeat(8_000)
  const added = diffLines('', wholeFile)
  assert.equal(added.status, 'ready')
  if (added.status === 'ready') {
    assert.equal(added.added, 8_000)
    assert.equal(added.deleted, 0)
    assert.equal(added.hunks.length, 1)
    assert.equal(applyHunks('', added.hunks), wholeFile)
  }

  const deleted = diffLines(wholeFile, '')
  assert.equal(deleted.status, 'ready')
  if (deleted.status === 'ready') {
    assert.equal(deleted.deleted, 8_000)
    assert.equal(deleted.added, 0)
    assert.equal(deleted.hunks.length, 1)
    assert.equal(applyHunks(wholeFile, deleted.hunks), '')
  }
})

test('line diff handles distant edits in a large mostly-equal file', () => {
  const beforeLines = Array.from({ length: 8_000 }, (_, i) => `L${String(i).padStart(4, '0')}\n`)
  const afterLines = [...beforeLines]
  afterLines[100] = 'changed near start\n'
  afterLines[7_900] = 'changed near end\n'
  const before = beforeLines.join('')
  const after = afterLines.join('')
  const forward = diffLines(before, after)
  assert.equal(forward.status, 'ready')
  if (forward.status === 'ready') {
    assert.equal(forward.added, 2)
    assert.equal(forward.deleted, 2)
    assert.equal(forward.hunks.length, 2)
    assert.equal(applyHunks(before, forward.hunks), after)
  }
  const reverse = diffLines(after, before)
  assert.equal(reverse.status, 'ready')
  if (reverse.status === 'ready') assert.equal(applyHunks(after, reverse.hunks), before)
})

test('line diff refuses over-budget bytes, lines, and edit distance', () => {
  assert.deepEqual(diffLines('x'.repeat(64 * 1024 + 1), ''), { status: 'too-complex' })
  assert.deepEqual(diffLines('é'.repeat(32 * 1024 + 1), ''), { status: 'too-complex' })
  assert.deepEqual(diffLines(`${'x\n'.repeat(8_001)}`, ''), { status: 'too-complex' })
  const distant = Array.from({ length: 1_100 }, (_, i) => `old ${i}\n`).join('')
  const replacement = Array.from({ length: 1_100 }, (_, i) => `new ${i}\n`).join('')
  assert.deepEqual(diffLines(distant, replacement), { status: 'too-complex' })
})

test('line diff randomized ready results reconstruct the complete after text', () => {
  let state = 0x51f15e
  const random = (limit: number) => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state % limit
  }
  for (let sample = 0; sample < 250; sample++) {
    const old = Array.from({ length: random(20) }, () => `v${random(7)}${random(4) === 0 ? '\r\n' : '\n'}`)
    const next = [...old]
    for (let edit = 0, count = random(8); edit < count; edit++) {
      const at = random(next.length + 1)
      if (at < next.length && random(2) === 0) next.splice(at, 1)
      else next.splice(at, 0, `new${random(9)}\n`)
    }
    const before = old.join('')
    const after = next.join('')
    const result = diffLines(before, after)
    assert.equal(result.status, 'ready', `sample ${sample}`)
    if (result.status === 'ready') {
      assert.equal(applyHunks(before, result.hunks), after, `sample ${sample}`)
      const reverse = diffLines(after, before)
      assert.equal(reverse.status, 'ready', `reverse sample ${sample}`)
      if (reverse.status === 'ready') assert.equal(applyHunks(after, reverse.hunks), before, `reverse sample ${sample}`)
    }
  }
})

test('line diff reports a minimal edit count for short repeated-line inputs', () => {
  const values = ['a\n', 'b\n', 'c\n']
  const sequences: string[][] = [[]]
  for (let size = 1; size <= 5; size++) {
    for (let mask = 0; mask < 3 ** size; mask++) {
      let value = mask
      const sequence: string[] = []
      for (let i = 0; i < size; i++) {
        sequence.push(values[value % values.length])
        value = Math.floor(value / values.length)
      }
      sequences.push(sequence)
    }
  }
  const lcsLength = (a: string[], b: string[]) => {
    const table = Array.from({ length: a.length + 1 }, () => new Uint8Array(b.length + 1))
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        table[i][j] = a[i - 1] === b[j - 1]
          ? table[i - 1][j - 1] + 1
          : Math.max(table[i - 1][j], table[i][j - 1])
      }
    }
    return table[a.length][b.length]
  }
  for (const before of sequences) {
    for (const after of sequences) {
      const result = diffLines(before.join(''), after.join(''))
      assert.equal(result.status, 'ready')
      if (result.status === 'ready') {
        const expected = before.length + after.length - 2 * lcsLength(before, after)
        assert.equal(result.added + result.deleted, expected)
      }
    }
  }
})
