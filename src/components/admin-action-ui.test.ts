import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('every maintainer security action uses one acknowledgement owner and shell recovery surface', () => {
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'hooks.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'adminActionCommands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'adminActionMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'adminActionMutationRuntime.ts')))
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'AdminActionMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacy, /function adminDeactivateUser|function adminRevokeToken|function adminRevokeInvite/)
  assert.match(commands, /\{ idempotencyKey \}/, 'Retry retains one transport identity')
  assert.match(commands, /adminActionRealized\(state, intent\)/, 'apply and recovery require exact desired state')
  assert.equal((commands.match(/apiGet<AdminActionState>\(paths\.admin/g) ?? []).length, 3, 'uncertainty reads each action itself')
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/, 'one confirmation mints one retry identity')
  assert.match(facade, /held\.get\(resourceId\)/, 'duplicate admin projections coalesce one exact action')
  assert.match(facade, /onAccountSwitch\(\(\) => \{[\s\S]*held\.clear\(\)/, 'account changes fence held work')
  assert.match(runtime, /createAcknowledgedActionMutationController/, 'all three actions share the acknowledgement FIFO')
  assert.equal((view.match(/action=\{\{ kind: 'revoke-token'/g) ?? []).length, 2, 'both token projections share one action target')
  assert.equal((view.match(/action=\{\{ kind: 'revoke-invite'/g) ?? []).length, 1)
  assert.equal((view.match(/action=\{\{ kind: 'deactivate-user'/g) ?? []).length, 1)
  assert.match(view, /data-admin-action=\{phase\}/, 'held state reconstructs after navigation')
  assert.match(view, /if \(!armed\)/, 'the existing two-step destructive confirmation remains')
  assert.match(notice, /kind="admin-action"/)
  assert.equal((shell.match(/<AdminActionMutationNotice \/>/g) ?? []).length, 1)
})
