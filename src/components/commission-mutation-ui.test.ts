import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('contributor configuration uses one orthogonal sparse held-draft recovery path', () => {
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const dialog = stripComments(read(join(ROOT, 'src', 'components', 'CommissionDialog.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'commissionMutations.ts')))
  const route = stripComments(read(join(ROOT, 'server', 'routes', 'commissionConfiguration.ts')))

  assert.match(section, /import \{ DeferredCommissionDialog \} from '\.\/DeferredCommissionDialog\.tsx'/)
  assert.match(dialog, /import \{ updateCommissionConfiguration \} from '\.\.\/controller\/commissionMutations\.ts'/)
  assert.doesNotMatch(section, /updateCommission,[\s\S]*from '\.\.\/api'/)
  assert.match(dialog, /const original = useRef\(commission\)\.current/)
  assert.match(dialog, /roleChanged[\s\S]*standingChanged[\s\S]*connectorsChanged[\s\S]*scopesChanged/)
  assert.match(dialog, /authority: \{[\s\S]*connectorsChanged[\s\S]*scopesChanged/,
    'authority axes remain independently sparse')
  assert.match(dialog, /const outcome = await updateCommissionConfiguration\(commission\.id, commission\.projectId, \{/)
  assert.match(dialog, /busy=\{busy\}/, 'the dialog remains mounted and disabled while its exact retry payload is held')
  assert.match(controller, /createRevisionedMutationController<Commission, CommissionConfigurationPatch>/)
  assert.match(commands, /export async function patchCommissionConfiguration\([\s\S]*expectedRevision[\s\S]*idempotencyKey/)
  assert.match(commands, /filter\(\(row\) => row\.id !== id\)/, 'reconciliation removes a deleted contributor')
  assert.match(route, /rejectUnknown\(input, UPDATE_FIELDS, 'commission'\)/,
    'server input is a bounded strict shape')
})
