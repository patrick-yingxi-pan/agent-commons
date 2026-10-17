/** A catalog change never substitutes a neighboring model for saved identity. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Page } from '@playwright/test'
import type { ModelProvider, SystemPromptEntry, ViewerModelPreferences } from '../contract/index.ts'
import { settledNarrowRail } from './accessibility-helpers.ts'
import { newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const API = '/api/v1'
const MODEL_A = `catalog-a-${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`
const MODEL_B = `catalog-b-${randomUUID()}`
const REPLY = 'The local model B fixture completed this reply.'
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

type PeerRequest = { model?: string; stream?: boolean; tools?: Array<{ name?: string }> }

async function readRequestBody(request: IncomingMessage): Promise<PeerRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as PeerRequest
}

function sendProbe(response: ServerResponse, model: string) {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({
    id: 'catalog-identity-probe',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'tool_use', id: 'probe-noop', name: 'probe_noop', input: {} }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 1, output_tokens: 1 },
  }))
}

function sendReply(response: ServerResponse, model: string) {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
  const event = (name: string, value: unknown) => response.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`)
  event('message_start', { type: 'message_start', message: {
    id: 'catalog-identity-reply', type: 'message', role: 'assistant', model,
    content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 },
  } })
  event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: REPLY } })
  event('content_block_stop', { type: 'content_block_stop', index: 0 })
  event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
  event('message_stop', { type: 'message_stop' })
  response.end()
}

async function startLocalPeer() {
  const requests: PeerRequest[] = []
  const server: Server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (request.method !== 'POST' || path !== '/v1/messages') {
      response.writeHead(404).end()
      return
    }
    const body = await readRequestBody(request)
    requests.push(body)
    if (!body.stream) sendProbe(response, body.model ?? MODEL_A)
    else sendReply(response, body.model ?? MODEL_A)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The test model peer did not bind.')
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

async function expectPickerContained(page: Page, label: string) {
  const picker = page.getByRole('dialog', { name: 'Model and effort', exact: true })
  await expect.poll(async () => {
    const box = await picker.boundingBox()
    const viewport = page.viewportSize()!
    return !!box && box.x >= 7 && box.y >= 7
      && box.x + box.width <= viewport.width - 7
      && box.y + box.height <= viewport.height - 7
      && await picker.evaluate(element => element.scrollWidth <= element.clientWidth)
  }, { message: `${label} picker stays inside the viewport` }).toBe(true)
}

test('catalog loss preserves the inherited model identity until the owner explicitly repairs it', async ({ browser }: { browser: Browser }, testInfo) => {
  test.setTimeout(ms(90_000))
  const stamp = randomUUID().slice(0, 10)
  const owner = await newUser(browser, {
    'x-user-id': `user-model-identity-${stamp}`,
    'x-tenant-id': `tenant-model-identity-${stamp}`,
  })
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const peer = await startLocalPeer()
  const { page } = owner
  const providerLabel = `Identity fixture ${stamp}`
  const agentLabel = `Inherited model Agent ${stamp}`
  const firstTurn = `Persisted model identity fixture ${stamp}`
  let sessionId = ''

  try {
    const createdProvider = await page.request.post(`${API}/providers`, {
      data: {
        label: providerLabel,
        modelFamily: 'claude',
        effortLevels: ['Default'],
        isDefault: true,
        models: [
          { id: MODEL_A, label: 'Catalog model A', effortLevels: ['Default'] },
          { id: MODEL_B, label: 'Catalog model B', effortLevels: ['Default'] },
        ],
        config: { baseURL: peer.baseURL, protocol: 'anthropic-messages', model: MODEL_A },
      },
    })
    expect(createdProvider.ok(), await createdProvider.text()).toBeTruthy()
    const provider = await createdProvider.json() as ModelProvider
    expect(provider).toMatchObject({ label: providerLabel, defaultModelId: MODEL_A, isDefault: true })
    expect(provider.models?.map(model => model.id)).toEqual([MODEL_A, MODEL_B])
    expect(peer.requests).toHaveLength(1)
    expect(peer.requests[0]?.model).toBe(MODEL_A)
    expect(peer.requests[0]?.tools?.some(tool => tool.name === 'probe_noop')).toBe(true)

    const promptResponse = await page.request.post(`${API}/system-prompts`, {
      data: {
        label: `Identity fixture prompt ${stamp}`,
        body: 'Use the selected catalog model to answer the assigned task.',
        targetFamily: 'claude',
      },
      headers: { 'Idempotency-Key': `model-identity-prompt-${stamp}` },
    })
    expect(promptResponse.ok(), await promptResponse.text()).toBeTruthy()
    const prompt = await promptResponse.json() as SystemPromptEntry
    const agentResponse = await page.request.post(`${API}/agents`, {
      data: { label: agentLabel, providerId: provider.id, systemPromptId: prompt.id, tools: [], instructions: 'A test-only inherited provider Agent.' },
    })
    expect(agentResponse.ok(), await agentResponse.text()).toBeTruthy()
    const agent = await agentResponse.json() as { id: string; providerId: string }
    expect(agent.providerId).toBe(provider.id)

    const createdSession = await page.request.post(`${API}/sessions`, {
      data: { firstMessage: firstTurn, persistFirstMessage: true, agentId: agent.id, modelId: MODEL_A },
    })
    expect(createdSession.ok(), await createdSession.text()).toBeTruthy()
    const createdRow = await createdSession.json() as { id: string; providerId?: string; modelId?: string }
    sessionId = createdRow.id
    expect(createdRow).toMatchObject({ modelId: MODEL_A })
    expect(createdRow.providerId, 'the session inherits its provider from the selected Agent').toBeUndefined()

    const grant = await page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'session', id: sessionId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grant.ok(), await grant.text()).toBeTruthy()

    const replaced = await page.request.patch(`${API}/providers/${encodeURIComponent(provider.id)}/models`, {
      data: { expectedRevision: provider.connectionRevision, models: [{ id: MODEL_B, label: 'Catalog model B', effortLevels: ['Default'] }] },
    })
    expect(replaced.ok(), await replaced.text()).toBeTruthy()
    const currentProvider = await replaced.json() as ModelProvider
    expect(currentProvider.defaultModelId).toBe(MODEL_A)
    expect(currentProvider.models?.map(model => model.id)).toEqual([MODEL_B])
    const sweptSessionResponse = await page.request.get(`${API}/sessions/${encodeURIComponent(sessionId)}`)
    expect(sweptSessionResponse.ok()).toBe(true)
    const sweptSession = await sweptSessionResponse.json() as { agentId?: string; providerId?: string; modelId?: string }
    expect(sweptSession).toMatchObject({ agentId: agent.id })
    expect(sweptSession.providerId).toBeUndefined()
    expect(sweptSession.modelId, 'catalog replacement sweeps the stale explicit A pick').toBeUndefined()

    // Fresh drafts read personal model preference, not the provider's default
    // flag; pin it to the same exact A reference so it cannot choose B instead.
    const preferenceResponse = await page.request.get(`${API}/viewer-preferences/model`)
    expect(preferenceResponse.ok(), await preferenceResponse.text()).toBeTruthy()
    const preferences = await preferenceResponse.json() as ViewerModelPreferences
    const pinnedPreference = await page.request.patch(`${API}/viewer-preferences/model`, {
      data: {
        expectedTenantId: preferences.tenantId,
        expectedUserId: preferences.userId,
        expectedRevision: preferences.revision,
        preferences: { ...preferences.preferences, providerId: provider.id, modelId: MODEL_A },
      },
      headers: { 'Idempotency-Key': `model-identity-preference-${stamp}` },
    })
    expect(pinnedPreference.ok(), await pinnedPreference.text()).toBeTruthy()

    // The fresh draft now explicitly inherits the same unavailable A reference
    // and is blocked before a Session is materialized. The saved Session below
    // separately proves how the owner repairs a swept persisted selection.
    await page.goto('/')
    const freshComposer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(freshComposer).toBeDisabled()
    await expect(freshComposer).toHaveAttribute('placeholder', 'Choose an available model…')
    await expect(page.getByText(`Model '${MODEL_A}' is unavailable. Choose an available model in Model and effort, or update this connection in Models.`, { exact: true })).toBeVisible()
    expect(peer.requests.filter(request => request.stream)).toHaveLength(0)

    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    await expect(page.locator('[data-turn]').filter({ hasText: firstTurn })).toBeVisible()
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(composer).toBeDisabled()
    await expect(composer).toHaveAttribute('placeholder', 'Choose an available model…')
    const unavailableAdvice = `Model '${MODEL_A}' is unavailable. Choose an available model in Model and effort, or update this connection in Models.`
    const unavailableNote = page.getByText(unavailableAdvice, { exact: true })
    await expect(unavailableNote).toBeVisible()
    const selector = page.getByRole('button', { name: 'Model and effort', exact: true })
    await expect(selector).toContainText(`${providerLabel} · ${MODEL_A} · unavailable`)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await expect(composer).toBeDisabled()
      await expect(selector).toBeVisible()
      await expect(unavailableNote).toBeVisible()
      await expect(unavailableNote).toBeInViewport()
      expect(await unavailableNote.evaluate(element => element.scrollWidth <= element.clientWidth),
        `unavailable-model note has no internal horizontal overflow at ${viewport.width}x${viewport.height}`).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`model-identity-unavailable-${viewport.width}x${viewport.height}.png`) })
    }

    await selector.click()
    const picker = page.getByRole('dialog', { name: 'Model and effort', exact: true })
    const missing = picker.locator('[data-model-unavailable]')
    await expect(missing).toHaveText(`Model '${MODEL_A}' is unavailable. Choose an available model below, or update this connection in Models.`)
    const modelB = picker.locator('[data-model-choice]').filter({ hasText: 'Catalog model B' })
    await expect(modelB).toHaveCount(1)
    await expect(modelB.locator('svg')).toHaveCount(0, 'B is offered but was not silently selected for missing A')
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await expectPickerContained(page, `unavailable model at ${viewport.width}x${viewport.height}`)
      await expect(missing).toBeVisible()
      await modelB.scrollIntoViewIfNeeded()
      await expect(modelB).toBeVisible()
      await expect(modelB).toBeInViewport()
      const pickerBox = await picker.boundingBox()
      const modelBBox = await modelB.boundingBox()
      expect(pickerBox && modelBBox
        && modelBBox.x >= pickerBox.x && modelBBox.y >= pickerBox.y
        && modelBBox.x + modelBBox.width <= pickerBox.x + pickerBox.width
        && modelBBox.y + modelBBox.height <= pickerBox.y + pickerBox.height,
      `model B is visibly reachable inside the picker at ${viewport.width}x${viewport.height}`).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`model-identity-picker-${viewport.width}x${viewport.height}.png`) })
    }

    await modelB.click()
    await expect(missing).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(composer).toBeEnabled()
    await expect(composer).toHaveAttribute('placeholder', 'Message…')
    await expect(page.getByText(unavailableAdvice, { exact: true })).toHaveCount(0)
    await expect(selector).toContainText(`${providerLabel} · Catalog model B`)
    await expect(selector).not.toContainText('unavailable')
    await expect.poll(async () => {
      const response = await page.request.get(`${API}/sessions/${encodeURIComponent(sessionId)}`)
      expect(response.ok()).toBe(true)
      const saved = await response.json() as { providerId?: string; modelId?: string }
      return [saved.providerId, saved.modelId]
    }).toEqual([provider.id, MODEL_B])

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await expect(composer).toBeEnabled()
      await expect(selector).toContainText(`${providerLabel} · Catalog model B`)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`model-identity-recovered-${viewport.width}x${viewport.height}.png`) })
    }

    const sendText = `Send only with explicit model B ${stamp}`
    const replyResponse = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `${API}/sessions/${encodeURIComponent(sessionId)}/messages`)
    await composer.fill(sendText)
    await composer.press('Enter')
    expect((await replyResponse).ok()).toBe(true)
    await expect(page.locator('[data-turn]').filter({ hasText: REPLY })).toBeVisible({ timeout: ms(20_000) })
    const generation = peer.requests.filter(request => request.stream)
    expect(generation).toHaveLength(1)
    expect(generation[0]?.model).toBe(MODEL_B)
    const completed = await page.request.get(`${API}/sessions/${encodeURIComponent(sessionId)}`)
    expect(completed.ok()).toBe(true)
    const afterSend = await completed.json() as { messages: Array<{ role: string; providerId?: string; modelId?: string }> }
    expect(afterSend.messages.find(message => message.role === 'assistant')).toMatchObject({ providerId: provider.id, modelId: MODEL_B })

    // A granted visitor can read the same transcript but cannot repair or send;
    // an unrelated tenant is refused and lands on its own clean draft.
    await reader.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    await expect(reader.page.locator('[data-turn]').filter({ hasText: REPLY })).toBeVisible()
    const visitorComposer = reader.page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(visitorComposer).toBeDisabled()
    await expect(visitorComposer).toHaveAttribute('placeholder', 'Only the conversation owner can send messages.')
    const visitorRead = await reader.page.request.get(`${API}/sessions/${encodeURIComponent(sessionId)}`)
    expect(visitorRead.status()).toBe(200)

    const foreignRead = await foreign.page.request.get(`${API}/sessions/${encodeURIComponent(sessionId)}`)
    expect(foreignRead.status()).toBe(404)
    const foreignRenderedRead = foreign.page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname === `${API}/sessions/${encodeURIComponent(sessionId)}` && response.request().method() === 'GET'
    })
    await foreign.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    expect((await foreignRenderedRead).status()).toBe(404)
    await expect(foreign.page.locator('[data-conversation-pane="draft"]')
      .getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
    await expect(foreign.page.locator('body')).not.toContainText(firstTurn)
    await expect(foreign.page.locator('[data-turn]')).toHaveCount(0)
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
    await peer.close()
  }
})
