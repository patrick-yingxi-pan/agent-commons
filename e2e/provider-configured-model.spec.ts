/** A configured endpoint model remains usable when its provider has no list API. */
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { test, expect, type Page, type Locator } from '@playwright/test'
import { DEFAULT_PROVIDER_ID, type Agent, type ModelProvider, type SystemPromptEntry } from '../contract/index.ts'
import { settledNarrowRail } from './accessibility-helpers.ts'
import { newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

const MODEL_ID = `deepseek-browser-${randomUUID()}`

type WireRequest = { model?: string; messages?: Array<{ role: string; content: unknown }>; stream?: boolean; tools?: unknown[] }

/** Test-owned Anthropic Messages endpoint. Listing is absent until explicitly
 * enabled; probe and generation remain valid the whole time. */
async function startNoListMessagesPeer() {
  let listEnabled = false
  let listRequests = 0
  const requests: WireRequest[] = []
  let sequence = 0
  const server: Server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (req.method === 'GET' && pathname === '/v1/models') {
      listRequests += 1
      if (!listEnabled) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { type: 'not_found_error', message: 'Model listing is not available.' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: MODEL_ID, display_name: 'Configured DeepSeek fixture' }], has_more: false }))
      return
    }
    if (req.method !== 'POST' || pathname !== '/v1/messages') {
      res.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = (chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) as WireRequest
    requests.push(body)
    sequence += 1
    const id = `msg_configured_model_${sequence}`
    const content = 'A local DeepSeek fixture completed this turn.'
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: MODEL_ID,
        content: [{ type: 'text', text: content }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 5 } }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
    const event = (name: string, value: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`)
    event('message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: MODEL_ID,
      content: [], stop_reason: null, usage: { input_tokens: 3, output_tokens: 0 } } })
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content } })
    event('content_block_stop', { type: 'content_block_stop', index: 0 })
    event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
    event('message_stop', { type: 'message_stop' })
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Configured-model fixture did not bind')
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
    get listRequestCount() { return listRequests },
    enableListing() { listEnabled = true },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

async function expectContainedDialog(page: Page, dialog: Locator) {
  const panel = dialog.locator('[data-bounded-dialog]')
  const footer = panel.locator(':scope > div').last()
  await expect.poll(async () => {
    const viewport = page.viewportSize()!
    const workspace = await page.locator('[data-popover-viewport]').boundingBox()
    const boxes = await Promise.all([panel.boundingBox(), footer.boundingBox()])
    return boxes.every((box) => box !== null && box.x >= 7
      && box.y >= (workspace?.y ?? 0) + 7
      && box.x + box.width <= viewport.width - 7
      && box.y + box.height <= viewport.height - 7)
  }, { message: 'dialog and footer stay inside the current viewport', timeout: ms(5_000) }).toBe(true)
}

test('configured model supports provider setup, explicit Dispatch, and later catalog recovery without public calls', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const stamp = randomUUID()
  const owner = await newUser(browser, {
    'x-user-id': `user-configured-model-${stamp}`,
    'x-tenant-id': `tenant-configured-model-${stamp}`,
  })
  const peer = await startNoListMessagesPeer()
  const { page } = owner
  let foreign: Awaited<ReturnType<typeof newUser>> | undefined
  try {
    await page.goto('/models')
    await page.getByRole('button', { name: 'New provider', exact: true }).click()
    const create = page.getByRole('dialog', { name: 'New provider' })
    let submittedProvider: Record<string, any> | undefined
    await page.route('**/api/v1/providers', async (route) => {
      if (route.request().method() === 'POST') submittedProvider = route.request().postDataJSON() as Record<string, any>
      await route.continue()
    })
    await create.getByLabel('Provider preset').selectOption('deepseek')
    await create.getByRole('textbox', { name: 'Name', exact: true }).fill(`Loopback DeepSeek ${stamp.slice(0, 8)}`)
    await create.getByLabel('Endpoint URL').fill(peer.baseURL)
    await create.getByLabel('Model ID', { exact: true }).fill(MODEL_ID)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expectContainedDialog(page, create)
      const modelField = create.getByLabel('Model ID', { exact: true })
      await modelField.scrollIntoViewIfNeeded()
      await expect(modelField).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`configured-provider-${viewport.width}x${viewport.height}.png`) })
    }

    await create.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(create).toHaveCount(0)
    const providersResponse = await page.request.get('/api/v1/providers')
    expect(providersResponse.ok()).toBe(true)
    const providers = await providersResponse.json() as ModelProvider[]
    const provider = providers.find((item) => item.label.startsWith('Loopback DeepSeek'))
    expect(provider, 'the owner can read the newly registered endpoint').toBeTruthy()
    expect(submittedProvider).toMatchObject({ config: { baseURL: peer.baseURL, model: MODEL_ID, protocol: 'anthropic-messages' } })
    expect(provider).toMatchObject({ modelFamily: 'deepseek', execution: 'configured', defaultModelId: MODEL_ID })
    expect(provider!.models ?? [], 'the endpoint has no model catalog yet').toHaveLength(0)
    expect(peer.requests.length, 'registration verifies the configured model through Messages').toBeGreaterThan(0)
    expect(peer.requests.every((request) => request.model === MODEL_ID), 'probe uses the exact configured model ID').toBe(true)
    expect(peer.listRequestCount, 'registration attempted endpoint-owned discovery').toBe(1)

    foreign = await newUser(browser, {
      'x-user-id': `user-configured-model-foreign-${stamp}`,
      'x-tenant-id': `tenant-configured-model-foreign-${stamp}`,
    })
    const foreignProvidersResponse = await foreign.page.request.get('/api/v1/providers')
    expect(foreignProvidersResponse.ok()).toBe(true)
    const foreignProviders = await foreignProvidersResponse.json() as ModelProvider[]
    expect(foreignProviders.some((item) => item.id === provider!.id), 'a foreign tenant cannot see the owner endpoint').toBe(false)
    const sharedDefault = foreignProviders.find((item) => item.id === DEFAULT_PROVIDER_ID)
    expect(sharedDefault, 'the shared built-in provider remains visible').toBeTruthy()
    await foreign.page.goto('/models')
    await expect(foreign.page.getByRole('main').getByText(provider!.label, { exact: true })).toHaveCount(0)
    await expect(foreign.page.getByRole('main').getByText(sharedDefault!.label, { exact: true })).toBeVisible()
    expect((await foreign.page.request.get(`/api/v1/providers/${encodeURIComponent(provider!.id)}`)).status())
      .toBe(404)
    await foreign.page.goto(`/models/${encodeURIComponent(provider!.id)}`)
    await expect(foreign.page.getByRole('heading', { name: provider!.label, exact: true })).toHaveCount(0)
    await foreign.page.goto(`/models/${encodeURIComponent(DEFAULT_PROVIDER_ID)}`)
    await expect(foreign.page.getByRole('heading', { name: sharedDefault!.label, exact: true })).toBeVisible()
    await expect(foreign.page.getByRole('button', { name: 'Refresh model catalog', exact: true })).toHaveCount(0)

    // Create an Agent against this provider through the real owner API, then
    // submit an explicit Agent/provider/model Dispatch in the rendered UI.
    const promptResponse = await page.request.post('/api/v1/system-prompts', {
      data: { label: `DeepSeek fixture prompt ${stamp.slice(0, 8)}`,
        body: 'Use the local fixture response to answer the assigned task clearly.', targetFamily: 'deepseek' },
    })
    expect(promptResponse.ok(), await promptResponse.text()).toBe(true)
    const prompt = await promptResponse.json() as SystemPromptEntry
    const agentResponse = await page.request.post('/api/v1/agents', {
      data: { label: `Configured model Agent ${stamp.slice(0, 8)}`, providerId: provider!.id,
        systemPromptId: prompt.id, tools: [], instructions: 'Answer the assigned task with the local fixture response.' },
    })
    expect(agentResponse.ok(), await agentResponse.text()).toBe(true)
    const agent = await agentResponse.json() as Agent
    expect(agent.providerId).toBe(provider!.id)

    await page.goto('/dispatch')
    await page.getByRole('button', { name: 'New dispatch', exact: true }).click()
    const dispatch = page.getByRole('dialog', { name: 'New dispatch' })
    await dispatch.getByRole('textbox', { name: 'Task' }).fill(`Use configured model ${stamp.slice(0, 8)}`)
    await dispatch.getByRole('textbox', { name: 'Detail' }).fill('Return the local fixture response.')
    await dispatch.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(agent.id)
    await dispatch.getByRole('combobox', { name: 'Model connection', exact: true }).selectOption(provider!.id)
    const modelSelect = dispatch.getByRole('combobox', { name: 'Model', exact: true })
    await expect(modelSelect.locator(`option[value="${MODEL_ID}"]`)).toHaveText(MODEL_ID)
    await expect(dispatch.getByText('This connection has no model list; its configured model is the only choice.', { exact: true })).toBeVisible()
    await modelSelect.selectOption(MODEL_ID)
    await expect(modelSelect).toHaveValue(MODEL_ID)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expectContainedDialog(page, dispatch)
      await modelSelect.scrollIntoViewIfNeeded()
      await expect(modelSelect).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`configured-dispatch-${viewport.width}x${viewport.height}.png`) })
    }
    const task = `Use configured model ${stamp.slice(0, 8)}`
    await dispatch.getByRole('button', { name: 'Dispatch', exact: true }).click()
    await expect(dispatch).toHaveCount(0)
    await expect.poll(async () => {
      const response = await page.request.get('/api/v1/dispatch')
      const runs = await response.json() as Array<{ title: string; execution?: { state: string; agentId: string; providerId: string; modelId: string; sessionId: string } }>
      const run = runs.find((item) => item.title === task)
      return run?.execution?.state === 'replied' ? run.execution : undefined
    }, { timeout: ms(20_000), message: 'the explicit Dispatch completes against the loopback Messages endpoint' })
      .toMatchObject({ agentId: agent.id, providerId: provider!.id, modelId: MODEL_ID })
    const completedRunsResponse = await page.request.get('/api/v1/dispatch')
    expect(completedRunsResponse.ok()).toBe(true)
    const completedRuns = await completedRunsResponse.json() as Array<{ title: string; execution?: { sessionId: string } }>
    const run = completedRuns.find((item) => item.title === task)
    expect(run?.execution?.sessionId).toBeTruthy()
    const sessionResponse = await page.request.get(`/api/v1/sessions/${encodeURIComponent(run!.execution!.sessionId)}`)
    expect(sessionResponse.ok()).toBe(true)
    const session = await sessionResponse.json() as { messages: Array<{ role: string; providerId?: string; modelId?: string }> }
    expect(session.messages.find((message) => message.role === 'assistant')).toMatchObject({ providerId: provider!.id, modelId: MODEL_ID })
    expect(peer.requests.some((request) => request.model === MODEL_ID && request.stream), 'generation used the selected model').toBe(true)
    await page.goto(`/s/${encodeURIComponent(run!.execution!.sessionId)}`)
    const reply = page.locator('[data-turn]').filter({ hasText: 'A local DeepSeek fixture completed this turn.' })
    await expect(reply.locator('[data-turn-model]')).toHaveText(`${provider!.label} · ${MODEL_ID}`)

    // The conversation uses the same shared picker as Customize and Routine.
    // With no endpoint catalog, it shows the exact configured ID and no invented
    // metadata or effort buttons before the later Refresh exposes a real list.
    await page.getByRole('button', { name: 'Model and effort', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Model and effort', exact: true })
    const configuredRow = picker.getByRole('button').filter({ hasText: MODEL_ID })
    await expect(configuredRow).toHaveCount(1)
    await expect(configuredRow).toContainText('Configured model — no catalog or model metadata supplied.')
    await expect(picker.getByText('This model declares no effort levels.', { exact: true })).toBeVisible()
    await expect(picker.getByRole('button', { name: /^(Low|Medium|High)$/ })).toHaveCount(0)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await expect(configuredRow).toBeVisible()
      await configuredRow.scrollIntoViewIfNeeded()
      await expect.poll(async () => {
        const box = await picker.boundingBox()
        const size = page.viewportSize()!
        return box !== null && box.x >= 8 && box.y >= 8
          && box.x + box.width <= size.width - 8
          && box.y + box.height <= size.height - 8
      }, { message: `shared model picker stays in bounds at ${viewport.width}×${viewport.height}` }).toBe(true)
      expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth),
        `picker content has no horizontal overflow at ${viewport.width}×${viewport.height}`).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        `page has no horizontal overflow at ${viewport.width}×${viewport.height}`).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`configured-model-picker-${viewport.width}x${viewport.height}.png`) })
    }
    await page.getByRole('button', { name: 'Model and effort', exact: true }).click()
    await expect(picker).toHaveCount(0)

    // The Models surface states that the one configured model runs even though
    // no catalog can be enumerated. A failed Refresh remains recoverable.
    await page.goto(`/models/${encodeURIComponent(provider!.id)}`)
    await expect(page.getByText('No model catalog — turns run its configured model.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh model catalog', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Refresh model catalog', exact: true }).click()
    const refreshFailure = page.locator('[data-provider-catalog-refresh="failed"]')
    await expect(refreshFailure).toContainText('The provider’s endpoint didn’t answer a model list.')
    expect(peer.listRequestCount, 'the Refresh reached the endpoint while its list API was unavailable').toBe(2)
    peer.enableListing()
    await refreshFailure.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(refreshFailure).toHaveCount(0)
    await page.getByRole('button', { name: 'Refresh model catalog', exact: true }).click()
    await expect(page.getByText('1 model, listed from its endpoint', { exact: true })).toBeVisible()
    const refreshed = await page.request.get(`/api/v1/providers/${encodeURIComponent(provider!.id)}`)
    expect(refreshed.ok()).toBe(true)
    expect(await refreshed.json()).toMatchObject({ catalogSource: 'listed', models: [{ id: MODEL_ID }] })
  } finally {
    await Promise.allSettled([owner.context.close(), foreign?.context.close()])
    await peer.close()
  }
})
