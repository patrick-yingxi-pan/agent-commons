import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('New organization holds one exact founding intent until authoritative acknowledgement', () => {
  const menu = stripComments(read(join(ROOT, 'src', 'components', 'AccountMenu.tsx')))
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'hooks.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'orgCreationCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'orgCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'orgCreationMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'OrgCreationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacy, /export async function createOrg/, 'legacy fire-and-invalidate founding is removed')
  assert.doesNotMatch(menu, /createOrg\(/, 'the account menu cannot bypass acknowledged founding')
  assert.equal((menu.match(/enqueueOrgCreation\(\{/g) ?? []).length, 1)
  assert.match(menu, /tenantId, request: \{ name \}/, 'the form binds its name to the active account')
  assert.match(menu, /value=\{visibleName\}/, 'the held exact name reconstructs from controller state')
  assert.match(menu, /disabled=\{frozen\}/, 'held form controls cannot race or rewrite the request')
  assert.match(menu, /if \(isOrgCreationHeld\(\)\) return/, 'outside and Escape dismissal cannot erase uncertainty')
  assert.match(menu, /Your organization name is still here/, 'Dismiss preserves the authored name')
  assert.match(controller, /intentId: crypto\.randomUUID\(\)/, 'one form submission owns one logical identity')
  assert.match(controller, /accountGeneration/, 'late acknowledgement is fenced by account scope')
  assert.match(commands, /orgCreationId\(intent\.tenantId, idempotencyKey\)/, 'reconciliation proves the exact tenant-scoped row')
  assert.match(commands, /candidate\.role === 'owner'/, 'a similar organization or non-owner seat cannot satisfy recovery')
  assert.match(commands, /apiPost<Tenant>[\s\S]*idempotencyKey/, 'Retry retains the logical key')
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/, 'transport and durable identity share one key')
  assert.match(notice, /kind="org-create"/, 'uncertainty has one shell-owned recovery surface')
  assert.equal((shell.match(/<OrgCreationMutationNotice \/>/g) ?? []).length, 1)
})
