/** Owner-reviewed unattended MCP for a Project Contributor. The test owns the
 * Project, model endpoint, and loopback HTTP MCP peer; approval and review still
 * travel through the real browser API and route. */
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Locator, type Page, type Route, type TestInfo } from '@playwright/test'
import type { Agent, Commission, CreateProjectResponse, ModelProvider, OpenSubGoal, Project, SystemPromptEntry } from '../contract/index.ts'
import type { CommissionMcpReview } from '../contract/commissionMcpApi.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import { mcpStdioConnectionCreationId } from '../server/mcpConnections.ts'
import { MCP_MODERN_VERSION } from '../server/mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../server/mcpToolAdmission.ts'
import { synchronizeMcpCredentials } from '../server/mcpRuntime.ts'
import type { McpStdioConnection } from '../server/mcpStdioClient.ts'
import { SESSION_COOKIE, signSession } from '../server/auth.ts'
import { createCommissionMcpRunner } from '../server/commissionMcpRunner.ts'
import { store } from '../server/store/index.ts'
import { startMcpFixture, startMcpRouterStack, proxyMcpApi } from './mcp-fixture.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const API = '/api/v1'
const TOOL = 'write_record'
const MODEL_ID = 'commission-mcp-e2e-model'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]

interface ModelPeer {
  baseURL: string
  requests: Array<Record<string, unknown>>
  close(): Promise<void>
}
interface Fixture {
  project: Project
  tenantId: string
  item: OpenSubGoal
  agent: Agent
  commission: Commission
  provider: ModelProvider
  connection: McpConnectionView
  model: ModelPeer
  fixedValue: string
}

const LOCAL_TOOL = { name: TOOL, description: 'Write one locally reviewed fixture record.', inputSchema: {
  type: 'object' as const,
  properties: { query: { type: 'string', maxLength: 256 },
    ...Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`detail_${String(index + 1).padStart(3, '0')}`, {
      type: 'string', description: `Optional schema detail ${index + 1} keeps the review region scrollable.`,
    }])) },
  required: ['query'], additionalProperties: false,
} }
const activeModelPeers = new Set<ModelPeer>()
test.afterEach(async () => Promise.all([...activeModelPeers].map(peer => peer.close())))

async function signInSeed(page: Page, email: string, password: string, userId: string) {
  await page.goto('/contexts')
  const login = await page.evaluate(async ({ email, password }) => {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    })
    return { status: response.status, body: await response.json() as { user?: { id?: string } } }
  }, { email, password })
  expect(login.status).toBe(200)
  expect(login.body.user?.id).toBe(userId)
  await page.reload()
  await expect.poll(async () => await page.evaluate(async () => {
    const response = await fetch('/api/v1/me')
    return (await response.json() as { user?: { id?: string } }).user?.id
  })).toBe(userId)
}

async function setSignedTenant(page: Page, userId: string, tenantId: string) {
  const appUrl = new URL(page.url())
  await page.context().addCookies([{
    name: SESSION_COOKIE, value: signSession({ userId, tenantId, iat: Date.now() }),
    url: `${appUrl.protocol}//${appUrl.host}`, httpOnly: true, sameSite: 'Lax',
  }])
  await page.reload()
  const identity = await page.evaluate(async () => await (await fetch('/api/v1/me')).json() as {
    via?: string; tenant?: { id: string }; user?: { id: string }
  })
  expect(identity.via).toBe('session')
  expect(identity.user?.id).toBe(userId)
  expect(identity.tenant?.id).toBe(tenantId)
}

async function startModelPeer(fixedValue: string) {
  const requests: Array<Record<string, unknown>> = []
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {}
    const path = (request.url ?? '').split('?')[0]
    if (request.method === 'GET' && path === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: MODEL_ID, display_name: 'Local Commission fixture model' }] }))
      return
    }
    if (request.method !== 'POST' || path !== '/v1/messages') { response.writeHead(404).end(); return }
    requests.push(body)
    const probe = Array.isArray(body.tools) && body.tools.some((tool: any) => tool?.name === 'probe_noop')
    const text = probe ? 'ok' : JSON.stringify({ toolName: TOOL, arguments: { query: fixedValue } })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: `msg_commission_mcp_${requests.length}`, type: 'message', role: 'assistant', model: MODEL_ID,
      content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 17, output_tokens: 9 } }))
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Commission MCP model fixture did not bind')
  const peer: ModelPeer = {
    baseURL: `http://127.0.0.1:${address.port}`, requests,
    close: async () => {
      if (!activeModelPeers.has(peer)) return
      activeModelPeers.delete(peer)
      server.closeAllConnections?.()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
  activeModelPeers.add(peer)
  return peer
}

async function api(page: Page, method: string, path: string, data?: unknown) {
  return page.evaluate(async ({ method, path, data, apiRoot }) => {
    const response = await fetch(`${apiRoot}${path}`, {
      method,
      headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
    return { status: response.status, ok: response.ok, json: await response.json().catch(() => ({})) as any }
  }, { method, path, data, apiRoot: API })
}

async function createFixture(page: Page, stamp: string, endpoint: string | undefined, tenantId: string,
  providedConnection?: Fixture['connection']): Promise<Fixture> {
  const projectResponse = await api(page, 'POST', '/projects', { name: `Commission MCP ${stamp}`, description: `Owner-reviewed Project ${stamp}.` })
  expect(projectResponse.status, JSON.stringify(projectResponse.json)).toBe(201)
  const project = (projectResponse.json as CreateProjectResponse).project
  const scoped = await api(page, 'POST', '/relations/ops', { op: {
    kind: 'scope-context', projectId: project.id, projectName: project.name,
    context: { kind: 'connector', label: TOOL, meta: `Only this reviewed fixture tool is reachable: ${stamp}.` },
  } })
  expect(scoped.ok, JSON.stringify(scoped.json)).toBe(true)
  const itemResponse = await api(page, 'POST', `/projects/${encodeURIComponent(project.id)}/open-subgoals`, {
    subGoal: `Write the approved record ${stamp}`, type: 'mcp.mutate', target: TOOL, note: 'Authored fixture work for the isolated Commission MCP runner.',
  })
  expect(itemResponse.ok, JSON.stringify(itemResponse.json)).toBe(true)
  const item = itemResponse.json as OpenSubGoal

  let connection: Fixture['connection']
  if (providedConnection) connection = providedConnection
  else {
    if (!endpoint) throw new Error('HTTP fixture requires its test-owned endpoint')
    const connectionResponse = await api(page, 'POST', '/mcp-connections', {
      creationId: randomUUID(), label: `Commission peer ${stamp}`, endpoint, authentication: 'none',
    })
    expect(connectionResponse.ok, JSON.stringify(connectionResponse.json)).toBe(true)
    const made = connectionResponse.json.connection as Fixture['connection']
    const inspected = await api(page, 'POST', `/mcp-connections/${encodeURIComponent(made.id)}/inspect`, {
      operationId: randomUUID(), expectedRevision: made.revision,
    })
    expect(inspected.ok, JSON.stringify(inspected.json)).toBe(true)
    connection = inspected.json.connection
  }

  const fixedValue = `fixed-${stamp}`
  const model = await startModelPeer(fixedValue)
  const providerResponse = await api(page, 'POST', '/providers', {
    label: `Commission local endpoint ${stamp}`, modelFamily: 'claude', effortLevels: ['Default'],
    models: [{ id: MODEL_ID, label: 'Local Commission fixture model' }],
    authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] },
    config: { baseURL: model.baseURL, model: MODEL_ID },
  })
  expect(providerResponse.ok, JSON.stringify(providerResponse.json)).toBe(true)
  const provider = providerResponse.json as ModelProvider
  const promptsResponse = await api(page, 'GET', '/system-prompts')
  expect(promptsResponse.ok).toBe(true)
  const prompt = (promptsResponse.json as SystemPromptEntry[])[0]
  expect(prompt).toBeDefined()
  const agentResponse = await api(page, 'POST', '/agents', {
    label: `Commission fixture Agent ${stamp}`, providerId: provider.id, systemPromptId: prompt!.id,
    tools: [], authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] }, instructions: `Use only the reviewed fixture work ${stamp}.`,
  })
  expect(agentResponse.ok, JSON.stringify(agentResponse.json)).toBe(true)
  const agent = agentResponse.json as Agent
  const commissionResponse = await api(page, 'POST', '/commissions', {
    agentId: agent.id, projectId: project.id, role: 'writer', standing: false,
  })
  expect(commissionResponse.ok, JSON.stringify(commissionResponse.json)).toBe(true)
  const commission = commissionResponse.json as Commission
  expect(model.requests, 'only local provider admission runs before approval').toHaveLength(1)
  return { project, tenantId, item, agent, commission, provider, connection, model, fixedValue }
}

function localPeer(methods: string[], calls: Array<{ name: string; arguments: unknown }>, resultText = 'Private local fixture result'): McpStdioConnection {
  return {
    request: async (method, parameters) => {
      methods.push(method)
      if (method === 'server/discover') return { jsonrpc: '2.0', id: method, result: {
        resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'commission-local-fixture', version: '1' } },
      } }
      if (method === 'tools/list') return { jsonrpc: '2.0', id: method, result: { resultType: 'complete', tools: [LOCAL_TOOL] } }
      if (method === 'tools/call') {
        calls.push({ name: String((parameters as any)?.name ?? ''), arguments: structuredClone((parameters as any)?.arguments ?? {}) })
        return { jsonrpc: '2.0', id: method, result: { resultType: 'complete', isError: false,
          content: [{ type: 'text', text: `${resultText}. ${'Local receipt detail '.repeat(80)}` }],
          structuredContent: { accepted: true, query: (parameters as any)?.arguments?.query ?? null },
        } }
      }
      return { jsonrpc: '2.0', id: method, result: { resultType: 'complete' } }
    },
    initialized: async () => undefined,
    close: async () => ({ code: 'released' }),
    closed: Promise.resolve({ code: 'released' }),
  }
}

function seedLocalConnection(tenantId: string, ownerUserId: string, label: string) {
  const suffix = randomUUID().replaceAll('-', '').toUpperCase()
  const id = mcpStdioConnectionCreationId(tenantId, suffix, ownerUserId)
  store.createMcpConnection({ transport: 'stdio', id, label }, tenantId, false, ownerUserId)
  store.commitMcpInspection(id, tenantId, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [LOCAL_TOOL],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(LOCAL_TOOL)] },
  }, Date.now(), undefined, undefined, ownerUserId, `MCP_STDIO_${suffix}`)
  const connection = store.mcpConnection(id, tenantId, ownerUserId)
  expect(connection).toBeDefined()
  expect(connection?.transport).toBe('stdio')
  expect(connection?.revision).toBe(1)
  return connection!
}

async function openPanel(page: Page, fixture: Fixture) {
  await page.goto(`/projects/${encodeURIComponent(fixture.project.id)}`)
  const row = page.locator(`[data-contributor-row="${fixture.commission.id}"]`)
  await expect(row).toBeVisible({ timeout: ms(20_000) })
  await settleArtifactPageRail(page)
  await row.getByRole('button', { name: 'Unattended MCP…', exact: true }).click()
  const panel = page.locator(`[data-commission-mcp="${fixture.commission.id}"]`)
  await expect(panel.getByRole('heading', { name: `Unattended MCP · ${fixture.agent.label}`, exact: true })).toBeVisible({ timeout: ms(20_000) })
  await expect(panel.getByLabel('Unattended endpoint', { exact: true })).toBeVisible({ timeout: ms(20_000) })
  return panel
}

async function assertContainment(page: Page, testInfo: TestInfo, panel: Locator, required: Locator, stem: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(required).toBeVisible()
    await required.scrollIntoViewIfNeeded()
    await expect(required).toBeInViewport()
    const geometry = await panel.evaluate(element => {
      const surface = element.getBoundingClientRect()
      const controls = [...element.querySelectorAll<HTMLElement>('button, input, select, textarea')]
        .filter(control => control.getClientRects().length > 0)
        .map(control => { const rect = control.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width } })
      const row = element.closest('[data-contributor-row]')!.getBoundingClientRect()
      return { left: surface.left, right: surface.right, width: element.clientWidth, rowWidth: row.width, scrollWidth: element.scrollWidth, controls }
    })
    expect(geometry.width, `${stem} panel width at ${viewport.width}`).toBeGreaterThan(0)
    expect(geometry.width, `${stem} review uses the full row width below its actions`).toBeGreaterThanOrEqual(geometry.rowWidth - 3)
    expect(geometry.scrollWidth, `${stem} panel has no horizontal overflow at ${viewport.width}`).toBeLessThanOrEqual(geometry.width)
    for (const control of geometry.controls) {
      expect(control.width, `${stem} visible control at ${viewport.width}`).toBeGreaterThan(0)
      expect(control.left, `${stem} control left edge at ${viewport.width}`).toBeGreaterThanOrEqual(geometry.left - 1)
      expect(control.right, `${stem} control right edge at ${viewport.width}`).toBeLessThanOrEqual(geometry.right + 1)
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${stem}-${viewport.width}x${viewport.height}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  await settleArtifactPageRail(page)
}

async function createReview(page: Page, fixture: Fixture, testInfo?: TestInfo, existingPanel?: Locator) {
  const panel = existingPanel ?? await openPanel(page, fixture)
  await panel.getByLabel('Unattended endpoint', { exact: true }).selectOption(fixture.provider.id)
  await panel.getByLabel('Unattended model', { exact: true }).selectOption(MODEL_ID)
  const toolCard = panel.locator('article').filter({ hasText: fixture.connection.label })
  await expect(toolCard.getByText(TOOL, { exact: true })).toBeVisible({ timeout: ms(20_000) })
  const checkbox = toolCard.getByRole('checkbox')
  await checkbox.check()
  await expect(checkbox).toBeChecked()
  await expect(toolCard).toContainText(fixture.connection.transport === 'stdio' ? 'Local program' : 'HTTP service')
  const fixed = { query: fixture.fixedValue }
  await toolCard.getByLabel(`Fixed values for ${TOOL}`, { exact: true }).fill(JSON.stringify(fixed))
  await toolCard.locator('summary').getByText('Input schema', { exact: true }).click()
  const schema = toolCard.getByRole('region', { name: `Input schema for ${TOOL}`, exact: true })
  await expect.poll(() => schema.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  await schema.focus()
  await schema.press('End')
  await expect.poll(() => schema.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  if (testInfo) await assertContainment(page, testInfo, panel, schema, 'commission-mcp-schema')
  await panel.getByLabel('Maximum work items', { exact: true }).fill('2')
  await panel.getByRole('button', { name: 'Review approval', exact: true }).click()
  const review = panel.locator('[data-commission-mcp-review]')
  await expect(review.getByRole('heading', { name: 'Review before approval', exact: true })).toBeVisible()
  await expect(review).toContainText(fixture.provider.label)
  await expect(review).toContainText('Local Commission fixture model')
  await expect(review).toContainText(fixture.connection.label)
  await expect(review).toContainText(TOOL)
  await expect(review).toContainText(JSON.stringify(fixed, null, 2))
  await expect(review).toContainText('Destination, audience and limits')
  return { panel, toolCard, review, fixed }
}

async function captureLocalSurface(page: Page, testInfo: TestInfo, panel: Locator, subject: Locator, stem: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(subject).toBeVisible()
    await subject.scrollIntoViewIfNeeded()
    await expect(subject).toBeInViewport()
    const geometry = await panel.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }))
    expect(geometry.width, `${stem} has a rendered panel at ${viewport.width}px`).toBeGreaterThan(0)
    expect(geometry.scrollWidth, `${stem} has no panel horizontal scrolling at ${viewport.width}px`).toBeLessThanOrEqual(geometry.width)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await assertWcag22Aa(page, `${stem} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`${stem}-${viewport.width}x${viewport.height}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  await settleArtifactPageRail(page)
}

test('owner approves one explicit HTTP tool, then reads a private inert receipt', async ({ page, browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const stack = await startMcpRouterStack()
  const mcp = await startMcpFixture({ toolName: TOOL, label: 'Local Commission peer', schemaPadding: 40,
    toolResult: (_params, callIndex) => ({ resultType: 'complete', isError: false, content: [
      { type: 'text', text: `Private fixture result ${callIndex}. ${'Receipt detail '.repeat(80)}` },
    ], structuredContent: { status: 'written', callIndex } }) })
  const pageDisposer = await proxyMcpApi(page, stack)
  let sameWorkspaceContext: Awaited<ReturnType<Browser['newContext']>> | undefined
  let visitorContext: Awaited<ReturnType<Browser['newContext']>> | undefined
  let foreignContext: Awaited<ReturnType<Browser['newContext']>> | undefined
  let commissionRunner: ReturnType<typeof createCommissionMcpRunner> | undefined
  try {
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const stamp = randomUUID().slice(0, 8)
    const orgResponse = await api(page, 'POST', '/orgs', { name: `Commission approval scope ${stamp}` })
    expect(orgResponse.status, JSON.stringify(orgResponse.json)).toBe(201)
    const tenantId = (orgResponse.json as { id: string }).id
    await setSignedTenant(page, 'user-ada', tenantId)
    const invite = await api(page, 'POST', `/orgs/${encodeURIComponent(tenantId)}/invites`, { email: 'grace@acme.example' })
    expect(invite.status, JSON.stringify(invite.json)).toBe(201)
    const owner = page
    const fixture = await createFixture(owner, stamp, mcp.url, tenantId)
    const { panel, review } = await createReview(owner, fixture, testInfo)
    await expect(review.getByRole('checkbox', { name: /I understand and explicitly approve unattended local-program launch/ }),
      'HTTP-only consent has no local launch acknowledgement').toHaveCount(0)
    await assertContainment(owner, testInfo, panel, review.getByRole('button', { name: 'Approve unattended work', exact: true }), 'commission-mcp-review')
    expect(mcp.toolCalls, 'selecting and reviewing never invokes the external tool').toHaveLength(0)
    expect(fixture.model.requests, 'selecting a model for review does not prepare work').toHaveLength(1)

    await review.getByRole('button', { name: 'Approve unattended work', exact: true }).click()
    await expect(panel.locator('[data-commission-mcp-status]')).toHaveText('Approval active', { timeout: ms(20_000) })
    expect(mcp.toolCalls, 'approval records permission but does not run the model or external tool').toHaveLength(0)
    expect(fixture.model.requests).toHaveLength(1)

    const reviewResponse = await api(owner, 'GET', `/commissions/${fixture.commission.id}/mcp-permission?providerId=${encodeURIComponent(fixture.provider.id)}&modelId=${encodeURIComponent(MODEL_ID)}`)
    expect(reviewResponse.ok, JSON.stringify(reviewResponse.json)).toBe(true)
    expect((reviewResponse.json as CommissionMcpReview).policy.approval?.localPrograms).toBeUndefined()
    expect((reviewResponse.json as CommissionMcpReview).policy.approval?.tools).toMatchObject([{
      connectionId: fixture.connection.id, toolName: TOOL, fixedArguments: { query: fixture.fixedValue },
    }])

    // Exercise the real bounded runner against only this fixture Commission.
    // The fixture router owns every HTTP MCP and model call.
    const fixtureCandidates = store.commissionMcpWorkCandidates().filter(candidate => candidate.commissionId === fixture.commission.id)
    expect(fixtureCandidates).toHaveLength(1)
    expect(fixtureCandidates[0]).toMatchObject({
      commissionId: fixture.commission.id, tenantId: fixture.tenantId, userId: 'user-ada',
      projectId: fixture.project.id, agentId: fixture.agent.id, itemId: fixture.item.id,
    })
    const runnerErrors: unknown[] = []
    const candidates = () => store.commissionMcpWorkCandidates().filter(candidate => candidate.commissionId === fixture.commission.id)
    commissionRunner = createCommissionMcpRunner({
      candidates,
      run: (candidate, signal) => store.runCommissionMcpWork(
        candidate.commissionId, candidate.tenantId, candidate.userId, candidate.itemId, signal,
      ),
    }, { onError: error => runnerErrors.push(error) })
    const beforeRunner = fixture.model.requests.length
    commissionRunner.start()
    await expect.poll(() => store.listOpenSubGoals(fixture.project.id, fixture.tenantId)
      .find(item => item.id === fixture.item.id), { timeout: ms(20_000) }).toMatchObject({
      status: 'done', resolvedBy: fixture.commission.id, commissionResolution: 'mcp',
    })
    expect(runnerErrors).toEqual([])
    expect(candidates(), 'a completed claim is not replayed').toHaveLength(0)
    commissionRunner.tick()
    expect(mcp.toolCalls, 'the runner made exactly one local MCP call').toHaveLength(1)
    const run = store.listOpenSubGoals(fixture.project.id, fixture.tenantId).find(item => item.id === fixture.item.id)
    expect(run?.status).toBe('done')
    expect(run?.commissionResolution).toBe('mcp')
    expect(fixture.model.requests).toHaveLength(beforeRunner + 1)
    expect(mcp.toolCalls).toMatchObject([{ name: TOOL, arguments: { query: fixture.fixedValue } }])

    await panel.getByRole('button', { name: 'Refresh review', exact: true }).click()
    const receipt = panel.locator('[data-commission-mcp-receipt]')
    await expect(receipt).toHaveCount(1, { timeout: ms(20_000) })
    await expect(receipt).toContainText(fixture.item.subGoal)
    await expect(receipt).toContainText('Call succeeded')
    await receipt.locator('summary').click()
    const argsRegion = receipt.getByRole('region', { name: `Arguments for ${fixture.item.subGoal}`, exact: true })
    const resultRegion = receipt.getByRole('region', { name: `Result for ${fixture.item.subGoal}`, exact: true })
    await expect(argsRegion).toContainText(fixture.fixedValue)
    await expect(resultRegion).toContainText('Private fixture result')
    await expect.poll(() => resultRegion.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await resultRegion.focus()
    await resultRegion.press('End')
    await expect.poll(() => resultRegion.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(receipt.getByRole('button'), 'a private receipt exposes no retry or execution action').toHaveCount(0)
    await assertContainment(owner, testInfo, panel, resultRegion, 'commission-mcp-receipt')

    // A private access denial clears any rendered/cached approval and receipt.
    await owner.route(`**${API}/commissions/${fixture.commission.id}/mcp-permission`, async route => {
      if (route.request().method() !== 'GET') return route.fallback()
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'forbidden', message: 'private fixture wall' } }) })
    })
    await panel.getByRole('button', { name: 'Refresh review', exact: true }).click()
    await expect(panel.getByText('Private MCP approval is unavailable for this Contributor in the current account.', { exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(panel.getByText('Approval active', { exact: true })).toHaveCount(0)
    await expect(panel.locator('[data-commission-mcp-receipt]')).toHaveCount(0)

    // A different person in the owning workspace gets an empty private review.
    // Cross-tenant and foreign readers can see the public Project/track record,
    // but get the existence-hiding 404 for private MCP approval history.
    sameWorkspaceContext = await browser.newContext({ baseURL: new URL(owner.url()).origin })
    const sameWorkspace = await sameWorkspaceContext.newPage()
    const sameWorkspaceDisposer = await proxyMcpApi(sameWorkspace, stack)
    await signInSeed(sameWorkspace, 'grace@acme.example', 'grace-demo-password', 'user-grace')
    const acceptedInvite = await api(sameWorkspace, 'POST', `/me/invites/${encodeURIComponent(invite.json.id)}/accept`)
    expect(acceptedInvite.status, JSON.stringify(acceptedInvite.json)).toBe(200)
    await setSignedTenant(sameWorkspace, 'user-grace', tenantId)
    await sameWorkspace.goto(`/projects/${fixture.project.id}`)
    await expect(sameWorkspace.getByRole('heading', { name: fixture.project.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
    const sameWorkspaceRow = sameWorkspace.locator(`[data-contributor-row="${fixture.commission.id}"]`)
    await sameWorkspaceRow.getByRole('button', { name: 'Unattended MCP…', exact: true }).click()
    const sameWorkspacePanel = sameWorkspace.locator(`[data-commission-mcp="${fixture.commission.id}"]`)
    await expect(sameWorkspacePanel.locator('[data-commission-mcp-status]')).toHaveText('No unattended approval', { timeout: ms(20_000) })
    await expect(sameWorkspacePanel).toContainText('No work has been claimed under your approval.')
    const sameWorkspaceRead = await api(sameWorkspace, 'GET', `/commissions/${fixture.commission.id}/mcp-permission`)
    expect(sameWorkspaceRead.status).toBe(200)
    expect(sameWorkspaceRead.json.policy.approval).toBeNull()
    expect(sameWorkspaceRead.json.claims).toEqual([])
    await sameWorkspaceDisposer()

    // Publishing only this authored Project exposes its redacted public
    // Contributor track record. The private MCP approval and receipts remain
    // owner-only and are checked through the 404 wall below.
    const publish = await api(owner, 'POST', '/relations/ops', { op: {
      kind: 'share-project', projectId: fixture.project.id, projectName: fixture.project.name, shared: true,
    } })
    expect(publish.ok, JSON.stringify(publish.json)).toBe(true)
    visitorContext = await browser.newContext({ baseURL: new URL(owner.url()).origin })
    const peerContext = visitorContext
    const peer = await peerContext.newPage()
    const peerDisposer = await proxyMcpApi(peer, stack)
    await signInSeed(peer, 'grace@acme.example', 'grace-demo-password', 'user-grace')
    await setSignedTenant(peer, 'user-grace', 'tenant-beta')
    await peer.goto(`/projects/${fixture.project.id}`)
    await expect(peer.getByRole('heading', { name: fixture.project.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(peer.getByRole('button', { name: 'Unattended MCP…', exact: true })).toHaveCount(0)
    const peerRow = peer.locator(`[data-contributor-row="${fixture.commission.id}"]`)
    await expect(peerRow).toContainText('Real MCP: 1', { timeout: ms(20_000) })
    await expect(peerRow).toContainText('Simulated: 0 here')
    await expect(peer.locator('[data-commission-mcp-receipt]')).toHaveCount(0)
    const peerRead = await api(peer, 'GET', `/commissions/${fixture.commission.id}/mcp-permission`)
    expect(peerRead.status).toBe(404)
    await peerDisposer()

    foreignContext = await browser.newContext({ baseURL: new URL(owner.url()).origin })
    const foreign = await foreignContext.newPage()
    const foreignDisposer = await proxyMcpApi(foreign, stack)
    await signInSeed(foreign, 'maya@growthworks.example', 'maya-demo-password', 'user-maya')
    await setSignedTenant(foreign, 'user-maya', 'tenant-growthworks')
    await foreign.goto(`/projects/${fixture.project.id}`)
    await expect(foreign.getByRole('heading', { name: fixture.project.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
    const foreignRow = foreign.locator(`[data-contributor-row="${fixture.commission.id}"]`)
    await expect(foreignRow).toContainText('Real MCP: 1', { timeout: ms(20_000) })
    await expect(foreignRow.getByRole('button', { name: 'Unattended MCP…', exact: true })).toHaveCount(0)
    await expect(foreign.locator('[data-commission-mcp-receipt]')).toHaveCount(0)
    expect((await api(foreign, 'GET', `/commissions/${fixture.commission.id}/mcp-permission`)).status).toBe(404)
    await expect(foreign.locator(`[data-commission-mcp="${fixture.commission.id}"]`)).toHaveCount(0)
    await foreignDisposer()
  } finally {
    await commissionRunner?.stop()
    await pageDisposer()
    await sameWorkspaceContext?.close()
    await visitorContext?.close()
    await foreignContext?.close()
    await mcp.close()
    await stack.close()
  }
})

test('lost approval acknowledgement retries the same frozen decision after navigation', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  const stack = await startMcpRouterStack()
  const mcp = await startMcpFixture({ toolName: TOOL, schemaPadding: 8 })
  const disposeProxy = await proxyMcpApi(page, stack)
  let loseAcknowledgement = true
  const attempts: Array<{ body: unknown; key: string | undefined }> = []
  let approvalPattern: string | undefined
  let approvalRoute: ((route: Route) => Promise<void>) | undefined
  try {
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    await setSignedTenant(page, 'user-ada', 'tenant-acme')
    const fixture = await test.step('create the signed-in owner fixture', async () =>
      createFixture(page, randomUUID().slice(0, 8), mcp.url, 'tenant-acme'))
    approvalRoute = async route => {
      if (route.request().method() !== 'POST') return route.fallback()
      attempts.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] })
      if (!loseAcknowledgement) return route.fallback()
      loseAcknowledgement = false
      const requestUrl = new URL(route.request().url())
      const { origin: _origin, ...headers } = route.request().headers()
      const response = await route.fetch({ url: `${stack.url}${requestUrl.pathname}${requestUrl.search}`, headers })
      expect(response.ok()).toBe(true)
      await response.body()
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'fixture lost acknowledgement' } }) })
    }
    approvalPattern = `**${API}/commissions/${fixture.commission.id}/mcp-permission`
    await page.route(approvalPattern, approvalRoute)
    const { panel, review } = await test.step('review the frozen endpoint, model and arguments', async () => createReview(page, fixture))
    await assertContainment(page, testInfo, panel, review.getByRole('button', { name: 'Approve unattended work', exact: true }), 'commission-mcp-lost-ack-review')
    const notice = page.locator('[data-revisioned-mutation="commission-mcp"]')
    await test.step('retain the exact approval after its acknowledgement is lost', async () => {
      await review.getByRole('button', { name: 'Approve unattended work', exact: true }).click({ timeout: ms(10_000) })
      await expect(notice).toBeVisible({ timeout: ms(10_000) })
      await expect(notice).toContainText('Couldn’t confirm whether the MCP decision was saved.', { timeout: ms(10_000) })
      await expect(notice.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({ timeout: ms(10_000) })
      expect(attempts, 'the lost acknowledgement is one keyed decision').toHaveLength(1)
      await expect(panel.locator('[data-commission-mcp-review]')).toContainText(fixture.fixedValue, { timeout: ms(10_000) })
    })

    const reopened = page.locator(`[data-commission-mcp="${fixture.commission.id}"]`)
    await test.step('navigate away and reopen the same Project through the expanded rail', async () => {
      const collapsedRail = page.getByRole('button', { name: 'Expand sidebar', exact: true })
      if (await collapsedRail.count()) await collapsedRail.click({ timeout: ms(10_000) })
      const contexts = page.getByRole('navigation').getByRole('button', { name: 'Contexts', exact: true })
      await contexts.click({ timeout: ms(10_000) })
      await expect(page.getByRole('heading', { name: 'Contexts', exact: true })).toBeVisible({ timeout: ms(10_000) })
      await expect(notice).toBeVisible({ timeout: ms(10_000) })

      const collapsedAgain = page.getByRole('button', { name: 'Expand sidebar', exact: true })
      if (await collapsedAgain.count()) await collapsedAgain.click({ timeout: ms(10_000) })
      const projects = page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true })
      await projects.click({ timeout: ms(10_000) })
      await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: ms(10_000) })
      await page.getByText(fixture.project.name, { exact: true }).first().click({ timeout: ms(10_000) })
      await expect(page.getByRole('heading', { name: fixture.project.name, exact: true })).toBeVisible({ timeout: ms(10_000) })

      const row = page.locator(`[data-contributor-row="${fixture.commission.id}"]`)
      await expect(row).toBeVisible({ timeout: ms(10_000) })
      await row.getByRole('button', { name: 'Unattended MCP…', exact: true }).click({ timeout: ms(10_000) })
      await expect(reopened.locator('[data-commission-mcp-review]')).toContainText(fixture.fixedValue, { timeout: ms(10_000) })
      await expect(notice).toBeVisible({ timeout: ms(10_000) })
    })

    await test.step('retry the same keyed body and confirm server truth', async () => {
      await notice.getByRole('button', { name: 'Retry', exact: true }).click({ timeout: ms(10_000) })
      await expect(reopened.locator('[data-commission-mcp-status]')).toHaveText('Approval active', { timeout: ms(20_000) })
      expect(attempts).toHaveLength(2)
      expect(attempts[0]?.key).toBeTruthy()
      expect(attempts[1]).toEqual(attempts[0])
      expect((await api(page, 'GET', `/commissions/${fixture.commission.id}/mcp-permission?providerId=${fixture.provider.id}&modelId=${MODEL_ID}`)).json.policy.approval).toBeTruthy()
      expect(mcp.toolCalls).toHaveLength(0)
    })
    if (approvalRoute && approvalPattern) await page.unroute(approvalPattern, approvalRoute)
    approvalRoute = undefined
    approvalPattern = undefined
  } finally {
    try {
      if (!page.isClosed() && approvalRoute && approvalPattern) await page.unroute(approvalPattern, approvalRoute)
    } finally {
      await Promise.allSettled([disposeProxy(), mcp.close(), stack.close()])
    }
  }
})

test('owner separately consents to a local Commission program and keeps its private transport receipt after revoke', async ({ page, browser }, testInfo) => {
  test.setTimeout(ms(180_000))
  const methods: string[] = []
  const localCalls: Array<{ name: string; arguments: unknown }> = []
  const opens: Array<{ ownerUserId: string; purpose: string }> = []
  const stack = await startMcpRouterStack({ localProcessesAvailable: true,
    synchronizeStdioBindings: async () => ({ available: true }),
    openStdio: (_reference, binding, options) => {
      opens.push({ ownerUserId: binding.ownerUserId, purpose: options.purpose })
      return localPeer(methods, localCalls)
    },
  })
  const pageDisposer = await proxyMcpApi(page, stack)
  const contexts: Array<Awaited<ReturnType<Browser['newContext']>>> = []
  const disposers: Array<() => Promise<void>> = []
  let runner: ReturnType<typeof createCommissionMcpRunner> | undefined
  let model: ModelPeer | undefined
  let localId = ''
  let peerLocalId = ''
  let tenantId = ''
  let panel: Locator | undefined
  let approvalPattern: string | undefined
  let approvalRoute: ((route: Route) => Promise<void>) | undefined
  try {
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const stamp = randomUUID().slice(0, 8)
    const orgResponse = await api(page, 'POST', '/orgs', { name: `Commission local scope ${stamp}` })
    expect(orgResponse.status, JSON.stringify(orgResponse.json)).toBe(201)
    tenantId = (orgResponse.json as { id: string }).id
    await setSignedTenant(page, 'user-ada', tenantId)

    const invitation = await api(page, 'POST', `/orgs/${encodeURIComponent(tenantId)}/invites`, { email: 'grace@acme.example' })
    expect(invitation.status, JSON.stringify(invitation.json)).toBe(201)
    const peerContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
    contexts.push(peerContext)
    const peer = await peerContext.newPage()
    disposers.push(await proxyMcpApi(peer, stack))
    await signInSeed(peer, 'grace@acme.example', 'grace-demo-password', 'user-grace')
    expect((await api(peer, 'POST', `/me/invites/${encodeURIComponent(invitation.json.id)}/accept`)).status).toBe(200)
    await setSignedTenant(peer, 'user-grace', tenantId)

    const ownerConnection = seedLocalConnection(tenantId, 'user-ada', `Ada local Commission ${stamp}`)
    const peerConnection = seedLocalConnection(tenantId, 'user-grace', `Grace local Commission ${stamp}`)
    localId = ownerConnection.id
    peerLocalId = peerConnection.id
    expect(await synchronizeMcpCredentials(store.mcpCredentialBindings(), store.mcpStdioBindings())).toBe('complete')
    const fixture = await createFixture(page, stamp, undefined, tenantId, ownerConnection)
    model = fixture.model
    const created = await createReview(page, fixture)
    panel = created.panel
    await expect(created.review).toContainText(`${ownerConnection.label} · Local program`)
    const acknowledgement = created.review.getByRole('checkbox', { name: /I understand and explicitly approve unattended local-program launch/ })
    const approveButton = created.review.getByRole('button', { name: 'Approve unattended work', exact: true })
    await expect(acknowledgement).toHaveAttribute('aria-checked', 'false')
    await expect(approveButton).toBeDisabled()
    await expect(created.review).toContainText('normal OS access')
    await expect(created.review).toContainText('possible startup effects')
    await expect(created.review).toContainText('Connection setup and Routine approvals do not grant this permission.')
    expect(methods, 'rendering and reviewing a local catalog never launches it').not.toContain('tools/call')

    await created.review.getByRole('button', { name: 'Back to choices', exact: true }).click()
    const fresh = await createReview(page, fixture, undefined, panel)
    const freshAcknowledgement = fresh.review.getByRole('checkbox', { name: /I understand and explicitly approve unattended local-program launch/ })
    const freshApprove = fresh.review.getByRole('button', { name: 'Approve unattended work', exact: true })
    await expect(freshAcknowledgement).toHaveAttribute('aria-checked', 'false')
    await expect(freshApprove).toBeDisabled()

    await freshAcknowledgement.check()
    await expect(freshApprove).toBeEnabled()
    await captureLocalSurface(page, testInfo, fresh.panel, freshAcknowledgement, 'commission-local-consent')
    await captureLocalSurface(page, testInfo, fresh.panel, freshApprove, 'commission-local-review')
    const submitted: Array<{ body: any; key?: string }> = []
    approvalPattern = `**${API}/commissions/${fixture.commission.id}/mcp-permission`
    approvalRoute = async route => {
      if (route.request().method() === 'POST') submitted.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] })
      await route.fallback()
    }
    await page.route(approvalPattern, approvalRoute)
    expect(methods).not.toContain('tools/call')
    await freshApprove.click()
    await expect(fresh.panel.locator('[data-commission-mcp-status]')).toHaveText('Approval active', { timeout: ms(20_000) })
    expect(submitted).toHaveLength(1)
    expect(submitted[0]?.body.action).toBe('approve')
    expect(submitted[0]?.body.approval.localPrograms).toBe(true)
    expect(submitted[0]?.body.approval.tools).toHaveLength(1)
    expect(submitted[0]?.body.approval.tools[0]).toMatchObject({
      connectionId: ownerConnection.id, connectionRevision: ownerConnection.revision, toolName: TOOL,
      schemaHash: mcpToolSchemaHash(LOCAL_TOOL), fixedArguments: { query: fixture.fixedValue },
    })
    expect(methods).not.toContain('tools/call')

    const reviewBeforeRun = await api(page, 'GET', `/commissions/${fixture.commission.id}/mcp-permission?providerId=${fixture.provider.id}&modelId=${MODEL_ID}`)
    expect(reviewBeforeRun.status).toBe(200)
    expect(reviewBeforeRun.json.policy.approval.localPrograms).toBe(true)
    const candidates = () => store.commissionMcpWorkCandidates().filter(candidate => candidate.commissionId === fixture.commission.id)
    const candidate = candidates()[0]
    expect(candidate).toMatchObject({ itemId: fixture.item.id, tenantId, userId: 'user-ada' })
    runner = createCommissionMcpRunner({ candidates,
      run: (work, signal) => store.runCommissionMcpWork(work.commissionId, work.tenantId, work.userId, work.itemId, signal),
    })
    runner.start()
    await expect.poll(() => store.listOpenSubGoals(fixture.project.id, tenantId).find(item => item.id === fixture.item.id), { timeout: ms(30_000) })
      .toMatchObject({ status: 'done', commissionResolution: 'mcp' })
    expect(localCalls).toEqual([{ name: TOOL, arguments: { query: fixture.fixedValue } }])
    expect(opens.filter(open => open.purpose === 'call')).toMatchObject([{ ownerUserId: 'user-ada', purpose: 'call' }])
    await fresh.panel.getByRole('button', { name: 'Refresh review', exact: true }).click()
    const receipt = fresh.panel.locator('[data-commission-mcp-receipt]')
    await expect(receipt).toHaveCount(1, { timeout: ms(20_000) })
    await expect(receipt).toContainText('Local program')
    await expect(receipt).toContainText(fixture.item.subGoal)
    await receipt.locator('summary').click()
    const resultRegion = receipt.getByRole('region', { name: `Result for ${fixture.item.subGoal}`, exact: true })
    await expect(resultRegion).toContainText('Private local fixture result')
    const ownerReview = await api(page, 'GET', `/commissions/${fixture.commission.id}/mcp-permission?providerId=${fixture.provider.id}&modelId=${MODEL_ID}`)
    expect(ownerReview.json.claims).toMatchObject([{ transport: 'stdio', status: 'done' }])
    expect(JSON.stringify(ownerReview.json)).not.toMatch(/MCP_STDIO_|grantReference|local-stdio-fixture-secret/)
    await captureLocalSurface(page, testInfo, fresh.panel, resultRegion, 'commission-local-private-history')

    await page.goto('/agents/commissions')
    await expect(page.getByRole('heading', { name: 'Commissions', exact: true })).toBeVisible({ timeout: ms(20_000) })
    const agentHostRow = page.locator(`[data-contributor-row="${fixture.commission.id}"]`)
    await expect(agentHostRow).toBeVisible({ timeout: ms(20_000) })
    await agentHostRow.getByRole('button', { name: 'Unattended MCP…', exact: true }).click()
    const agentHostPanel = page.locator(`[data-commission-mcp="${fixture.commission.id}"]`)
    await expect(agentHostPanel.locator('[data-commission-mcp-status]')).toHaveText('Approval active', { timeout: ms(20_000) })
    const agentHostReceipt = agentHostPanel.locator('[data-commission-mcp-receipt]')
    await expect(agentHostReceipt).toContainText('Local program')
    await agentHostReceipt.locator('summary').click()
    const agentHostResult = agentHostReceipt.getByRole('region', { name: `Result for ${fixture.item.subGoal}`, exact: true })
    await expect(agentHostResult).toContainText('Private local fixture result')
    await captureLocalSurface(page, testInfo, agentHostPanel, agentHostResult, 'commission-local-agent-host-history')

    const peerPanel = await openPanel(peer, fixture)
    await expect(peerPanel.locator('[data-commission-mcp-status]')).toHaveText('No unattended approval', { timeout: ms(20_000) })
    await expect(peerPanel).not.toContainText(ownerConnection.label)
    await expect(peerPanel).not.toContainText(fixture.fixedValue)
    await expect(peer.locator('[data-commission-mcp-receipt]')).toHaveCount(0)
    const peerReview = await api(peer, 'GET', `/commissions/${fixture.commission.id}/mcp-permission`)
    expect(peerReview.json.policy.approval).toBeNull()
    expect(peerReview.json.claims).toEqual([])
    expect(peerReview.json.tools.map((choice: { connectionId: string; transport?: string }) => [choice.connectionId, choice.transport]))
      .toEqual([[peerLocalId, 'stdio']])
    expect(JSON.stringify(peerReview.json)).not.toContain(ownerConnection.id)
    await captureLocalSurface(peer, testInfo, peerPanel, peerPanel.locator('[data-commission-mcp-status]'), 'commission-local-peer-private-view')

    const publish = await api(page, 'POST', '/relations/ops', { op: {
      kind: 'share-project', projectId: fixture.project.id, projectName: fixture.project.name, shared: true,
    } })
    expect(publish.ok, JSON.stringify(publish.json)).toBe(true)
    const foreignContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
    contexts.push(foreignContext)
    const foreign = await foreignContext.newPage()
    disposers.push(await proxyMcpApi(foreign, stack))
    await signInSeed(foreign, 'maya@growthworks.example', 'maya-demo-password', 'user-maya')
    await setSignedTenant(foreign, 'user-maya', 'tenant-growthworks')
    await foreign.goto(`/projects/${fixture.project.id}`)
    await expect(foreign.getByRole('heading', { name: fixture.project.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
    const foreignRow = foreign.locator(`[data-contributor-row="${fixture.commission.id}"]`)
    await expect(foreignRow).toBeVisible()
    await expect(foreignRow.getByRole('button', { name: 'Unattended MCP…', exact: true })).toHaveCount(0)
    await expect(foreignRow).not.toContainText(ownerConnection.label)
    await expect(foreignRow).not.toContainText('Local program')
    await expect(foreign.locator('[data-commission-mcp-receipt]')).toHaveCount(0)
    expect((await api(foreign, 'GET', `/commissions/${fixture.commission.id}/mcp-permission`)).status).toBe(404)
    await captureLocalSurface(foreign, testInfo, foreignRow, foreignRow, 'commission-local-foreign-public-view')

    await agentHostPanel.getByRole('button', { name: 'Revoke approval', exact: true }).click()
    await expect(agentHostPanel.locator('[data-commission-mcp-status]')).toHaveText('No unattended approval', { timeout: ms(20_000) })
    await expect(agentHostPanel.locator('[data-commission-mcp-receipt]')).toContainText('Local program')
    const revoked = await api(page, 'GET', `/commissions/${fixture.commission.id}/mcp-permission?providerId=${fixture.provider.id}&modelId=${MODEL_ID}`)
    expect(revoked.json.policy.approval).toBeNull()
    expect(revoked.json.claims).toMatchObject([{ transport: 'stdio', status: 'done' }])

    await peer.getByRole('button', { name: 'Refresh review', exact: true }).click()
    expect((await api(peer, 'GET', `/commissions/${fixture.commission.id}/mcp-permission`)).json.claims).toEqual([])
    expect(localCalls, 'revocation and owner history reads do not relaunch the local peer').toHaveLength(1)
  } finally {
    try {
      if (!page.isClosed() && approvalRoute && approvalPattern) await page.unroute(approvalPattern, approvalRoute)
    } finally {
      await runner?.stop()
      await Promise.allSettled([pageDisposer(), ...disposers.map(dispose => dispose()), ...contexts.map(context => context.close()), stack.close()])
      if (localId && tenantId) {
        const local = store.privateMcpConnection(localId, tenantId, 'user-ada')
        if (local) store.removeMcpConnection(local.id, tenantId, local.revision, 'user-ada')
      }
      if (peerLocalId && tenantId) {
        const local = store.privateMcpConnection(peerLocalId, tenantId, 'user-grace')
        if (local) store.removeMcpConnection(local.id, tenantId, local.revision, 'user-grace')
      }
      await model?.close()
    }
  }
})

test('web-shaped Commission host omits person-owned local tools', async ({ page }) => {
  const stack = await startMcpRouterStack()
  const dispose = await proxyMcpApi(page, stack)
  let localId = ''
  let tenantId = ''
  let model: ModelPeer | undefined
  try {
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const stamp = randomUUID().slice(0, 8)
    const orgResponse = await api(page, 'POST', '/orgs', { name: `Commission local refusal ${stamp}` })
    expect(orgResponse.status).toBe(201)
    tenantId = (orgResponse.json as { id: string }).id
    await setSignedTenant(page, 'user-ada', tenantId)
    const local = seedLocalConnection(tenantId, 'user-ada', `Web hidden local Commission ${stamp}`)
    localId = local.id
    const fixture = await createFixture(page, stamp, undefined, tenantId, local)
    model = fixture.model
    const response = await api(page, 'GET', `/commissions/${fixture.commission.id}/mcp-permission?providerId=${fixture.provider.id}&modelId=${MODEL_ID}`)
    expect(response.status).toBe(200)
    expect(response.json.tools).toEqual([])
    expect(JSON.stringify(response.json)).not.toContain(localId)
    const panel = await openPanel(page, fixture)
    await panel.getByLabel('Unattended endpoint', { exact: true }).selectOption(fixture.provider.id)
    await panel.getByLabel('Unattended model', { exact: true }).selectOption(MODEL_ID)
    await expect(panel).toContainText('Local programs require the desktop runtime.')
    await expect(panel).not.toContainText(local.label)
    await expect(panel.getByRole('button', { name: 'Review approval', exact: true })).toBeDisabled()
  } finally {
    await Promise.allSettled([dispose(), stack.close(), model?.close()])
    if (localId && tenantId) {
      const local = store.privateMcpConnection(localId, tenantId, 'user-ada')
      if (local) store.removeMcpConnection(local.id, tenantId, local.revision, 'user-ada')
    }
  }
})

test('lost local approval acknowledgement retains consent in the held keyed decision without asking again', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  const methods: string[] = []
  const localCalls: Array<{ name: string; arguments: unknown }> = []
  const stack = await startMcpRouterStack({ localProcessesAvailable: true,
    synchronizeStdioBindings: async () => ({ available: true }),
    openStdio: () => localPeer(methods, localCalls),
  })
  const disposeProxy = await proxyMcpApi(page, stack)
  const attempts: Array<{ body: any; key: string | undefined }> = []
  let loseAcknowledgement = true
  let pattern: string | undefined
  let handler: ((route: Route) => Promise<void>) | undefined
  let model: ModelPeer | undefined
  let localId = ''
  let tenantId = ''
  try {
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const stamp = randomUUID().slice(0, 8)
    const orgResponse = await api(page, 'POST', '/orgs', { name: `Commission local held ${stamp}` })
    expect(orgResponse.status).toBe(201)
    tenantId = (orgResponse.json as { id: string }).id
    await setSignedTenant(page, 'user-ada', tenantId)
    const local = seedLocalConnection(tenantId, 'user-ada', `Held local Commission ${stamp}`)
    localId = local.id
    expect(await synchronizeMcpCredentials(store.mcpCredentialBindings(), store.mcpStdioBindings())).toBe('complete')
    const fixture = await createFixture(page, stamp, undefined, tenantId, local)
    model = fixture.model
    const { panel, review } = await createReview(page, fixture)
    const acknowledgement = review.getByRole('checkbox', { name: /I understand and explicitly approve unattended local-program launch/ })
    await acknowledgement.check()
    await captureLocalSurface(page, testInfo, panel, review.getByRole('button', { name: 'Approve unattended work', exact: true }), 'commission-local-lost-ack-review')

    pattern = `**${API}/commissions/${fixture.commission.id}/mcp-permission`
    handler = async route => {
      if (route.request().method() !== 'POST') return route.fallback()
      attempts.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] })
      if (!loseAcknowledgement) return route.fallback()
      loseAcknowledgement = false
      const requestUrl = new URL(route.request().url())
      const { origin: _origin, ...headers } = route.request().headers()
      const response = await route.fetch({ url: `${stack.url}${requestUrl.pathname}${requestUrl.search}`, headers })
      expect(response.ok()).toBe(true)
      await response.body()
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'fixture lost local consent acknowledgement' } }) })
    }
    await page.route(pattern, handler)
    await review.getByRole('button', { name: 'Approve unattended work', exact: true }).click()
    const notice = page.locator('[data-revisioned-mutation="commission-mcp"]')
    await expect(notice).toContainText('Couldn’t confirm whether the MCP decision was saved.', { timeout: ms(20_000) })
    await expect(notice.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    await expect(panel.locator('[data-commission-mcp-review]')).toContainText('Explicit local-program consent was included in this submitted approval.')
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.body.approval.localPrograms).toBe(true)
    expect(methods).not.toContain('tools/call')

    const collapse = page.getByRole('button', { name: 'Expand sidebar', exact: true })
    if (await collapse.count()) await collapse.click()
    await page.getByRole('navigation').getByRole('button', { name: 'Contexts', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Contexts', exact: true })).toBeVisible()
    await expect(notice).toBeVisible()
    const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true })
    if (await expand.count()) await expand.click()
    await page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    await page.getByText(fixture.project.name, { exact: true }).first().click()
    await expect(page.getByRole('heading', { name: fixture.project.name, exact: true })).toBeVisible()
    const row = page.locator(`[data-contributor-row="${fixture.commission.id}"]`)
    await row.getByRole('button', { name: 'Unattended MCP…', exact: true }).click()
    const reopened = page.locator(`[data-commission-mcp="${fixture.commission.id}"]`)
    await expect(reopened.locator('[data-commission-mcp-review]')).toContainText('Explicit local-program consent was included in this submitted approval.')
    await expect(reopened.locator('[data-commission-mcp-review]').getByRole('checkbox', { name: /I understand and explicitly approve unattended local-program launch/ })).toHaveCount(0)
    await expect(notice).toBeVisible()
    await expect(notice.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    await notice.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(reopened.locator('[data-commission-mcp-status]')).toHaveText('Approval active', { timeout: ms(20_000) })
    expect(attempts).toHaveLength(2)
    expect(attempts[0]?.key).toBeTruthy()
    expect(attempts[1]).toEqual(attempts[0])
    expect(attempts[1]?.body.approval.localPrograms).toBe(true)
    expect(attempts[1]?.body.approval.tools).toHaveLength(1)
    expect(attempts[1]?.body.approval.tools[0].connectionId).toBe(localId)
    expect(localCalls).toEqual([])
  } finally {
    try {
      if (!page.isClosed() && handler && pattern) await page.unroute(pattern, handler)
    } finally {
      await Promise.allSettled([disposeProxy(), stack.close(), model?.close()])
      if (localId && tenantId) {
        const local = store.privateMcpConnection(localId, tenantId, 'user-ada')
        if (local) store.removeMcpConnection(local.id, tenantId, local.revision, 'user-ada')
      }
    }
  }
})
