/** Owner consent for bounded unattended MCP calls stays separate from routine
 * context setup and remains private across the shared-resource boundary. */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { ScheduledTask, ScheduleTemplate } from '../contract/index.ts'
import type { RoutineMcpDecisionRequest, RoutineMcpReview } from '../contract/routineMcpApi.ts'
import { startMcpFixture, startMcpRouterStack, proxyMcpApi } from './mcp-fixture.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { createRoutineRunner } from '../server/routineRunner.ts'
import { configureScheduleExecutor } from '../server/store/index.ts'

const API = '/api/v1'
const VIEWPORTS = [{ width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]

function sse(res: import('node:http').ServerResponse, event: string, data: unknown) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }

async function captureViews(page: Page, info: TestInfo, label: string, check: () => Promise<void>, lowerContent: Locator) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await check()
    const header = page.locator('header').filter({ has: page.locator('[data-routine-delivery-icon]') })
    await expect(header.getByText('New workflow', { exact: true })).toBeVisible()
    await expect(header).not.toContainText('New workflow · paused')
    await page.getByRole('heading', { name: 'External MCP', exact: true }).scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await assertWcag22Aa(page, `Routine MCP ${label} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: info.outputPath(`${label}-${viewport.width}x${viewport.height}.png`), fullPage: true })
    // The workspace pane scrolls inside the viewport; fullPage cannot capture
    // its lower content. Prove actual reachability and preserve those pixels.
    await lowerContent.scrollIntoViewIfNeeded()
    await expect(lowerContent).toBeInViewport()
    await page.screenshot({ path: info.outputPath(`${label}-lower-${viewport.width}x${viewport.height}.png`), fullPage: true })
  }
}

/** Test-owned Anthropic Messages peer: requests the actual offered tool and
 * returns final prose only after the executor submits the tool_result. */
async function startRoutineMessagesPeer() {
  let calls = 0
  const offered: string[] = []
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: boolean; tools?: Array<{ name: string }>; messages?: Array<{ content: unknown }> } : {}
    if (req.method === 'GET' && (req.url ?? '').split('?')[0] === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'routine-mcp-e2e-model', display_name: 'Routine MCP fixture' }] }))
      return
    }
    if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== '/v1/messages') { res.writeHead(404).end(); return }
    if (body.tools?.some((tool) => tool.name === 'probe_noop')) {
      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'routine-mcp-provider-probe', type: 'message', role: 'assistant', model: 'routine-mcp-e2e-model', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }))
      } else {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
        sse(res, 'message_start', { type: 'message_start', message: { id: 'routine-mcp-provider-probe', type: 'message', role: 'assistant', model: 'routine-mcp-e2e-model', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } })
        sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
        sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })
        sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
        sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
        sse(res, 'message_stop', { type: 'message_stop' }); res.end()
      }
      return
    }
    calls += 1
    const content = body.messages?.at(-1)?.content
    const continued = Array.isArray(content) && content.some((block) => block?.type === 'tool_result')
    const external = body.tools?.find((tool) => tool.name.startsWith('mcp_external_'))
    if (!continued && !external) { res.writeHead(500).end('No offered external MCP tool'); return }
    const id = `routine-mcp-peer-${calls}`
    const payload = continued
      ? { block: { type: 'text', text: 'The requested external lookup completed.' }, stop: 'end_turn' }
      : (offered.push(external!.name), { block: { type: 'tool_use', id: `call-${calls}`, name: external!.name, input: { query: 'routine-mcp-e2e' } }, stop: 'tool_use' })
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id, type: 'message', role: 'assistant', model: 'routine-mcp-e2e-model', content: [payload.block], stop_reason: payload.stop, usage: { input_tokens: 1, output_tokens: 1 } }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
    sse(res, 'message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'routine-mcp-e2e-model', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } })
    const block = payload.block.type === 'tool_use' ? { ...payload.block, input: {} } : { type: 'text', text: '' }
    sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: block })
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: payload.block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(payload.block.input) } : { type: 'text_delta', text: payload.block.text } })
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
    sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: payload.stop, stop_sequence: null }, usage: { output_tokens: 1 } })
    sse(res, 'message_stop', { type: 'message_stop' }); res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Messages fixture failed to bind')
  return { url: `http://127.0.0.1:${address.port}`, offered, get calls() { return calls }, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}

async function createBoundRoutine(page: Page, name: string, endpoint: string): Promise<ScheduledTask> {
  const stamp = Date.now().toString(36)
  const providerResponse = await api(page, 'POST', `${API}/providers`, { label: `Routine MCP ${stamp}`, modelFamily: 'claude', effortLevels: ['Default'], models: [{ id: 'routine-mcp-e2e-model', label: 'Routine MCP fixture' }], config: { baseURL: endpoint, model: 'routine-mcp-e2e-model' } })
  expect(providerResponse.ok, JSON.stringify(providerResponse.json)).toBe(true)
  const provider = providerResponse.json as { id: string }
  const prompts = await api(page, 'GET', `${API}/system-prompts`)
  const prompt = (prompts.json as Array<{ id: string }>)[0]
  expect(prompt).toBeDefined()
  const agentResponse = await api(page, 'POST', `${API}/agents`, { label: `Routine MCP agent ${stamp}`, providerId: provider.id, systemPromptId: prompt!.id, tools: [], instructions: '' })
  expect(agentResponse.ok).toBe(true)
  const templates = await api(page, 'GET', `${API}/schedule-templates`)
  const template = (templates.json as ScheduleTemplate[])[0]
  expect(template).toBeDefined()
  const created = await api(page, 'POST', `${API}/schedules`, { seed: { ...template!.seed, name, enabled: true, prompt: 'Look up routine-mcp-e2e with an approved external MCP tool.', runs: [], steps: [], delivery: { tool: { id: 'assistant', label: 'Assistant', tone: 'claude' }, target: 'Run conversation' }, agentId: (agentResponse.json as { id: string }).id, providerId: provider.id, modelId: 'routine-mcp-e2e-model', effort: 'Default', model: 'Routine MCP fixture · Default' } })
  expect(created.ok).toBe(true)
  return created.json as ScheduledTask
}

async function api(page: Page, method: string, path: string, data?: unknown, headers?: Record<string, string>) {
  return page.evaluate(async ({ method, path, data, headers }) => {
    const response = await fetch(`${path.startsWith('/api/v1/') ? '' : '/api/v1'}${path}`, {
      method,
      headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    return { status: response.status, ok: response.ok, json: await response.json() as unknown }
  }, { method, path, data, headers })
}

async function createRoutine(page: Page, name: string, enabled = true): Promise<ScheduledTask> {
  const response = await api(page, 'GET', `${API}/schedule-templates`)
  expect(response.ok).toBe(true)
  const [template] = response.json as ScheduleTemplate[]
  const created = await api(page, 'POST', `${API}/schedules`, { seed: { ...template!.seed, name, enabled, prompt: 'Use the attached external MCP tool with query "routine-mcp-e2e".', runs: [] } })
  expect(created.ok).toBe(true)
  return created.json as ScheduledTask
}

async function connectFixture(page: Page, fixture: Awaited<ReturnType<typeof startMcpFixture>>, label = 'Routine review fixture') {
  const created = await api(page, 'POST', `${API}/mcp-connections`, { creationId: `routine-mcp-${Date.now()}-${Math.random()}`, label, endpoint: fixture.url, authentication: 'none' })
  expect(created.ok).toBe(true)
  const { connection } = created.json as { connection: { id: string; revision: number } }
  const inspected = await api(page, 'POST', `${API}/mcp-connections/${connection.id}/inspect`, { operationId: `routine-mcp-inspect-${Date.now()}-${Math.random()}`, expectedRevision: connection.revision })
  expect(inspected.ok).toBe(true)
  return connection.id
}

async function review(page: Page, id: string): Promise<RoutineMcpReview> {
  const response = await api(page, 'GET', `${API}/schedules/${id}/mcp-permission`)
  expect(response.ok).toBe(true)
  return response.json as RoutineMcpReview
}

async function approve(page: Page, id: string, current: RoutineMcpReview, connectionId: string, fixed = { query: 'routine-mcp-e2e' }) {
  const tool = current.tools.find(row => row.connectionId === connectionId)
  expect(tool).toBeDefined()
  const request: RoutineMcpDecisionRequest = {
    requestId: `routine-mcp-approve-${Date.now()}-${Math.random()}`,
    action: 'approve',
    approval: {
      expectedRevision: current.policy.revision,
      expectedDefinitionRevision: current.definitionRevision,
      reviewHash: current.reviewHash,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      maxCallsPerRun: 3,
      tools: [{ connectionId, connectionRevision: tool!.connectionRevision, toolName: tool!.tool.name, schemaHash: tool!.schemaHash, fixedArguments: fixed }],
    },
  }
  const response = await api(page, 'POST', `${API}/schedules/${id}/mcp-permission`, request, { 'Idempotency-Key': request.requestId })
  expect(response.ok).toBe(true)
  return { request, response: response.json as { review: RoutineMcpReview } }
}

test('owner reviews exact tools and fixed values, sees server disclosures, and can revoke', async ({ page }, testInfo) => {
  test.setTimeout(ms(60_000))
  const fixture = await startMcpFixture({ label: 'Private routine peer', schemaPadding: 30 })
  const stack = await startMcpRouterStack()
  const disposeProxy = await proxyMcpApi(page, stack)
  try {
    await page.goto('/scheduled')
    const task = await createRoutine(page, `Routine MCP consent ${Date.now().toString(36)}`)
    await connectFixture(page, fixture, `Unselected routine peer ${Date.now()}`)
    const schemaLabel = `Routine review fixture ${Date.now()}`
    const connectionId = await connectFixture(page, fixture, schemaLabel)
    await page.goto(`/scheduled/${task.id}/external-mcp`)
    const panel = page.getByRole('region', { name: 'External MCP' })
    await expect(page.locator('[data-routine-delivery-icon]')).toHaveAttribute('role', 'img')
    await expect(page.getByRole('img', { name: 'New session', exact: true })).toBeVisible()
    await expect(panel.getByText('No unattended MCP tools', { exact: true })).toBeVisible({ timeout: ms(20_000) })
    await captureViews(page, testInfo, 'empty', async () => await expect(panel.getByText('No unattended MCP tools', { exact: true })).toBeVisible(), panel.getByRole('button', { name: 'Review approval', exact: true }))
    expect(await panel.getByRole('checkbox').count()).toBeGreaterThanOrEqual(2)
    const toolCard = panel.locator('article').filter({ hasText: schemaLabel })
    await expect(toolCard).toHaveCount(1)
    await expect(toolCard.getByText('inspect_records', { exact: true })).toBeVisible()
    await toolCard.getByRole('checkbox').check()
    await toolCard.getByLabel('Fixed values for inspect_records').fill('{"query":"routine-mcp-e2e"}')
    await panel.getByLabel('Maximum calls per run').fill('3')
    await toolCard.getByText('Input schema', { exact: true }).click()
    const schema = toolCard.getByRole('region', { name: 'Input schema for inspect_records', exact: true })
    await expect.poll(() => schema.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await schema.focus()
    await schema.press('End')
    await expect.poll(() => schema.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await captureViews(page, testInfo, 'choices', async () => await expect(toolCard.getByLabel('Fixed values for inspect_records')).toHaveValue('{"query":"routine-mcp-e2e"}'), toolCard.getByLabel('Fixed values for inspect_records'))
    await panel.getByRole('button', { name: 'Review approval', exact: true }).click()
    const step = panel.locator('[aria-label="Approval review"]')
    await expect(step).toContainText('Destination and audience')
    await expect(step).toContainText(schemaLabel)
    await expect(step).toContainText('not a monetary cap')
    await expect(step).toContainText('routine-mcp-e2e')

    await captureViews(page, testInfo, 'review', async () => await expect(step.getByRole('button', { name: 'Approve these tools', exact: true })).toBeVisible(), step.getByRole('button', { name: 'Approve these tools', exact: true }))
    await step.getByRole('button', { name: 'Approve these tools', exact: true }).click()
    await expect(panel.getByText('Approval active', { exact: true })).toBeVisible({ timeout: ms(20_000) })
    await captureViews(page, testInfo, 'current', async () => await expect(panel.getByText('Approval active', { exact: true })).toBeVisible(), panel.getByRole('button', { name: 'Revoke approval', exact: true }))
    let current = await review(page, task.id)
    expect(current.active).toBe(true)
    expect(current.policy.approval?.maxCallsPerRun).toBe(3)
    expect(current.policy.approval?.tools).toMatchObject([{ connectionId, toolName: 'inspect_records', fixedArguments: { query: 'routine-mcp-e2e' } }])
    expect(current.policy.approval?.expiresAt).toBeGreaterThan(Date.now())

    await panel.getByRole('button', { name: 'Revoke approval', exact: true }).click()
    await expect(panel.getByText('No unattended MCP tools', { exact: true })).toBeVisible({ timeout: ms(20_000) })
    current = await review(page, task.id)
    expect(current.active).toBe(false)
    expect(current.policy.approval).toBeNull()

    const reapproved = await approve(page, task.id, current, connectionId)
    const changed = await api(page, 'PATCH', `${API}/schedules/${task.id}`, { prompt: 'Changed definition requires review.', expectedRevision: task.revision })
    expect(changed.ok).toBe(true)
    const stale = await review(page, task.id)
    expect(stale.reviewHash).not.toBe(reapproved.response.review.reviewHash)
    expect(stale.active).toBe(false)
  } finally { await disposeProxy(); await fixture.close(); await stack.close() }
})

test('lost decision acknowledgement keeps Retry on the same frozen approval', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const fixture = await startMcpFixture()
  const stack = await startMcpRouterStack()
  const disposeProxy = await proxyMcpApi(page, stack)
  let loseAcknowledgement = true
  const attempts: Array<{ body: unknown; key: string | undefined }> = []
  try {
    await page.goto('/scheduled')
    const task = await createRoutine(page, `Routine MCP retry ${Date.now().toString(36)}`)
    await connectFixture(page, fixture, 'Routine retry fixture')
    await page.route(`**${API}/schedules/${task.id}/mcp-permission`, async route => {
      if (route.request().method() !== 'POST') return route.fallback()
      attempts.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] })
      if (!loseAcknowledgement) return route.fallback()
      loseAcknowledgement = false
      const requestUrl = new URL(route.request().url())
      const { origin: _origin, ...headers } = route.request().headers()
      const response = await route.fetch({ url: `${stack.url}${requestUrl.pathname}${requestUrl.search}`, headers })
      expect(response.ok()).toBe(true)
      await response.body()
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'acknowledgement lost' }) })
    })
    await page.goto(`/scheduled/${task.id}/external-mcp`)
    const panel = page.getByRole('region', { name: 'External MCP' })
    const choice = panel.getByRole('checkbox', { name: /Routine retry fixture/ })
    await expect(choice).toBeVisible({ timeout: ms(20_000) })
    await choice.check()
    await panel.getByRole('button', { name: 'Review approval', exact: true }).click()
    const step = panel.locator('[aria-label="Approval review"]')
    await step.getByRole('button', { name: 'Approve these tools', exact: true }).click()
    const notice = page.locator('[data-revisioned-mutation="routine-mcp"]')
    await expect(notice).toBeVisible({ timeout: ms(20_000) })
    await expect(notice.getByRole('button', { name: 'Retry same decision', exact: true })).toBeVisible()
    expect(attempts).toHaveLength(1)

    await page.locator('[data-routine-row]').getByRole('button', { name: task.name, exact: true }).click()
    await page.getByRole('button', { name: 'External MCP', exact: true }).last().click()
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('Held decision: approve inspect_records')
    await notice.getByRole('button', { name: 'Retry same decision', exact: true }).click()
    await expect(panel.getByText('Approval active', { exact: true })).toBeVisible({ timeout: ms(20_000) })
    expect(attempts).toHaveLength(2)
    expect(attempts[0]?.key).toBeTruthy()
    expect(attempts[1]).toEqual(attempts[0])
    expect((await review(page, task.id)).active).toBe(true)
  } finally { await disposeProxy(); await fixture.close(); await stack.close() }
})

test('granted readers and foreign users cannot read or open the owner-only MCP band', async ({ browser }) => {
  test.setTimeout(ms(60_000))
  const owner = await browser.newPage()
  const graceContext = await browser.newContext({ extraHTTPHeaders: { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' } })
    const grace = await graceContext.newPage()
  const foreignContext = await browser.newContext({ extraHTTPHeaders: { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' } })
  const foreign = await foreignContext.newPage()
  const stack = await startMcpRouterStack()
  const disposers = await Promise.all([proxyMcpApi(owner, stack), proxyMcpApi(grace, stack), proxyMcpApi(foreign, stack)])
  try {
    await owner.goto('/scheduled')
    await foreign.goto('/scheduled')
    const task = await createRoutine(owner, `Private MCP review ${Date.now().toString(36)}`)
    const shared = await api(owner, 'POST', `${API}/grants`, { subject: { kind: 'schedule', id: task.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' })
    expect(shared.ok).toBe(true)
    await grace.goto(`/scheduled/${task.id}`)
    await expect(grace.getByRole('heading', { name: task.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(grace.getByRole('button', { name: 'External MCP', exact: true })).toHaveCount(0)
    expect((await api(grace, 'GET', `${API}/schedules/${task.id}/mcp-permission`)).status).toBe(404)
    expect((await api(foreign, 'GET', `${API}/schedules/${task.id}/mcp-permission`)).status).toBe(404)
    await foreign.goto(`/scheduled/${task.id}/external-mcp`)
    await expect(foreign.getByText('No unattended MCP tools', { exact: true })).toHaveCount(0)
  } finally {
    await Promise.all(disposers.map(dispose => dispose()))
    await owner.close(); await graceContext.close(); await foreignContext.close(); await stack.close()
  }
})

test('unavailable owner review hides cached policy while transient read errors remain retryable', async ({ page }) => {
  test.setTimeout(ms(75_000))
  const fixture = await startMcpFixture({ label: 'Routine recovery fixture' })
  const stack = await startMcpRouterStack()
  const disposeProxy = await proxyMcpApi(page, stack)
  try {
    // The desktop-shaped router's development headers never change user-local.
    // A real sign-in supplies Ada's actual workspace membership for decisions.
    await page.goto('/scheduled')
    const signedIn = await api(page, 'POST', `${API}/auth/login`, { email: 'ada@acme.example', password: 'ada-demo-password' })
    expect(signedIn.status).toBe(200)
    await page.reload()
    const identity = await api(page, 'GET', `${API}/me`)
    expect(identity.status).toBe(200)
    expect(identity.json).toMatchObject({ via: 'session', user: { id: 'user-ada' }, tenant: { id: 'tenant-acme' } })
    await page.goto('/scheduled/s-standup/external-mcp')
    const seededPanel = page.getByRole('region', { name: 'External MCP' })
    await expect(seededPanel.getByText('MCP settings are unavailable for this Routine in the current account.', { exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(seededPanel.getByRole('button', { name: 'Retry read', exact: true })).toHaveCount(0)
    await expect(seededPanel.getByRole('button', { name: 'Refresh review', exact: true })).toHaveCount(0)

    await page.goto('/scheduled')
    const task = await createRoutine(page, `Routine review recovery ${Date.now().toString(36)}`)
    await connectFixture(page, fixture, 'Routine recovery fixture')
    await page.goto(`/scheduled/${task.id}/external-mcp`)
    const panel = page.getByRole('region', { name: 'External MCP' })
    const choice = panel.getByRole('checkbox', { name: /Routine recovery fixture/ })
    await expect(choice).toBeVisible({ timeout: ms(20_000) })
    await choice.check()
    await panel.getByRole('button', { name: 'Review approval', exact: true }).click()
    const step = panel.locator('[aria-label="Approval review"]')
    await step.getByRole('button', { name: 'Approve these tools', exact: true }).click()
    await expect(panel.getByText('Approval active', { exact: true })).toBeVisible({ timeout: ms(20_000) })

    let failure: 404 | 500 = 404
    await page.route(`**${API}/schedules/${task.id}/mcp-permission`, async route => {
      if (route.request().method() !== 'GET') return route.fallback()
      await route.fulfill({ status: failure, contentType: 'application/json', body: JSON.stringify({ error: { code: failure === 404 ? 'not_found' : 'internal', message: 'read fixture failure' } }) })
    })
    await panel.getByRole('button', { name: 'Refresh review', exact: true }).click()
    await expect(panel.getByText('MCP settings are unavailable for this Routine in the current account.', { exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(panel.getByText('Approval active', { exact: true })).toHaveCount(0)
    await expect(panel.getByText('Routine recovery fixture · inspect_records', { exact: true })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Retry read', exact: true })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Refresh review', exact: true })).toHaveCount(0)

    failure = 500
    await page.locator('[data-routine-row]').getByRole('button', { name: task.name, exact: true }).click()
    await page.getByRole('button', { name: 'External MCP', exact: true }).last().click()
    await expect(panel.getByRole('button', { name: 'Retry read', exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(panel.getByText('MCP settings are unavailable for this Routine in the current account.', { exact: true })).toHaveCount(0)

    failure = 404 // Recovery now reaches the real owner endpoint.
    await page.unroute(`**${API}/schedules/${task.id}/mcp-permission`)
    await panel.getByRole('button', { name: 'Retry read', exact: true }).click()
    await expect(panel.getByText('Approval active', { exact: true })).toBeVisible({ timeout: ms(20_000) })
  } finally { await disposeProxy(); await fixture.close(); await stack.close() }
})

test('uncertain tool execution leaves a private receipt and pauses the routine', async ({ page }, testInfo) => {
  test.setTimeout(ms(75_000))
  const fixture = await startMcpFixture({ toolBehavior: 'uncertain' })
  const messages = await startRoutineMessagesPeer()
  const stack = await startMcpRouterStack()
  const disposeProxy = await proxyMcpApi(page, stack)
  let runnerFatal: Error | undefined
  const runner = createRoutineRunner(undefined, undefined, { onFatal: () => { runnerFatal = new Error('Routine runner entered a fatal state.') } })
  try {
    await page.goto('/scheduled')
    const task = await createBoundRoutine(page, `Routine MCP uncertainty ${Date.now().toString(36)}`, messages.url)
    const connectionId = await connectFixture(page, fixture)
    await approve(page, task.id, await review(page, task.id), connectionId)
    configureScheduleExecutor((taskId, runId) => runner.enqueue(taskId, runId))
    runner.start()
    await page.goto(`/scheduled/${task.id}`)
    await page.getByRole('button', { name: 'Run now', exact: true }).click()
    await expect.poll(async () => (await review(page, task.id)).runs.some(run => run.calls.some(call => call.status === 'uncertain')), { timeout: ms(45_000) }).toBe(true)

    await page.goto(`/scheduled/${task.id}/external-mcp`)
    const panel = page.getByRole('region', { name: 'External MCP' })
    await expect(panel.getByRole('heading', { name: 'Private run receipts', exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(panel.getByText(/Outcome uncertain/)).toBeVisible()
    await expect(panel.getByText(/provider outcome could not be confirmed/i)).toBeVisible()
    await captureViews(page, testInfo, 'uncertain', async () => await expect(panel.getByText(/Outcome uncertain/)).toBeVisible(), panel.getByText(/provider outcome could not be confirmed/i))
    const after = await review(page, task.id)
    expect(after.runs.flatMap(run => run.calls).some(call => call.status === 'uncertain')).toBe(true)
    expect(after.active).toBe(false)
    const schedules = (await api(page, 'GET', `${API}/schedules`)).json as ScheduledTask[]
    expect(schedules.find(row => row.id === task.id)?.enabled).toBe(false)
    expect(messages.offered).toHaveLength(1)
    expect(fixture.toolCalls).toEqual([{ name: 'inspect_records', arguments: { query: 'routine-mcp-e2e' } }])
    expect(runnerFatal).toBeUndefined()
  } finally { runner.stop(); configureScheduleExecutor(undefined); await disposeProxy(); await fixture.close(); await messages.close(); await stack.close() }
})

test('Routine runner executes the offered MCP tool and returns to the Messages peer for final prose', async ({ page }) => {
  test.setTimeout(ms(75_000))
  const fixture = await startMcpFixture({ label: 'Successful Routine MCP fixture' })
  const messages = await startRoutineMessagesPeer()
  const stack = await startMcpRouterStack()
  const disposeProxy = await proxyMcpApi(page, stack)
  let runnerFatal: Error | undefined
  const runner = createRoutineRunner(undefined, undefined, { onFatal: () => { runnerFatal = new Error('Routine runner entered a fatal state.') } })
  try {
    await page.goto('/scheduled')
    const task = await createBoundRoutine(page, `Routine MCP success ${Date.now().toString(36)}`, messages.url)
    const connectionId = await connectFixture(page, fixture)
    await approve(page, task.id, await review(page, task.id), connectionId)
    configureScheduleExecutor((taskId, runId) => runner.enqueue(taskId, runId))
    runner.start()
    await page.goto(`/scheduled/${task.id}`)
    await page.getByRole('button', { name: 'Run now', exact: true }).click()
    await expect.poll(async () => {
      const schedules = (await api(page, 'GET', `${API}/schedules`)).json as ScheduledTask[]
      return schedules.find(row => row.id === task.id)?.runs.at(-1)?.status
    }, { timeout: ms(45_000) }).toBe('ok')
    expect(messages.calls).toBeGreaterThanOrEqual(2)
    expect(messages.offered).toHaveLength(1)
    expect(fixture.toolCalls).toEqual([{ name: 'inspect_records', arguments: { query: 'routine-mcp-e2e' } }])
    const current = await review(page, task.id)
    expect(current.runs.flatMap(run => run.calls).some(call => call.status === 'done')).toBe(true)
    expect(runnerFatal).toBeUndefined()
  } finally { runner.stop(); configureScheduleExecutor(undefined); await disposeProxy(); await fixture.close(); await messages.close(); await stack.close() }
})
