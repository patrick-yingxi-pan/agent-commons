/** Rendered Agent-request argument advice: private, one-shot and never execution consent. */
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { test, expect, type APIRequestContext, type Browser, type Page, type Route, type TestInfo } from '@playwright/test'
import type { Identity } from '../contract/identity.ts'
import type { Agent, ModelProvider, SystemPromptEntry } from '../contract/index.ts'
import { SESSION_COOKIE } from '../server/auth.ts'
import { MCP_MODERN_VERSION } from '../server/mcpProtocol.ts'
import { store } from '../server/store/index.ts'
import { proxyMcpApi, startMcpRouterStack, type McpRouterStack } from './mcp-fixture.ts'
import { assertWcag22Aa, settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]
const TOOL = { name: 'write_private_note', description: 'Write one note after explicit review.', inputSchema: {
  type: 'object' as const, properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
} }
const MODEL_ID = `agent-request-draft-${randomUUID()}`
type Person = { identity: Identity; cookie: string }
type ModelPeer = { baseURL: string; requests: Array<Record<string, unknown>>; setMode(mode: 'success' | 'hold' | 'uncertain' | 'failed'): void; release(): void; close(): Promise<void> }

async function modelPeer(): Promise<ModelPeer> {
  let mode: 'success' | 'hold' | 'uncertain' | 'failed' = 'success', release!: () => void
  let gate = Promise.resolve()
  const requests: Array<Record<string, unknown>> = []
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    if (Array.isArray(body.tools)) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'probe', type: 'message', role: 'assistant', model: MODEL_ID,
        stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }))
      return
    }
    requests.push(body)
    if (mode === 'hold') await gate
    if (mode === 'uncertain') { req.socket.destroy(); return }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: `draft-${requests.length}`, type: 'message', role: 'assistant', model: MODEL_ID,
      stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ toolName: TOOL.name,
        arguments: mode === 'failed' ? { unexpected: true } : { value: `suggestion-${requests.length} `.repeat(240) } }) }], usage: { input_tokens: 71, output_tokens: 19 } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Agent argument-draft model fixture did not bind')
  return { baseURL: `http://127.0.0.1:${address.port}`, requests,
    setMode(next) { mode = next; if (next === 'hold') gate = new Promise<void>(resolve => { release = resolve }) },
    release() { release?.() },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}

async function mcpPeer() {
  const calls: Array<{ method: string; arguments?: unknown }> = []
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const rpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    calls.push({ method: rpc.method, arguments: rpc.params?.arguments })
    const result = rpc.method === 'server/discover' ? { resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Agent request draft fixture', version: '1' } } } :
      rpc.method === 'tools/list' ? { resultType: 'complete', tools: [TOOL] } :
      { resultType: 'complete', content: [{ type: 'text', text: 'private tool result' }], isError: false }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Agent request MCP fixture did not bind')
  return { endpoint: `http://127.0.0.1:${address.port}/mcp`, calls,
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}

async function signedPerson(request: APIRequestContext, stack: McpRouterStack, name: string): Promise<Person> {
  const stamp = randomUUID()
  const response = await request.post(`${stack.url}/api/v1/auth/signup`, {
    data: { name, email: `${stamp}@agent-request-arguments.test`, password: `password-${stamp}` },
  })
  const text = await response.text()
  expect(response.status(), text).toBe(200)
  const identity = JSON.parse(text) as Identity
  expect(identity.via).toBe('session')
  const cookie = response.headers()['set-cookie']?.match(new RegExp(`${SESSION_COOKIE}=([^;,]+)`))?.[1]
  expect(cookie).toBeTruthy()
  return { identity, cookie: cookie! }
}

async function api(request: APIRequestContext, stack: McpRouterStack, person: Person, method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown, idempotencyKey?: string) {
  const response = await request.fetch(`${stack.url}/api/v1${path}`, { method,
    headers: { cookie: `${SESSION_COOKIE}=${person.cookie}`, 'x-account-transition-source': `session:${person.identity.user.id}`,
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
    ...(data === undefined ? {} : { data }) })
  const text = await response.text()
  expect(response.status(), `${method} ${path}: ${text}`).toBeLessThan(300)
  return text ? JSON.parse(text) as any : undefined
}

async function createAgent(request: APIRequestContext, stack: McpRouterStack, person: Person, label: string, providerId?: string): Promise<Agent> {
  const [prompts, providers] = await Promise.all([
    api(request, stack, person, 'GET', '/system-prompts'), api(request, stack, person, 'GET', '/providers'),
  ]) as [SystemPromptEntry[], ModelProvider[]]
  const prompt = prompts[0], provider = providerId ?? providers.find(row => row.isDefault)?.id ?? providers[0]?.id
  expect(prompt).toBeTruthy(); expect(provider).toBeTruthy()
  return await api(request, stack, person, 'POST', '/agents', { label, providerId: provider, systemPromptId: prompt!.id, tools: [],
    instructions: 'Use only the selected note tool and the requested outcome.' }) as Agent
}

async function chooseTool(select: ReturnType<Page['getByRole']>) {
  const value = await select.locator('option').evaluateAll((options, name) =>
    (options.find(option => option.textContent?.includes(name)) as HTMLOptionElement | undefined)?.value, TOOL.name)
  expect(value, `the reviewed tool ${TOOL.name} is available`).toBeTruthy()
  await select.selectOption(value!)
}

async function createRequest(request: APIRequestContext, stack: McpRouterStack, requester: Person, fromAgentId: string, toAgentId: string, task: string) {
  return api(request, stack, requester, 'POST', '/agent-requests', { fromAgentId, toAgentId, task }, randomUUID())
}

async function captureViewports(page: Page, info: TestInfo, label: string, focus: ReturnType<Page['getByRole']>) {
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true })
  if (await collapse.evaluateAll(nodes => nodes.some(node => !node.closest('[inert]')))) await collapse.click()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settledNarrowRail(page)
    await expect(page.locator('main')).not.toHaveAttribute('inert', '')
    await focus.scrollIntoViewIfNeeded()
    await expect(focus).toBeInViewport()
    await settledOpaquePaint(focus)
    await expect.poll(() => page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1,
      fields: [...document.querySelectorAll('main input, main select, main textarea, main pre')].some(node => {
        const box = node.getBoundingClientRect()
        return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1)
      }) }))).toEqual({ overflow: false, fields: false })
    if (viewport.width === 320 || viewport.width === 1280) await assertWcag22Aa(page, `${label} ${viewport.width}`)
    await page.screenshot({ path: info.outputPath(`${label}-${viewport.width}.png`) })
  }
}

test('argument drafts stay private advice across pending, done, uncertain and stale UI states', async ({ page, browser, request }, info) => {
  test.setTimeout(ms(240_000))
  const stack = await startMcpRouterStack()
  const model = await modelPeer(), peer = await mcpPeer()
  const ownerKey = `PROVIDER_AGENT_REQUEST_E2E_${randomUUID().replaceAll('-', '').toUpperCase()}`
  const priorKey = process.env[ownerKey]
  process.env[ownerKey] = 'e2e-local-key-only'
  let proxyDispose: (() => Promise<void>) | undefined
  let requesterContext: Awaited<ReturnType<Browser['newContext']>> | undefined
  try {
    const requester = await signedPerson(request, stack, 'Draft requester')
    const owner = await signedPerson(request, stack, 'Draft owner')
    const connection = await api(request, stack, owner, 'POST', '/mcp-connections', {
      creationId: randomUUID(), label: 'Draft review note fixture', endpoint: peer.endpoint, authentication: 'none',
    }) as { connection: { id: string; revision: number } }
    await api(request, stack, owner, 'POST', `/mcp-connections/${connection.connection.id}/inspect`, {
      operationId: randomUUID(), expectedRevision: connection.connection.revision,
    })
    const inspectedPeerCalls = structuredClone(peer.calls)
    const provider = store.createProvider({ label: `Local argument model ${randomUUID().slice(0, 8)}`, modelFamily: 'claude', effortLevels: ['Low'],
      models: [{ id: MODEL_ID, label: 'Local argument model' }] }, { baseURL: model.baseURL, apiKeyEnv: ownerKey, model: MODEL_ID,
      capabilities: { toolUse: true } }, owner.identity.tenant.id)
    const source = await createAgent(request, stack, requester, `Requester agent ${randomUUID().slice(0, 8)}`)
    const target = await createAgent(request, stack, owner, `Owner agent ${randomUUID().slice(0, 8)}`, provider.id)
    const published = await api(request, stack, owner, 'PATCH', `/agents/${target.id}`, { published: true,
      authority: { connectors: [connection.connection.id] }, expectedRevision: target.revision }) as Agent

    // The signed cookie is a real per-person session; requests are proxied only
    // to this test-owned router and no seeded account or external service.
    await page.goto('/')
    const origin = new URL(page.url()).origin
    await proxyDispose?.()
    proxyDispose = await proxyMcpApi(page, stack)
    await page.context().addCookies([{ name: SESSION_COOKIE, value: owner.cookie, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }])
    await page.reload()

    const first = await createRequest(request, stack, requester, source.id, published.id, `Write one exact note ${randomUUID().slice(0, 8)}.`)
    await page.goto(`/agents/requests/${first.id}`)
    await expect(page.getByRole('heading', { name: 'Choose one call' })).toBeVisible({ timeout: ms(12_000) })
    const toolSelect = page.getByRole('combobox', { name: 'Inspected tool' })
    await expect(toolSelect.locator('option')).toContainText(['Choose an exact tool', TOOL.name])
    await chooseTool(toolSelect)
    await expect(page.getByRole('region', { name: 'Optional argument draft' })).toContainText('no conversation history, connection credentials or tool results')

    await captureViewports(page, info, 'argument-draft-disclosure', page.getByRole('button', { name: 'Draft arguments', exact: true }))

    model.setMode('hold')
    let draftPosts = 0, savedDraft: any
    let committedDraft!: () => void
    const draftCommitted = new Promise<void>(resolve => { committedDraft = resolve })
    const loseFirstDraftAck = async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const body = route.request().postDataJSON() as { action?: string }
      if (body.action !== 'draft-arguments') return route.fallback()
      draftPosts++
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
      savedDraft = await api(request, stack, owner, 'POST', path, body)
      committedDraft()
      await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'The saved draft acknowledgement was lost.' } }) })
    }
    let savedStatusReads = 0
    const countSavedStatusReads = async (route: Route) => {
      if (route.request().method() === 'GET') savedStatusReads++
      await route.fallback()
    }
    await page.route('**/api/v1/agent-requests/*/decision', loseFirstDraftAck)
    await page.route(`**/api/v1/agent-requests/${first.id}`, countSavedStatusReads)
    await page.getByRole('button', { name: 'Draft arguments', exact: true }).click()
    await draftCommitted
    expect(savedDraft.argumentDraft.status).toBe('pending')
    await page.unroute('**/api/v1/agent-requests/*/decision', loseFirstDraftAck)
    await expect.poll(() => savedStatusReads, { timeout: ms(12_000) }).toBeGreaterThan(0)
    await page.goto('/agents/requests')
    await page.goto(`/agents/requests/${first.id}`)
    const pending = page.getByRole('region', { name: 'Optional argument draft' })
    await expect(pending).toContainText('Drafting arguments… No tool is running.', { timeout: ms(12_000) })
    await expect(pending.locator('[data-agent-request-draft-binding]')).toContainText(TOOL.name)
    await expect(pending.locator('[data-agent-request-draft-binding]')).toContainText(MODEL_ID)
    await captureViewports(page, info, 'argument-draft-pending', pending.getByRole('status'))
    expect(draftPosts).toBe(1, 'lost acknowledgement recovery reads saved status and never resubmits the model request')
    expect(savedStatusReads).toBeGreaterThan(0, 'the controller resolves uncertainty with a canonical GET')
    expect(model.requests).toHaveLength(1)
    model.release()
    const firstGenerated = page.getByRole('region', { name: 'Optional argument draft' })
    await expect(firstGenerated.getByText(/Suggested arguments · private to you/)).toBeVisible({ timeout: ms(20_000) })
    await chooseTool(page.getByRole('combobox', { name: 'Inspected tool' }))
    await captureViewports(page, info, 'argument-draft-done', firstGenerated.getByRole('button', { name: 'Use draft' }))
    const reader = firstGenerated.getByRole('region', { name: 'Suggested arguments', exact: true })
    await reader.focus()
    await reader.press('End')
    await expect.poll(() => reader.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
    await reader.press('Home')
    await expect.poll(() => reader.evaluate(node => node.scrollTop)).toBe(0)
    await expect(model.requests).toHaveLength(1)
    const modelText = JSON.stringify(model.requests[0])
    expect(modelText).toContain(first.task)
    expect(modelText).toContain('Use only the selected note tool')
    expect(modelText).toContain('inputSchema')
    expect(modelText).not.toContain(owner.cookie)
    expect(modelText).not.toContain(peer.endpoint)
    expect(modelText).not.toContain('private tool result')
    expect(peer.calls).toEqual(inspectedPeerCalls, 'argument advice causes no MCP request beyond the prior connection inspection')
    expect(peer.calls.some(call => call.method === 'tools/call')).toBe(false)

    // A completed model response remains advice until the owner chooses Use draft.
    await expect(page.getByRole('textbox', { name: 'Arguments (JSON)' })).toHaveValue('{}')
    await firstGenerated.getByRole('button', { name: 'Use draft' }).click()
    const argumentEditor = page.getByRole('textbox', { name: 'Arguments (JSON)' })
    await expect(argumentEditor).toHaveValue(/suggestion-1/)
    await argumentEditor.fill('{"value":"owner edited this after using the suggestion"}')
    await page.getByRole('button', { name: 'Review call', exact: true }).click()
    await expect(page.getByRole('heading', { name: /Run write_private_note once\?/ })).toBeVisible()
    expect(peer.calls).toEqual(inspectedPeerCalls, 'copying draft and reviewing a call do not add another MCP request')
    await page.getByRole('button', { name: 'Run once', exact: true }).click()
    await expect.poll(() => peer.calls.filter(call => call.method === 'tools/call').length, { timeout: ms(20_000) }).toBe(1)
    expect(peer.calls.find(call => call.method === 'tools/call')?.arguments).toEqual({ value: 'owner edited this after using the suggestion' })
    await expect(page.getByRole('heading', { name: 'Private execution receipt' })).toBeVisible()

    requesterContext = await browser.newContext({ baseURL: origin })
    await requesterContext.addCookies([{ name: SESSION_COOKIE, value: requester.cookie, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }])
    const requesterPage = await requesterContext.newPage()
    const requesterDispose = await proxyMcpApi(requesterPage, stack)
    await requesterPage.goto(`/agents/requests/${first.id}`)
    await expect(requesterPage.getByRole('heading', { name: 'Agent request' })).toBeVisible()
    await expect(requesterPage.getByText(/suggestion-1/)).toHaveCount(0)
    await expect(requesterPage.getByRole('heading', { name: 'Private argument draft receipt' })).toHaveCount(0)
    await requesterDispose()

    const second = await createRequest(request, stack, requester, source.id, published.id, 'This draft endpoint will lose its reply.')
    model.setMode('uncertain')
    await page.goto(`/agents/requests/${second.id}`)
    await expect(page.getByRole('heading', { name: 'Choose one call' })).toBeVisible()
    await chooseTool(page.getByRole('combobox', { name: 'Inspected tool' }))
    await page.getByRole('button', { name: 'Draft arguments', exact: true }).click()
    const uncertain = page.getByRole('region', { name: 'Optional argument draft' })
    await expect(uncertain).toContainText('The model outcome is uncertain.', { timeout: ms(20_000) })
    await captureViewports(page, info, 'argument-draft-uncertain', uncertain.getByRole('status'))
    expect(peer.calls.filter(call => call.method === 'tools/call')).toHaveLength(1)

    const failedRequest = await createRequest(request, stack, requester, source.id, published.id, 'The invalid model result must not become arguments.')
    model.setMode('failed')
    await page.goto(`/agents/requests/${failedRequest.id}`)
    await expect(page.getByRole('heading', { name: 'Choose one call' })).toBeVisible()
    await chooseTool(page.getByRole('combobox', { name: 'Inspected tool' }))
    await page.getByRole('button', { name: 'Draft arguments', exact: true }).click()
    const failed = page.getByRole('region', { name: 'Optional argument draft' })
    await expect(failed).toContainText('No usable argument draft was returned.', { timeout: ms(20_000) })
    await captureViewports(page, info, 'argument-draft-failed', failed.getByRole('status'))
    expect(peer.calls.filter(call => call.method === 'tools/call')).toHaveLength(1)

    const third = await createRequest(request, stack, requester, source.id, published.id, 'This suggestion will become stale.')
    model.setMode('success')
    await page.goto(`/agents/requests/${third.id}`)
    await expect(page.getByRole('heading', { name: 'Choose one call' })).toBeVisible()
    await chooseTool(page.getByRole('combobox', { name: 'Inspected tool' }))
    await page.getByRole('button', { name: 'Draft arguments', exact: true }).click()
    const retained = page.getByRole('region', { name: 'Optional argument draft' })
    await expect(retained.getByText(/Suggested arguments · private to you/)).toBeVisible({ timeout: ms(20_000) })
    const currentAgent = store.listAgents(owner.identity.tenant.id).find(row => row.id === published.id)!
    store.updateAgentFromRequest(currentAgent.id, { instructions: 'Changed instructions make the old draft stale.' }, currentAgent.revision)
    await page.goto('/agents/requests')
    await page.goto(`/agents/requests/${third.id}`)
    await expect(page.getByRole('heading', { name: 'Choose one call' })).toBeVisible()
    await chooseTool(page.getByRole('combobox', { name: 'Inspected tool' }))
    const stale = page.getByRole('region', { name: 'Optional argument draft' })
    await expect(stale).toContainText('This suggestion is retained as history; enter arguments manually.')
    await expect(stale.getByRole('button', { name: 'Use draft' })).toHaveCount(0)
    await captureViewports(page, info, 'argument-draft-stale', stale.getByRole('status'))
  } finally {
    await proxyDispose?.()
    await requesterContext?.close()
    await model.close()
    await peer.close()
    await stack.close()
    if (priorKey === undefined) delete process.env[ownerKey]
    else process.env[ownerKey] = priorKey
  }
})
