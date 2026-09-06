import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AppNotification } from '../../contract/index.ts'
import { mergeNotificationsRead, notificationsReadRealized } from './notificationReadRevision.ts'

const row = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: 'ntf-1',
  kind: 'social.shared',
  at: 1,
  read: false,
  actor: 'Ada Lovelace',
  subjectKind: 'project',
  subjectId: 'p-1',
  subjectName: 'Project one',
  ...overrides,
})

test('notification-read acknowledgement changes only frozen rows', () => {
  const target = row()
  const sibling = row({ id: 'ntf-2', subjectId: 'p-2', subjectName: 'Project two' })
  const next = mergeNotificationsRead([target, sibling], [target.id])

  assert.equal(next[0]?.read, true)
  assert.equal(next[0]?.subjectName, target.subjectName, 'every unrelated field survives')
  assert.strictEqual(next[1], sibling, 'a notification that arrived outside the frozen set keeps identity')
  assert.strictEqual(mergeNotificationsRead(next, [target.id]), next, 'realized state is referentially stable')
})

test('read recovery accepts read or evicted rows, never a still-unread row', () => {
  assert.equal(notificationsReadRealized([{ id: 'ntf-1', read: true }], ['ntf-1']), true)
  assert.equal(notificationsReadRealized([], ['ntf-1']), true, 'bounded-inbox absence is terminal')
  assert.equal(notificationsReadRealized([{ id: 'ntf-1', read: false }], ['ntf-1']), false)
})
