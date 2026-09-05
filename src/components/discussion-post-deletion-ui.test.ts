import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('discussion deletion holds exact reviewed effects through acknowledgement and recovery', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'discussionPostDeletionCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'discussionPostDeletionMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'discussionPostDeletionMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'DiscussionPostDeletionMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacy, /export async function deleteDiscussionPost/, 'legacy fire-and-forget deletion is removed')
  assert.doesNotMatch(view, /\bdeleteDiscussionPost\(/, 'rendered surfaces cannot bypass acknowledgement recovery')
  assert.match(view, /const postIds = cascade\s*\? \[confirmDelete\.id, \.\.\.under\]\s*:\s*\[confirmDelete\.id\]/)
  assert.match(view, /enqueueDiscussionPostDeletion\(\{[\s\S]*post: confirmDelete,[\s\S]*postIds,[\s\S]*cascade,/)
  assert.equal((view.match(/deletion=\{\{ discussionId:/g) ?? []).length, 2, 'both canonical thread hosts supply deletion identity')
  assert.match(view, /deletion=\{standalone && root \? \{ discussionId:/, 'the standalone post page keeps moderation')
  assert.match(view, /data-discussion-post-id=\{p\.id\}/)
  assert.match(view, /data-discussion-post-deletion=\{deletionPhase\}/)
  assert.ok((view.match(/disabled=\{held\}/g) ?? []).length >= 5, 'fold, reply, react, and delete freeze together')
  const deletionControl = view.slice(
    view.indexOf('{deletion && p.canDelete === true && ('),
    view.indexOf('{onReport && p.canDelete !== true && ('),
  )
  assert.match(deletionControl, /<button[\s\S]*?disabled=\{held\}[\s\S]*?aria-label=/, 'the irreversible control itself freezes')
  assert.match(view, /const threadHeld = postingHeld \|\| deletionHeld/, 'host-level compose and lifecycle acts freeze too')

  assert.match(controller, /post: \{ \.\.\.input\.post \}/, 'the exact reviewed post is snapshotted eagerly')
  assert.match(controller, /postIds: \[\.\.\.input\.postIds\]/, 'the complete reviewed effect is frozen')
  assert.equal((controller.match(/intentId: crypto\.randomUUID\(\)/g) ?? []).length, 1)
  assert.match(controller, /accountGeneration/, 'account switches fence private held state and late work')
  assert.match(commands, /expectedPostIds: \[\.\.\.intent\.postIds\]/)
  assert.match(commands, /apiDelete<DeleteDiscussionPostResponse>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /withoutReviewedPosts\(current, intent\)/, 'a crossed acknowledgement mutates only addressed absence')
  assert.match(commands, /setData<Discussion \| undefined>\(key, undefined\)/, 'dissolution records known exact absence')
  assert.match(commands, /error instanceof ApiRequestError && error\.status === 404[\s\S]*acceptDeletion\(intent, null\)/)
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)
  assert.match(runtime, /status === 409[\s\S]*review it again/)
  assert.match(notice, /kind="discussion-post-delete"/)
  assert.equal((shell.match(/<DiscussionPostDeletionMutationNotice \/>/g) ?? []).length, 1)
})
