import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Coordination exposes release only from server authority and holds it until represented absence', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'projectSubGoalReleaseCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'projectSubGoalReleaseMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'projectSubGoalReleaseMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const guardian = stripComments(read(join(ROOT, 'server', 'guardian.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ProjectSubGoalReleaseMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function releaseSubGoal/)
  assert.match(view, /s\.canRelease === true/)
  assert.match(view, /isProjectSubGoalReleaseHeld\(s\.reservationId\)/)
  assert.match(view, /enqueueProjectSubGoalRelease/)
  assert.match(view, /isProjectSubGoalReleaseScopeHeld\(project\.id, subGoal\)/)
  assert.match(commands, /apiPost<Reservation>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /incoming\.some\(\(claim\) => claim\.reservationId === intent\.reservationId\)/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(runtime, /createAcknowledgedActionMutationController/)

  const subGoalStart = routes.indexOf("r.get('/projects/:id/subgoals'")
  const openWorkStart = routes.indexOf("r.get('/projects/:id/open-subgoals'", subGoalStart)
  assert.ok(subGoalStart >= 0 && openWorkStart > subGoalStart)
  const subGoalRoutes = routes.slice(subGoalStart, openWorkStart)
  assert.match(subGoalRoutes, /projectHiddenFrom/)
  assert.match(subGoalRoutes, /holder !== SELF_PROJECT_HOLDER/)
  assert.match(subGoalRoutes, /projectSubGoals\(params\.id, tenantId\)/)

  const releaseStart = routes.indexOf("r.post('/reservations/:id/release'")
  assert.ok(releaseStart >= 0)
  assert.match(routes.slice(releaseStart, releaseStart + 420), /idempotent[\s\S]*reservationActorDenied/)
  assert.match(guardian, /const \{ ownerTenant, \.\.\.publicRow \} = r/)
  assert.match(guardian, /ownedBy\(reservationId: string, tenantId: string\)/)
  assert.match(notice, /kind="subgoal-release"/)
  assert.match(shell, /<ProjectSubGoalReleaseMutationNotice \/>/)
})
