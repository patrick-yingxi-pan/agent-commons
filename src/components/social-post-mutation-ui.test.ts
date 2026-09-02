import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('authored social prose stays frozen behind one acknowledgement recovery door', () => {
  const composer = stripComments(read(join(ROOT, 'src', 'components', 'AnchorThreadComposer.tsx')))
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const message = stripComments(read(join(ROOT, 'src', 'components', 'MessageButton.tsx')))
  const locus = stripComments(read(join(ROOT, 'src', 'components', 'LocusGutter.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'socialPostCommands.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'socialPostMutationRuntime.ts')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'RevisionedMutationNotice.tsx')))

  assert.match(runtime, /createAcknowledgedActionMutationController/,
    'thread replies, first posts, DMs, and Commons prose share one acknowledgement FIFO')
  assert.match(commands, /discussionPostId\(intent\.tenantId, intent\.logicalKey\)/,
    'reconciliation proves the exact durable post identity')
  assert.match(commands, /\{ idempotencyKey \}/g,
    'every social-post transport carries the stable logical key')

  assert.doesNotMatch(composer, /\b(openDiscussion|postToDiscussion)\s*\(/,
    'the shared composer cannot bypass acknowledgement')
  assert.match(composer, /if \(result\.outcome === 'applied' && result\.discussion\)[\s\S]*setDraft\(''\)/,
    'only acknowledgement clears the exact thread draft')
  assert.match(composer, /<fieldset disabled=\{held\}/,
    'the retry payload cannot drift while its outcome is unknown')
  assert.match(composer, /useEffect\(\(\) => onHeldChange\?\.\(held\)/,
    'duplicate thread projections inherit the same anchor hold')
  assert.match(composer, /onHeldChange\?\.\(isSocialPostMutationHeld\(subject, anchorLocus\)\)/,
    'one settled projection cannot release a still-queued sibling hold')

  assert.match(section, /enqueueWallPost\([\s\S]*if \(result\.outcome === 'applied'\)[\s\S]*setBody\(''\)/,
    'the Commons composer clears only after acknowledgement')
  assert.match(section, /<fieldset disabled=\{held\}/,
    'the Commons retry payload is frozen too')
  assert.match(section, /title="Discussion"[\s\S]*heldOpen=\{postingHeld\}/,
    'a held section composer cannot be folded away')
  assert.match(section, /onHeldChange=\{setPostingHeld\}/,
    'thread hosts observe and preserve the shared hold')
  assert.match(message, /if \(!held\) setOpen\(false\)/,
    'outside dismissal cannot unmount an uncertain direct message')
  assert.match(message, /onHeldChange=\{setHeld\}/,
    'the direct-message popover observes the same hold')
  assert.match(locus, /disabled=\{postingHeld\}/,
    'a position thread cannot navigate its exact draft away while held')
  assert.match(locus, /onHeldChange=\{setPostingHeld\}/,
    'the position gutter observes the same hold')

  assert.match(shell, /<SocialPostMutationNotice \/>/,
    'Retry and Dismiss remain reachable after navigation')
  assert.match(notice, /data-social-post-mutation=\{kind === 'social-post' \? phase : undefined\}/,
    'rendered recovery has a semantic pending/failed handle')
})
