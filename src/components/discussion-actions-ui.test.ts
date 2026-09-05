import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('discussion reaction, report, and lifecycle actions wait for exact server truth', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const stateCommands = stripComments(read(join(ROOT, 'src', 'api', 'discussionStateCommands.ts')))
  const stateRevision = stripComments(read(join(ROOT, 'src', 'api', 'discussionStateRevision.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'discussionStateMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'discussionStateMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'DiscussionStateMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  const postListStart = view.indexOf('function DiscussionPostList')
  const postListEnd = view.indexOf('const POST_ACT_CLASS', postListStart)
  assert.ok(postListStart >= 0 && postListEnd > postListStart)
  const postList = view.slice(postListStart, postListEnd)
  assert.match(postList, /onReact: \(pid: string, reacted: boolean\) => Promise<void>/)
  assert.match(postList, /await onReact\(post\.id, post\.reacted !== true\)/,
    'retryable endorsement expresses the desired result instead of toggling')
  assert.match(postList, /disabled=\{held \|\| reacting\.has\(p\.id\)\}/)
  assert.match(postList, /catch \(error\)[\s\S]*Could not update that endorsement/,
    'a failed endorsement stays visibly retryable')

  const reportStart = postList.indexOf('const report = async')
  const reportEnd = postList.indexOf('\n  const row =', reportStart)
  assert.ok(reportStart >= 0 && reportEnd > reportStart)
  const reportAction = postList.slice(reportStart, reportEnd)
  assert.ok(
    reportAction.indexOf('await onReport(postId)') < reportAction.indexOf('setReported('),
    'Reported never paints before acknowledgement',
  )
  assert.match(postList, /p\.reported === true \|\| reported\.has\(p\.id\)/,
    'the durable viewer receipt survives navigation and reload')
  assert.match(postList, /disabled=\{held \|\| isReported \|\| isReporting\}/)

  assert.doesNotMatch(commands, /export async function setDiscussionState/,
    'the old fire-and-forget lifecycle command is removed')
  assert.doesNotMatch(view, /\bsetDiscussionState\(/,
    'rendered surfaces cannot bypass lifecycle acknowledgement recovery')
  assert.equal((view.match(/useDiscussionStateStatus\(\)/g) ?? []).length, 2,
    'both lifecycle-capable canonical hosts subscribe to shell-held state')
  assert.ok((view.match(/postingHeld \|\| deletionHeld \|\| stateHeld/g) ?? []).length >= 3,
    'compose, deletion, folding, and lifecycle controls freeze as one reviewed thread')
  assert.match(view, /enqueueDiscussionState\(root, root\.state === 'open' \? 'resolved' : 'open'\)/)
  assert.match(view, /enqueueDiscussionState\(d, d\.state === 'open' \? 'resolved' : 'open'\)/)

  assert.match(commands, /\{ reacted \} satisfies SetDiscussionReactionRequest[\s\S]*idempotencyKey: crypto\.randomUUID\(\)/)
  assert.match(commands, /acknowledged\?\.reported !== true/)
  assert.match(commands, /posts: current\.posts\.map[\s\S]*reported: true/,
    'report acknowledgement merges only the addressed post')
  assert.match(stateRevision, /expectedStateRevision: number/)
  assert.match(stateRevision, /`discussion-state:\$\{intent\.discussionId\}`/)
  assert.match(controller, /expectedStateRevision: discussion\.stateRevision/)
  assert.match(controller, /intentId: crypto\.randomUUID\(\)/)
  assert.match(controller, /heldStates/)
  assert.match(controller, /accountGeneration/)
  assert.match(stateCommands, /expectedStateRevision: intent\.expectedStateRevision/)
  assert.match(stateCommands, /\{ idempotencyKey \}/)
  assert.match(stateCommands, /peek<Discussion\[\]>\(keys\.discussions/,
    'crossed acknowledgement checks the canonical subject projection as well as exact detail')
  assert.match(stateCommands, /newest\.stateRevision > discussion\.stateRevision/,
    'a crossed acknowledgement cannot rewind newer lifecycle truth')
  assert.match(runtime, /status === 409[\s\S]*review it again/)
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)
  assert.match(notice, /kind="discussion-state"/)
  assert.equal((shell.match(/<DiscussionStateMutationNotice \/>/g) ?? []).length, 1)
})
