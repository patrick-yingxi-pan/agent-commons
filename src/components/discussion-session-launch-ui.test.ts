import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

function discussionPage(): string {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const start = view.indexOf('function DiscussionPage')
  const end = view.indexOf('function DiscussionsSection', start)
  assert.ok(start >= 0 && end > start)
  return view.slice(start, end)
}

test('Discuss with Claude holds one durable handoff until exact Session truth', () => {
  const host = discussionPage()
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'discussionSessionLaunchCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'discussionSessionLaunchMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'discussionSessionLaunchMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'DiscussionSessionLaunchMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(host, /createSession\(|sendMessage\(/,
    'the rendered action cannot bypass acknowledgement or the conversation store')
  assert.match(host, /enqueueDiscussionSessionLaunch\(\{[\s\S]*tenantId,[\s\S]*discussionId: d\.id,[\s\S]*digest: discussionDigest\(d\)/)
  assert.match(host, /disabled=\{launchHeld \|\| !tenantId\}/)
  assert.match(host, /aria-busy=\{launchHeld \|\| undefined\}/)
  assert.match(host, /launchHeld \? 'Starting conversation…' : 'Discuss with Claude'/)
  assert.match(host, /discussionMountedRef\.current[\s\S]*discussionLocationRef\.current === origin/,
    'a late acknowledgement cannot steal navigation after the source changes')
  assert.match(host, /The conversation wasn’t started/,
    'Dismiss releases the exact page action with an in-place explanation')

  assert.match(controller, /intentId: crypto\.randomUUID\(\)/)
  assert.match(controller, /heldDiscussions/)
  assert.match(controller, /const existing = heldDiscussions\.get\(input\.discussionId\)[\s\S]*if \(existing\) return existing/,
    'repeat activation shares the held result instead of enqueuing another Session')
  assert.match(controller, /accountGeneration/)
  assert.match(controller, /import\('\.\/discussionSessionLaunchMutationRuntime\.ts'\)/,
    'the low-frequency handoff transport stays outside the cold graph')
  assert.match(commands, /createSession\(intent\.digest, \{[\s\S]*idempotencyKey,[\s\S]*persistFirstMessage: true/)
  assert.match(commands, /sessionCreationId\(intent\.tenantId, idempotencyKey\)/,
    'reconciliation reads the exact tenant-scoped Session')
  assert.match(runtime, /conversations\.reset\(session\.id, liveFromSession\(session\)/)
  assert.match(runtime, /conversations\.retryTurn\(session\.id\)/,
    'generation reuses the committed user tail instead of appending the digest again')
  assert.match(notice, /kind="discussion-session-launch"/)
  assert.match(shell, /<DiscussionSessionLaunchMutationNotice \/>/)
})
