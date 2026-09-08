import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import { CHIP_COUNT_CLASS } from './chipStyle.ts'

const CHIP = join('src', 'components', 'Chip.tsx')

test('context-chip counts keep the parent tone at full contrast through one style owner', () => {
  assert.match(CHIP_COUNT_CLASS, /\btabular-nums\b/)
  assert.match(CHIP_COUNT_CLASS, /\btext-inherit\b/)
  assert.doesNotMatch(CHIP_COUNT_CLASS, /\bopacity-\d+\b/)

  const source = stripComments(read(join(ROOT, CHIP)))
  assert.equal((source.match(/data-context-chip-count/g) ?? []).length, 1)
  assert.match(source, /data-context-chip-count[\s\S]*CHIP_COUNT_CLASS/)
  assert.doesNotMatch(source, /tabular-nums\s+opacity-\d+/)
})

test('the context-chip count has one declaration and one rendered consumer', () => {
  const offenders: string[] = []
  for (const file of [CHIP, join('src', 'lib', 'chipStyle.ts')]) {
    const source = stripComments(read(join(ROOT, file)))
    const matches = source.match(/CHIP_COUNT_CLASS/g) ?? []
    if (file === CHIP && matches.length !== 2) offenders.push(`${file}: expected one import and one consumer`)
    if (file.endsWith('chipStyle.ts') && matches.length !== 1) offenders.push(`${file}: expected one declaration`)
  }
  assert.deepEqual(offenders, [], 'context-chip count styling must have one lib owner and one rendered consumer')
})
