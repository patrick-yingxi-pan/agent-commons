import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('invitation verdicts hold one exact row and action until private receipt truth', () => {
  const menu = stripComments(read(join(ROOT, 'src', 'components', 'AccountMenu.tsx')))
  const view = stripComments(read(join(ROOT, 'src', 'components', 'OrgInvitationMenuSection.tsx')))
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'hooks.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'orgInviteVerdictCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'orgInviteVerdictMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'orgInviteVerdictMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'OrgInviteVerdictMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacy, /export async function resolveMyInvite/, 'legacy component-local verdict transport is removed')
  assert.doesNotMatch(menu, /resolveMyInvite\(/, 'the account menu cannot bypass acknowledged recovery')
  assert.match(menu, /lazy\(\(\) =>[\s\S]*import\('\.\/OrgInvitationMenuSection'\)/, 'low-frequency controls stay out of the boot graph')
  assert.equal((menu.match(/<OrgInvitationMenuSection \/>/g) ?? []).length, 1)
  assert.equal((view.match(/enqueueOrgInviteVerdict\(invitation, verdict\)/g) ?? []).length, 1)
  assert.match(view, /heldOrgInviteVerdictIntents\(\)/, 'a disappeared pending row reconstructs from held state')
  assert.equal((view.match(/disabled=\{!!held\}/g) ?? []).length, 2, 'Accept and Decline freeze together')
  assert.match(view, /held\?\.verdict === 'accept'/, 'the exact accepted action stays named')
  assert.match(view, /held\?\.verdict === 'decline'/, 'the exact declined action stays named')
  assert.match(controller, /invitation: \{ \.\.\.invitation \}/, 'the reviewed invitation is snapshotted')
  assert.match(controller, /intentId: crypto\.randomUUID\(\)/, 'one decision owns one retry identity')
  assert.match(controller, /accountGeneration/, 'account switching fences private invitation state')
  assert.match(commands, /paths\.myInvite\(intent\.invitation\.id\)/, 'reconciliation reads the exact private receipt')
  assert.match(commands, /receipt\.status !== \(intent\.verdict === 'accept' \? 'accepted' : 'declined'\)/)
  assert.match(commands, /TENANT_ROLE_RANK\[membership\.role\] >= TENANT_ROLE_RANK\[intent\.invitation\.role\]/, 'Accept proves a non-demoting represented seat')
  assert.match(commands, /apiPost<MyOrg>[\s\S]*idempotencyKey/, 'Accept Retry retains the logical key')
  assert.match(commands, /apiPost<\{ declined: true \}>[\s\S]*idempotencyKey/, 'Decline Retry retains the logical key')
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)
  assert.match(notice, /kind="org-invite-verdict"/)
  assert.equal((shell.match(/<OrgInviteVerdictMutationNotice \/>/g) ?? []).length, 1)
})
