/** Rendered effort controls distinguish explicit unsupported from unknown metadata. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import type { ModelProvider } from '../contract/index.ts'
import { assertWcag22Aa, settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'
import { newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const API = '/api/v1'
const MODEL_NO_EFFORT = `effort-explicitly-unsupported-${randomUUID()}`
const MODEL_UNKNOWN_EFFORT = `effort-metadata-unknown-${randomUUID()}`
const REPLY = 'The local peer accepted the model with no effort override.'
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

type WireRequest = Record<string, unknown> & { model?: string; stream?: boolean }

async function readBody(request: IncomingMessage): Promise<WireRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as WireRequest
}

function sendProbe(response: ServerResponse, model: string) {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({
    id: 'provider-effort-capability-probe', type: 'message', role: 'assistant', model,
    content: [{ type: 'tool_use', id: 'probe-noop', name: 'probe_noop', input: {} }],
    stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
  }))
}

function sendReply(response: ServerResponse, model: string) {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
  const event = (name: string, value: unknown) => response.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`)
  event('message_start', { type: 'message_start', message: {
    id: 'provider-effort-capability-reply', type: 'message', role: 'assistant', model,
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
  const messages: WireRequest[] = []
  const listings: URL[] = []
  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/v1/models') {
      listings.push(url)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        data: [
          { id: MODEL_NO_EFFORT, display_name: 'No-effort model', capabilities: { effort: { supported: false } } },
          { id: MODEL_UNKNOWN_EFFORT, display_name: 'Unknown-effort model' },
        ],
        has_more: false,
      }))
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/messages') {
      const body = await readBody(request)
      messages.push(body)
      if (body.stream && Object.hasOwn(body, 'output_config')) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'This model rejects output_config.' } }))
        return
      }
      if (body.stream) sendReply(response, body.model ?? MODEL_NO_EFFORT)
      else sendProbe(response, body.model ?? MODEL_NO_EFFORT)
      return
    }
    response.writeHead(404).end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The effort capability Messages peer did not bind.')
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    messages,
    listings,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

async function openNewSession(page: Page) {
  await page.goto('/')
  await expect(page.locator('main').first()).toBeVisible()
  const expandSidebar = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expandSidebar.isVisible()) await expandSidebar.click()
  const createNavigation = page.getByRole('navigation', { name: 'Create', exact: true })
  await expect(createNavigation.getByRole('button', { name: 'New session', exact: true })).toBeVisible()
  await createNavigation.getByRole('button', { name: 'New session', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
}

async function capturePicker(page: Page, testInfo: TestInfo, state: string, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport)
  await settledNarrowRail(page)
  const picker = page.getByRole('dialog', { name: 'Model and effort', exact: true })
  await expect(picker).toBeVisible()
  await settledOpaquePaint(picker)
  if (viewport.height === 390) {
    const lowerControl = state === 'unknown'
      ? picker.getByRole('button', { name: 'High', exact: true })
      : picker.getByText('This model declares no effort levels.', { exact: true })
    await lowerControl.scrollIntoViewIfNeeded()
    await expect(lowerControl).toBeInViewport()
    if (state === 'unknown') {
      await expect(lowerControl).toBeEnabled()
      await lowerControl.click()
    }
  }
  await expect.poll(async () => {
    const box = await picker.boundingBox()
    const currentViewport = page.viewportSize()
    if (!box || !currentViewport) return false
    return box.x >= 7 && box.y >= 7 &&
      box.x + box.width <= currentViewport.width - 7 &&
      box.y + box.height <= currentViewport.height - 7 &&
      await picker.evaluate(element => element.scrollWidth <= element.clientWidth) &&
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  }, { message: `${viewport.width}x${viewport.height}: picker geometry, internal overflow, and page width stay within bounds` }).toBe(true)
  // The landscape reachability click saves an effort preference. Its HTTP
  // acknowledgement can arrive during axe's scan, re-enabling rows while their
  // disabled-opacity transition is still running. Audit the admitted choices
  // only after that mutation and each row's painted hold have settled.
  for (const row of await picker.locator('[data-model-choice]').all()) {
    await expect(row).toBeEnabled()
    await settledOpaquePaint(row)
  }
  await assertWcag22Aa(page, `provider effort ${state} picker ${viewport.width}x${viewport.height}`)
  await page.screenshot({ path: testInfo.outputPath(`provider-effort-${state}-${viewport.width}x${viewport.height}.png`) })
}

test('explicit unsupported effort hides overrides while unknown metadata inherits provider effort', async ({ browser }, testInfo) => {
  test.setTimeout(ms(90_000))
  const stamp = randomUUID().slice(0, 12)
  const owner = await newUser(browser, {
    'x-user-id': `user-provider-effort-${stamp}`,
    'x-tenant-id': `tenant-provider-effort-${stamp}`,
  })
  const { page } = owner
  const peer = await startMessagesPeer()
  const providerLabel = `Effort tri-state ${stamp}`

  try {
    const created = await page.request.post(`${API}/providers`, {
      data: {
        label: providerLabel,
        modelFamily: 'claude',
        effortLevels: ['High'],
        config: { baseURL: peer.baseURL, protocol: 'anthropic-messages', model: MODEL_NO_EFFORT },
      },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const provider = await created.json() as ModelProvider
    expect(provider.models?.map(model => model.id)).toEqual([MODEL_NO_EFFORT, MODEL_UNKNOWN_EFFORT])
    expect(peer.listings).toHaveLength(1)
    expect(peer.messages).toHaveLength(1)

    await page.goto(`/models/${encodeURIComponent(provider.id)}`)
    const refresh = page.getByRole('button', { name: 'Refresh model catalog', exact: true })
    await expect(refresh).toBeEnabled()
    const refreshResponsePromise = page.waitForResponse(response =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `${API}/providers/${encodeURIComponent(provider.id)}/models/refresh`,
    )
    await refresh.click()
    expect((await refreshResponsePromise).status()).toBe(200)
    await expect(page.getByText('2 models, listed from its endpoint', { exact: true })).toBeVisible()
    expect(peer.listings).toHaveLength(2)
    expect(peer.messages, 'catalog refresh does not generate').toHaveLength(1)

    await openNewSession(page)
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    const trigger = page.getByRole('button', { name: 'Model and effort', exact: true })
    await trigger.click()
    const picker = page.getByRole('dialog', { name: 'Model and effort', exact: true })
    await picker.getByRole('button').filter({ hasText: providerLabel }).first().click()
    await expect(picker).toBeVisible()
    await picker.getByRole('button').filter({ hasText: 'No-effort model' }).click()
    await expect(trigger).toContainText(`${providerLabel} · No-effort model`)
    await expect(picker.getByText('Effort', { exact: true })).toHaveCount(0)
    await expect(picker.getByRole('button', { name: 'High', exact: true })).toHaveCount(0)
    await expect(composer).toBeEnabled()

    for (const viewport of VIEWPORTS) {
      await capturePicker(page, testInfo, 'unsupported', viewport)
      await expect(picker.getByText('Effort', { exact: true }), `${viewport.width}x${viewport.height}: unsupported metadata hides effort`).toHaveCount(0)
      await expect(picker.getByRole('button', { name: 'High', exact: true })).toHaveCount(0)
    }

    await picker.getByRole('button').filter({ hasText: 'Unknown-effort model' }).click()
    await expect(trigger).toContainText(`${providerLabel} · Unknown-effort model`)
    await expect(picker.getByText('Effort', { exact: true })).toBeVisible()
    const high = picker.getByRole('button', { name: 'High', exact: true })
    await expect(high).toBeEnabled()
    await high.click()
    for (const viewport of VIEWPORTS) {
      await capturePicker(page, testInfo, 'unknown', viewport)
      await expect(picker.getByText('Effort', { exact: true })).toBeVisible()
      await expect(picker.getByRole('button', { name: 'High', exact: true })).toBeVisible()
    }

    await picker.getByRole('button').filter({ hasText: 'No-effort model' }).click()
    await expect(trigger).toContainText(`${providerLabel} · No-effort model`)
    await expect(picker.getByText('Effort', { exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(composer).toBeEnabled()

    const sentText = `Send without effort override ${stamp}`
    await composer.fill(sentText)
    await composer.press('Enter')
    await expect(page.getByText(REPLY, { exact: true })).toBeVisible({ timeout: ms(15_000) })
    const generated = peer.messages.filter(request => request.stream === true)
    expect(generated).toHaveLength(1)
    expect(generated[0]?.model).toBe(MODEL_NO_EFFORT)
    expect(Object.hasOwn(generated[0]!, 'output_config'), 'explicitly unsupported effort must not send output_config').toBe(false)
    expect(generated[0]?.messages).toEqual([{ role: 'user', content: sentText }])
  } finally {
    await peer.close()
    await owner.context.close()
  }
})
