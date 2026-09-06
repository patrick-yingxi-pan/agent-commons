import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Commons Like owns acknowledgement, exact recovery, and one shell notice', () => {
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commonsLikeCommands.ts')))
  const revision = stripComments(read(join(ROOT, 'src', 'api', 'commonsLikeRevision.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'commonsLikeMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'commonsLikeMutationRuntime.ts')))
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'CommonsLikeMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const events = stripComments(read(join(ROOT, 'src', 'api', 'events.ts')))

  assert.doesNotMatch(legacy, /function setCommonsLike/, 'the page-local mutation door is retired')
  assert.match(commands, /\{ idempotencyKey \}/, 'Retry retains one transport key')
  assert.match(commands, /apiGet<CommonsLikeState>\(paths\.commonsLike\(intent\.itemId\)\)/, 'uncertainty reads the exact item relationship')
  assert.match(commands, /state\.liked === intent\.liked/, 'only desired viewer truth settles')
  assert.match(commands, /mergeCommonsLikeMembership/, 'acknowledgement uses the addressed merge')
  assert.match(commands, /invalidate\(keys\.commons\)/, 'public aggregate ordering comes from a fresh projection')
  assert.doesNotMatch(revision, /likes:/, 'acknowledgement never rewrites a crossed public count')
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/, 'one activation mints one retry identity')
  assert.match(facade, /const existing = held\.get\(resourceId\)/, 'same-item activations coalesce')
  assert.match(facade, /onAccountSwitch\(\(\) => \{[\s\S]*held\.clear\(\)/, 'account changes fence held work')
  assert.match(runtime, /createAcknowledgedActionMutationController/, 'Like reuses the shared acknowledgement FIFO')
  assert.match(view, /enqueueCommonsLike\([\s\S]*itemId: item\.id/, 'the one Like control uses the controller')
  assert.match(view, /Waiting for Retry/, 'the control reconstructs failure after navigation')
  assert.match(events, /case 'commons-like\.changed':[\s\S]*invalidate\(keys\.commons\)/, 'ambient count or membership changes heal the feed')
  assert.match(notice, /kind="commons-like"/, 'uncertainty has one shell recovery surface')
  assert.equal((shell.match(/<CommonsLikeMutationNotice \/>/g) ?? []).length, 1)
})
