import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { ChangesetVersion, EffectEnvelope } from '../../contract/contributions.ts'
import type { DelegatedJudgmentInput } from '../delegatedJudgmentResult.ts'
import { generateDelegatedJudgment } from '../generate.ts'
import {
  DelegatedJudgmentGenerationError,
  DelegatedJudgmentTransportError,
  DelegatedJudgmentUsageError,
  parseDelegatedJudgmentResult,
} from '../delegatedJudgmentResult.ts'
import { UsageRecordingError } from '../modelUsage.ts'

const changeset: ChangesetVersion = {
  version: 4,
  at: 1_764_000_000_000,
  by: 'PRIVATE_CHANGES_AUTHOR_CANARY',
  entries: [{ id: 'entry-one', kind: 'instructions', target: 'release rule', before: 'old boundary', after: 'new boundary' }],
}
const envelope: EffectEnvelope = {
  version: 3,
  status: 'proposed',
  lines: [{ id: 'line-one', type: 'connector.read', target: 'release note', cardinality: 1, harness: 'draft-escrow', note: 'One bounded revision.', used: 0 }],
  proposedBy: 'PRIVATE_PROPOSER_CANARY',
  proposedAt: 1_764_000_000_123,
  approvedBy: 'PRIVATE_APPROVER_CANARY',
  approvedAt: 1_764_000_000_456,
}
const judgment: DelegatedJudgmentInput = {
  policy: { actKind: 'approve-envelope', mode: 'decide', policy: 'Approve one read-only change that preserves the release boundary.', escalation: ['effectful', 'unreviewed'], revision: 7, expiresAt: 1_800_000_000_000 },
  changeset,
  envelope,
  risk: { effectful: false, unreviewed: false, stranger: false, readOnlyEnvelope: true },
}

let server: Server
let baseURL = ''
let mode: 'success' | 'invalid' | 'tool-block' | 'truncated' | 'http-error' | 'hang' = 'success'
let providerUsage: unknown = { input_tokens: 17, output_tokens: 29 }
const requests: Array<{ body: any; attempt: number }> = []
let onRequestAccepted: (() => void) | undefined

function listen(serverToRead: Server): string {
  const address = serverToRead.address()
  return typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
}

function responseFor(currentMode: typeof mode) {
  if (currentMode === 'invalid') return { content: [{ type: 'text', text: '{"decision":"approve","summary":"ok","extra":true}' }], stop_reason: 'end_turn' }
  if (currentMode === 'tool-block') return { content: [{ type: 'tool_use', id: 'must-not-run', name: 'land_contribution', input: {} }], stop_reason: 'tool_use' }
  if (currentMode === 'truncated') return { content: [{ type: 'text', text: '{"decision":"approve"' }], stop_reason: 'max_tokens' }
  return { content: [{ type: 'text', text: JSON.stringify({ decision: 'approve', summary: 'The frozen policy admits this read-only envelope.' }) }], stop_reason: 'end_turn' }
}

before(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = raw ? JSON.parse(raw) : undefined
    requests.push({ body, attempt: requests.length + 1 })
    onRequestAccepted?.()
    onRequestAccepted = undefined
    if (mode === 'hang') return
    if (mode === 'http-error') {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'retry me' } }))
      return
    }
    const result = responseFor(mode)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: 'msg-delegated-judgment-test',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: result.content,
      stop_reason: result.stop_reason,
      stop_sequence: null,
      usage: providerUsage,
    }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  baseURL = listen(server)
})

after(() => {
  server.closeAllConnections?.()
  server.close()
})

function provider(model: string) { return { baseURL, model } }

test('delegated judgment sends only frozen allowlisted inputs in one tool-free Messages call', async () => {
  requests.length = 0
  mode = 'success'
  const usage: Array<{ inputTokens: number; outputTokens: number }> = []
  const result = await generateDelegatedJudgment(judgment, provider('delegated-judgment-tool-free'), (row) => usage.push(row))

  assert.deepEqual(result, { decision: 'approve', summary: 'The frozen policy admits this read-only envelope.' })
  assert.deepEqual(usage, [{ inputTokens: 17, outputTokens: 29 }])
  assert.equal(requests.length, 1)
  const { body } = requests[0]
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'system'])
  assert.equal(body.model, 'delegated-judgment-tool-free')
  assert.ok(Number.isInteger(body.max_tokens) && body.max_tokens > 0 && body.max_tokens <= 1_024)
  assert.equal(body.messages.length, 1)
  assert.equal(body.messages[0].role, 'user')
  assert.deepEqual(JSON.parse(body.messages[0].content), {
    policy: judgment.policy,
    changeset: { version: 4, entries: changeset.entries },
    envelope: { version: 3, status: 'proposed', lines: envelope.lines },
    risk: judgment.risk,
  })
  assert.match(body.system, /at most 2000 characters/)
  assert.match(body.system, /effectful/i)
  assert.doesNotMatch(body.system, /Agent instructions|conversation history|private contributor/i)
  assert.doesNotMatch(body.messages[0].content, /PRIVATE_CHANGES_AUTHOR_CANARY|PRIVATE_PROPOSER_CANARY|PRIVATE_APPROVER_CANARY|1764000000/)
  assert.equal(Object.hasOwn(body, 'tools'), false)
  assert.equal(Object.hasOwn(body, 'metadata'), false)
})

test('decision parser rejects extra keys, invalid decisions, blank and oversized summaries', () => {
  assert.deepEqual(parseDelegatedJudgmentResult('{"decision":"escalate","summary":"Needs owner review."}'), {
    decision: 'escalate', summary: 'Needs owner review.',
  })
  for (const raw of [
    '{"decision":"approve","summary":"ok","extra":true}',
    '{"decision":"tool_use","summary":"ok"}',
    '{"decision":"approve","summary":"  "}',
    JSON.stringify({ decision: 'decline', summary: 'x'.repeat(2_001) }),
    'not json',
  ]) assert.throws(() => parseDelegatedJudgmentResult(raw), DelegatedJudgmentGenerationError)
})

test('completed malformed, truncated, or tool-call responses are metered before definitive refusal', async (t) => {
  providerUsage = { input_tokens: 17, output_tokens: 29 }
  for (const currentMode of ['invalid', 'truncated', 'tool-block'] as const) {
    await t.test(currentMode, async () => {
      requests.length = 0
      mode = currentMode
      const usage: Array<{ inputTokens: number; outputTokens: number }> = []
      await assert.rejects(
        generateDelegatedJudgment(judgment, provider(`delegated-${currentMode}`), (row) => usage.push(row)),
        DelegatedJudgmentGenerationError,
      )
      assert.equal(requests.length, 1)
      assert.deepEqual(usage, [{ inputTokens: 17, outputTokens: 29 }])
    })
  }
})

test('missing or malformed settled usage is uncertainty and is never recorded as zero', async (t) => {
  const cases: Array<[string, unknown]> = [
    ['missing usage object', undefined],
    ['missing input count', { output_tokens: 29 }],
    ['missing output count', { input_tokens: 17 }],
    ['negative count', { input_tokens: 17, output_tokens: -1 }],
    ['unsafe count', { input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: 0 }],
    ['unsafe combined total', { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 }],
  ]
  for (const [label, invalidUsage] of cases) {
    await t.test(label, async () => {
      mode = 'success'
      providerUsage = invalidUsage
      const usage: Array<{ inputTokens: number; outputTokens: number }> = []
      await assert.rejects(
        generateDelegatedJudgment(judgment, provider(`delegated-usage-${label}`), (row) => usage.push(row)),
        DelegatedJudgmentUsageError,
      )
      assert.deepEqual(usage, [])
    })
  }
  providerUsage = { input_tokens: 17, output_tokens: 29 }
})

test('provider errors are not retried despite ambient retry configuration', async () => {
  const previous = process.env.ANTHROPIC_MAX_RETRIES
  process.env.ANTHROPIC_MAX_RETRIES = '4'
  try {
    requests.length = 0
    mode = 'http-error'
    await assert.rejects(generateDelegatedJudgment(judgment, provider('delegated-no-retry'), () => {}), DelegatedJudgmentTransportError)
    assert.equal(requests.length, 1)
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_MAX_RETRIES
    else process.env.ANTHROPIC_MAX_RETRIES = previous
  }
})

test('usage recorder failure discards an otherwise valid delegated decision', async () => {
  providerUsage = { input_tokens: 17, output_tokens: 29 }
  mode = 'success'
  await assert.rejects(
    generateDelegatedJudgment(judgment, provider('delegated-usage-failure'), () => { throw new Error('store unavailable') }),
    UsageRecordingError,
  )
})

test('invalid or oversized frozen inputs fail before provider I/O', async () => {
  requests.length = 0
  mode = 'success'
  await assert.rejects(
    generateDelegatedJudgment({ ...judgment, policy: { ...judgment.policy, escalation: [] } }, provider('delegated-no-floor'), () => {}),
    DelegatedJudgmentGenerationError,
  )
  await assert.rejects(
    generateDelegatedJudgment({ ...judgment, envelope: { ...envelope, lines: [{ ...envelope.lines[0], note: 'x'.repeat(2_001) }] } }, provider('delegated-large-envelope'), () => {}),
    DelegatedJudgmentGenerationError,
  )
  assert.equal(requests.length, 0)
})

test('provider timeout is classified as transport uncertainty and does not retry', async () => {
  const previousTimeout = process.env.DELEGATED_JUDGMENT_TIMEOUT_MS
  const originalTimeout = AbortSignal.timeout
  const deadline = new AbortController()
  const timeoutDurations: number[] = []
  process.env.DELEGATED_JUDGMENT_TIMEOUT_MS = '25'
  AbortSignal.timeout = (milliseconds) => {
    timeoutDurations.push(milliseconds)
    return deadline.signal
  }
  let acceptRequest!: () => void
  const requestAccepted = new Promise<void>((resolve) => { acceptRequest = resolve })
  onRequestAccepted = acceptRequest
  try {
    requests.length = 0
    mode = 'hang'
    const pending = generateDelegatedJudgment(judgment, provider('delegated-timeout'), () => {})
    const settledEarly = pending.then(() => false, () => false)
    // Inject timeout only after the local server has fully received the request
    // body. This excludes connection setup scheduling from the timeout behavior.
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const admitted = await Promise.race([
      requestAccepted.then(() => true),
      settledEarly,
      new Promise<boolean>((resolve) => { watchdog = setTimeout(() => resolve(false), 1_000) }),
    ])
    if (watchdog) clearTimeout(watchdog)
    assert.equal(admitted, true, 'request must reach the fixture before timeout injection')
    assert.deepEqual(timeoutDurations, [25])
    deadline.abort(new DOMException('The operation timed out', 'TimeoutError'))
    await assert.rejects(pending, DelegatedJudgmentTransportError)
    assert.equal(requests.length, 1)
  } finally {
    onRequestAccepted = undefined
    deadline.abort(new DOMException('The operation timed out', 'TimeoutError'))
    AbortSignal.timeout = originalTimeout
    if (previousTimeout === undefined) delete process.env.DELEGATED_JUDGMENT_TIMEOUT_MS
    else process.env.DELEGATED_JUDGMENT_TIMEOUT_MS = previousTimeout
  }
})
