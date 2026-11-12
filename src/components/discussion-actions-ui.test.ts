import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import { POST_ACT_CLASS } from '../lib/discussionPostAction.ts'
import { FOLDED_POST_CLASS } from '../lib/replyTree.ts'

test('collapsed post identity and synopsis share a contained two-row narrow layout', () => {
  assert.match(FOLDED_POST_CLASS, /(?:^|\s)grid(?:\s|$)/, 'narrow stubs must not squeeze every field onto one line')
  assert.match(FOLDED_POST_CLASS, /grid-cols-\[minmax\(0,1fr\)_auto\]/, 'the synopsis receives the shrinkable first column, separate from age and reply count')
  assert.match(FOLDED_POST_CLASS, /\bsm:flex\b/, 'wide stubs retain their existing inline arrangement')
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.match(view, /data-discussion-post-stub[\s\S]*?className=\{FOLDED_POST_CLASS\}/,
    'the actual collapsed row adopts the shared layout and is enumerable')
  assert.match(view, /data-discussion-post-synopsis className="min-w-0 flex-1 truncate/,
    'the real synopsis is independently measurable and ellipsizes within its own column')
})

test('all seven discussion post controls share a color-neutral 24px target floor', () => {
  assert.match(POST_ACT_CLASS, /\bmin-h-6\b/, '12px icons need a 24px minimum clickable height')
  assert.match(POST_ACT_CLASS, /\bmin-w-6\b/, 'the minimum width must still admit endorsement counts')
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.match(view, /import \{ POST_ACT_CLASS \} from '\.\.\/lib\/discussionPostAction\.ts'/)
  const buttons = [...view.matchAll(/<button\b[\s\S]*?<\/button>/g)]
    .map(match => match[0])
    .filter(button => button.includes('POST_ACT_CLASS') || button.includes('data-discussion-post-action') ||
      button.includes('aria-label={`Unfold ${p.author}') || button.includes('aria-label={branch > 0 ?'))
  assert.equal(buttons.length, 7, 'enumerate every post control, including leading and conditional disclosures')
  const actions = buttons.map(button => {
    assert.match(button, /className=\{`\$\{POST_ACT_CLASS\}/, 'each stamped button adopts the shared floor')
    const action = /data-discussion-post-action="([^"]+)"/.exec(button)?.[1]
    assert.ok(action, 'each shared-floor button is enumerable in rendered review')
    return action
  })
  assert.deepEqual(actions.sort(), ['delete', 'endorse', 'fold-others', 'fold-toggle', 'reply', 'report', 'unfold-branch'])
  assert.match(view, /\$\{FOLD_GUTTER_CLASS\} relative flex h-6 items-center justify-center/,
    'the wider caret is centered over the unchanged indent without a vertical offset')
  assert.match(view, /branch > 0 \? 'sm:min-h-12' : ''/,
    'every branch reserves both 24px targets above the narrow tier, open or collapsed')
})

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
  const postListEnd = view.indexOf('function DiscussionsPanel', postListStart)
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
