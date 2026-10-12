import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Commission an agent holds one exact assignment until authoritative acknowledgement', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'CommissionAdd.tsx')))
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src', 'components', 'DeferredCommissionAdd.tsx')))
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commissionCreationCommands.ts')))
  const cache = stripComments(read(join(ROOT, 'src', 'api', 'commissionRosterCache.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'commissionCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'commissionCreationMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'CommissionCreationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacy, /export async function createCommission/, 'legacy invalidate-only creation is removed')
  assert.doesNotMatch(view, /createCommission\(/, 'the picker cannot bypass acknowledged creation')
  assert.match(section, /DeferredCommissionAdd as CommissionAdd/, 'the section uses the deferred picker')
  assert.match(deferred, /lazy\(\(\) => import\('\.\/CommissionAdd\.tsx'\)/)
  assert.match(deferred, /Contributor picker unavailable/, 'chunk failure remains visible')
  assert.match(deferred, /disabledReason="Loading contributor picker"/, 'loading cannot create a Commission')
  assert.equal((view.match(/enqueueCommissionCreation\(\{/g) ?? []).length, 1)
  assert.match(view, /tenantId,\s*request: \{ agentId: agent\.id, projectId, role: joinRole \}/,
    'the visible Agent, Project, role, and account become one retained intent')
  assert.match(view, /aria-busy=\{pending !== null\}/)
  assert.match(view, /disabled=\{pending !== null\}/, 'all alternative choices freeze while one assignment is held')
  assert.match(view, /disabled=\{!tenantId \|\| pending !== null\}/, 'the initiating trigger freezes too')
  assert.match(view, /const choices = selectedAgent[\s\S]*\? \[selectedAgent, \.\.\.available\]/,
    'ambient roster truth cannot erase the submitted row before settlement')
  assert.match(view, /isCommissionCreationHeld\(projectId\)/, 'outside click and trigger toggles cannot hide held intent')
  assert.match(view, /Your Contributor choice is still here/, 'Dismiss preserves a visible retry choice')
  assert.match(controller, /intentId: crypto\.randomUUID\(\)/)
  assert.match(controller, /heldProjects/, 'the initiating Project host is held eagerly while transport stays lazy')
  assert.match(controller, /accountGeneration/, 'late acknowledgement is fenced by account scope')
  assert.match(commands, /commissionCreationId\(intent\.tenantId, idempotencyKey\)/,
    'reconciliation proves the exact tenant-scoped assignment')
  assert.match(commands, /apiPost<Commission>[\s\S]*idempotencyKey/, 'Retry retains the logical key')
  assert.match(cache, /mergeCommissionConfiguration\(existing, commission\)/,
    'a delayed create acknowledgement cannot rewind newer Contributor configuration')
  assert.match(store, /id: options\.logicalId \?\? `commission-/,
    'the stable logical key owns durable row identity')
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)
  assert.match(notice, /kind="commission-create"/, 'uncertainty has one shell-owned recovery surface')
  assert.match(shell, /<CommissionCreationMutationNotice \/>/,
    'Contributor creation recovery is mounted exactly once in the shell')
})
