import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('every routine projection uses one acknowledgement-gated manual-run flow', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
  const routineMenu = stripComments(read(join(ROOT, 'src', 'components', 'RoutineRowMenu.tsx')))
  const rowMenu = stripComments(read(join(ROOT, 'src', 'components', 'RowMenu.tsx')))
  const command = stripComments(read(join(ROOT, 'src', 'api', 'scheduleRunCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'scheduleRunMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'scheduleRunRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ScheduleMutationNotice.tsx')))
  const actionRow = rowMenu.match(/function ActionRow[\s\S]*?(?=function ProjectRow)/)?.[0]
  assert.ok(actionRow, 'the shared action row is present')

  assert.doesNotMatch(view, /runScheduleNow\(/, 'main and Project surfaces cannot bypass acknowledgement')
  assert.doesNotMatch(sidebar, /runScheduleNow\(/, 'the rail cannot bypass acknowledgement')
  assert.equal((view.match(/enqueueScheduleRun\(id\)/g) ?? []).length, 2, 'Project and Routines enter the shared controller')
  assert.match(routineMenu, /enqueueScheduleRun\(task\.id\)/, 'the rail enters the shared controller')
  assert.equal((view.match(/isScheduleRunHeld\(id\)/g) ?? []).length, 2, 'both main projections render the immediate hold')
  assert.match(routineMenu, /isScheduleRunHeld\(task\.id\)/, 'the rail renders the same immediate hold')
  assert.match(view, /runs\.some\(\(run\) => run\.status === 'running'\)/, 'rendered controls respect durable active-run truth')
  assert.match(routineMenu, /runs\.find\(\(run\) => run\.status === 'running'\)/, 'the rail binds Stop to one durable active run')
  assert.match(routineMenu, /runId: activeRun\.id/, 'the rail never targets a latest run dynamically')
  assert.match(sidebar, /lazy\(\(\) =>[\s\S]*import\('\.\/RoutineRowMenu'\)/, 'rail execution state loads only with routine rows')

  assert.match(controller, /import\('\.\/scheduleRunRuntime'\)/, 'the low-frequency transport stays behind a lazy boundary')
  assert.match(controller, /heldResources\.add\(id\)/, 'a run intent is held before the lazy runtime loads')
  assert.match(controller, /outcome\.finally/, 'the hold releases only after acknowledgement or explicit recovery')
  assert.match(controller, /issuedGeneration !== accountGeneration/, 'a retired account cannot release the new account\'s same-id hold')
  assert.match(runtime, /createAcknowledgedActionMutationController/, 'manual execution uses the shared acknowledgement FIFO')
  assert.match(runtime, /\.\.\/api\/scheduleRunCommands/, 'the Run-now transport remains behind that lazy boundary')
  assert.match(command, /apiPost<ScheduledRun>[\s\S]*idempotencyKey/, 'the command sends its controller-owned logical key')
  assert.match(command, /manualScheduleRunId\(idempotencyKey\)/, 'reconciliation proves only this exact logical run')
  assert.match(command, /mergeAcknowledgedScheduleRun/, 'only acknowledged run truth enters the cache')
  assert.match(notice, /kind="routine-run"/, 'uncertain execution has one enumerable shell recovery role')

  assert.match(rowMenu, /disabled=\{item\.disabled\}/, 'the rail can disable only Run while leaving other actions available')
  assert.match(routineMenu, /key: 'stop-run'/, 'durable activity offers exact Stop instead of a disabled Run item')
  assert.match(routineMenu, /\.\.\.\(!activeRun \?/, 'Run now is absent while a run is active')
  assert.match(actionRow, /disabled=\{disabled\}/, 'the action row uses native disabled semantics')
})
