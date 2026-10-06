import assert from 'node:assert/strict'
import { request } from 'node:http'
import { test } from 'node:test'
import { REVIEW_SMOKE_MODEL, startContributionReviewSmokeEndpoint } from './contributionReviewSmokeFixture.mjs'

const reviewBody = () => ({ model: REVIEW_SMOKE_MODEL, messages: [{ role: 'user', content: JSON.stringify({ version: 4, entries: [{ id: 'entry-one', body: 'First' }, { id: 'entry-two', body: 'Second' }] }) }] })
const post = (origin: string, body: unknown) => fetch(`${origin}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer do-not-capture' }, body: typeof body === 'string' ? body : JSON.stringify(body) })

async function waitForCaptured(fixture: Awaited<ReturnType<typeof startContributionReviewSmokeEndpoint>>, count: number) {
  for (let attempt = 0; fixture.requests.length < count && attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.equal(fixture.requests.length, count, `expected ${count} captured review request(s)`)
}

async function waitForHeldCount(fixture: Awaited<ReturnType<typeof startContributionReviewSmokeEndpoint>>, count: number) {
  for (let attempt = 0; fixture.heldCount !== count && attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.equal(fixture.heldCount, count, `expected ${count} held review request(s)`)
}

test('discovers the fixture model, excludes registration probes, and captures detached scoped reviews', async () => {
  const fixture = await startContributionReviewSmokeEndpoint()
  try {
    const models = await fetch(`${fixture.origin}/v1/models`)
    assert.equal(models.status, 200)
    assert.equal((await models.json()).data[0].id, REVIEW_SMOKE_MODEL)

    const probe = await post(fixture.origin, { model: REVIEW_SMOKE_MODEL, messages: [{ role: 'user', content: 'connection probe' }] })
    assert.equal(probe.status, 200)
    assert.deepEqual((await probe.json()).usage, { input_tokens: 137, output_tokens: 29 })
    assert.equal(fixture.requests.length, 0)

    const submitted = reviewBody()
    const response = await post(fixture.origin, submitted)
    const result = await response.json()
    assert.equal(response.status, 200)
    assert.deepEqual(result.usage, { input_tokens: 137, output_tokens: 29 })
    assert.deepEqual(JSON.parse(result.content[0].text), {
      summary: 'One scoped issue needs attention.',
      findings: [{ entryId: 'entry-one', body: 'The first entry needs a clearer acceptance condition.' }],
    })
    submitted.messages[0].content = 'changed after request'
    submitted.messages.push({ role: 'assistant', content: 'later mutation' })
    assert.equal(fixture.requests.length, 1)
    assert.deepEqual(fixture.requests[0], reviewBody())
    assert.doesNotMatch(JSON.stringify(fixture.requests), /do-not-capture|authorization/i)
  } finally {
    await fixture.close()
  }
})

test('passed mode returns no findings and ordinary traffic never adds an extra capture', async () => {
  const fixture = await startContributionReviewSmokeEndpoint()
  try {
    fixture.setMode('passed')
    const response = await post(fixture.origin, reviewBody())
    assert.deepEqual(JSON.parse((await response.json()).content[0].text), { summary: 'The contribution review passed.', findings: [] })
    assert.equal(fixture.requests.length, 1)
    await post(fixture.origin, { messages: [{ role: 'user', content: 'another probe' }] })
    assert.equal(fixture.requests.length, 1)
  } finally {
    await fixture.close()
  }
})

test('held reviews release as passed by default or as findings when requested', async () => {
  const fixture = await startContributionReviewSmokeEndpoint()
  try {
    fixture.setMode('hold')
    const heldPassed = post(fixture.origin, reviewBody())
    await waitForCaptured(fixture, 1)
    assert.equal(fixture.releaseHeld(), 1)
    assert.deepEqual(JSON.parse((await (await heldPassed).json()).content[0].text).findings, [])

    const heldFindings = post(fixture.origin, reviewBody())
    await waitForCaptured(fixture, 2)
    assert.equal(fixture.releaseHeld('findings'), 1)
    assert.deepEqual(JSON.parse((await (await heldFindings).json()).content[0].text).findings[0].entryId, 'entry-one')
  } finally {
    await fixture.close()
  }
})

test('client disconnect releases held work and close destroys held requests idempotently', async () => {
  const fixture = await startContributionReviewSmokeEndpoint()
  try {
    fixture.setMode('hold')
    const url = new URL(`${fixture.origin}/v1/messages`)
    let req: ReturnType<typeof request>
    let destroyed = false
    const disconnected = new Promise<void>((resolve, reject) => {
      req = request({ hostname: url.hostname, port: Number(url.port), path: url.pathname, method: 'POST', headers: { 'content-type': 'application/json' } })
      req.once('error', (error) => destroyed ? resolve() : reject(error))
      req.once('close', () => destroyed ? resolve() : reject(new Error('Request closed before the test disconnected it.')))
      req.end(JSON.stringify(reviewBody()))
    })
    await waitForCaptured(fixture, 1)
    destroyed = true
    req!.destroy()
    await disconnected
    await waitForHeldCount(fixture, 0)
    assert.equal(fixture.releaseHeld(), 0, 'disconnected review must no longer be held')

    // Observe rejection before closing: the socket can fail before close() settles.
    const waitingRejected = assert.rejects(post(fixture.origin, reviewBody()))
    await waitForCaptured(fixture, 2)
    await Promise.all([fixture.close(), fixture.close()])
    await waitingRejected
    await assert.rejects(fetch(`${fixture.origin}/v1/models`))
  } finally {
    await fixture.close()
  }
})

test('rejects malformed, oversized, unsupported method and unsupported path requests', async () => {
  const fixture = await startContributionReviewSmokeEndpoint()
  try {
    assert.equal((await post(fixture.origin, '{not json')).status, 400)
    assert.equal((await post(fixture.origin, { messages: [{ role: 'user', content: JSON.stringify({ version: 1, entries: [] }) }], extra: 'x'.repeat(270 * 1024) })).status, 413)
    assert.equal((await fetch(`${fixture.origin}/v1/messages`, { method: 'GET' })).status, 404)
    assert.equal((await fetch(`${fixture.origin}/v1/messages/extra`, { method: 'POST' })).status, 404)
    assert.equal(fixture.requests.length, 0)
    assert.equal((await fetch(`${fixture.origin}/v1/models`)).status, 200)
  } finally {
    await fixture.close()
  }
})
