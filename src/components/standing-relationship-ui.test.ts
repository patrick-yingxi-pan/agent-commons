import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Follow and Watch share one acknowledgement-owned desired-state workflow', () => {
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'standingRelationshipCommands.ts')))
  const revision = stripComments(read(join(ROOT, 'src', 'api', 'standingRelationshipRevision.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'standingRelationshipMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'standingRelationshipMutationRuntime.ts')))
  const follow = stripComments(read(join(ROOT, 'src', 'components', 'FollowButton.tsx')))
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'StandingRelationshipMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const events = stripComments(read(join(ROOT, 'src', 'api', 'events.ts')))

  assert.doesNotMatch(legacy, /function setFollow|function setSocialWatch|function setProjectWatch/, 'page-local mutation doors are retired')
  assert.match(commands, /\{ idempotencyKey \}/, 'Retry retains one transport key')
  assert.match(commands, /apiGet<string\[]>\(paths\.follows\(\)\)/, 'Follow uncertainty reads its exact relationship list')
  assert.match(commands, /paths\.projectWatch\(intent\.subject\.id\)/, 'Project Watch retains the UI/MCP capability seam')
  assert.match(commands, /paths\.socialWatchState\(intent\.subject\.kind, intent\.subject\.id\)/, 'Watch uncertainty reads its exact subject')
  assert.match(commands, /state\.watching === intent\.watching/, 'only desired Watch truth settles')
  assert.match(revision, /item\.actor !== name/, 'Follow patches only matching actors')
  assert.match(revision, /sameSubject\(item\.subject, subject\)/, 'Watch patches only matching subjects')
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/, 'one activation mints one retry identity')
  assert.match(facade, /const existing = held\.get\(resourceId\)/, 'same relationship activations coalesce')
  assert.match(facade, /onAccountSwitch\(\(\) => \{[\s\S]*held\.clear\(\)/, 'account changes fence held work')
  assert.match(runtime, /createAcknowledgedActionMutationController/, 'both controls reuse the shared acknowledgement FIFO')
  assert.match(follow, /enqueueStandingRelationship\([\s\S]*kind: 'follow'/, 'Follow uses the shared controller')
  assert.match(view, /enqueueStandingRelationship\([\s\S]*kind: 'watch'/, 'Watch uses the shared controller')
  assert.match(follow, /Waiting for Retry/, 'Follow reconstructs failure after navigation')
  assert.match(view, /Waiting for Retry/, 'Watch reconstructs failure after navigation')
  assert.match(events, /case 'watch\.changed':[\s\S]*keys\.commons[\s\S]*keys\.projectWatch/, 'ambient Watch changes heal both projections')
  assert.match(notice, /kind="standing-relationship"/, 'uncertainty has one shell recovery surface')
  assert.equal((shell.match(/<StandingRelationshipMutationNotice \/>/g) ?? []).length, 1)
})
