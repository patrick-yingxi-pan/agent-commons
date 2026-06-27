/** Unit tests for the mock model's decision logic (server/model/intents.ts) — the
 *  "fake Anthropic" matching messages to tool calls by fixed string (the tour) and
 *  by keyword pattern (free-typed). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchIntents, TOUR_TURNS } from '../server/model/intents.ts'
import { TOOL_NAMES } from '../server/model/tools.ts'

test('every tour beat resolves to exactly the tool calls it scripts (fixed-string match)', () => {
  for (const turn of TOUR_TURNS) {
    const calls = matchIntents(turn.text)
    assert.deepEqual(
      calls.map((c) => c.name),
      turn.calls.map((c) => c.name),
      `tour beat: ${turn.text.slice(0, 40)}…`,
    )
  }
})

test('the tour exercises ALL possible case manipulation — every tool appears in its traffic', () => {
  const used = new Set(TOUR_TURNS.flatMap((t) => t.calls.map((c) => c.name)))
  const missing = TOOL_NAMES.filter((n) => !used.has(n))
  assert.deepEqual(missing, [], `tools never exercised by the tour: ${missing.join(', ')}`)
})

test('the tour has two no-tool beats (the plain-chat + wrap turns)', () => {
  const noTool = TOUR_TURNS.filter((t) => t.calls.length === 0)
  assert.equal(noTool.length, 2)
})

test('whitespace differences do not break the fixed-string match', () => {
  const turn = TOUR_TURNS[0]
  const spaced = `  ${turn.text.replace(/ /g, '  ')}  `
  assert.equal(matchIntents(spaced).length, turn.calls.length)
})

test('keyword fallback: free-typed organizing requests pick the right tools', () => {
  assert.equal(matchIntents('Please save a recap of this as recap.md').at(0)?.name, 'save_artifact')
  assert.equal(matchIntents('Have the “Triage new GitHub issues” schedule save a digest each run').at(0)?.name, 'set_schedule_artifact')
  assert.equal(matchIntents('attach Linear to this session').at(0)?.name, 'attach_context')
  assert.equal(matchIntents('file this under the Growth experiments project').at(0)?.name, 'file_session')
  assert.equal(matchIntents('create a project called Q3 Planning').at(0)?.name, 'create_project')
})

test('an unrecognized message yields no tool calls (a plain-chat turn)', () => {
  assert.deepEqual(matchIntents('what is a vector database?'), [])
})
