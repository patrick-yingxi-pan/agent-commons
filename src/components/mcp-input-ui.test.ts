import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
test('private form review is lazy, person-read gated, and exposes explicit one-shot choices with honest disclosure', () => {
  const deferred = source('./DeferredMcpInputReview.tsx')
  const panel = source('./McpInputReviewPanel.tsx')
  const card = source('./ToolActivityCard.tsx')
  assert.match(deferred, /lazy\(/)
  assert.doesNotMatch(deferred + panel, /Nothing was sent|No response was sent/,
    'a failed review read cannot claim an earlier external submission did not occur')
  for (const consumer of [deferred, panel]) assert.match(consumer, /MCP_INPUT_READ_DISCLOSURE/)
  assert.match(source('../lib/mcpInputCopy.ts'), /does not send a response or cancel earlier work/)
  assert.match(card, /displayStatus === 'awaiting-input'/)
  assert.match(panel, /useMcpInput\(sessionId, activityId, decisionId\)/)
  assert.match(panel, /if \(!query\.data\?\.review\)/)
  assert.match(panel, /person who approved this call/)
  assert.match(panel, /Continue with responses/)
  assert.match(panel, /Stop locally/)
  assert.match(panel, /cannot undo earlier remote effects/)
  assert.match(panel, /final result may repeat answers in the shared conversation/)
  assert.match(panel, /Don’t enter passwords, API tokens or payment details/)
  assert.match(panel, /namedReadRegionProps\('Private MCP form requests', 'mcp-input'\)/)
  assert.match(panel, /CheckboxRow/)
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML|localStorage|<a\b/)
})

test('shell owns recovery through navigation and no Check status or Review latest act replays POST', () => {
  assert.match(source('./ShellMutationNotices.tsx'), /<McpInputMutationNotice \/>/)
  const shell = source('./McpInputMutationNotice.tsx')
  assert.match(shell, /label: 'Check status'/)
  assert.match(shell, /label: 'Review latest'/)
  assert.doesNotMatch(shell, /beginMcpInput|submitMcpInputOnce/)
  const mutations = source('../controller/mcpInputMutations.ts')
  const recovery = mutations.slice(mutations.indexOf('export async function checkMcpInput'))
  assert.doesNotMatch(recovery, /submitMcpInputOnce\(/)
  assert.match(source('../api/events.ts'), /invalidatePrefix\(keys\.mcpInputPrefix\(e\.session\.id\)\)/)
  assert.match(source('../api/events.ts'), /invalidatePrefix\(keys\.mcpInputPrefix\(\)\)/)
  assert.match(source('../api/mcpInputCommands.ts'), /refreshOpenSession\(sessionId\)/,
    'an acknowledgement heals the open transcript without depending on ambient sync')
})
