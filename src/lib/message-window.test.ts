/** Bounded message rendering (PD36): no matter how many cursor pages the
 *  controller has loaded, one conversation pane mounts only one reading window. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { messageWindow } from './messageWindow.ts'

const messages = Array.from({ length: 8 }, (_, index) => ({ id: `m${index + 1}` }))

test('messageWindow defaults to the newest bounded tail', () => {
  const window = messageWindow(messages, null, 3)
  assert.deepEqual(window.items.map((message) => message.id), ['m6', 'm7', 'm8'])
  assert.equal(window.hiddenEarlier, 5)
  assert.equal(window.hiddenNewer, 0)
})

test('messageWindow anchors an older page and reports both hidden directions', () => {
  const window = messageWindow(messages, 'm3', 3)
  assert.deepEqual(window.items.map((message) => message.id), ['m3', 'm4', 'm5'])
  assert.equal(window.hiddenEarlier, 2)
  assert.equal(window.hiddenNewer, 3)
})

test('messageWindow falls back to the newest tail when an anchor disappears', () => {
  assert.deepEqual(messageWindow(messages, 'compacted-away', 3).items.map((message) => message.id), ['m6', 'm7', 'm8'])
  assert.deepEqual(messageWindow(messages, null, 0).items, [], 'a non-positive window never mounts rows')
})
