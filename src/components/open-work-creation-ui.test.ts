import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

function openWorkForm(): string {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const start = view.indexOf('const OPEN_WORK_ACTION_LABELS')
  const end = view.indexOf('function WatchButton', start)
  assert.ok(start >= 0 && end > start)
  return view.slice(start, end)
}

test('open-work posting is one held, explicit, exactly reconciled action', () => {
  const form = openWorkForm()
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'openWorkCreationCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'openWorkCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'openWorkCreationMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'OpenWorkCreationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function postOpenSubGoal/,
    'there is no second best-effort posting door for future callers to bypass through')
  assert.match(form, /useOpenWorkCreationStatus\(\)/)
  assert.match(form, /const heldIntent = heldOpenWorkIntent\(projectId\)/)
  assert.match(form, /setSubGoal\(heldIntent\.request\.subGoal\)[\s\S]*setComposing\(true\)/,
    'returning to the Project reconstructs the complete held form')
  assert.match(form, /heldOpen=\{held\}/)
  assert.match(form, /data-open-work-creation-form[\s\S]*aria-busy=\{held \|\| undefined\}/)
  assert.match(form, /disabled=\{held\}/)
  assert.match(form, /held \? 'Posting…' : 'Post work'/)
  assert.match(form, /value="" disabled>Choose an action…<\/option>/,
    'the form never silently chooses an external effect')
  assert.match(form, /A standing contributor may act on it immediately/)
  assert.match(form, /result\.outcome === 'applied'[\s\S]*setComposing\(false\)[\s\S]*work item wasn’t posted/,
    'only proven truth clears the complete form')

  assert.match(commands, /apiPost<OpenSubGoal>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /openWorkCreationId\(intent\.tenantId, intent\.projectId, idempotencyKey\)/)
  assert.match(commands, /item\.id === expectedId[\s\S]*item\.subGoal === intent\.request\.subGoal[\s\S]*item\.note ===/)
  assert.match(commands, /incoming\.find\(\(item\) => item\.id === expectedId\)/)

  assert.match(facade, /const existing = heldProjects\.get\(input\.projectId\)[\s\S]*if \(existing\) return existing\.result/,
    'repeat activation in one Project shares the logical post')
  assert.match(facade, /\.trim\(\)\.slice\(0, OPEN_WORK_FIELD_MAX\)/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /import\('\.\/openWorkCreationMutationRuntime\.ts'\)/)
  assert.match(runtime, /createAcknowledgedActionMutationController/)

  const routeStart = routes.indexOf("r.post('/projects/:id/open-subgoals'")
  const routeEnd = routes.indexOf("r.post('/projects/:id/open-subgoals/:itemId/comments'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  const route = routes.slice(routeStart, routeEnd)
  assert.match(route, /getOpenWorkCreation[\s\S]*if \(typeof represented === 'object'\) return sendJson[\s\S]*await body<PostOpenSubGoalRequest>/,
    'represented truth is returned before changed body input can run')
  assert.match(route, /openWorkCreationId\(who\.tenant\.id, params\.id, idempotencyKey\)/)

  const storeStart = store.indexOf('  postOpenSubGoal(', store.indexOf('getOpenWorkCreation'))
  const storeEnd = store.indexOf('  dispatchOpenSubGoal(', storeStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart)
  assert.match(store.slice(storeStart, storeEnd), /return commitMutationBatch\(\(\) => \{[\s\S]*openSubGoals\.push[\s\S]*dispatchOpenSubGoal[\s\S]*persist\(\)/,
    'row, notifications, standing effect, credit, audit, events, and persistence share one commit')
  assert.match(notice, /kind="open-work-create"/)
  assert.match(shell, /<OpenWorkCreationMutationNotice \/>/)
})
