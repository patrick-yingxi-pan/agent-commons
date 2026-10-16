import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

const source = (path: string) => stripComments(read(join(ROOT, 'src', path)))

test('every conversation projects the account-scoped exact-turn Stop lifecycle through the shared status slot', () => {
  const pane = source('components/ConversationPane.tsx')
  const view = source('components/ConversationView.tsx')
  const controls = source('components/TurnControls.tsx')
  const api = source('api/commands.ts')
  assert.ok(pane.includes('stopRequest={conv.stopRequest}'))
  assert.ok(view.includes('stopRequest={stopRequest}'))
  assert.ok(controls.includes('<InlineOperationStatus'))
  assert.ok(!controls.includes('<button'), 'Stop and Retry share the existing accessible recovery primitive')
  for (const phase of ['pending', 'requested', 'failed']) assert.ok(controls.includes(`stopping === '${phase}'`), phase)
  assert.ok(controls.includes("'Retry stop'"))
  assert.ok(api.includes('apiPost(paths.turnCancel(sessionId, turnId), undefined, { signal })'), 'the lifecycle signal reaches the real cancellation request')
})

test('a shared conversation retains live reading but never offers owner turn controls', () => {
  const pane = source('components/ConversationPane.tsx')
  const view = source('components/ConversationView.tsx')
  const controls = source('components/TurnControls.tsx')
  assert.ok(pane.includes('const canControlTurn = isDraft || row?.own === true'), 'only an owned server projection or local draft grants turn control')
  assert.ok(pane.includes('canControlTurn={canControlTurn}'))
  assert.ok(pane.includes('onSelectModel={canControlTurn ? selectModel : undefined}'))
  assert.match(view, /const interrupted =\s*canControlTurn &&/, 'viewers cannot regenerate an orphaned owner turn')
  assert.ok(view.includes('disabled={!canControlTurn || generationLocked'), 'viewers cannot send another user turn')
  assert.ok(view.includes('canStop={canControlTurn}'))
  assert.ok(controls.includes('!canStop && streaming'), 'live viewing never silently grants Stop')
})
