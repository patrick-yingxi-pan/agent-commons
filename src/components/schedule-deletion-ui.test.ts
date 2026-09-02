import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('every routine projection enters one revision-pinned, acknowledgement-gated deletion flow', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
  const command = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const definitionController = stripComments(read(join(ROOT, 'src', 'controller', 'scheduleMutations.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'scheduleDeletionMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'scheduleDeletionRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ScheduleMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(view, /removeSchedule\(/, 'main and Project surfaces cannot bypass acknowledgement')
  assert.doesNotMatch(sidebar, /removeSchedule\(/, 'the rail cannot bypass acknowledgement')
  assert.match(view, /<ConfirmDialog[\s\S]*title=\{`Delete “\$\{deleteTarget\.name\}”\?`\}/, 'main deletion confirms the named routine')
  assert.match(controller, /permanently removes the routine and its run conversations/, 'the shared confirmation states the durable cascade')
  assert.match(controller, /Artifacts it created stay/, 'the shared confirmation states what survives')
  assert.match(view, /body=\{ROUTINE_DELETE_SCOPE\}/, 'the main confirmation consumes the shared scope')
  assert.match(sidebar, /ROUTINE_DELETE_SCOPE/, 'the rail confirmation consumes the shared scope')
  assert.match(view, /enqueueScheduleDeletion\(task\.id, task\.revision \?\? 0\)/, 'confirmation freezes the reviewed revision')
  assert.match(view, /scheduleIdRef\.current === task\.id/, 'a late acknowledgement redirects only the still-open deleted detail')
  assert.match(view, /isScheduleMutationHeld\(id\) \|\| isScheduleDeletionHeld\(id\)/, 'definition edits and deletion share one rendered hold')
  assert.match(view, /<RowMenu[^>]*disabled=\{mutationHeld\}/, 'the Project menu stays held through acknowledgement or recovery')
  assert.match(sidebar, /enqueueScheduleDeletion\(task\.id, task\.revision \?\? 0\)/, 'the rail enters the same controller with its reviewed revision')
  assert.match(sidebar, /activeSeedRef\.current\?\.scheduleId === task\.id/, 'a late rail acknowledgement cannot eject a newer destination')
  assert.match(sidebar, /<RowMenu[^>]*disabled=\{mutationHeld\}/, 'the rail row stays held')

  assert.match(runtime, /createRevisionedDeletionMutationController/, 'routine deletion reuses the destructive FIFO')
  assert.match(controller, /import\('\.\/scheduleDeletionRuntime'\)/, 'the low-frequency deletion engine stays behind a lazy boundary')
  assert.match(controller, /heldResourceCounts\.set\(id, \(heldResourceCounts\.get\(id\) \?\? 0\) \+ 1\)/, 'a queued routine is held immediately')
  assert.match(controller, /outcome\.finally/, 'the hold releases only after the intent settles')
  assert.match(controller, /remaining > 0/, 'one caller cannot release another caller’s hold on the same deletion')
  assert.match(definitionController, /heldResourceCounts = new Map/, 'several queued edits keep a reference-counted resource hold')
  assert.match(definitionController, /remaining > 0/, 'one acknowledged edit cannot release a later edit on the same routine')
  assert.match(definitionController, /isScheduleDeletionHeld\(scheduleId\)/, 'an already-open editor cannot race a held deletion')
  assert.match(command, /await apiDelete\([\s\S]*expectedRevision[\s\S]*idempotencyKey/, 'transport pins revision and retry identity before publishing absence')
  assert.match(command, /mutate<ScheduledTask\[]>\(keys\.schedules/, 'only an acknowledged delete evicts the cached routine')
  assert.match(notice, /kind="routine-delete"/, 'deletion recovery has one enumerable shell role')
  assert.match(shell, /<ScheduleMutationNotice\s*\/>/, 'routine recovery is mounted once at shell scope')
})
