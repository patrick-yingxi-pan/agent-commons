import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseScheduledArtifactSpec } from './scheduledArtifact.ts'

test('scheduled artifact specs detach every explicit authored kind and legacy strings mean Document', () => {
  const legacy = 'report.xlsx'
  assert.deepEqual(parseScheduledArtifactSpec(legacy), { name: legacy, kind: 'doc' }, 'a suffix never upgrades a legacy Document')
  for (const kind of ['doc', 'sheet', 'slide'] as const) {
    const input = { name: `report-${kind}`, kind }
    const parsed = parseScheduledArtifactSpec(input)
    assert.deepEqual(parsed, input)
    assert.notEqual(parsed, input)
  }
})

test('scheduled artifact specs reject malformed names, kinds, prototypes and unknown fields', () => {
  for (const invalid of [
    '', ' report ', 'bad\nname', 'x'.repeat(241), null, [], {},
    { name: 'report', kind: 'slides' },
    { name: undefined, kind: 'sheet' },
    { name: 'report', kind: 'sheet', extra: true },
    { name: ' report ', kind: 'doc' },
    { name: 'report.xlsx' },
    { kind: 'sheet' },
    Object.create({ name: 'report', kind: 'doc' }),
  ]) assert.equal(parseScheduledArtifactSpec(invalid), undefined)
})
