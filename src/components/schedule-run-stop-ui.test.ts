import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import { canStopScheduleRun } from '../lib/scheduleRunStopPresentation.ts'

test('routine Stop requires explicit viewer-relative ownership', () => {
  assert.equal(canStopScheduleRun(undefined), false, 'missing ownership is not authority')
  assert.equal(canStopScheduleRun(false), false, 'a shared reader cannot stop the owner’s run')
  assert.equal(canStopScheduleRun(true), true, 'the owner can stop the run')

  const readSource = (path: string) => stripComments(read(join(ROOT, path)))
  const view = readSource('src/components/SectionView.tsx')
  const rail = readSource('src/components/RoutineRowMenu.tsx')
  assert.ok((view.match(/canStopScheduleRun\(task\.own\)/g) ?? []).length >= 3,
    'project row, routine row, and detail Stop require explicit ownership')
  assert.match(rail, /activeRun && canStopScheduleRun\(task\.own\)/,
    'rail Stop requires explicit ownership')
})

test('routine Stop is one frozen, account-fenced command and shared presentation', () => {
  const readSource = (path: string) => stripComments(read(join(ROOT, path)))
  const api = readSource('src/api/scheduleRunStopCommands.ts')
  const facade = readSource('src/controller/scheduleRunStopMutations.ts')
  const runtime = readSource('src/controller/scheduleRunStopRuntime.ts')
  const view = readSource('src/components/SectionView.tsx')
  const rail = readSource('src/components/RoutineRowMenu.tsx')
  const menu = readSource('src/components/RunHistoryMenu.tsx')
  const copy = readSource('src/lib/scheduleRunStopPresentation.ts')

  assert.match(facade, /Object\.freeze\(\{ scheduleId: intent\.scheduleId, runId: intent\.runId \}\)/)
  assert.match(facade, /intent: frozenIntent/)
  assert.match(facade, /enqueueScheduleRunStopRuntime\(held\.intent\)/)
  assert.match(facade, /createRetryableRuntimeLoader<Runtime>/)
  assert.match(facade, /No Stop request was sent/)
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(api, /paths\.scheduleRunStop\(intent\.scheduleId, intent\.runId\)/)
  assert.match(api, /run\.id !== intent\.runId/)
  assert.match(api, /accountGeneration\(\) !== issuedGeneration/)
  assert.match(api, /invalidate\(keys\.scheduleMcpPermission\(intent\.scheduleId\)\)/)
  assert.match(api, /invalidate\(keys\.session\(sessionId\)\)/)
  assert.match(api, /invalidatePrefix\(keys\.mcpInputPrefix\(sessionId\)\)/)
  assert.match(api, /invalidate\(keys\.sessions\)/)
  assert.equal((api.match(/invalidateRunSideViews\(intent\)/g) ?? []).length, 2)
  assert.match(api, /scheduleRunStopSettled\(incoming, intent\)/)

  for (const surface of [view, rail]) {
    assert.match(surface, /SCHEDULE_RUN_STOP_LABEL/)
    assert.match(surface, /SCHEDULE_RUN_STOP_SCOPE/)
  }
  assert.match(menu, /scheduleRunStatusLabel\(status\)/)
  assert.match(copy, /status === 'cancelled' \? 'Stopped'/)
  assert.match(view, /task\.lastStatus === 'cancelled'/)
  assert.match(view, /isScheduleRunStopHeldForTask\(task\.id\) \? SCHEDULE_RUN_STOP_PENDING_LABEL : SCHEDULE_RUN_STOP_LABEL/)
  assert.match(view, /canStopScheduleRun\(task\.own\) && running && <p/)
  assert.match(view, /<\/header>\s*\{canStopScheduleRun\(task\.own\) && running && <p data-routine-stop-scope className=\{AUTOMATION_NOTICE_CLASS\}>\{SCHEDULE_RUN_STOP_SCOPE\}/)
  assert.doesNotMatch(view, /!running && <SectionAction[\s\S]{0,180}label=\{running \?/)
})
