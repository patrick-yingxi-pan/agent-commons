/** The schedule detail page's workflow-step editor mutates a routine's ordered
 *  steps through pure helpers (src/lib/steps.ts) and commits via
 *  updateSchedule({ steps }). These lock the fiddly array logic — clamped reorder,
 *  immutability, and the save that drops blank rows — so the editor can't corrupt
 *  the step list. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moveStep, removeStep, cleanSteps } from '../src/lib/steps.ts'
import type { WorkflowStep } from '../contract/cowork.ts'

const tool = { id: 'claude', label: 'Claude', tone: 'claude' as const }
const mk = (id: string, action: string): WorkflowStep => ({ id, action, tool })

test('moveStep swaps neighbors and returns a new array (immutability)', () => {
  const steps = [mk('a', 'A'), mk('b', 'B'), mk('c', 'C')]
  const down = moveStep(steps, 0, 1)
  assert.deepEqual(down.map((s) => s.id), ['b', 'a', 'c'], 'step a moved down past b')
  assert.notEqual(down, steps, 'a new array is returned')
  assert.deepEqual(steps.map((s) => s.id), ['a', 'b', 'c'], 'the input is untouched')
  const up = moveStep(steps, 2, -1)
  assert.deepEqual(up.map((s) => s.id), ['a', 'c', 'b'], 'step c moved up past b')
})

test('moveStep is a clamped no-op at either end (returns the same array)', () => {
  const steps = [mk('a', 'A'), mk('b', 'B')]
  assert.equal(moveStep(steps, 0, -1), steps, 'cannot move the first step up')
  assert.equal(moveStep(steps, 1, 1), steps, 'cannot move the last step down')
})

test('removeStep drops the indexed step (and no-ops out of range)', () => {
  const steps = [mk('a', 'A'), mk('b', 'B'), mk('c', 'C')]
  assert.deepEqual(removeStep(steps, 1).map((s) => s.id), ['a', 'c'])
  assert.equal(removeStep(steps, 9), steps, 'an out-of-range index changes nothing')
})

test('cleanSteps trims actions and drops the blank rows (what a save commits)', () => {
  const steps = [mk('a', '  do a  '), mk('b', '   '), mk('c', 'do c'), mk('d', '')]
  const cleaned = cleanSteps(steps)
  assert.deepEqual(cleaned.map((s) => s.action), ['do a', 'do c'], 'blanks dropped, actions trimmed')
  assert.equal(cleaned.length, 2)
})
