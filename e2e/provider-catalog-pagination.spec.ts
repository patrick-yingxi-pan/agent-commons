/** Rendered provider refresh keeps a complete paginated Messages catalog atomic. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import type { ModelProvider, ViewerModelPreferences } from '../contract/index.ts'
import { newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const API = '/api/v1'
const MODEL_A = `catalog-page-one-${randomUUID()}`
const MODEL_B = `catalog-page-two-${randomUUID()}`
const REPLY = 'The selected page-two model answered through the local Messages peer.'

type MessagesRequest = { model?: string; stream?: boolean }
type ListingRequest = { url: URL; status: number }

async function readBody(request: IncomingMessage): Promise<MessagesRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as MessagesRequest
}

function sendProbe(response: ServerResponse, model: string) {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({
    id: 'catalog-pagination-probe', type: 'message', role: 'assistant', model,
    content: [{ type: 'tool_use', id: 'probe-noop', name: 'probe_noop', input: {} }],
    stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
  }))
}

function sendReply(response: ServerResponse, model: string) {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
  const event = (name: string, value: unknown) => response.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`)
  event('message_start', { type: 'message_start', message: {
    id: 'catalog-pagination-reply', type: 'message', role: 'assistant', model,
    content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 },
  } })
  event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: REPLY } })
  event('content_block_stop', { type: 'content_block_stop', index: 0 })
  event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
  event('message_stop', { type: 'message_stop' })
  response.end()
}

async function startMessagesPeer() {
  const messages: MessagesRequest[] = []
  const listings: ListingRequest[] = []
  let failContinuation = false
  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/v1/models') {
      if (url.searchParams.get('limit') !== '100') {
        response.writeHead(400).end('Unexpected page size')
        listings.push({ url, status: 400 })
        return
      }
      if (url.searchParams.has('after_id')) {
        if (url.searchParams.get('after_id') !== MODEL_A) {
          response.writeHead(400).end('Unexpected continuation cursor')
          listings.push({ url, status: 400 })
          return
        }
        if (failContinuation) {
          response.writeHead(503, { 'content-type': 'application/json', 'x-should-retry': 'false' })
          response.end(JSON.stringify({ error: { type: 'service_unavailable_error', message: 'fixture page two is temporarily unavailable' } }))
          listings.push({ url, status: 503 })
          return
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: MODEL_B }], has_more: false }))
        listings.push({ url, status: 200 })
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: MODEL_A, display_name: 'Page one model A' }], has_more: true, last_id: MODEL_A }))
      listings.push({ url, status: 200 })
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/messages') {
      const body = await readBody(request)
      messages.push(body)
      if (body.stream) sendReply(response, body.model ?? MODEL_B)
      else sendProbe(response, body.model ?? MODEL_B)
      return
    }
    response.writeHead(404).end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The pagination Messages fixture did not bind.')
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    messages,
    listings,
    failContinuation() { failContinuation = true },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

test('provider refresh preserves the selected page-two model across complete and failed catalog reads', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const stamp = randomUUID().slice(0, 12)
  const owner = await newUser(browser, {
    'x-user-id': `user-provider-pagination-${stamp}`,
    'x-tenant-id': `tenant-provider-pagination-${stamp}`,
  })
  const { page } = owner
  const peer = await startMessagesPeer()
  const providerLabel = `Paginated Messages ${stamp}`

  try {
    const created = await page.request.post(`${API}/providers`, {
      data: {
        label: providerLabel,
        modelFamily: 'claude',
        effortLevels: ['Default'],
        isDefault: true,
        config: { baseURL: peer.baseURL, protocol: 'anthropic-messages', model: MODEL_B },
      },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const provider = await created.json() as ModelProvider
    expect(provider).toMatchObject({ label: providerLabel, defaultModelId: MODEL_B, isDefault: true })
    expect(provider.models?.map(model => model.id), 'registration publishes both complete pages').toEqual([MODEL_A, MODEL_B])
    expect(peer.listings.map(item => [item.url.searchParams.get('after_id'), item.status])).toEqual([
      [null, 200], [MODEL_A, 200],
    ])
    expect(peer.messages).toHaveLength(1)
    expect(peer.messages[0]).toMatchObject({ model: MODEL_B })
    expect(peer.messages[0]).not.toHaveProperty('stream', true)

    const currentPreferencesResponse = await page.request.get(`${API}/viewer-preferences/model`)
    expect(currentPreferencesResponse.ok()).toBe(true)
    const currentPreferences = await currentPreferencesResponse.json() as ViewerModelPreferences
    const preferencesResponse = await page.request.patch(`${API}/viewer-preferences/model`, {
      data: {
        expectedTenantId: currentPreferences.tenantId,
        expectedUserId: currentPreferences.userId,
        expectedRevision: currentPreferences.revision,
        preferences: { ...currentPreferences.preferences, providerId: provider.id, modelId: MODEL_B },
      },
      headers: { 'Idempotency-Key': `provider-pagination-preference-${stamp}` },
    })
    expect(preferencesResponse.ok(), await preferencesResponse.text()).toBe(true)

    const expectComposerSelection = async (phase: string) => {
      await page.goto('/')
      // Root reload restores the last workspace pane; enter a draft through
      // the actual navigation action instead of assuming '/' clears it.
      await page.getByRole('navigation', { name: 'Create' }).getByRole('button', { name: 'New session', exact: true }).click()
      const composer = page.getByRole('textbox', { name: 'Message', exact: true })
      await expect(composer, `${phase}: the selected page-two model leaves Send enabled`).toBeEnabled()
      const selection = page.getByRole('button', { name: 'Model and effort', exact: true })
      await expect(selection, `${phase}: the composer retains provider and exact model identity`).toContainText(`${providerLabel} · ${MODEL_B}`)
      return composer
    }

    await expectComposerSelection('initial preference')
    const detail = `/models/${encodeURIComponent(provider.id)}`
    await page.goto(detail)
    const refresh = page.getByRole('button', { name: 'Refresh model catalog', exact: true })
    await expect(refresh).toBeEnabled()
    const beforeSuccessfulRefresh = peer.listings.length
    const successfulRefresh = page.waitForResponse(response =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `${API}/providers/${encodeURIComponent(provider.id)}/models/refresh`,
    )
    await refresh.click()
    expect((await successfulRefresh).status(), 'the exact manual refresh completed successfully').toBe(200)
    await expect(page.getByText('2 models, listed from its endpoint', { exact: true })).toBeVisible()
    await expect(page.getByText(`${MODEL_B} · default`, { exact: true })).toBeVisible()
    expect(peer.listings.slice(beforeSuccessfulRefresh).map(item => [item.url.searchParams.get('after_id'), item.status])).toEqual([
      [null, 200], [MODEL_A, 200],
    ])
    expect(peer.messages, 'catalog enumeration and navigation never generate a reply').toHaveLength(1)
    await expectComposerSelection('after successful page-two refresh')

    peer.failContinuation()
    await page.goto(detail)
    const beforeFailedRefresh = peer.listings.length
    const failedRefresh = page.waitForResponse(response =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `${API}/providers/${encodeURIComponent(provider.id)}/models/refresh`,
    )
    await page.getByRole('button', { name: 'Refresh model catalog', exact: true }).click()
    expect((await failedRefresh).status(), 'the page-two refusal reaches the catalog refresh route').toBe(400)
    const failure = page.locator('[data-provider-catalog-refresh="failed"]')
    await expect(failure).toContainText('The provider’s endpoint didn’t answer a model list.')
    expect(peer.listings.slice(beforeFailedRefresh).map(item => [item.url.searchParams.get('after_id'), item.status])).toEqual([
      [null, 200], [MODEL_A, 503],
    ])
    await expect(page.getByText('2 models, listed from its endpoint', { exact: true })).toBeVisible()
    await expect(page.getByText('Page one model A', { exact: true })).toBeVisible()
    await expect(page.getByText(`${MODEL_B} · default`, { exact: true })).toBeVisible()
    const retainedResponse = await page.request.get(`${API}/providers/${encodeURIComponent(provider.id)}`)
    expect(retainedResponse.ok()).toBe(true)
    const retainedProvider = await retainedResponse.json() as ModelProvider
    expect(retainedProvider).toMatchObject({ defaultModelId: MODEL_B, catalogSource: 'listed' })
    expect(retainedProvider.models?.map(model => model.id)).toEqual([MODEL_A, MODEL_B])
    expect(peer.messages, 'a failed catalog read does not dispatch a generation').toHaveLength(1)

    const composer = await expectComposerSelection('after failed page-two refresh and navigation')
    expect(peer.messages, 'navigation after failure also does not generate').toHaveLength(1)
    const text = `Use the selected page-two model ${stamp}`
    await composer.fill(text)
    await composer.press('Enter')
    await expect(page.getByText(REPLY, { exact: true })).toBeVisible({ timeout: ms(15_000) })
    expect(peer.messages.filter(request => request.stream).map(({ model, stream }) => ({ model, stream })))
      .toEqual([{ model: MODEL_B, stream: true }])
    expect(peer.messages.map(request => request.model)).toEqual([MODEL_B, MODEL_B])
  } finally {
    await peer.close()
    await owner.context.close()
  }
})
