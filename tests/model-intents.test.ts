/** Unit tests for the mock model's decision logic (server/model/intents.ts) — the
 *  "fake Anthropic" matching free-typed messages to tool calls by keyword
 *  pattern. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchIntents } from '../server/model/intents.ts'
import { TOOL_NAMES } from '../server/model/tools.ts'

/** The Agent Commons CRUD tools (D6/D9/D10/D7) — Claude managing the multi-tenant
 *  concepts — plus the D26 README setter. Covered by their own keyword tests. */
const COMMONS_TOOLS = ['create_provider', 'create_system_prompt', 'create_agent', 'commission_agent', 'uncommission_agent', 'handoff_agent', 'set_commission_cap', 'set_project_readme']

/** One free-typed phrase per relation/escalation tool — the coverage set for the
 *  completeness invariant below (no tool in the catalog ships unreachable). */
const PHRASES: Record<string, string> = {
  open_workspace: 'Open a workspace and draft the launch assets',
  connect_repo: 'Connect the repo patrick-yingxi-pan/web-app on branch feat/insights-dashboard',
  create_project: 'Create a project called Q3 Planning',
  file_session: 'File this under the Growth experiments project',
  save_artifact: 'Please save a recap of this as recap.md',
  set_schedule_artifact: 'Have the “Triage new GitHub issues” schedule save a digest each run',
  set_schedule_session: 'Have the “Daily AI news briefing” schedule open a fresh session each run',
  schedule_add_tool: 'Let the “Daily AI news briefing” schedule use Slack each run',
  link_schedule_project: 'Link the “Triage new GitHub issues” schedule to the Growth experiments project',
  attach_context: 'Attach Linear to this session',
  scope_context: 'Scope Figma into the Growth experiments project',
  unscope_context: 'Drop Figma from the Growth experiments project',
  set_artifact_source: 'Note that insights-onepager.md derives from the brand-kit/ folder',
  refile_artifact: 'Move query-perf.sheet into the Growth experiments project',
  set_project_instructions: 'Set the instructions for Growth experiments: lead with the metric, then the mechanism',
}

test('every relation/escalation tool in the catalog is reachable by a free-typed phrase', () => {
  const missing = TOOL_NAMES.filter((n) => {
    if (COMMONS_TOOLS.includes(n)) return false
    const phrase = PHRASES[n]
    return !phrase || matchIntents(phrase).at(0)?.name !== n
  })
  assert.deepEqual(missing, [], `tools with no working keyword phrase: ${missing.join(', ')}`)
})

test('the panel escalations match free-typed asks (chat → workspace / repo growth)', () => {
  assert.equal(matchIntents(PHRASES.open_workspace).at(0)?.name, 'open_workspace')
  const repo = matchIntents(PHRASES.connect_repo).at(0)
  assert.equal(repo?.name, 'connect_repo')
  assert.equal(repo?.input.remote, 'patrick-yingxi-pan/web-app')
  assert.equal(repo?.input.branch, 'feat/insights-dashboard')
  // A repo ask never doubles as a connector attach ("the repo" is not a connector).
  assert.equal(matchIntents(PHRASES.connect_repo).length, 1)
})

test('the escalation patterns do not misfire on messages that merely mention the nouns', () => {
  // The verb must sit ON the noun — mentioning a workspace is not asking for one.
  assert.deepEqual(matchIntents('Start a new session in my workspace'), [])
  assert.deepEqual(matchIntents('Which folders are open in my workspace?'), [])
  // A connector attach that merely mentions the repo still attaches the connector.
  const mixed = matchIntents('Attach Linear to this session so it can read the repo')
  assert.equal(mixed.at(0)?.name, 'attach_context')
  assert.equal(mixed.length, 1)
  // An innocent edit is never an unscope proposal (project vocabulary required).
  assert.deepEqual(matchIntents('Remove the last paragraph from the doc'), [])
  // Unnamed project instructions are refused, not resolved to some default
  // project on the caller's behalf (INV-9's shape at the mock's altitude).
  assert.deepEqual(matchIntents('Set the project instructions: be brief'), [])
})

test('keyword matching: free-typed organizing requests pick the right tools', () => {
  assert.equal(matchIntents('Please save a recap of this as recap.md').at(0)?.name, 'save_artifact')
  assert.equal(matchIntents('Have the “Triage new GitHub issues” schedule save a digest each run').at(0)?.name, 'set_schedule_artifact')
  assert.equal(matchIntents('attach Linear to this session').at(0)?.name, 'attach_context')
  assert.equal(matchIntents('file this under the Growth experiments project').at(0)?.name, 'file_session')
  assert.equal(matchIntents('create a project called Q3 Planning').at(0)?.name, 'create_project')
  // D26 — the conversational README (the claim the design log makes, exercised).
  const readme = matchIntents('Write a readme for the Insights dashboard saying “Ship weekly, measure everything.”').at(0)
  assert.equal(readme?.name, 'set_project_readme')
  assert.equal((readme?.input as { readme?: string })?.readme, 'Ship weekly, measure everything.')
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
      'Hand this conversation off to Scout',
      'Set the commission cap on Insights dashboard to 3',
      'Write a readme for the Insights dashboard', // D26 — the conversational README
    ].flatMap((m) => matchIntents(m).map((c) => c.name)),
  )
  for (const t of COMMONS_TOOLS) assert.ok(exercised.has(t), `${t} is exercised by a keyword pattern`)
})

test('an unrecognized message yields no tool calls (a plain-chat turn)', () => {
  assert.deepEqual(matchIntents('what is a vector database?'), [])
})

test('keyword fallback: a hand-off request (hand/switch/pass … to X) routes to handoff_agent (D16)', () => {
  assert.equal(matchIntents('Hand this conversation off to Research scout').at(0)?.name, 'handoff_agent')
  assert.equal(matchIntents('Switch to the Research scout agent').at(0)?.name, 'handoff_agent')
  // It does not collide with commission (different verb + a project target).
  assert.equal(matchIntents('Commission Research scout to the Insights dashboard project').at(0)?.name, 'commission_agent')
})

test('keyword fallback: a commission-cap request (D13) routes to set_commission_cap without colliding with commission', () => {
  // Noun-first phrasing.
  const c1 = matchIntents('Set the commission cap on Insights dashboard to 3').at(0)
  assert.equal(c1?.name, 'set_commission_cap')
  assert.equal((c1?.input as any).project, 'Insights dashboard')
  assert.equal((c1?.input as any).cap, 3)
  // Noun-last phrasing.
  const c2 = matchIntents('Cap Insights dashboard at 2 commissions').at(0)
  assert.equal(c2?.name, 'set_commission_cap')
  assert.equal((c2?.input as any).cap, 2)
  // A bare commission (no count) still routes to commission_agent — the cap never steals it.
  assert.equal(matchIntents('Commission Research scout to the Insights dashboard project').at(0)?.name, 'commission_agent')
})

// ── The co-authoring beat (the cross-tenant E2E scenario) ─────────────────────
// "Draft the … of our article" is a PLAIN-CHAT turn (no tool calls) whose canned
// prose is the article draft — the one mock-side piece of the two-tenant
// co-authoring E2E (e2e/co-author-article.spec.ts). Locks both halves so the
// spec's chat beat can't silently rot: no spurious tool call, and the prose stays
// recognizably the article draft.
test('an article-draft request is a plain-chat turn whose canned prose is the shared-article draft', async () => {
  const { plainReplyText } = await import('../server/model/replies.ts')
  const msg = 'Draft the introduction of our co-authored article.'
  assert.deepEqual(matchIntents(msg), [], 'drafting prose is not a resource manipulation — no tool calls')
  const prose = plainReplyText(msg)
  assert.match(prose, /The Adaptive Workspace/, 'the draft names the shared article')
  assert.match(prose, /Guardian/, 'the draft narrates the coordination it stands on')
  // The generic local-mock pointer must NOT swallow the beat.
  assert.doesNotMatch(prose, /local mock/)
})
