import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('owner invitation actions hold exact form/row truth through durable acknowledgement', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'hooks.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'orgInviteOwnerCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'orgInviteOwnerMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'orgInviteOwnerMutationRuntime.ts')))
  const events = stripComments(read(join(ROOT, 'src', 'api', 'events.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'OrgInviteOwnerMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacy, /export async function (inviteToOrg|revokeOrgInvite)/, 'legacy local transport is removed')
  assert.doesNotMatch(view, /\b(inviteToOrg|revokeOrgInvite)\(/, 'the member panel cannot bypass recovery')
  assert.equal((view.match(/enqueueOrgInviteIssue\(\{/g) ?? []).length, 1)
  assert.equal((view.match(/enqueueOrgInviteRevoke\(org\.id, invitation\)/g) ?? []).length, 1)
  assert.match(view, /const visibleEmail = heldIssue\?\.request\.email \?\? email/, 'held issuance reconstructs exact prose')
  assert.match(view, /heldOrgInviteRevokes\(org\.id\)/, 'an early-disappeared revoked row reconstructs')
  assert.ok((view.match(/disabled=\{ownerActionHeld\}/g) ?? []).length >= 2, 'row action and input freeze together')
  assert.match(view, /ownerActionHeld \|\| !visibleEmail\.trim\(\) \|\| !ledgerReady \|\| duplicatePending/)
  assert.match(view, /'Invite held'/)
  assert.match(view, /'Revoke held'/)
  assert.match(controller, /baselineInviteIds: input\.baselineInvites\.map/, 'issue snapshots the complete loaded ledger')
  assert.match(controller, /invitation: \{ \.\.\.invitation \}/, 'revoke snapshots the exact reviewed row')
  assert.equal((controller.match(/intentId: crypto\.randomUUID\(\)/g) ?? []).length, 2)
  assert.match(controller, /accountGeneration/, 'account switches fence private owner actions')
  assert.match(commands, /orgInviteCreationId\(intent\.orgId, intent\.ownerUserId, idempotencyKey\)/)
  assert.match(commands, /!intent\.baselineInviteIds\.includes\(invitation\.id\)/, 'only exact or post-snapshot issue truth reconciles')
  assert.match(commands, /apiPost<OrgInviteRow>[\s\S]*idempotencyKey/)
  assert.match(commands, /apiDelete<OrgInviteRow>[\s\S]*idempotencyKey/)
  assert.match(commands, /if \(!hadCache\) setData\(key, incoming\)/, 'a crossed full read cannot erase a loaded newer ledger')
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)
  assert.match(events, /case 'org\.invitation\.changed':[\s\S]*revalidateAll\(\)/, 'live Accept widens already-open devices')
  assert.match(notice, /kind="org-invite-owner"/)
  assert.equal((shell.match(/<OrgInviteOwnerMutationNotice \/>/g) ?? []).length, 1)
})
