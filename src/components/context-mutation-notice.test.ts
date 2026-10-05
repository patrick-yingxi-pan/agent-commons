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
  assert.match(notice, /state\.reconciling \? 'Checking saved context…' : 'Updating context…'/)
  assert.match(notice, /message=\{state\.error\}/)
  assert.match(notice, /label: 'Retry'/)
  assert.match(notice, /state\.dismissible && onDismiss/)
  assert.match(notice, /label: 'Use saved state'/)
  assert.ok(!notice.includes('<button'), 'the recovery button stays in the one shared primitive')

  for (const file of ['ConversationView.tsx', 'ContextPanelView.tsx', 'OverlayPanelDock.tsx']) {
    assert.match(read(`src/components/${file}`), /<ContextMutationNotice\b/, `${file} renders delivery state`)
  }
})

test('conversation composer holds while context truth is pending or retryable', () => {
  const conversation = read('src/components/ConversationView.tsx')
  assert.match(conversation, /isContextMutationHeld\(contextMutation\)/)
  assert.match(conversation, /contextMutation\.busy[\s\S]*Updating context…/)
  assert.match(conversation, /contextMutation\.error[\s\S]*Resolve the context update before sending\./)
})

test('all context-panel tiers reserve recovery space outside the scrollable body', () => {
  const notice = read('src/components/ContextMutationNotice.tsx')
  assert.doesNotMatch(notice, /absolute|pointer-events-none/, 'recovery must not float over saved content')
  assert.match(notice, /data-context-panel-status/)
  const shell = read('src/components/PanelShell.tsx')
  assert.equal((shell.match(/data-panel-body/g) ?? []).length, 3, 'embedded, takeover and docked share the body stamp')
  assert.equal((shell.match(/\{chrome\.footer\}/g) ?? []).length, 3, 'every panel tier reserves the same footer slot')
  assert.match(shell, /style=\{\{ width: width - 1 \}\}/, 'the fixed drawer body excludes its shell border')
  for (const file of ['ContextPanelView.tsx', 'OverlayPanelDock.tsx']) {
    const source = read(`src/components/${file}`)
    assert.match(source, /<PaneChromeContext\.Provider/)
    assert.match(source, /footer:/)
    assert.doesNotMatch(source, /\bfloating\b/)
  }
  const preview = read('src/components/AttachmentPanel.tsx').split('function FileBody(')[1]
  assert.match(preview, /data-attachment-preview=\{item.id\}[^>]*tabIndex=\{0\}/, 'saved text stays keyboard-scrollable when Refresh is disabled')
})
