import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artifactSearchReveal } from './artifactSearchReveal.ts'

const body = { type: 'workbook' as const, sheets: [
  { id: 'first', name: 'First', columns: ['Label'], rows: [['Original']] },
  { id: 'later', name: 'Later', columns: ['Label'], rows: [['Needle']] },
] }

test('body locations reveal only the exact saved revision and declared field', () => {
  assert.deepEqual(artifactSearchReveal(body, 0, { revision: 0, field: 'workbook.1.cell.0.0' }), { kind: 'ready', field: 'workbook.1.cell.0.0' })
  assert.deepEqual(artifactSearchReveal(body, 1, { revision: 0, field: 'workbook.1.cell.0.0' }), { kind: 'stale' })
  for (const field of ['workbook.2.cell.0.0', 'workbook.1.cell.0.1', 'doc.title', 'workbook.01.name', '__proto__']) {
    assert.deepEqual(artifactSearchReveal(body, 0, { revision: 0, field }), { kind: 'missing' }, field)
  }
})
