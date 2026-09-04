import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('both work-item comment projections share one held, exactly reconciled action', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'workItemCommentCreationCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'workItemCommentCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'workItemCommentCreationMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'WorkItemCommentCreationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function commentOnWorkItem/,
    'there is no second best-effort comment door for future callers to bypass through')
  assert.ok((view.match(/useWorkItemCommentCreationStatus\(\)/g) ?? []).length >= 2,
    'the compact row and canonical page both subscribe to the shared hold')
  assert.ok((view.match(/heldWorkItemCommentIntent\(/g) ?? []).length >= 2)
  assert.ok((view.match(/data-work-item-comment-form/g) ?? []).length >= 2)
  assert.ok((view.match(/maxLength=\{WORK_ITEM_COMMENT_MAX\}/g) ?? []).length >= 2)
  assert.ok((view.match(/aria-busy=\{commentHeld \|\| undefined\}/g) ?? []).length >= 2)
  assert.ok((view.match(/disabled=\{commentHeld \|\| busy\}/g) ?? []).length >= 2)
  assert.ok((view.match(/result\.outcome === 'applied'/g) ?? []).length >= 3,
    'posting and both comment surfaces clear only after represented truth')
  assert.match(view, /const effectiveThreadOpen = threadOpen \|\| commentHeld/,
    'a held intent itself exposes the compact thread across projection remounts')
  assert.match(view, /if \(!heldComment\) return\s+setDraft\(heldComment\.body\)/,
    'returning to the compact projection restores the held draft')

  assert.match(commands, /apiPost<OpenSubGoal>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /comment\.id === expectedId && comment\.body === intent\.body/)
  assert.match(commands, /incoming\.find\(\(item\) => exactComment\(item, intent, expectedId\)\)/)
  assert.match(facade, /const existing = heldItems\.get\(key\)[\s\S]*if \(existing\) return existing\.result/,
    'repeat activation on one work item shares the logical comment')
  assert.match(facade, /trim\(\)\.slice\(0, WORK_ITEM_COMMENT_MAX\)/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(runtime, /createAcknowledgedActionMutationController/)

  const routeStart = routes.indexOf("r.post('/projects/:id/open-subgoals/:itemId/comments'")
  const routeEnd = routes.indexOf("r.post('/agents/:id/proposals'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  const route = routes.slice(routeStart, routeEnd)
  assert.match(route, /getWorkItemCommentCreation[\s\S]*if \(typeof represented === 'object'\) return sendJson[\s\S]*await body<PostWorkItemCommentRequest>/,
    'represented comment truth returns before changed input can run')
  assert.match(route, /workItemCommentCreationId\(who\.tenant\.id, params\.id, params\.itemId, idempotencyKey\)/)

  const storeStart = store.indexOf('  commentOnOpenSubGoal(', store.indexOf('getWorkItemCommentCreation'))
  const storeEnd = store.indexOf('  retractOpenSubGoal(', storeStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart)
  assert.match(store.slice(storeStart, storeEnd), /return commitMutationBatch\(\(\) => \{[\s\S]*comments\.push[\s\S]*notifyTenants[\s\S]*persist\(\)/,
    'comment, mention fan-out, generic bells, event, and persistence share one commit')
  assert.match(notice, /kind="work-item-comment-create"/)
  assert.match(shell, /<WorkItemCommentCreationMutationNotice \/>/)
})
