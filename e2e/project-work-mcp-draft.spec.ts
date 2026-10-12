/** Private model-authored MCP arguments for an open linked Project work item. */
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import type { Agent, Commission, CreateProjectResponse, DispatchRun, Identity, ModelProvider, OpenSubGoal, Project, SystemPromptEntry } from '../contract/index.ts'
import { startMcpFixture, startMcpRouterStack, proxyMcpApi } from './mcp-fixture.ts'
import { newUser } from './social-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { ms } from './budget.ts'

const API = '/api/v1'
const MODEL_ID = 'project-work-mcp-draft-model'
const TOOL = 'write'
const CONNECTION = (stamp: string) => `Project draft MCP ${stamp}`
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]

interface ModelPeer {
  server: Server
  baseURL: string
  requests: Array<{ body: Record<string, any> }>
  reply: string
  close(): Promise<void>
}
interface Fixture {
  project: Project
  item: OpenSubGoal
  contribution: { id: string; title: string }
  agent: Agent
  commission: Commission
  provider: ModelProvider
  connection: { id: string; revision: number; label: string }
  peer: ModelPeer
  modelRequestOffset: number
  privateSentinel: string
}

const activeModelPeers = new Set<ModelPeer>()
test.afterEach(async () => Promise.all([...activeModelPeers].map((peer) => peer.close())))

function sse(response: import('node:http').ServerResponse, event: string, data: unknown) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function startModelPeer(reply: string): Promise<ModelPeer> {
  let currentReply = reply
  const requests: ModelPeer['requests'] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any> : {}
    const path = (request.url ?? '').split('?')[0]
    if (request.method === 'GET' && path === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: MODEL_ID, display_name: 'Project MCP draft fixture model' }] }))
      return
    }
    if (request.method !== 'POST' || path !== '/v1/messages') { response.writeHead(404).end(); return }
    requests.push({ body })
    const id = `msg_project_mcp_draft_${requests.length}`
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
    sse(response, 'message_start', { type: 'message_start', message: {
      id, type: 'message', role: 'assistant', model: MODEL_ID, content: [], stop_reason: null,
      usage: { input_tokens: 11, output_tokens: 0 },
    } })
    sse(response, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    sse(response, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: currentReply } })
    sse(response, 'content_block_stop', { type: 'content_block_stop', index: 0 })
    sse(response, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } })
    sse(response, 'message_stop', { type: 'message_stop' })
    response.end()
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Project MCP draft model fixture did not bind')
  const peer: ModelPeer = {
    server, baseURL: `http://127.0.0.1:${address.port}`, requests,
    get reply() { return currentReply }, set reply(value: string) { currentReply = value },
    close: async () => {
      if (!activeModelPeers.has(peer)) return
      activeModelPeers.delete(peer)
      server.closeAllConnections?.()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    },
  }
  activeModelPeers.add(peer)
  return peer
}

async function api(page: Page, stack: { url: string }, method: string, path: string, data?: unknown, key = randomUUID()) {
  // Go through the signed browser origin so its HttpOnly session cookie rides
  // the request into the isolated router via proxyMcpApi.
  void stack
  const result = await page.evaluate(async ({ method, path, data, key, apiRoot }) => {
    const response = await fetch(`${apiRoot}${path}`, {
      method,
      headers: { 'Idempotency-Key': key, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
    return { ok: response.ok, status: response.status, json: await response.json().catch(() => ({})) }
  }, { method, path, data, key, apiRoot: API })
  return { response: { ok: () => result.ok, status: () => result.status }, json: result.json as any }
}

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

async function createFixture(page: Page, stack: { url: string }, mcpEndpoint: string, stamp: string, reply: string): Promise<Fixture> {
  const identityResponse = await api(page, stack, 'GET', '/me')
  expect(identityResponse.response.ok()).toBe(true)
  const identity = identityResponse.json as Identity
  expect(identity.user.id).toBe('user-ada')
  const projectResponse = await api(page, stack, 'POST', '/projects', {
    name: `MCP draft work ${stamp}`, description: `Project-owned work context ${stamp}.`,
  })
  expect(projectResponse.response.status(), JSON.stringify(projectResponse.json)).toBe(201)
  const project = (projectResponse.json as CreateProjectResponse).project
  const privateSentinel = `private-context-not-for-dispatch-${stamp}`
  const scoped = await api(page, stack, 'POST', '/relations/ops', { op: {
    kind: 'scope-context', projectId: project.id, projectName: project.name,
    context: { kind: 'doc', label: `Private unrelated document ${stamp}`, meta: privateSentinel },
  } })
  expect(scoped.response.ok(), JSON.stringify(scoped.json)).toBe(true)
  const itemResponse = await api(page, stack, 'POST', `/projects/${project.id}/open-subgoals`, {
    subGoal: `Apply reviewed write ${stamp}`, type: 'mcp.mutate', target: TOOL,
    note: `Only the separately reviewed ${TOOL} tool may apply this item.`,
  })
  expect(itemResponse.response.ok(), JSON.stringify(itemResponse.json)).toBe(true)
  const item = itemResponse.json as OpenSubGoal
  const contributionTitle = `Reviewed write contribution ${stamp}`
  const contributionResponse = await api(page, stack, 'POST', `/projects/${project.id}/contributions`, {
    title: contributionTitle, summary: 'A workspace model draft may suggest arguments; a person reviews every act.', workItemId: item.id,
  })
  expect(contributionResponse.response.ok(), JSON.stringify(contributionResponse.json)).toBe(true)
  const contribution = contributionResponse.json as Fixture['contribution']

  const connectionResponse = await api(page, stack, 'POST', '/mcp-connections', {
    creationId: randomUUID(), label: CONNECTION(stamp), endpoint: mcpEndpoint, authentication: 'none',
  })
  expect(connectionResponse.response.ok(), JSON.stringify(connectionResponse.json)).toBe(true)
  const connection = connectionResponse.json.connection as Fixture['connection']
  const inspected = await api(page, stack, 'POST', `/mcp-connections/${connection.id}/inspect`, {
    operationId: randomUUID(), expectedRevision: connection.revision,
  })
  expect(inspected.response.ok(), JSON.stringify(inspected.json)).toBe(true)
  const currentConnection = inspected.json.connection as Fixture['connection']

  const peer = await startModelPeer(reply)
  const providerResponse = await api(page, stack, 'POST', '/providers', {
    label: `MCP draft endpoint ${stamp}`, modelFamily: 'claude', effortLevels: ['Default'],
    models: [{ id: MODEL_ID, label: `MCP draft model ${stamp}` }], config: { baseURL: peer.baseURL, model: MODEL_ID },
  })
  expect(providerResponse.response.ok(), JSON.stringify(providerResponse.json)).toBe(true)
  const provider = providerResponse.json as ModelProvider
  const promptsResponse = await api(page, stack, 'GET', '/system-prompts')
  expect(promptsResponse.response.ok()).toBe(true)
  const prompts = promptsResponse.json as SystemPromptEntry[]
  expect(prompts.length).toBeGreaterThan(0)
  const agentResponse = await api(page, stack, 'POST', '/agents', {
    label: `MCP draft Agent ${stamp}`, providerId: provider.id, systemPromptId: prompts[0]!.id,
    tools: [], instructions: `Private Agent instruction sentinel ${stamp}; not a Project or tool permission.`,
  })
  expect(agentResponse.response.ok(), JSON.stringify(agentResponse.json)).toBe(true)
  const agent = agentResponse.json as Agent
  const commissionResponse = await api(page, stack, 'POST', '/commissions', {
    agentId: agent.id, projectId: project.id, role: 'reader', standing: false,
  })
  expect(commissionResponse.response.ok(), JSON.stringify(commissionResponse.json)).toBe(true)
  const commission = commissionResponse.json as Commission
  expect(peer.requests).toHaveLength(1, 'only the provider conformance probe runs before a draft is admitted')
  expect(peer.requests[0]?.body.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'probe_noop' })]))
  return { project, item, contribution, agent, commission, provider, connection: currentConnection,
    peer, modelRequestOffset: peer.requests.length, privateSentinel }
}

function admittedModelRequests(fixture: Fixture) {
  return fixture.peer.requests.slice(fixture.modelRequestOffset)
}

async function openContribution(page: Page, fixture: Fixture) {
  await page.goto(`/projects/${encodeURIComponent(fixture.project.id)}/work/${encodeURIComponent(fixture.item.id)}`)
  await expect(page.getByRole('heading', { name: fixture.item.subGoal, exact: true })).toBeVisible({ timeout: ms(20_000) })
  const contributionDoor = page.locator('[data-work-item-contribution]').getByRole('button', { name: fixture.contribution.title, exact: true })
  await expect(contributionDoor).toBeVisible()
  await contributionDoor.click()
  await expect(page.getByRole('heading', { name: fixture.contribution.title, exact: true })).toBeVisible({ timeout: ms(20_000) })
}

async function startEnvelopeMcpDraft(page: Page, fixture: Fixture) {
  await page.getByRole('button', { name: 'Declare effects', exact: true }).click()
  await page.getByLabel('Effect type 1', { exact: true }).selectOption('mcp.mutate')
  await page.getByLabel('MCP tool 1', { exact: true }).selectOption({ label: `${fixture.connection.label} · ${TOOL}` })
  const disclosure = page.locator('[data-contribution-mcp-draft-disclosure]')
  await expect(disclosure).toBeVisible()
  await disclosure.click()
  const helper = page.locator('[data-contribution-mcp-draft-helper]')
  await expect(helper).toBeVisible()
  await helper.getByLabel('Commission and Agent', { exact: true }).selectOption(fixture.commission.id)
  await helper.getByLabel('Endpoint', { exact: true }).selectOption(fixture.provider.id)
  await helper.getByLabel('Model', { exact: true }).selectOption(MODEL_ID)
  const start = helper.locator('[data-contribution-mcp-draft-start]')
  await expect(start).toBeEnabled()
  return { helper, start }
}

async function captureFive(page: Page, info: TestInfo, subject: ReturnType<Page['locator']>, stem: string, required?: ReturnType<Page['locator']>) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(subject).toBeVisible()
    await subject.scrollIntoViewIfNeeded()
    if (required) {
      await required.scrollIntoViewIfNeeded()
      await expect(required).toBeInViewport()
    }
    const geometry = await subject.evaluate((element) => {
      const surface = element.getBoundingClientRect()
      const controls = [...element.querySelectorAll<HTMLElement>('button, input, select, textarea')]
        .filter((control) => control.getClientRects().length > 0)
        .map((control) => {
          const rect = control.getBoundingClientRect()
          return { width: rect.width, left: rect.left, right: rect.right }
        })
      return { width: element.clientWidth, scrollWidth: element.scrollWidth,
        controls, left: surface.left, right: surface.right }
    })
    expect(geometry.width, `${stem} has rendered width at ${viewport.width}`).toBeGreaterThan(0)
    expect(geometry.scrollWidth, `${stem} has no clipped horizontal content at ${viewport.width}`).toBeLessThanOrEqual(geometry.width)
    for (const control of geometry.controls) {
      expect(control.width, `${stem} controls remain visible at ${viewport.width}`).toBeGreaterThan(0)
      expect(control.left, `${stem} control begins inside its surface at ${viewport.width}`).toBeGreaterThanOrEqual(geometry.left - 1)
      expect(control.right, `${stem} control ends inside its surface at ${viewport.width}`).toBeLessThanOrEqual(geometry.right + 1)
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${stem}-${viewport.width}x${viewport.height}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  await settleArtifactPageRail(page)
}

async function listDispatch(page: Page, stack: { url: string }): Promise<DispatchRun[]> {
  const result = await api(page, stack, 'GET', '/dispatch')
  expect(result.response.ok()).toBe(true)
  return result.json as DispatchRun[]
}

test('owner reviews model-drafted arguments, then separately proposes, approves, runs, and resolves linked work', async ({ page }, info) => {
  test.setTimeout(ms(180_000))
  const stack = await startMcpRouterStack()
  const mcp = await startMcpFixture({ toolName: TOOL })
  const cleanup = await proxyMcpApi(page, stack)
  try {
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const stamp = randomUUID().slice(0, 8)
    const proposedArguments = { query: `drafted suggestion ${stamp}` }
    const fixture = await createFixture(page, stack, mcp.url, stamp,
      JSON.stringify({ toolName: TOOL, arguments: proposedArguments }))
    await openContribution(page, fixture)
    const { helper, start } = await startEnvelopeMcpDraft(page, fixture)
    await expect(helper).toContainText('The chosen model receives the selected Agent’s configured system prompt and instructions')
    await expect(helper).toContainText('Saved in your workspace. Workspace members can read the selected tool schema and reply; other Project viewers cannot.')
    await expect(helper).toContainText('Its workspace-private first reply is a suggestion only.')
    await captureFive(page, info, helper, 'project-work-mcp-draft-start', start)
    const inputDisclosure = helper.locator('[data-contribution-mcp-draft-inputs]')
    await inputDisclosure.locator('summary').click()
    await expect(inputDisclosure.locator('p')).toBeVisible()
    await captureFive(page, info, helper, 'project-work-mcp-draft-inputs', inputDisclosure)
    await inputDisclosure.locator('summary').click()
    expect(mcp.toolCalls).toHaveLength(0, 'drafting arguments never calls the MCP tool')
    await start.click()

    const runRow = page.locator('[data-contribution-mcp-draft-run]')
    await expect(runRow).toBeVisible({ timeout: ms(30_000) })
    await expect(runRow.getByRole('button', { name: 'Open conversation', exact: true })).toBeVisible()
    await expect(runRow.getByRole('button', { name: 'Review saved reply', exact: true })).toBeVisible()
    expect(mcp.toolCalls).toHaveLength(0, 'a completed workspace draft still has no external effect')
    const dispatches = await listDispatch(page, stack)
    const draft = dispatches.find((run) => run.execution?.projectWork?.itemId === fixture.item.id)
    expect(draft).toBeTruthy()
    expect(draft!.execution?.mcpProposal).toMatchObject({
      connectionLabel: fixture.connection.label, toolName: TOOL,
      bindingHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(draft!.execution?.mcpProposal).not.toHaveProperty('connectionId')
    expect(draft!.execution?.mcpProposal).not.toHaveProperty('ownerUserId')
    expect(draft!.execution?.mcpProposal).not.toHaveProperty('grantReference')
    const sessionResponse = await api(page, stack, 'GET', `/sessions/${encodeURIComponent(draft!.execution!.sessionId!)}`)
    expect(sessionResponse.response.ok()).toBe(true)
    expect(sessionResponse.json.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', content: JSON.stringify({ toolName: TOOL, arguments: proposedArguments }) }),
    ]))
    const modelRequests = admittedModelRequests(fixture)
    expect(modelRequests).toHaveLength(1, 'one model turn follows provider setup')
    const modelRequest = modelRequests[0]!.body
    expect(modelRequest.tools).toBeUndefined()
    expect(modelRequest.system).toContain(fixture.agent.systemPrompt)
    expect(modelRequest.system).toContain(fixture.agent.instructions)
    expect(modelRequest.system).not.toContain(fixture.privateSentinel)
    const promptText = JSON.stringify(modelRequest.messages)
    expect(promptText).toContain(fixture.project.name)
    expect(promptText).toContain(fixture.item.subGoal)
    expect(promptText).toContain(TOOL)
    expect(promptText).toContain('maxLength')
    expect(promptText).toContain('additionalProperties')
    expect(promptText).not.toContain(fixture.privateSentinel)
    expect(promptText).not.toContain(fixture.connection.id)
    expect(promptText).not.toContain(fixture.agent.instructions)
    expect(promptText).not.toContain(fixture.provider.id)
    expect(mcp.calls).toContain('tools/list')
    expect(mcp.calls).not.toContain('tools/call')

    await captureFive(page, info, runRow, 'project-work-mcp-draft-saved', runRow.getByRole('button', { name: 'Open conversation', exact: true }))
    await runRow.getByRole('button', { name: 'Review saved reply', exact: true }).click()
    const review = helper.locator('[data-contribution-mcp-draft-review]')
    await expect(review.locator('[data-contribution-mcp-draft-reply]')).toContainText(JSON.stringify({ toolName: TOOL, arguments: proposedArguments }))
    const adopt = review.locator('[data-contribution-mcp-draft-adopt]')
    await expect(adopt).toBeEnabled()
    await captureFive(page, info, review, 'project-work-mcp-draft-review-adopt', adopt)
    await adopt.click()
    const argumentsField = page.getByLabel('MCP arguments 1', { exact: true })
    await expect(argumentsField).toHaveValue(JSON.stringify(proposedArguments, null, 2))
    const reviewedArguments = { query: `human-edited arguments ${stamp}` }
    await argumentsField.fill(JSON.stringify(reviewedArguments, null, 2))
    await expect(page.getByRole('button', { name: 'Propose v1', exact: true })).toBeEnabled()
    expect(mcp.toolCalls).toHaveLength(0)
    await page.getByRole('button', { name: 'Propose v1', exact: true }).click()
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await page.getByRole('button', { name: 'Review & run', exact: true }).click()
    const confirmation = page.getByRole('group', { name: 'Confirm one MCP effect run', exact: true })
    await expect(confirmation).toBeVisible()
    await expect(page.getByLabel(`Approved arguments for ${TOOL}`, { exact: true })).toContainText(reviewedArguments.query)
    expect(mcp.toolCalls).toHaveLength(0, 'the separately reviewed confirmation still precedes every tools/call')
    await confirmation.getByRole('button', { name: 'Confirm and run once', exact: true }).click()
    await expect(page.locator('[data-contribution-effect-status="done"]')).toContainText(reviewedArguments.query)
    expect(mcp.toolCalls).toEqual([{ name: TOOL, arguments: reviewedArguments }])
    await expect(page.getByRole('button', { name: 'Land and resolve work', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Land and resolve work', exact: true }).click()
    await expect(page.getByRole('main').getByText(/Landed · L\d+/).first()).toBeVisible()
    await expect.poll(async () => {
      const items = await api(page, stack, 'GET', `/projects/${fixture.project.id}/open-subgoals`)
      return (items.json as OpenSubGoal[]).find((item) => item.id === fixture.item.id)?.status
    }).toBe('done')
    expect(mcp.toolCalls).toHaveLength(1, 'landing resolves the exact result without a second MCP call')
    await assertWcag22Aa(page, 'Project-work MCP draft contribution workflow')
  } finally {
    await cleanup(); await mcp.close(); await stack.close()
  }
})

test('malformed model arguments cannot be adopted; connection revision change fences a saved workspace draft', async ({ page }, info) => {
  test.setTimeout(ms(150_000))
  const stack = await startMcpRouterStack()
  const mcp = await startMcpFixture({ toolName: TOOL })
  const cleanup = await proxyMcpApi(page, stack)
  try {
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const stamp = randomUUID().slice(0, 8)
    const fixture = await createFixture(page, stack, mcp.url, stamp, `Here is prose, not exact JSON for ${TOOL}.`)
    await openContribution(page, fixture)
    const { helper, start } = await startEnvelopeMcpDraft(page, fixture)
    await start.click()
    await expect.poll(() => admittedModelRequests(fixture).length).toBe(1)
    const invalidRun = page.locator('[data-contribution-mcp-draft-run]').first()
    await expect(invalidRun).toBeVisible({ timeout: ms(30_000) })
    await invalidRun.getByRole('button', { name: 'Review saved reply', exact: true }).click()
    const invalidReview = helper.locator('[data-contribution-mcp-draft-review]')
    await expect(invalidReview.locator('[data-contribution-mcp-draft-invalid]')).toHaveText('The draft reply was not one exact, bounded JSON tool-arguments object.')
    await expect(invalidReview.locator('[data-contribution-mcp-draft-adopt]')).toHaveCount(0)
    const invalidRunId = await invalidRun.getAttribute('data-contribution-mcp-draft-run')
    expect(invalidRunId).toBeTruthy()
    expect(mcp.toolCalls).toHaveLength(0)
    const itemRead = await api(page, stack, 'GET', `/projects/${fixture.project.id}/open-subgoals`)
    expect((itemRead.json as OpenSubGoal[]).find((item) => item.id === fixture.item.id)?.status).toBe('open')
    await captureFive(page, info, helper, 'project-work-mcp-draft-invalid-workspace', invalidReview.locator('[data-contribution-mcp-draft-invalid]'))

    // A fresh exact model result is saved, then inspection advances the live
    // connection revision. Explicit adoption must revalidate before copying.
    fixture.peer.reply = JSON.stringify({ toolName: TOOL, arguments: { query: `fresh exact result ${stamp}` } })
    await start.click()
    await expect.poll(() => admittedModelRequests(fixture).length).toBe(2)
    await expect.poll(async () => (await listDispatch(page, stack)).filter((run) => run.execution?.projectWork?.itemId === fixture.item.id).length).toBe(2)
    const validRunRecord = (await listDispatch(page, stack)).find((run) => run.execution?.projectWork?.itemId === fixture.item.id && run.id !== invalidRunId)
    expect(validRunRecord).toBeTruthy()
    const validRun = page.locator(`[data-contribution-mcp-draft-run="${validRunRecord!.id}"]`)
    await expect(validRun).toBeVisible({ timeout: ms(30_000) })
    await validRun.getByRole('button', { name: 'Review saved reply', exact: true }).click()
    const validReview = helper.locator('[data-contribution-mcp-draft-review]')
    const freshAdopt = validReview.locator('[data-contribution-mcp-draft-adopt]')
    await expect(freshAdopt).toBeEnabled()
    const reinspected = await api(page, stack, 'POST', `/mcp-connections/${fixture.connection.id}/inspect`, {
      operationId: randomUUID(), expectedRevision: fixture.connection.revision,
    })
    expect(reinspected.response.ok(), JSON.stringify(reinspected.json)).toBe(true)
    await page.reload()
    await expect(page.getByRole('heading', { name: fixture.contribution.title, exact: true })).toBeVisible()
    const refreshed = await startEnvelopeMcpDraft(page, fixture)
    const refreshedRun = page.locator(`[data-contribution-mcp-draft-run="${validRunRecord!.id}"]`)
    await refreshedRun.getByRole('button', { name: 'Review saved reply', exact: true }).click()
    const staleReview = refreshed.helper.locator('[data-contribution-mcp-draft-review]')
    const stale = page.locator('[data-contribution-mcp-draft-stale]')
    await expect(stale).toBeVisible()
    await expect(staleReview.locator('[data-contribution-mcp-draft-adopt]')).toBeDisabled()
    await expect(page.getByLabel('MCP arguments 1', { exact: true })).toHaveValue('{}')
    await captureFive(page, info, refreshed.helper, 'project-work-mcp-draft-stale-binding', stale)
    await assertWcag22Aa(page, 'Invalid Project-work MCP draft')
  } finally {
    await cleanup(); await mcp.close(); await stack.close()
  }
})

test('other Project viewers see the Contribution but not the workspace draft; foreign and private Project walls hold', async ({ page, browser }, info) => {
  test.setTimeout(ms(100_000))
  const stack = await startMcpRouterStack()
  const mcp = await startMcpFixture({ toolName: TOOL })
  const cleanup = await proxyMcpApi(page, stack)
  const reader = await newUser(browser)
  const foreign = await newUser(browser)
  const readerCleanup = await proxyMcpApi(reader.page, stack)
  const foreignCleanup = await proxyMcpApi(foreign.page, stack)
  try {
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    await signInSeed(reader.page, 'grace@acme.example', 'grace-demo-password', 'user-grace')
    await signInSeed(foreign.page, 'maya@growthworks.example', 'maya-demo-password', 'user-maya')
    const stamp = randomUUID().slice(0, 8)
    const workspaceReply = JSON.stringify({ toolName: TOOL, arguments: { query: `workspace dispatch reply ${stamp}` } })
    const fixture = await createFixture(page, stack, mcp.url, stamp, workspaceReply)
    const shared = await api(page, stack, 'POST', '/relations/ops', { op: {
      kind: 'share-project', projectId: fixture.project.id, projectName: fixture.project.name, shared: true,
    } })
    expect(shared.response.ok()).toBe(true)
    const privateProject = await api(page, stack, 'POST', '/projects', {
      name: `Private MCP draft project ${stamp}`, description: 'Owner-only test resource.',
    })
    expect(privateProject.response.status()).toBe(201)
    await openContribution(page, fixture)
    const { start } = await startEnvelopeMcpDraft(page, fixture)
    const dispatchPosts: Array<{ key: string; body: unknown }> = []
    let loseFirstAck = true
    let exposeDispatchFeed = false
    const dispatchRoute = async (route: import('@playwright/test').Route) => {
      const method = route.request().method()
      if (method === 'GET' && !exposeDispatchFeed) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        return
      }
      if (method !== 'GET' && method !== 'POST') {
        await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: { code: 'method_not_allowed' } }) })
        return
      }
      if (method === 'POST') dispatchPosts.push({ key: route.request().headers()['idempotency-key'] ?? '', body: route.request().postDataJSON() })
      const url = new URL(route.request().url())
      const { origin: _origin, ...headers } = route.request().headers()
      const response = await route.fetch({ url: `${stack.url}${url.pathname}${url.search}`, headers })
      if (method === 'POST' && loseFirstAck) {
        loseFirstAck = false
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Dispatch acknowledgement was lost.' } }) })
        return
      }
      await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() })
    }
    await page.route('**/api/v1/dispatch', dispatchRoute)
    await start.click()
    const notice = page.locator('[data-dispatch-creation="failed"]')
    await expect(notice).toBeVisible({ timeout: ms(30_000) })
    await expect(notice).toContainText('Couldn’t confirm whether the dispatch started')
    await expect.poll(() => admittedModelRequests(fixture).length).toBe(1)
    expect(dispatchPosts).toHaveLength(1)
    expect(dispatchPosts[0]?.key).not.toBe('')
    expect(dispatchPosts[0]?.body).toMatchObject({
      projectWork: { projectId: fixture.project.id, itemId: fixture.item.id, commissionId: fixture.commission.id },
      mcpProposal: { connectionId: fixture.connection.id, connectionRevision: fixture.connection.revision, toolName: TOOL },
    })
    await captureFive(page, info, notice, 'project-work-mcp-draft-held-ack')
    await assertWcag22Aa(page, 'Held Project-work MCP Dispatch recovery')

    // Exercise an actual SPA unmount/remount while the Dispatch response is
    // held; a document reload would erase the controller state being tested.
    await page.getByRole('main').getByRole('button', { name: fixture.item.subGoal, exact: true }).click()
    await expect(page.getByRole('heading', { name: fixture.item.subGoal, exact: true })).toBeVisible()
    await page.getByRole('main').getByRole('button', { name: fixture.contribution.title, exact: true }).click()
    await expect(page.getByRole('heading', { name: fixture.contribution.title, exact: true })).toBeVisible()
    await expect(page.locator('[data-dispatch-creation="failed"]')).toBeVisible()
    const heldRecovery = page.locator('[data-contribution-mcp-draft-recovery]')
    await expect(heldRecovery).toBeVisible()
    await heldRecovery.getByRole('button', { name: 'Review held argument draft', exact: true }).click()
    const heldHelper = page.locator('[data-contribution-mcp-draft-helper]')
    await expect(heldHelper).toBeVisible()
    await expect(heldHelper.getByLabel('Commission and Agent', { exact: true })).toHaveValue(fixture.commission.id)
    await expect(heldHelper.getByLabel('Endpoint', { exact: true })).toHaveValue(fixture.provider.id)
    await expect(heldHelper.getByLabel('Model', { exact: true })).toHaveValue(MODEL_ID)
    await expect(heldHelper.getByLabel('Commission and Agent', { exact: true })).toBeDisabled()
    await expect(heldHelper.locator('[data-contribution-mcp-draft-start]')).toBeDisabled()
    await captureFive(page, info, heldHelper, 'project-work-mcp-draft-held-selection', heldHelper.locator('[data-contribution-mcp-draft-start]'))
    exposeDispatchFeed = true
    await page.locator('[data-dispatch-creation="failed"]').getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.locator('[data-dispatch-creation="failed"]')).toHaveCount(0)
    expect(dispatchPosts).toHaveLength(2)
    expect(dispatchPosts[1]?.key).toBe(dispatchPosts[0]?.key)
    expect(dispatchPosts[1]?.body).toEqual(dispatchPosts[0]?.body)
    expect(admittedModelRequests(fixture)).toHaveLength(1, 'same-key recovery returns the saved Dispatch instead of a second model turn')
    const helper = heldHelper
    const runRow = helper.locator('[data-contribution-mcp-draft-run]')
    await expect(runRow).toBeVisible({ timeout: ms(30_000) })
    const runTitle = (await listDispatch(page, stack)).find((run) => run.execution?.projectWork?.itemId === fixture.item.id)?.title
    expect(runTitle).toBeTruthy()
    await captureFive(page, info, helper, 'project-work-mcp-draft-owner-private', runRow)
    await assertWcag22Aa(page, 'Recovered private Project-work MCP draft')
    await runRow.getByRole('button', { name: 'Review saved reply', exact: true }).click()
    await expect(helper.locator('[data-contribution-mcp-draft-reply]')).toHaveText(workspaceReply)
    await expect(helper.locator('[data-contribution-mcp-draft-source]')).toContainText(fixture.agent.label)
    await expect(helper.locator('[data-contribution-mcp-draft-source]')).toContainText(fixture.provider.label)
    await expect(helper.locator('[data-contribution-mcp-draft-source]')).toContainText(MODEL_ID)

    await reader.page.goto(`/projects/${encodeURIComponent(fixture.project.id)}/changes/${encodeURIComponent(fixture.contribution.id)}`)
    await expect(reader.page.getByRole('heading', { name: fixture.contribution.title, exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(reader.page.locator('[data-contribution-mcp-draft-helper]')).toHaveCount(0)
    await expect(reader.page.getByRole('button', { name: 'Land and resolve work', exact: true })).toBeDisabled()
    await expect(reader.page.locator('main')).not.toContainText(runTitle!)
    await expect(reader.page.locator('main')).not.toContainText(workspaceReply)
    await expect(reader.page.getByRole('main')).toContainText(fixture.contribution.title)
    await captureFive(reader.page, info, reader.page.getByRole('main').locator('[data-resource-page]'), 'project-work-mcp-draft-shared-reader')
    const readerRuns = await api(reader.page, stack, 'GET', '/dispatch')
    expect(readerRuns.response.ok()).toBe(true)
    expect(JSON.stringify(readerRuns.json)).not.toContain(runTitle!)

    await foreign.page.goto(`/projects/${encodeURIComponent(fixture.project.id)}/changes/${encodeURIComponent(fixture.contribution.id)}`)
    await expect(foreign.page.getByRole('heading', { name: fixture.contribution.title, exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(foreign.page.locator('[data-contribution-mcp-draft-helper]')).toHaveCount(0)
    await expect(foreign.page.locator('main')).not.toContainText(runTitle!)
    await expect(foreign.page.locator('main')).not.toContainText(workspaceReply)
    const foreignRuns = await api(foreign.page, stack, 'GET', '/dispatch')
    expect(foreignRuns.response.ok()).toBe(true)
    expect(JSON.stringify(foreignRuns.json)).not.toContain(runTitle!)
    await foreign.page.goto(`/projects/${encodeURIComponent(privateProject.json.project.id)}`)
    await expect(foreign.page.getByText('This project isn’t visible from this account (or no longer exists).', { exact: true })).toBeVisible()
    await reader.page.goto(`/projects/${encodeURIComponent(privateProject.json.project.id)}`)
    await expect(reader.page.getByText('This project isn’t visible from this account (or no longer exists).', { exact: true })).toBeVisible()
  } finally {
    await cleanup(); await readerCleanup(); await foreignCleanup(); await reader.context.close(); await foreign.context.close()
    await mcp.close(); await stack.close()
  }
})
