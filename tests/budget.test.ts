/** Budget attenuation (docs/agent-commons.md, D8 — the quota face). The pure subset
 *  check (contract) + the meter's plan ceilings (the cascade root) + the mint funnel
 *  that rejects an over-grant. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { overBudgetWindow, clampBudget, type Budget, type BudgetWindow } from '../contract/index.ts'
import { createUsageMeter, mintBudget, BudgetError } from '../server/usage.ts'

const PLAN: BudgetWindow[] = [
  { label: '5-hour limit', ceiling: 1_200_000 },
  { label: 'Weekly · all models', ceiling: 24_000_000 },
]

test('overBudgetWindow: a subset budget is a valid attenuation (null)', () => {
  const child: Budget = { windows: [{ label: '5-hour limit', ceiling: 600_000 }] }
  assert.equal(overBudgetWindow(PLAN, child), null)
})

test('overBudgetWindow: a window exceeding its parent breaks attenuation', () => {
  const child: Budget = { windows: [{ label: '5-hour limit', ceiling: 2_000_000 }] }
  assert.equal(overBudgetWindow(PLAN, child)?.label, '5-hour limit')
})

test('overBudgetWindow: a window the parent does not have breaks attenuation', () => {
  const child: Budget = { windows: [{ label: 'made-up window', ceiling: 1 }] }
  assert.equal(overBudgetWindow(PLAN, child)?.label, 'made-up window')
})

test('the meter exposes the plan ceilings as the cascade root', () => {
  const ceilings = createUsageMeter(() => 0).planCeilings()
  assert.equal(ceilings.find((w) => w.label === '5-hour limit')?.ceiling, 1_200_000)
  assert.equal(ceilings.find((w) => w.label === 'Weekly · all models')?.ceiling, 24_000_000)
})

test('mintBudget passes a subset and rejects an over-grant', () => {
  const ok: Budget = { windows: [{ label: '5-hour limit', ceiling: 500_000 }] }
  assert.equal(mintBudget(PLAN, ok), ok)
  const over: Budget = { windows: [{ label: 'Weekly · all models', ceiling: 99_000_000 }] }
  assert.throws(() => mintBudget(PLAN, over), BudgetError)
})

test('clampBudget caps each child window at its narrowed parent (D8 runtime)', () => {
  const child: Budget = { windows: [{ label: '5-hour limit', ceiling: 1_000_000 }, { label: 'Weekly · all models', ceiling: 5_000_000 }] }
  const parent: BudgetWindow[] = [{ label: '5-hour limit', ceiling: 400_000 }, { label: 'Weekly · all models', ceiling: 9_000_000 }]
  const out = clampBudget(child, parent)
  assert.equal(out.windows.find((w) => w.label === '5-hour limit')?.ceiling, 400_000) // clamped down
  assert.equal(out.windows.find((w) => w.label === 'Weekly · all models')?.ceiling, 5_000_000) // already under → kept
})
