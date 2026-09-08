import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

const root = process.cwd()
const read = (file: string): string => readFileSync(join(root, file), 'utf8')

test('context mutation delivery uses the shared accessible status/recovery primitive in every host', () => {
  const primitive = read('src/components/InlineOperationStatus.tsx')
  assert.match(primitive, /role=\{tone\}/)
  assert.match(primitive, /aria-live=\{tone === 'status' \? 'polite' : 'assertive'\}/)
  assert.match(primitive, /aria-atomic="true"/)

  const notice = read('src/components/ContextMutationNotice.tsx')
  assert.match(notice, /message="Updating context…"/)
  assert.match(notice, /message=\{state\.error\}/)
  assert.match(notice, /label: 'Retry'/)
  assert.ok(!notice.includes('<button'), 'the recovery button stays in the one shared primitive')

  for (const file of ['ConversationView.tsx', 'ContextPanelView.tsx', 'OverlayPanelDock.tsx']) {
    assert.match(read(`src/components/${file}`), /<ContextMutationNotice\b/, `${file} renders delivery state`)
  }
})

test('conversation composer holds while context truth is pending or retryable', () => {
  const conversation = read('src/components/ConversationView.tsx')
  assert.match(conversation, /isContextMutationHeld\(contextMutation\)/)
  assert.match(conversation, /contextMutation\.busy[\s\S]*Updating context…/)
  assert.match(conversation, /contextMutation\.error[\s\S]*Retry the context update before sending\./)
})
