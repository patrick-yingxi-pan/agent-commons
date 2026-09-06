import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('notification triage owns exact acknowledgement and one shell recovery surface', () => {
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'notificationReadCommands.ts')))
  const revision = stripComments(read(join(ROOT, 'src', 'api', 'notificationReadRevision.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'notificationReadMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'notificationReadMutationRuntime.ts')))
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const row = stripComments(read(join(ROOT, 'src', 'components', 'NotificationList.tsx')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'NotificationReadMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacy, /function markNotificationsRead/, 'the fire-and-forget component door is retired')
  assert.match(commands, /\{ ids: intent\.ids \}/, 'Retry sends the exact frozen row set')
  assert.match(commands, /\{ idempotencyKey \}/, 'Retry retains one transport key')
  assert.match(commands, /apiGet<NotificationReadState\[\]>\(paths\.notificationsReadState\(\.\.\.intent\.ids\)\)/, 'uncertainty reads exact unfiltered row state')
  assert.match(commands, /mergeNotificationsRead/, 'acknowledgement uses an addressed merge')
  assert.match(commands, /invalidate\(keys\.notifications\)/, 'later arrivals come from a fresh projection')
  assert.match(revision, /addressed\.has\(row\.id\)/, 'only frozen rows can change')
  assert.match(facade, /const ids = \[\.\.\.new Set\(input\.ids\)\]\.sort\(\)/, 'the held batch is immutable and canonical')
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/, 'one activation mints one retry identity')
  assert.match(facade, /onAccountSwitch\(\(\) => \{[\s\S]*held\.clear\(\)/, 'account changes fence held work')
  assert.match(runtime, /createAcknowledgedActionMutationController/, 'triage reuses the shared acknowledgement FIFO')
  assert.match(view, /enqueueNotificationRead\(\{ tenantId: me\.tenant\.id, ids: unreadIds \}\)/, 'Mark all freezes the visible unread ids')
  assert.match(view, /heldNotificationReadFor\(n\.id\)/, 'row doors reconstruct held work after navigation')
  assert.match(row, /Waiting for Retry/, 'the row names unresolved state without hiding its door')
  assert.match(notice, /kind="notification-read"/, 'uncertainty has one shell recovery surface')
  assert.equal((shell.match(/<NotificationReadMutationNotice \/>/g) ?? []).length, 1)
})
