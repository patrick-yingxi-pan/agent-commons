/** Repository-level lock for the UI invariant ledger. The ledger is a
 * cross-surface document, so its identifiers need a small structural oracle
 * of their own rather than relying on a feature's behavioral suite. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read } from './helpers/source.ts'

const LEDGER = join(ROOT, 'docs', 'ui-invariants.md')

test('UI invariant ledger has nonempty, uniquely numbered subject rows', () => {
  const rows: Array<{ id: string; line: number; subject: string }> = []
  for (const [index, line] of read(LEDGER).split('\n').entries()) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    const first = cells[0] ?? ''
    if (!first.startsWith('UI-')) continue
    assert.match(first, /^UI-\d+$/, `line ${index + 1}: UI invariant id must be UI-<number>`)
    const subject = cells[1] ?? ''
    assert.notEqual(subject, '', `line ${index + 1}: UI invariant ${first} needs a subject`)
    rows.push({ id: first, line: index + 1, subject })
  }

  assert.ok(rows.length > 0, 'UI invariant ledger must contain subject rows')
  const byId = new Map<string, number[]>()
  for (const row of rows) byId.set(row.id, [...(byId.get(row.id) ?? []), row.line])
  const duplicates = [...byId.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([id, lines]) => `${id} (lines ${lines.join(', ')})`)
  assert.deepEqual(duplicates, [], `UI invariant ids must be unique:\n${duplicates.join('\n')}`)
})
