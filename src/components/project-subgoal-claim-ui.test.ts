import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'

test('Coordination holds one exact claim until acknowledged or authoritatively represented', () => {
  const panel = stripComments(sectionViewComponent('CoordinationPanel'))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'projectSubGoalClaimCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'projectSubGoalClaimMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'projectSubGoalClaimMutationRuntime.ts')))
  const core = stripComments(read(join(ROOT, 'src', 'controller', 'acknowledgedActionMutationCore.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ProjectSubGoalClaimMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function reserveSubGoal/)
  assert.match(panel, /const heldIntent = heldProjectSubGoalClaimIntent\(project\.id\)/)
  assert.match(panel, /setDraft\(heldIntent\.subGoal\)[\s\S]*setHolder\(heldIntent\.holder\)[\s\S]*setClaiming\(true\)/,
    'returning to the Project reconstructs the frozen sub-goal and principal')
  assert.match(panel, /data-subgoal-claim-form[\s\S]*aria-busy=\{claimHeld \|\| undefined\}/)
  assert.match(panel, /disabled=\{claimHeld \|\| isProjectSubGoalReleaseScopeHeld/)
  assert.match(panel, /isProjectSubGoalClaimScopeHeld\(project\.id, s\.subGoal\)/,
    'claim and release cannot cross on the same coordination slot')
  assert.match(panel, /outcome === 'applied'[\s\S]*setClaiming\(false\)[\s\S]*held by another Contributor/,
    'only represented success closes; a represented conflict stays a re-reason prompt')

  assert.match(commands, /apiPost<Reservation>[\s\S]*holder: intent\.holder, subGoal: intent\.subGoal/)
  assert.doesNotMatch(commands, /\{\s*idempotencyKey(?:\s*:|\s*\})/,
    'a 24-hour response replay must not outlive and resurrect the transient Guardian lease')
  assert.match(commands, /reservation\.holder !== intent\.holder \|\| reservation\.status === 'released'/)
  assert.match(commands, /candidate\.reservationId === reservationId/)
  assert.match(commands, /claim\.subGoal === intent\.subGoal[\s\S]*claim\.holder === intent\.holder[\s\S]*claim\.canRelease === true/,
    'lost-response reconciliation proves the exact viewer-owned active claim')
  assert.match(facade, /const existing = heldProjects\.get\(input\.projectId\)[\s\S]*existing\.result/)
  assert.match(facade, /const subGoal = input\.subGoal\.trim\(\)[\s\S]*subGoal,/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /import\('\.\/projectSubGoalClaimMutationRuntime\.ts'\)/)
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(runtime, /error instanceof ApiRequestError && error\.status === 409 \? 'discarded'/)
  assert.match(core, /const rejected = deps\.settleRejected\?\.\(error, entry\.input\)[\s\S]*complete\(entry, rejected\)/)
  assert.match(notice, /kind="subgoal-claim"/)
  assert.match(shell, /<ProjectSubGoalClaimMutationNotice \/>/)
})
