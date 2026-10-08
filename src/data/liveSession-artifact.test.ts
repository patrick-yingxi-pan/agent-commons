import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detachOperationsForFocuses, addContextToLive, bindingsFor, focusForAdded, removeContextsFromLive, EMPTY_LIVE } from './liveSession.ts'

test('saved Artifact contexts add, focus, and remove as read-only references without effect bindings', () => {
  const attachment = {
    id: 'artifact::launch%2Fbrief',
    label: 'Launch brief',
    kind: 'artifact',
    artifactSnapshot: {
      version: 1,
      snapshotId: '11111111-1111-4111-8111-111111111111',
      capturedAt: '2026-10-08T12:00:00.000Z',
      artifactId: 'launch/brief',
      title: 'Launch brief',
      artifactKind: 'doc',
      revision: 7,
      body: { type: 'doc', title: 'Launch brief', blocks: [{ p: 'Saved source text' }] },
    },
  }
  const context = { kind: 'artifact', attachment } as never
  const added = addContextToLive(EMPTY_LIVE, context)
  const focus = focusForAdded(context, added)

  assert.deepEqual(added.attachments, [attachment], 'the complete immutable copy is the live panel payload')
  assert.deepEqual(focus, { kind: 'artifact', id: attachment.id })
  assert.deepEqual(bindingsFor(context), [], 'saved references do not grant effect access')
  assert.deepEqual(detachOperationsForFocuses(added, [focus!] as never), [], 'removing the panel emits no effect detach')

  const other = { id: 'artifact::other', label: 'Other copy', kind: 'artifact' }
  const withOther = addContextToLive(added, { kind: 'artifact', attachment: other } as never)
  const removed = removeContextsFromLive(withOther, [focus!] as never)
  assert.deepEqual(removed.attachments, [other], 'remove targets only the selected Artifact context')
})
