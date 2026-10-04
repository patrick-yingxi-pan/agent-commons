import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('a conversation pane seeds only exact account-scoped API truth, never bundled demo transcripts', () => {
  const source = readFileSync(new URL('./usePaneConversation.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /import.*SESSIONS|data\/sessions/)
  assert.match(source, /peek<Session>\(keys.session\(sessionId\)\)/)
  assert.match(source, /seed\?\.id === sessionId/)
})
