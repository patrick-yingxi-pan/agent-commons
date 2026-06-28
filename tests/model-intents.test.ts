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

/** The Agent Commons CRUD tools (D6/D9/D10/D7) — Claude managing the multi-tenant
 *  concepts. They're shown via free-typed requests, not the linear narrative tour
 *  (which is the chat→workspace→repo→organize story), so they're excluded from the
 *  tour-completeness invariant and covered by the keyword tests below instead. */
const COMMONS_TOOLS = ['create_provider', 'create_system_prompt', 'create_agent', 'commission_agent', 'uncommission_agent']

test('the tour exercises every relation/escalation tool (the Agent Commons CRUD tools are shown via free-typed requests)', () => {
  const used = new Set(TOUR_TURNS.flatMap((t) => t.calls.map((c) => c.name)))
  const missing = TOOL_NAMES.filter((n) => !used.has(n) && !COMMONS_TOOLS.includes(n))
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

test('keyword fallback: Agent Commons management requests pick the right CRUD tools', () => {
  assert.equal(matchIntents('Register a model provider called Local Llama on the llama family').at(0)?.name, 'create_provider')
  assert.equal(matchIntents('Add a system prompt called Deep research').at(0)?.name, 'create_system_prompt')
  assert.equal(
    matchIntents('Create a worker agent called Research scout on Anthropic with the Deep research prompt').at(0)?.name,
    'create_agent',
  )
  assert.equal(matchIntents('Commission Research scout to the Insights dashboard project').at(0)?.name, 'commission_agent')
  assert.equal(matchIntents('Uncommission Research scout from the Insights dashboard project').at(0)?.name, 'uncommission_agent')
})

test('keyword fallback: a trailing "as <role>" clause sets the commission role without polluting the project', () => {
  const call = matchIntents('Commission Research scout to Insights dashboard as a reader').at(0)
  assert.equal(call?.name, 'commission_agent')
  assert.equal((call?.input as any).role, 'reader')
  // The project name stops before "as" — it isn't captured as "Insights dashboard as a reader".
  assert.equal((call?.input as any).project, 'Insights dashboard')
  // No role clause ⇒ no role on the input (server defaults to writer).
  assert.equal((matchIntents('Commission Research scout to Insights dashboard').at(0)?.input as any).role, undefined)
})

test('keyword fallback: create_agent carries the resolved provider + prompt names for the executor', () => {
  const call = matchIntents('Create a worker agent called Scout on Anthropic with the Deep research prompt').at(0)
  assert.equal(call?.name, 'create_agent')
  assert.equal(call?.input.label, 'Scout')
  assert.equal(call?.input.provider, 'Anthropic')
  assert.equal(call?.input.system_prompt, 'Deep research')
})

test('every Agent Commons CRUD tool is exercised by a keyword pattern (none ships unexercised)', () => {
  const exercised = new Set(
    [
      'Register a model provider called Local Llama',
      'Add a system prompt called Deep research',
      'Create a worker agent called Scout',
      'Commission Scout to the Insights dashboard project',
      'Uncommission Scout from the Insights dashboard project',
    ].flatMap((m) => matchIntents(m).map((c) => c.name)),
  )
  for (const t of COMMONS_TOOLS) assert.ok(exercised.has(t), `${t} is exercised by a keyword pattern`)
})

test('an unrecognized message yields no tool calls (a plain-chat turn)', () => {
  assert.deepEqual(matchIntents('what is a vector database?'), [])
})
