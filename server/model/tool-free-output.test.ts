/** Authored responses only: all five dedicated workflows share visible-answer
 * semantics without exposing opaque reasoning or acquiring tool authority. */
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Agent, ChangesetVersion } from '../../contract/index.ts'
import type { ProviderConfig } from '../data/providers.ts'
import type { ModelUsage, ModelUsageHandler } from '../modelUsage.ts'
import type { DelegatedJudgmentInput } from '../delegatedJudgmentResult.ts'
import {
  generateContributionReview, generateDelegatedJudgment, generateCommissionMcpArguments,
  generateAgentRequestArguments, generateAgentRequestReply,
} from '../generate.ts'
import { prepareAgentRequestArguments } from '../proxyArgumentPreparation.ts'
import { prepareAgentRequestReply } from '../proxyReplyPreparation.ts'
import { prepareCommissionMcpInput } from '../commissionMcpPreparation.ts'
import { mcpToolSchemaHash } from '../mcpToolAdmission.ts'

const HIDDEN = 'TOOL_FREE_HIDDEN_REASONING_CANARY'
const agent: Agent = { id: 'tool-free-agent', label: 'Reviewed Agent', tools: [],
  systemPrompt: 'Use reviewed facts.', instructions: 'Be concise.' }
const changeset: ChangesetVersion = { version: 4, at: 123, by: 'Reviewed author', entries: [
  { id: 'entry-one', kind: 'instructions', target: 'release rule', before: 'old', after: 'new' },
] }
const judgment: DelegatedJudgmentInput = {
  policy: { actKind: 'approve-envelope', mode: 'decide', policy: 'Approve one read-only change.',
    escalation: ['effectful', 'unreviewed'], revision: 7 },
  changeset, envelope: null,
  risk: { effectful: false, unreviewed: false, stranger: false, readOnlyEnvelope: true },
}
const tool = { name: 'search', description: 'Search reviewed sources.', inputSchema: {
  type: 'object' as const, properties: { query: { type: 'string' }, scope: { type: 'string' } },
  required: ['query', 'scope'], additionalProperties: false,
} }
const permission = { connectionId: `mcp-connection-${'a'.repeat(32)}`, connectionRevision: 7,
  toolName: tool.name, schemaHash: mcpToolSchemaHash(tool), fixedArguments: { scope: 'project' } }
const arguments_ = { query: 'Reviewed release notes', scope: 'project' }
const argumentAnswer = { toolName: tool.name, arguments: arguments_ }
const commission = prepareCommissionMcpInput({ agent,
  project: { id: 'tool-free-project', name: 'Reviewed project', description: 'A small workspace.',
    instructions: 'Use primary sources.', updatedAt: 1, scheduled: [], contexts: [], sessionIds: [] },
  work: { itemId: 'item-a', subGoal: 'Search reviewed source', type: 'mcp.mutate', target: tool.name, note: 'Use recent findings.' },
  tool, permission,
})

interface Workflow {
  label: string
  answer: unknown
  expected: unknown
  errorName: string
  invoke(provider: ProviderConfig, record: ModelUsageHandler): Promise<unknown>
}
const review = { summary: 'One reviewed concern.', findings: [{ entryId: 'entry-one', body: 'Preserve rollback.' }] }
const verdict = { decision: 'approve', summary: 'The reviewed policy admits this change.' }
const reply = 'The reviewed delivery is on track.'
const workflows: Workflow[] = [
  { label: 'Contribution review', answer: review, expected: review, errorName: 'ContributionReviewGenerationError',
    invoke: (config, record) => generateContributionReview(changeset, agent, config, record) },
  { label: 'delegated judgment', answer: verdict, expected: verdict, errorName: 'DelegatedJudgmentGenerationError',
    invoke: (config, record) => generateDelegatedJudgment(judgment, config, record) },
  { label: 'Commission arguments', answer: argumentAnswer,
    expected: { connectionId: permission.connectionId, connectionRevision: 7, toolName: tool.name,
      schemaHash: permission.schemaHash, arguments: arguments_ }, errorName: 'CommissionMcpPreparationOutputError',
    invoke: (config, record) => generateCommissionMcpArguments(commission, config, undefined, record) },
  { label: 'Agent Request arguments', answer: argumentAnswer, expected: argumentAnswer, errorName: 'ProxyArgumentPreparationOutputError',
    invoke: (config, record) => generateAgentRequestArguments(
      prepareAgentRequestArguments({ task: 'Find reviewed notes.', agent, tool }), config, undefined, record) },
  { label: 'Agent Request reply', answer: reply, expected: reply, errorName: 'ProxyReplyPreparationOutputError',
    invoke: (config, record) => generateAgentRequestReply(
      prepareAgentRequestReply({ task: 'Explain delivery status.', agent, notes: 'Use reviewed notes.' }), config, undefined, record) },
]
const flavors = [
  { label: 'Claude Messages', protocol: 'anthropic-messages' as const, baseURL: 'https://tool-free.invalid', path: '/v1/messages' },
  { label: 'DeepSeek Messages', protocol: 'anthropic-messages' as const, baseURL: 'https://tool-free.invalid/anthropic', path: '/anthropic/v1/messages' },
  { label: 'native Responses', protocol: 'openai-responses' as const, baseURL: 'https://tool-free.invalid/v1', path: '/v1/responses' },
]
type Flavor = typeof flavors[number]
const thinking = { type: 'thinking', thinking: HIDDEN, signature: `signature-${HIDDEN}` }
const redacted = { type: 'redacted_thinking', data: `redacted-${HIDDEN}` }
const reasoning = { type: 'reasoning', id: 'rs-tool-free', summary: [], encrypted_content: `encrypted-${HIDDEN}` }
const variants = [
  { label: 'plain-text control', hidden: [] },
  { label: 'thinking', hidden: [thinking] },
  { label: 'redacted thinking', hidden: [redacted] },
  { label: 'thinking and redacted thinking', hidden: [thinking, redacted] },
]

function answerText(workflow: Workflow): string {
  return typeof workflow.answer === 'string' ? workflow.answer : JSON.stringify(workflow.answer)
}
function response(flavor: Flavor, content: unknown[], stop = 'end_turn'): Response {
  if (flavor.protocol === 'openai-responses') return Response.json({ id: 'resp-tool-free', object: 'response',
    status: stop === 'end_turn' ? 'completed' : 'incomplete',
    ...(stop !== 'end_turn' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    output: content, usage: { input_tokens: 25, output_tokens: 11 } })
  return Response.json({ id: 'msg-tool-free', type: 'message', role: 'assistant', model: 'tool-free-model',
    content, stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 17, output_tokens: 11, cache_creation_input_tokens: 3, cache_read_input_tokens: 5 } })
}
function install(t: TestContext, flavor: Flavor, result: Response) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    // This intercepts every outbound request; the reserved hostname is never contacted.
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
    assert.equal(requests.length, 1, 'the dedicated workflow must never start a second attempt')
    return result
  })
  const config: ProviderConfig = { protocol: flavor.protocol, baseURL: flavor.baseURL, model: 'tool-free-model' }
  return { config, assertRequest() {
    assert.equal(requests.length, 1)
    assert.equal(new URL(requests[0].url).pathname, flavor.path)
    const body = requests[0].body
    assert.equal(body.model, config.model)
    for (const field of ['tools', 'tool_choice']) assert.equal(Object.hasOwn(body, field), false, `${field} remains absent`)
    assert.ok(!JSON.stringify(body).includes(HIDDEN), 'opaque response bytes never re-enter a request')
  } }
}

for (const flavor of flavors) for (const workflow of workflows) {
  const accepted = flavor.protocol === 'openai-responses'
    ? [{ label: 'opaque reasoning', hidden: [reasoning] }]
    : variants
  for (const variant of accepted) {
    test(`${flavor.label} ${workflow.label} accepts ${variant.label} with one visible answer`, async t => {
      const text = answerText(workflow)
      const visible = flavor.protocol === 'openai-responses'
        ? { id: 'msg-visible', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
        : { type: 'text', text }
      const fixture = install(t, flavor, response(flavor, [...variant.hidden, visible]))
      const usage: ModelUsage[] = []
      try {
        const result = await workflow.invoke(fixture.config, row => usage.push(row))
        assert.deepEqual(result, workflow.expected)
        assert.ok(!JSON.stringify(result).includes(HIDDEN), 'hidden reasoning is neither answer prose nor parsed arguments')
      } finally {
        fixture.assertRequest()
        assert.deepEqual(usage, [{ inputTokens: 25, outputTokens: 11 }], 'completed usage records exactly once, including cache tokens once')
      }
    })
  }
}

const invalid = [
  { label: 'malformed thinking', content: (text: string) => [{ type: 'thinking', thinking: 42, signature: HIDDEN }, { type: 'text', text }] },
  { label: 'missing thinking signature', content: (text: string) => [{ type: 'thinking', thinking: HIDDEN }, { type: 'text', text }] },
  { label: 'malformed redacted thinking', content: (text: string) => [{ type: 'redacted_thinking', data: 42 }, { type: 'text', text }] },
  { label: 'unknown content', content: (text: string) => [{ type: 'future_block', data: HIDDEN }, { type: 'text', text }] },
  { label: 'tool call beside text', content: (text: string) => [thinking, { type: 'text', text }, { type: 'tool_use', id: 'forbidden', name: 'search', input: {} }] },
  { label: 'duplicate visible text', content: (text: string) => [thinking, { type: 'text', text }, { type: 'text', text }] },
  { label: 'missing visible text', content: (_text: string) => [thinking, redacted] },
  { label: 'malformed visible text', content: (_text: string) => [thinking, { type: 'text', text: 42 }] },
  { label: 'non-final stop', content: (text: string) => [thinking, { type: 'text', text }], stop: 'max_tokens' },
]
for (const workflow of workflows) for (const bad of invalid) {
  test(`Messages ${workflow.label} rejects ${bad.label} after recording usage`, async t => {
    const flavor = flavors[0]
    const fixture = install(t, flavor, response(flavor, bad.content(answerText(workflow)), bad.stop))
    const usage: ModelUsage[] = []
    await assert.rejects(workflow.invoke(fixture.config, row => usage.push(row)), (error: Error) => {
      assert.equal(error.name, workflow.errorName)
      assert.ok(!`${error.message}\n${error.stack}`.includes(HIDDEN), 'rejection diagnostics contain no hidden provider bytes')
      return true
    })
    fixture.assertRequest()
    assert.deepEqual(usage, [{ inputTokens: 25, outputTokens: 11 }])
  })
}

for (const workflow of workflows) for (const bad of ['tool call', 'duplicate text', 'missing text', 'non-final stop']) {
  test(`native Responses ${workflow.label} rejects ${bad} after recording usage`, async t => {
    const flavor = flavors[2]
    const visible = { id: 'msg-visible', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: answerText(workflow), annotations: [] }] }
    const output = bad === 'missing text' ? [reasoning] : bad === 'duplicate text' ? [reasoning, visible, visible]
      : bad === 'tool call' ? [reasoning, visible, { type: 'function_call', id: 'fc-forbidden', call_id: 'call-forbidden',
        name: 'search', arguments: '{}', status: 'completed' }] : [reasoning, visible]
    const fixture = install(t, flavor, response(flavor, output, bad === 'non-final stop' ? 'max_tokens' : 'end_turn'))
    const usage: ModelUsage[] = []
    await assert.rejects(workflow.invoke(fixture.config, row => usage.push(row)), (error: Error) => {
      assert.equal(error.name, workflow.errorName)
      assert.ok(!`${error.message}\n${error.stack}`.includes(HIDDEN))
      return true
    })
    fixture.assertRequest()
    assert.deepEqual(usage, [{ inputTokens: 25, outputTokens: 11 }])
  })
}
