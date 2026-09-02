import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Contributor removal is confirmed, revision-pinned, retained, and shell-recoverable', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'commissionDeletionMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'commissionDeletionMutationRuntime.ts')))
  const holds = stripComments(read(join(ROOT, 'src', 'controller', 'commissionMutationHolds.ts')))
  const config = stripComments(read(join(ROOT, 'src', 'controller', 'commissionMutations.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'CommissionMutationNotice.tsx')))

  assert.doesNotMatch(view, /deleteCommission\(/, 'the row cannot bypass acknowledged removal')
  assert.match(view, /<ConfirmDialog[\s\S]*title=\{`Remove \$\{agentLabel\}\?`\}/,
    'the destructive confirmation names the selected Agent')
  assert.match(controller, /removes the Agent from this Project and releases any work items it holds/)
  assert.match(controller, /Previous contributions stay/, 'the confirmation states what survives')
  assert.match(view, /body=\{COMMISSION_DELETE_SCOPE\}/)
  assert.match(view, /enqueueCommissionDeletion\(commission\)/,
    'confirmation freezes the exact row and its configuration revision')
  assert.match(view, /heldCommissionDeletions\(project\.id\)[\s\S]*!currentCommissions\.some/,
    'an early absence refresh cannot erase the reviewed row before settlement')
  assert.match(view, /data-commission-removal=\{deleting \|\| undefined\}/)
  assert.match(view, /disabled=\{mutationHeld\}/, 'edit and remove controls share one row hold')
  assert.match(view, /commission\.mine !== false/, 'foreign public Contributors expose no owner-only actions')

  assert.match(runtime, /createRevisionedDeletionMutationController<Commission>/)
  assert.match(runtime, /configurationRevision \?\? 0/)
  assert.match(runtime, /rebaseOnRetry: true/, 'only stale reviewed truth rebases on explicit Retry')
  assert.match(commands, /apiDelete\([\s\S]*expectedRevision[\s\S]*idempotencyKey/)
  assert.match(commands, /acceptCommissionAbsence\(id, projectId\)/,
    'only acknowledgement or authoritative absence evicts the row')
  assert.match(controller, /heldSnapshots\.set\(commission\.id, commission\)/)
  assert.match(controller, /issuedGeneration !== accountGeneration/)
  assert.match(holds, /counts\[otherKind\(kind\)\]/, 'configuration and removal cannot race')
  assert.match(config, /acquireCommissionMutation\('configuration', commissionId\)/)
  assert.match(notice, /kind="commission-delete"/, 'removal recovery is shell-owned')
})
