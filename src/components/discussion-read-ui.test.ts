import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('DM reading freezes the rendered post and owns one cross-navigation recovery surface', () => {
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'discussionReadCommands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'discussionReadMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'discussionReadMutationRuntime.ts')))
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'DiscussionReadMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacy, /function markDiscussionRead/, 'the swallowed fire-and-forget door is retired')
  assert.match(commands, /throughPostId: intent\.throughPostId/, 'apply freezes the exact rendered post')
  assert.match(commands, /\{ idempotencyKey \}/, 'Retry retains one transport identity')
  assert.match(commands, /paths\.discussionReadState\(intent\.discussionId, intent\.throughPostId\)/, 'uncertainty reads exact cursor truth')
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/, 'one activation mints one retry identity')
  assert.match(facade, /held\.get\(resourceId\)/, 'strict-mode and duplicate projections coalesce exact intent')
  assert.match(facade, /onAccountSwitch\(\(\) => \{[\s\S]*held\.clear\(\)/, 'account changes fence held work')
  assert.match(runtime, /createAcknowledgedActionMutationController/, 'read cursors use the shared acknowledgement FIFO')
  assert.match(view, /\(d\?\.unread \?\? 0\) > 0/, 'already-read conversations do not write again on every mount')
  assert.match(view, /throughPostId: newestPostId/, 'the effect addresses the post actually rendered')
  assert.match(view, /data-message-read=\{phase\}/, 'the inbox reconstructs held state after navigation')
  assert.match(notice, /kind="discussion-read"/, 'uncertainty has one shell recovery surface')
  assert.equal((shell.match(/<DiscussionReadMutationNotice \/>/g) ?? []).length, 1)
})
