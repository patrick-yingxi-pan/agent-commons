/** ── Workflow-step array operations ─────────────────────────────────────────
 *  The schedule detail page's step editor mutates a routine's ordered steps —
 *  reorder, remove, and a save that drops the blanks. Kept pure (no React) so the
 *  fiddly bits (clamping, immutability, trimming) are unit-tested; the editor
 *  holds the draft and commits the result via updateSchedule({ steps }). */
import type { WorkflowStep } from '../../contract/cowork.ts'

/** Move the step at `i` by `dir` (-1 up, +1 down). Returns a NEW array, or the
 *  same array unchanged when the move would fall off either end. */
export function moveStep(steps: WorkflowStep[], i: number, dir: -1 | 1): WorkflowStep[] {
  const j = i + dir
  if (i < 0 || i >= steps.length || j < 0 || j >= steps.length) return steps
  const next = [...steps]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** Remove the step at `i` (a new array; unchanged if `i` is out of range). */
export function removeStep(steps: WorkflowStep[], i: number): WorkflowStep[] {
  if (i < 0 || i >= steps.length) return steps
  return steps.filter((_, j) => j !== i)
}

/** What a save commits: trim each action and drop the blank steps, so an
 *  added-but-never-filled row never persists. */
export function cleanSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((s) => ({ ...s, action: s.action.trim() })).filter((s) => s.action.length > 0)
}
