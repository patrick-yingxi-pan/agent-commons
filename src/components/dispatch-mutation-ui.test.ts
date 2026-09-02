import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Dispatch creation retains authored intent until one acknowledged logical run lands', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const command = stripComments(read(join(ROOT, 'src', 'api', 'dispatchCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'dispatchMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'dispatchMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'DispatchMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(view, /createDispatch\(/, 'the dialog cannot bypass acknowledgement')
  assert.match(view, /const input = \{[\s\S]*title:[\s\S]*detail:[\s\S]*enqueueDispatch\(input\)/, 'the exact authored form enters the controller')
  assert.match(view, /outcome === 'applied'/, 'only acknowledged creation closes the dialog')
  assert.match(view, /busy=\{held\}/, 'the shared form freezes the exact draft while uncertain')
  assert.match(controller, /import\('\.\/dispatchMutationRuntime'\)/, 'low-frequency transport remains lazy')
  assert.match(controller, /issuedGeneration !== accountGeneration/, 'an old account cannot release the new account hold')
  assert.match(runtime, /createAcknowledgedActionMutationController/, 'Dispatch reuses the action FIFO')
  assert.match(command, /manualDispatchRunId\(baseline\.tenantId, idempotencyKey\)/, 'reconciliation proves the exact tenant-scoped run')
  assert.match(command, /apiPost<DispatchRun>[\s\S]*idempotencyKey/, 'transport retains one logical key')
  assert.match(notice, /kind="dispatch-create"/, 'uncertainty has one shell recovery role')
  assert.match(shell, /<DispatchMutationNotice\s*\/>/, 'Dispatch recovery mounts once at shell scope')
})
