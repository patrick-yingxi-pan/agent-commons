/** Real conversation Stop cancels a Messages adapter's retry wait, not merely
 * its browser subscriber. Every upstream request goes to this authored loopback
 * peer; no public provider or paid generation is involved. */
import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { test, expect, type Browser } from '@playwright/test'
import type { ModelProvider, Session } from '../contract/index.ts'
import { newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const REPLY = 'The local Messages peer completed the follow-up after Stop.'
const RETRY_AFTER_MS = 5_000

function completeMessage(response: ServerResponse, model: string, stream: boolean) {
  const message = {
    id: `msg_retry_stop_${randomUUID()}`, type: 'message', role: 'assistant', model,
    content: [{ type: 'text', text: REPLY }], stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 3 },
  }
  if (!stream) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ...message,
      content: [{ type: 'tool_use', id: 'probe-noop', name: 'probe_noop', input: {} }], stop_reason: 'tool_use',
    }))
    return
  }
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
  const event = (name: string, value: unknown) => response.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`)
  event('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null,
    usage: { input_tokens: 1, output_tokens: 0 } } })
  event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: REPLY } })
  event('content_block_stop', { type: 'content_block_stop', index: 0 })
  event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
  event('message_stop', { type: 'message_stop' })
  response.end()
}

async function exerciseRetryStop(browser: Browser, family: 'claude' | 'deepseek') {
  const stamp = randomUUID()
  const modelId = `${family}-retry-stop-${stamp}`
  const mount = family === 'deepseek' ? '/anthropic' : ''
  const providerLabel = `Local ${family} retry Stop ${stamp.slice(0, 8)}`
  const firstText = `Cancel the pending retry ${stamp}`
  const followupText = `Continue after cancellation ${stamp}`
  const owner = await newUser(browser, {
    'x-user-id': `user-messages-retry-stop-${stamp}`,
    'x-tenant-id': `tenant-messages-retry-stop-${stamp}`,
  })
  const { page } = owner
  const streamRequests: Array<{ model?: string; messages?: unknown[] }> = []
  let probes = 0
  let refuse = true
  let firstRefusalAt = 0
  const peer = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (request.method === 'GET' && pathname === `${mount}/v1/models`) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: modelId, display_name: 'Retry Stop fixture',
        capabilities: { effort: { supported: false } } }], has_more: false }))
      return
    }
    if (request.method !== 'POST' || pathname !== `${mount}/v1/messages`) {
      response.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: boolean; model?: string; messages?: unknown[] }
    if (!body.stream) {
      probes += 1
      completeMessage(response, body.model ?? modelId, false)
      return
    }
    streamRequests.push(body)
    if (refuse) {
      firstRefusalAt ||= Date.now()
      response.writeHead(503, { 'content-type': 'application/json', 'retry-after': '5' })
      response.end(JSON.stringify({ error: { type: 'overloaded_error', message: 'Authored local retry wait.' } }))
      return
    }
    completeMessage(response, body.model ?? modelId, true)
  })
  peer.listen(0, '127.0.0.1')
  await once(peer, 'listening')
  const address = peer.address()
  if (!address || typeof address === 'string') throw new Error('Messages retry Stop peer did not bind.')
  let sessionId: string | undefined
  try {
    const registered = await page.request.post('/api/v1/providers', { data: {
      label: providerLabel, modelFamily: family, effortLevels: ['High'],
      config: { protocol: 'anthropic-messages', baseURL: `http://127.0.0.1:${address.port}${mount}`, model: modelId },
    } })
    expect(registered.ok(), await registered.text()).toBe(true)
    const provider = await registered.json() as ModelProvider
    expect(provider).toMatchObject({ execution: 'configured', defaultModelId: modelId })
    expect(probes, 'registration verifies this local Messages peer').toBe(1)
    expect(streamRequests, 'onboarding never starts a conversation generation').toHaveLength(0)
    const created = await page.request.post('/api/v1/sessions', { data: { providerId: provider.id, modelId } })
    expect(created.ok(), await created.text()).toBe(true)
    sessionId = ((await created.json()) as Session).id
    await page.goto(`/s/${sessionId}`)
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(composer).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Model and effort', exact: true })).toContainText('Retry Stop fixture')
    await composer.fill(firstText)
    await composer.press('Enter')
    await expect.poll(() => streamRequests.length, { timeout: ms(10_000) }).toBe(1)
    expect(streamRequests[0]!.model).toBe(modelId)
    const before = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as Session & { activeTurnId?: string }
    expect(before.activeTurnId, 'the retry wait belongs to a real server-owned active turn').toBeTruthy()
    expect(before.messages.map(message => message.role), '503 has not produced assistant output').toEqual(['user'])
    const stop = page.getByRole('button', { name: 'Stop', exact: true })
    await expect(stop).toBeVisible()
    await expect(composer, 'the pending retry owns the composer before Stop releases it').toBeDisabled()
    expect(Date.now() - firstRefusalAt, 'Stop is exercised inside the authored five-second retry wait').toBeLessThan(2_000)
    const stoppedAt = Date.now()
    const cancellation = page.waitForResponse(response => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/v1/sessions/${sessionId}/turns/${before.activeTurnId}/cancel`)
    await stop.click()
    expect((await cancellation).ok(), 'the genuine cancellation route acknowledges this exact active turn').toBe(true)
    // A fixed real-time bound is intentional: scaling it beyond Retry-After5
    // would let the broken non-abortable timer pass on a slower host.
    await expect(composer, 'Stop releases Send without waiting for Retry-After5').toBeEnabled({ timeout: 2_000 })
    expect(Date.now() - stoppedAt, 'cancellation settles before the upstream retry delay').toBeLessThan(2_000)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(page.getByText('Generating a reply…', { exact: true })).toHaveCount(0)
    await expect(page.locator('[data-turn]')).toHaveCount(1)
    await expect(page.locator('[data-turn]').first().locator('[data-turn-author]')).toHaveText('You')
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    await expect.poll(async () => {
      const response = await page.request.get(`/api/v1/sessions/${sessionId}`)
      expect(response.ok()).toBe(true)
      const session = await response.json() as Session & { activeTurnId?: string }
      return { live: session.activeTurnId ?? null, messages: session.messages.map(message => ({ role: message.role, content: message.content })) }
    }, { timeout: 2_000 }).toEqual({ live: null, messages: [{ role: 'user', content: firstText }] })
    await page.reload()
    await expect(composer).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    await expect(page.locator('[data-turn]')).toHaveCount(1)
    // Stay past the authored retry deadline while refusal remains armed. A
    // delayed abandoned retry cannot hide behind the later successful reply.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, firstRefusalAt + RETRY_AFTER_MS + 300 - Date.now())))
    expect(streamRequests, 'cancelled retry never makes another provider request, including after reload').toHaveLength(1)
    refuse = false
    await composer.fill(followupText)
    await composer.press('Enter')
    const reply = page.locator('[data-turn]').filter({ hasText: REPLY })
    await expect(reply.locator('[data-turn-author]')).not.toHaveText('You')
    await expect(reply.getByText(REPLY, { exact: true })).toBeVisible()
    await expect(composer).toBeEnabled()
    const completed = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as Session & { activeTurnId?: string }
    expect(completed.activeTurnId ?? null).toBeNull()
    expect(completed.messages.map(message => message.role)).toEqual(['user', 'user', 'assistant'])
    expect(completed.messages[0]!.content).toBe(firstText)
    expect(completed.messages[1]!.content).toBe(followupText)
    expect(completed.messages[2]).toMatchObject({ content: REPLY, providerId: provider.id, modelId })
    expect(streamRequests, 'only the cancelled attempt and explicit follow-up reached the peer').toHaveLength(2)
    expect(streamRequests.every(request => request.model === modelId)).toBe(true)
  } finally {
    if (sessionId) {
      const response = await page.request.get(`/api/v1/sessions/${sessionId}`).catch(() => undefined)
      if (response?.ok()) {
        const session = await response.json() as { activeTurnId?: string }
        if (session.activeTurnId) await page.request.post(`/api/v1/sessions/${sessionId}/turns/${session.activeTurnId}/cancel`).catch(() => {})
      }
    }
    peer.closeAllConnections()
    await new Promise<void>(resolve => peer.close(() => resolve()))
    await owner.context.close()
  }
}

test('Claude Messages Stop promptly cancels Retry-After wait and permits a follow-up', async ({ browser }) => {
  test.setTimeout(ms(45_000))
  await exerciseRetryStop(browser, 'claude')
})

test('DeepSeek Messages Stop promptly cancels Retry-After wait and permits a follow-up', async ({ browser }) => {
  test.setTimeout(ms(45_000))
  await exerciseRetryStop(browser, 'deepseek')
})
