import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Add context retains one exact setup until authoritative acknowledgement', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'savedContextCreationCommands.ts')))
  const revision = stripComments(read(join(ROOT, 'src', 'api', 'savedContextRevision.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'savedContextCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'savedContextCreationMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'SavedContextCreationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacy, /function addSavedContext/, 'the optimistic fire-and-forget command is removed')
  assert.doesNotMatch(legacy, /snap\.contexts\.some\(\(c\) => c\.id === context\.id\)/, 'the client cannot invent a saved row')
  assert.match(commands, /apiPost<SavedContext>[\s\S]*\{ idempotencyKey \}/, 'Retry retains one transport key')
  assert.match(commands, /apiGet<SavedContextsSnapshot>\(paths\.savedContexts\)/, 'uncertainty reads authoritative registry truth')
  assert.match(commands, /left\.id === right\.id && left\.kind === right\.kind/, 'only the exact setup identity settles recovery')
  assert.match(revision, /mergeSavedContextCreationSnapshot/, 'creation has one addressed cache merge')
  assert.match(revision, /mergeSavedContextConnection\(contexts\[index\]!, incoming\)/, 'delayed creation cannot rewind connection truth')
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/, 'one activation mints one logical retry identity')
  assert.match(facade, /const existing = held\.get\(input\.context\.id\)/, 'repeat activation coalesces by context')
  assert.match(facade, /onAccountSwitch\(\(\) => \{[\s\S]*held\.clear\(\)[\s\S]*clearSavedContextCreations/, 'account changes fence held setup')
  assert.match(runtime, /createAcknowledgedActionMutationController/, 'setup reuses the shared acknowledgement FIFO')
  assert.match(view, /isSavedContextCreationHeld\(id\)[\s\S]*isSavedContextConnectionHeld\(id\)/, 'create, status, and removal exclude each other')
  assert.match(view, /pendingLabel === 'Adding…'/, 'the selected catalog row exposes in-place progress')
  assert.match(view, /Waiting for Retry/, 'the row remains visibly held after failure')
  assert.match(view, /enqueueSavedContextCreation\(\{ tenantId: me\.tenant\.id, context: ctx \}\)/, 'the active account owns the exact setup')
  assert.match(notice, /kind="saved-context-create"/, 'uncertainty has one shell recovery surface')
  assert.equal((shell.match(/<SavedContextCreationMutationNotice \/>/g) ?? []).length, 1)
})
