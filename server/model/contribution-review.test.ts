import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { ChangesetVersion } from '../../contract/contributions.ts'
import { DEFAULT_AGENT } from '../data/workers.ts'
import { generateContributionReview } from '../generate.ts'
import { ContributionReviewGenerationError, ContributionReviewTransportError, ContributionReviewUsageError, parseContributionReviewResult } from '../contributionReviewResult.ts'
import { UsageRecordingError } from '../modelUsage.ts'

const changeset: ChangesetVersion = {
  version: 3,
  at: 123,
  by: 'private contributor display name',
  entries: [
    { id: 'entry-one', kind: 'instructions', target: 'release policy', before: 'old rule', after: 'new rule' },
    { id: 'entry-two', kind: 'note', target: 'audit marker', after: 'The change is ready.' },
  ],
}

let server: Server
let baseURL = ''
let mode: 'success' | 'findings' | 'malformed' | 'tool-block' | 'truncated' | 'http-error' | 'hang' = 'success'
let providerUsage: unknown = { input_tokens: 17, output_tokens: 29 }
const requests: Array<{ body: any; attempt: number }> = []

function listen(serverToRead: Server): string {
  const address = serverToRead.address()
  return typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
}

function responseFor(currentMode: typeof mode) {
  if (currentMode === 'findings') return {
    content: [{ type: 'text', text: JSON.stringify({ summary: 'One concrete concern needs attention.', findings: [{ entryId: 'entry-one', body: 'The new rule has no rollback condition.' }] }) }],
    stop_reason: 'end_turn',
  }
  if (currentMode === 'malformed') return { content: [{ type: 'text', text: '{"summary":"looks ok","findings":[],"extra":true}' }], stop_reason: 'end_turn' }
  if (currentMode === 'tool-block') return { content: [{ type: 'tool_use', id: 'should-not-run', name: 'write_resource', input: {} }], stop_reason: 'tool_use' }
  if (currentMode === 'truncated') return { content: [{ type: 'text', text: '{"summary":"incomplete' }], stop_reason: 'max_tokens' }
  return { content: [{ type: 'text', text: JSON.stringify({ summary: 'No concrete issue was identified in the supplied changes.', findings: [] }) }], stop_reason: 'end_turn' }
}

before(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = raw ? JSON.parse(raw) : undefined
    requests.push({ body, attempt: requests.length + 1 })
    if (mode === 'hang') return
    if (mode === 'http-error') {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'retry me' } }))
      return
    }
    const result = responseFor(mode)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: 'msg-review-test',
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

function provider(model: string) {
  return { baseURL, model }
}

test('review uses only a detached frozen changeset, selected Agent framing, and a tool-free Messages call', async () => {
  requests.length = 0
  mode = 'success'
  const usage: Array<{ inputTokens: number; outputTokens: number }> = []
  const agent = { ...DEFAULT_AGENT, systemPrompt: 'Agent review role', instructions: 'Check rollback and privacy.' }
  const result = await generateContributionReview(changeset, agent, provider('review-tool-free'), (row) => usage.push(row))

  assert.deepEqual(result, { summary: 'No concrete issue was identified in the supplied changes.', findings: [] })
  assert.deepEqual(usage, [{ inputTokens: 17, outputTokens: 29 }])
  assert.equal(requests.length, 1)
  const { body } = requests[0]
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'system'])
  assert.equal(body.model, 'review-tool-free')
  assert.ok(Number.isInteger(body.max_tokens) && body.max_tokens > 0 && body.max_tokens <= 8192)
  assert.equal(body.messages.length, 1)
  assert.equal(body.messages[0].role, 'user')
  assert.deepEqual(JSON.parse(body.messages[0].content), {
    version: 3,
    entries: [
      { id: 'entry-one', kind: 'instructions', target: 'release policy', before: 'old rule', after: 'new rule' },
      { id: 'entry-two', kind: 'note', target: 'audit marker', after: 'The change is ready.' },
    ],
  })
  assert.match(body.system, /Agent review role/)
  assert.match(body.system, /Check rollback and privacy\./)
  assert.match(body.system, /adversarial review/i)
  assert.match(body.system, /at most 2000 characters/)
  assert.match(body.system, /at most 12 findings/)
  assert.match(body.system, /unique entryIds, with at most one finding per supplied entry/)
  assert.doesNotMatch(body.system, /private contributor display name/)
  assert.doesNotMatch(body.messages[0].content, /private contributor display name|123/)
  assert.equal(Object.hasOwn(body, 'tools'), false)
  assert.equal(Object.hasOwn(body, 'metadata'), false)
})

test('findings are returned only when they refer to an entry in the frozen changeset', async () => {
  requests.length = 0
  mode = 'findings'
  const result = await generateContributionReview(changeset, DEFAULT_AGENT, provider('review-findings'), () => {})
  assert.deepEqual(result, {
    summary: 'One concrete concern needs attention.',
    findings: [{ entryId: 'entry-one', body: 'The new rule has no rollback condition.' }],
  })
})

test('review result parser rejects extra keys, unbound or repeated entry ids, and unbounded findings', () => {
  const ids = new Set(['entry-one', 'entry-two'])
  assert.throws(() => parseContributionReviewResult('{"summary":"ok","findings":[{"entryId":"other","body":"bad"}]}', ids), ContributionReviewGenerationError)
  assert.throws(() => parseContributionReviewResult('{"summary":"ok","findings":[{"entryId":"entry-one","body":"a"},{"entryId":"entry-one","body":"b"}]}', ids), ContributionReviewGenerationError)
  assert.throws(() => parseContributionReviewResult(JSON.stringify({ summary: 'ok', findings: Array.from({ length: 13 }, (_, index) => ({ entryId: `entry-${index}`, body: 'finding' })) }), ids), ContributionReviewGenerationError)
})

test('settled usage is recorded before rejecting malformed or non-final provider output', async (t) => {
  providerUsage = { input_tokens: 17, output_tokens: 29 }
  for (const currentMode of ['malformed', 'truncated', 'tool-block'] as const) {
    await t.test(currentMode, async () => {
      mode = currentMode
      const usage: Array<{ inputTokens: number; outputTokens: number }> = []
      await assert.rejects(
        generateContributionReview(changeset, DEFAULT_AGENT, provider(`review-${currentMode}`), (row) => usage.push(row)),
        ContributionReviewGenerationError,
      )
      assert.deepEqual(usage, [{ inputTokens: 17, outputTokens: 29 }])
    })
  }
})

test('missing or invalid settled usage is uncertainty and is never recorded as zero', async (t) => {
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
        generateContributionReview(changeset, DEFAULT_AGENT, provider(`review-usage-${label}`), (row) => usage.push(row)),
        ContributionReviewUsageError,
      )
      assert.deepEqual(usage, [])
    })
  }
  providerUsage = { input_tokens: 17, output_tokens: 29 }
})

test('provider errors are not retried even when ambient retry configuration requests retries', async () => {
  providerUsage = { input_tokens: 17, output_tokens: 29 }
  const prior = process.env.ANTHROPIC_MAX_RETRIES
  process.env.ANTHROPIC_MAX_RETRIES = '4'
  try {
    requests.length = 0
    mode = 'http-error'
    await assert.rejects(generateContributionReview(changeset, DEFAULT_AGENT, provider('review-no-retry'), () => {}), ContributionReviewTransportError)
    assert.equal(requests.length, 1, 'one provider attempt only')
  } finally {
    if (prior === undefined) delete process.env.ANTHROPIC_MAX_RETRIES
    else process.env.ANTHROPIC_MAX_RETRIES = prior
  }
})

test('usage recorder failure discards an otherwise valid review result', async () => {
  providerUsage = { input_tokens: 17, output_tokens: 29 }
  mode = 'success'
  await assert.rejects(
    generateContributionReview(changeset, DEFAULT_AGENT, provider('review-usage-failure'), () => { throw new Error('store unavailable') }),
    UsageRecordingError,
  )
})

test('provider timeout is classified as transport uncertainty and instructions are bounded before dispatch', async () => {
  providerUsage = { input_tokens: 17, output_tokens: 29 }
  const previousTimeout = process.env.CONTRIBUTION_REVIEW_TIMEOUT_MS
  process.env.CONTRIBUTION_REVIEW_TIMEOUT_MS = '25'
  try {
    requests.length = 0
    mode = 'hang'
    await assert.rejects(
      generateContributionReview(changeset, DEFAULT_AGENT, provider('review-timeout'), () => {}),
      ContributionReviewTransportError,
    )
    assert.equal(requests.length, 1)
  } finally {
    if (previousTimeout === undefined) delete process.env.CONTRIBUTION_REVIEW_TIMEOUT_MS
    else process.env.CONTRIBUTION_REVIEW_TIMEOUT_MS = previousTimeout
  }

  requests.length = 0
  mode = 'success'
  await assert.rejects(
    generateContributionReview(changeset, { ...DEFAULT_AGENT, instructions: 'x'.repeat(130_000) }, provider('review-oversized-agent'), () => {}),
    ContributionReviewGenerationError,
  )
  assert.equal(requests.length, 0, 'oversized selected instructions fail before provider I/O')
})
