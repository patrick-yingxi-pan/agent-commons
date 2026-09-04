import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('both work-item projections confirm and hold one acknowledgement-owned retraction', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'workItemRetractionCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'workItemRetractionMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'workItemRetractionMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'WorkItemRetractionMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function retractWorkItem/)
  assert.ok((view.match(/useWorkItemRetractionStatus\(\)/g) ?? []).length >= 2)
  assert.ok((view.match(/isWorkItemRetractionHeld\(/g) ?? []).length >= 2)
  assert.ok((view.match(/setConfirmingRetract\(true\)/g) ?? []).length >= 2)
  assert.ok((view.match(/confirmLabel="Retract work item"/g) ?? []).length >= 2)
  assert.match(facade, /permanently closes[\s\S]*cannot be reopened[\s\S]*comments remain visible/)
  assert.match(facade, /const existing = heldItems\.get\(key\)[\s\S]*if \(existing\) return existing\.result/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(commands, /apiPost<OpenSubGoal>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /item\.status === 'retracted'/)
  assert.match(runtime, /createAcknowledgedActionMutationController/)

  const routeStart = routes.indexOf("r.post('/projects/:id/open-subgoals/:itemId/retract'")
  const routeEnd = routes.indexOf("r.get('/grants'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  assert.match(routes.slice(routeStart, routeEnd), /getWorkItemRetraction[\s\S]*if \(typeof represented === 'object'\) return sendJson/)
  const storeStart = store.indexOf('  retractOpenSubGoal(', store.indexOf('getWorkItemRetraction'))
  const storeEnd = store.indexOf('  grantSubjectRow(', storeStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart)
  assert.match(store.slice(storeStart, storeEnd), /return commitMutationBatch\(\(\) => \{[\s\S]*retractionId[\s\S]*notifyTenants[\s\S]*persist\(\)/)
  assert.match(notice, /kind="work-item-retract"/)
  assert.match(shell, /<WorkItemRetractionMutationNotice \/>/)
})
