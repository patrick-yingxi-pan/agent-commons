import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Delegate judgment holds one exact authority request until server truth', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'DelegationPanel.tsx')))
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'delegationCreationCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'delegationCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'delegationCreationMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'DelegationCreationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const route = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))

  assert.doesNotMatch(legacy, /export async function createDelegation/,
    'the invalidate-only creation command is removed')
  assert.doesNotMatch(view, /createDelegation\(/,
    'the form cannot bypass acknowledgement-owned creation')
  assert.match(view, /enqueueDelegationCreation\(\{[\s\S]*?tenantId,[\s\S]*?projectId: project\.id,[\s\S]*?request:/)
  assert.match(view, /heldOpen=\{held \|\| editingDelegationId !== null\}/, 'the section cannot fold away held authority intent')
  assert.match(view, /aria-busy=\{held\}/)
  assert.match(view, /disabled=\{held\}/, 'every value-bearing field freezes')
  assert.match(view, /e\.key === 'Escape' && !held/,
    'the keyboard cannot dismiss a form whose request is still unacknowledged')
  assert.match(view, /Your Delegation is still here/, 'Dismiss preserves a visible authored form')
  assert.match(view, /Labor moves; liability stays yours\./,
    'the compact form explains its consequential model without internal rung jargon')

  assert.match(controller, /intentId: crypto\.randomUUID\(\)/)
  assert.match(controller, /heldProjects/, 'the Project host is held eagerly while transport stays lazy')
  assert.match(controller, /accountGeneration/, 'late acknowledgement is fenced by account scope')
  assert.match(commands, /delegationCreationId\([\s\S]*intent\.tenantId,[\s\S]*intent\.projectId,[\s\S]*idempotencyKey/)
  assert.match(commands, /apiPost<Delegation>[\s\S]*idempotencyKey/, 'Retry retains one logical key')
  assert.match(route, /r\.post\('\/projects\/:id\/delegations', idempotent\(/)
  assert.match(route, /if \(represented\) return sendJson\(res, represented\)/,
    'durable replay returns represented authority before parsing changed input')
  assert.match(store, /id = options\.logicalId \?\? `delegation-/)
  assert.match(store, /return commitMutationBatch\(\(\) => \{[\s\S]*delegations\.push\(d\)[\s\S]*persist\(\)/,
    'row, event, and persistence are one store commit')
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)
  assert.match(notice, /kind="delegation-create"/)
  assert.match(shell, /<DelegationCreationMutationNotice \/>/)
})

test('the Delegate form uses end-user language while preserving the authority choices', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'DelegationPanel.tsx')))
  assert.match(view, /label="Delegate judgment"/)
  assert.match(view, /<option value="draft">recommend only<\/option>/)
  assert.match(view, /<option value="decide">decide within policy<\/option>/)
  assert.match(view, /Irreversible action \(always asks you\)/)
  assert.match(view, /No adversarial review/)
  assert.match(view, /Outside contributor/)
})
