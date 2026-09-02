import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('every routine template surface holds one exact creation intent until acknowledgement', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'scheduleCreationCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'scheduleCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'scheduleCreationMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ScheduleMutationNotice.tsx')))

  assert.doesNotMatch(view, /addScheduleFromSeed/, 'no template picker can bypass acknowledgement')
  assert.equal(
    (view.match(/enqueueScheduleCreation\(\{ tenantId, seed: tpl\.seed \}\)/g) ?? []).length,
    2,
    'Project and Routines template pickers enter the same controller',
  )
  assert.match(view, /aria-busy=\{(?:pendingTemplate !== null|held) \|\| undefined\}/, 'the picker names its pending state')
  assert.match(view, /if \(outcome === 'applied'\) setOpen\(false\)/, 'only acknowledged creation closes the primary picker')
  assert.match(view, /Your template choice is still here/, 'Dismiss preserves a retryable local choice')
  assert.match(view, /scheduledSectionMountedRef\.current[\s\S]*scheduleIdRef\.current === null/, 'late success cannot steal navigation after leaving Routines')
  assert.match(view, /projectMountedRef\.current && projectLocationRef\.current === origin/, 'late Project success cannot steal a newer destination')
  assert.match(controller, /intentId: crypto\.randomUUID\(\)/, 'the eager hold owns one logical identity')
  assert.match(controller, /import\('\.\/scheduleCreationMutationRuntime'\)/, 'low-frequency transport remains lazy')
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/, 'retry identity and durable row identity are the same act')
  assert.match(commands, /scheduleCreationId\(baseline\.tenantId, idempotencyKey\)/, 'reconciliation proves the exact tenant-scoped routine')
  assert.match(commands, /apiPost<ScheduledTask>[\s\S]*idempotencyKey/, 'transport retains one logical key')
  assert.match(notice, /kind="routine-create"/, 'uncertainty uses the routine shell recovery surface')
})
