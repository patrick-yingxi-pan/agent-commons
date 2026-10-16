import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')
test('the shared conversation surface holds Send and Retry while personal model intent is unacknowledged', () => {
  const view = source('./ConversationView.tsx')
  assert.ok(view.includes('const { held: modelPreferenceHeld } = useModelPreferences()'))
  assert.ok(view.includes('const selectionLocked = busy || compactionHeld || bindingHeld'))
  assert.ok(view.includes('const generationLocked = selectionLocked || modelPreferenceHeld'))
  assert.match(view, /const interrupted =[\s\S]*?!generationLocked/)
  assert.match(view, /disabled=\{!canControlTurn \|\| generationLocked/)
  assert.ok(view.includes('onSelectModel={selectionLocked ? undefined : onSelectModel}'),
    'preference holds retain the provider choices; the picker disables them')
  assert.ok(view.includes('Finish the model preference change before sending.'))
  const wiring = source('../controller/conversationStore.ts')
  assert.match(wiring, /sendMessage: \(sessionId, text, handlers, options\) => sendAfterModelPreference\(/)
  assert.ok(source('../lib/models.ts').includes("export { effortLevelsFor, resolveEffort } from '../../contract/modelEffort.ts'"))
})
