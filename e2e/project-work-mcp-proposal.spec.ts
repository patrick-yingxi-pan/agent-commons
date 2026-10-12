/** Item-first commissioned proposal through explicit Contribution approval,
 *  exact MCP Run, and owner acceptance. Every external peer is test-owned. */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { Agent, Commission, Contribution, Identity, ModelProvider, OpenSubGoal, Project, SystemPromptEntry } from '../contract/index.ts'
import { startMcpFixture, startMcpRouterStack, proxyMcpApi } from './mcp-fixture.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { newUser, openSection } from './social-helpers.ts'
import { ms } from './budget.ts'

const API = '/api/v1'
const MODEL_ID = 'project-work-mcp-proposal-model'
const TOOL = 'write'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]

interface ModelPeer {
  server: ReturnType<typeof createServer>
  baseURL: string
  requests: Array<{ body: Record<string, any> }>
  reply: string
  close(): Promise<void>
}

interface Fixture {
  project: Project
  item: OpenSubGoal
  agent: Agent
  commission: Commission
  provider: ModelProvider
  connection: { id: string; revision: number; label: string }
  peer: ModelPeer
  modelRequestOffset: number
  privateSentinel: string
}

const activePeers = new Set<ModelPeer>()
test.afterEach(async () => Promise.all([...activePeers].map((peer) => peer.close())))

function sendSse(response: import('node:http').ServerResponse, event: string, data: unknown) {
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
      response.end(JSON.stringify({ data: [{ id: MODEL_ID, display_name: 'Project proposal fixture model' }] }))
      return
    }
    if (request.method !== 'POST' || path !== '/v1/messages') { response.writeHead(404).end(); return }
    requests.push({ body })
    const id = `msg_project_mcp_proposal_${requests.length}`
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
    sendSse(response, 'message_start', { type: 'message_start', message: {
      id, type: 'message', role: 'assistant', model: MODEL_ID, content: [], stop_reason: null,
      usage: { input_tokens: 11, output_tokens: 0 },
    } })
    sendSse(response, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    sendSse(response, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: currentReply } })
    sendSse(response, 'content_block_stop', { type: 'content_block_stop', index: 0 })
    sendSse(response, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } })
    sendSse(response, 'message_stop', { type: 'message_stop' })
    response.end()
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Project MCP proposal model fixture did not bind')
  const peer: ModelPeer = {
    server, baseURL: `http://127.0.0.1:${address.port}`, requests,
    get reply() { return currentReply }, set reply(value: string) { currentReply = value },
    close: async () => {
      if (!activePeers.has(peer)) return
      activePeers.delete(peer)
      server.closeAllConnections?.()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    },
  }
  activePeers.add(peer)
  return peer
}

async function api(page: Page, method: string, path: string, data?: unknown, key = randomUUID()) {
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

async function createFixture(page: Page, stamp: string, mcpEndpoint: string, reply: string): Promise<Fixture> {
  const identity = await api(page, 'GET', '/me')
  expect(identity.response.ok()).toBe(true)
  expect((identity.json as Identity).user.id).toBe('user-ada')
  const projectResponse = await api(page, 'POST', '/projects', {
    name: `Work proposal ${stamp}`, description: `Visible work request for ${stamp}.`,
  })
  expect(projectResponse.response.status(), JSON.stringify(projectResponse.json)).toBe(201)
  const project = (projectResponse.json as { project: Project }).project
  const privateSentinel = `private-unrelated-context-${stamp}`
  const scoped = await api(page, 'POST', '/relations/ops', { op: {
    kind: 'scope-context', projectId: project.id, projectName: project.name,
    context: { kind: 'doc', label: `Unrelated private document ${stamp}`, meta: privateSentinel },
  } })
  expect(scoped.response.ok(), JSON.stringify(scoped.json)).toBe(true)
  const workResponse = await api(page, 'POST', `/projects/${project.id}/open-subgoals`, {
    subGoal: `Apply one reviewed ${stamp}`, type: 'mcp.mutate', target: TOOL,
    note: `Only one explicitly reviewed ${TOOL} call may resolve this request.`,
  })
  expect(workResponse.response.ok(), JSON.stringify(workResponse.json)).toBe(true)
  const item = workResponse.json as OpenSubGoal

  const connectionResponse = await api(page, 'POST', '/mcp-connections', {
    creationId: randomUUID(), label: `Proposal peer ${stamp}`, endpoint: mcpEndpoint, authentication: 'none',
  })
  expect(connectionResponse.response.ok(), JSON.stringify(connectionResponse.json)).toBe(true)
  const connectionCreated = connectionResponse.json.connection as Fixture['connection']
  const inspected = await api(page, 'POST', `/mcp-connections/${connectionCreated.id}/inspect`, {
    operationId: randomUUID(), expectedRevision: connectionCreated.revision,
  })
  expect(inspected.response.ok(), JSON.stringify(inspected.json)).toBe(true)
  const connection = inspected.json.connection as Fixture['connection']

  const peer = await startModelPeer(reply)
  const providerResponse = await api(page, 'POST', '/providers', {
    label: `Proposal endpoint ${stamp}`, modelFamily: 'claude', effortLevels: ['Default'],
    models: [{ id: MODEL_ID, label: `Proposal model ${stamp}` }], config: { baseURL: peer.baseURL, model: MODEL_ID },
  })
  expect(providerResponse.response.ok(), JSON.stringify(providerResponse.json)).toBe(true)
  const provider = providerResponse.json as ModelProvider
  const promptsResponse = await api(page, 'GET', '/system-prompts')
  expect(promptsResponse.response.ok()).toBe(true)
  const prompts = promptsResponse.json as SystemPromptEntry[]
  expect(prompts.length).toBeGreaterThan(0)
  const agentResponse = await api(page, 'POST', '/agents', {
    label: `Proposal Agent ${stamp}`, providerId: provider.id, systemPromptId: prompts[0]!.id,
    tools: [], instructions: `Configured proposal-only instruction ${stamp}; never implies permission.`,
  })
  expect(agentResponse.response.ok(), JSON.stringify(agentResponse.json)).toBe(true)
  const agent = agentResponse.json as Agent
  const commissionResponse = await api(page, 'POST', '/commissions', {
    agentId: agent.id, projectId: project.id, role: 'reader', standing: false,
  })
  expect(commissionResponse.response.ok(), JSON.stringify(commissionResponse.json)).toBe(true)
  const commission = commissionResponse.json as Commission
  expect(peer.requests).toHaveLength(1, 'only provider conformance probe runs during setup')
  expect(peer.requests[0]?.body.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'probe_noop' })]))
  return { project, item, agent, commission, provider, connection, peer, modelRequestOffset: peer.requests.length, privateSentinel }
}

function admittedModelRequests(fixture: Fixture) {
  return fixture.peer.requests.slice(fixture.modelRequestOffset)
}

async function openWork(page: Page, fixture: Fixture) {
  await page.goto(`/projects/${encodeURIComponent(fixture.project.id)}/work/${encodeURIComponent(fixture.item.id)}`)
  await expect(page.getByRole('heading', { name: fixture.item.subGoal, exact: true })).toBeVisible({ timeout: ms(20_000) })
}

async function openWorkDoorFromProject(page: Page, fixture: Fixture) {
  await openSection(page, 'Open work')
  const backlog = page.locator('section.group\\/section').filter({
    has: page.locator('[data-section-title]', { hasText: /^Open work$/i }),
  })
  const door = backlog.getByRole('button', { name: fixture.item.subGoal, exact: true })
  await expect(door).toBeVisible()
  await door.click()
  await expect(page.getByRole('heading', { name: fixture.item.subGoal, exact: true })).toBeVisible()
}

async function returnToWorkFromProject(page: Page, fixture: Fixture) {
  await page.getByRole('main').getByRole('button', { name: fixture.project.name, exact: true }).click()
  await expect(page.getByRole('main').getByRole('heading', { name: fixture.project.name, exact: true })).toBeVisible()
  await openWorkDoorFromProject(page, fixture)
}

async function openProposal(page: Page, fixture: Fixture) {
  await page.getByRole('button', { name: 'Work this item now', exact: true }).click()
  const panel = page.locator('[data-work-item-mcp-proposal]')
  await expect(panel).toBeVisible()
  await panel.getByLabel('MCP tool', { exact: true }).selectOption({ label: `${fixture.connection.label} · ${TOOL}` })
  await panel.locator('[data-work-item-mcp-proposal-draft]').click()
  const helper = panel.locator('[data-contribution-mcp-draft-helper]')
  await expect(helper).toBeVisible()
  await helper.getByLabel('Commission and Agent', { exact: true }).selectOption(fixture.commission.id)
  await helper.getByLabel('Endpoint', { exact: true }).selectOption(fixture.provider.id)
  await helper.getByLabel('Model', { exact: true }).selectOption(MODEL_ID)
  return panel
}

async function startDraft(panel: ReturnType<Page['locator']>) {
  const start = panel.getByRole('button', { name: 'Draft arguments · uses budget', exact: true })
  await expect(start).toBeEnabled()
  await start.click()
  return start
}

async function reviewDraft(fixture: Fixture, panel: ReturnType<Page['locator']>, expectedTurns = 1) {
  await expect.poll(() => admittedModelRequests(fixture).length).toBe(expectedTurns)
  const helper = panel.locator('[data-contribution-mcp-draft-helper]')
  // The helper lists newest saved Dispatch first.
  const run = helper.locator('[data-contribution-mcp-draft-run]').first()
  await expect(run).toBeVisible({ timeout: ms(30_000) })
  await run.getByRole('button', { name: 'Review saved reply', exact: true }).click()
  const review = helper.locator('[data-contribution-mcp-draft-review]')
  await expect(review).toBeVisible()
  return { helper, run, review }
}

async function captureFive(page: Page, info: TestInfo, subject: ReturnType<Page['locator']>, stem: string, required?: ReturnType<Page['locator']>, companion?: ReturnType<Page['locator']>) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(subject).toBeVisible()
    await subject.scrollIntoViewIfNeeded()
    if (required) {
      await required.scrollIntoViewIfNeeded()
      await expect(required).toBeInViewport()
    }
    if (companion && viewport.width >= 768 && viewport.height >= 768) await expect(companion).toBeInViewport()
    const geometry = await subject.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const controls = [...element.querySelectorAll<HTMLElement>('button, input, select, textarea')]
        .filter((control) => control.getClientRects().length > 0)
        .map((control) => {
          const rect = control.getBoundingClientRect()
          return { width: rect.width, left: rect.left, right: rect.right }
        })
      return { width: element.clientWidth, scrollWidth: element.scrollWidth, left: box.left, right: box.right, controls }
    })
    expect(geometry.width, `${stem} has rendered width at ${viewport.width}`).toBeGreaterThan(0)
    expect(geometry.scrollWidth, `${stem} fits horizontally at ${viewport.width}`).toBeLessThanOrEqual(geometry.width)
    for (const control of geometry.controls) {
      expect(control.width, `${stem} controls remain reachable at ${viewport.width}`).toBeGreaterThan(0)
      expect(control.left, `${stem} control begins inside its panel`).toBeGreaterThanOrEqual(geometry.left - 1)
      expect(control.right, `${stem} control ends inside its panel`).toBeLessThanOrEqual(geometry.right + 1)
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${stem}-${viewport.width}x${viewport.height}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  await settleArtifactPageRail(page)
}

async function listContributions(page: Page, projectId: string): Promise<Contribution[]> {
  const result = await api(page, 'GET', `/projects/${projectId}/contributions`)
  expect(result.response.ok(), JSON.stringify(result.json)).toBe(true)
  return result.json as Contribution[]
}

async function listWork(page: Page, projectId: string): Promise<OpenSubGoal[]> {
  const result = await api(page, 'GET', `/projects/${projectId}/open-subgoals`)
  expect(result.response.ok(), JSON.stringify(result.json)).toBe(true)
  return result.json as OpenSubGoal[]
}

async function listDispatch(page: Page) {
  const result = await api(page, 'GET', '/dispatch')
  expect(result.response.ok(), JSON.stringify(result.json)).toBe(true)
  return result.json as import('../contract/index.ts').DispatchRun[]
}

test('Project owner reviews a commissioned MCP proposal, separately runs once, and resolves the work', async ({ page }, info) => {
  test.setTimeout(ms(180_000))
  const stack = await startMcpRouterStack()
  const mcp = await startMcpFixture({ toolName: TOOL })
  const cleanup = await proxyMcpApi(page, stack)
  try {
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const stamp = randomUUID().slice(0, 8)
    const modelReply = JSON.stringify({ toolName: TOOL, arguments: { query: `model suggestion ${stamp}` } })
    const fixture = await createFixture(page, stamp, mcp.url, modelReply)
    await openWork(page, fixture)
    const panel = await openProposal(page, fixture)
    const modelStart = panel.getByRole('button', { name: 'Draft arguments · uses budget', exact: true })
    await captureFive(page, info, panel, 'work-item-mcp-proposal-ready', modelStart)
    await startDraft(panel)
    await expect.poll(() => admittedModelRequests(fixture).length).toBe(1)
    const modelRequest = admittedModelRequests(fixture)[0]!.body
    expect(modelRequest.tools).toBeUndefined()
    expect(modelRequest.system).toContain(fixture.agent.systemPrompt)
    expect(modelRequest.system).toContain(fixture.agent.instructions)
    const promptText = JSON.stringify(modelRequest.messages)
    expect(promptText).toContain(fixture.project.name)
    expect(promptText).toContain(fixture.item.subGoal)
    expect(promptText).toContain(TOOL)
    // The user prompt carries the bounded schema body, not an implementation
    // wrapper key named `inputSchema`.
    expect(promptText).toContain('maxLength')
    expect(promptText).toContain('additionalProperties')
    expect(promptText).not.toContain(fixture.privateSentinel)
    expect(promptText).not.toContain(fixture.connection.id)
    expect(promptText).not.toContain(fixture.agent.instructions)
    expect(promptText).not.toContain(fixture.provider.id)
    expect(mcp.calls).toContain('tools/list')
    expect(mcp.calls).not.toContain('tools/call')
    expect(await listContributions(page, fixture.project.id)).toHaveLength(0)
    expect((await listWork(page, fixture.project.id)).find((item) => item.id === fixture.item.id)?.status).toBe('open')

    const { review } = await reviewDraft(fixture, panel)
    await expect(review.locator('[data-contribution-mcp-draft-reply]')).toHaveText(modelReply)
    const adopt = review.locator('[data-contribution-mcp-draft-adopt]')
    await expect(adopt).toBeEnabled()
    await captureFive(page, info, review, 'work-item-mcp-proposal-model-review', adopt)
    await adopt.click()
    await expect(panel.locator('[data-work-item-mcp-proposal-adopted]')).toContainText('Copied from the saved reply')
    await expect(panel.locator('[data-contribution-mcp-draft-helper]')).toHaveCount(0)

    const exactReview = panel.locator('[data-work-item-mcp-proposal-review]')
    const title = `Reviewed contribution ${stamp}`
    const summary = `One exact ${TOOL} call, independently approved and run by a person.`
    await exactReview.getByText('Contribution details', { exact: true }).click()
    await exactReview.getByLabel('Contribution title', { exact: true }).fill(title)
    await exactReview.getByLabel('Contribution summary', { exact: true }).fill(summary)
    const argumentsField = exactReview.locator('[data-work-item-mcp-proposal-arguments]')
    await expect(argumentsField).toHaveValue(JSON.stringify({ query: `model suggestion ${stamp}` }, null, 2))
    const editedArguments = { query: `owner-reviewed call ${stamp}` }
    await argumentsField.fill(JSON.stringify(editedArguments, null, 2))
    const publish = panel.locator('[data-work-item-mcp-proposal-publish]')
    await expect(publish).toBeEnabled()
    await captureFive(page, info, exactReview, 'work-item-mcp-proposal-edited-review', publish, argumentsField)
    expect(mcp.toolCalls).toHaveLength(0, 'a model draft and explicit publish do not call the MCP tool')
    await publish.click()

    const contributionHeading = page.getByRole('heading', { name: title, exact: true })
    await expect(contributionHeading).toBeVisible({ timeout: ms(30_000) })
    const contributions = await listContributions(page, fixture.project.id)
    expect(contributions).toHaveLength(1)
    const contribution = contributions[0]!
    expect(contribution).toMatchObject({ title, summary, subGoal: fixture.item.subGoal, workItemId: fixture.item.id, status: 'open' })
    expect(contribution.envelope).toMatchObject({
      version: 1, status: 'proposed',
      lines: [{ type: 'mcp.mutate', target: TOOL, cardinality: 1, harness: 'explicit-call', used: 0,
        mcp: { connectionLabel: fixture.connection.label, toolName: TOOL, arguments: editedArguments } }],
    })
    expect((await listWork(page, fixture.project.id)).find((item) => item.id === fixture.item.id)?.status).toBe('open')
    expect(mcp.toolCalls).toHaveLength(0)
    const proposedEnvelope = page.locator('[data-contribution-envelope-version="1"]')
    await expect(proposedEnvelope).toBeVisible()
    await captureFive(page, info, proposedEnvelope, 'work-item-mcp-proposal-published-unapproved')

    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await page.getByRole('button', { name: 'Review & run', exact: true }).click()
    const confirmation = page.getByRole('group', { name: 'Confirm one MCP effect run', exact: true })
    await expect(confirmation).toBeVisible()
    await expect(page.getByLabel(`Approved arguments for ${TOOL}`, { exact: true })).toContainText(editedArguments.query)
    expect(mcp.toolCalls).toHaveLength(0, 'approval is not execution; the exact-call confirmation is a separate act')
    await captureFive(page, info, confirmation, 'work-item-mcp-proposal-run-confirmation', confirmation.getByRole('button', { name: 'Confirm and run once', exact: true }))
    await confirmation.getByRole('button', { name: 'Confirm and run once', exact: true }).click()
    const receipt = page.locator('[data-contribution-effect-status="done"]')
    await expect(receipt).toContainText(editedArguments.query)
    expect(mcp.toolCalls).toEqual([{ name: TOOL, arguments: editedArguments }])
    const resolution = page.locator('[data-linked-work-item-resolution]')
    await expect(page.getByRole('button', { name: 'Land and resolve work', exact: true })).toBeEnabled()
    await captureFive(page, info, receipt, 'work-item-mcp-proposal-saved-result')
    await captureFive(page, info, resolution, 'work-item-mcp-proposal-ready-to-resolve', page.getByRole('button', { name: 'Land and resolve work', exact: true }))
    await page.getByRole('button', { name: 'Land and resolve work', exact: true }).click()
    await expect(page.getByRole('main').getByText(/Landed · L\d+/).first()).toBeVisible()
    const landed = await listContributions(page, fixture.project.id)
    expect(landed[0]).toMatchObject({ id: contribution.id, status: 'landed', workItemResolution: 'closed' })
    const completedItem = (await listWork(page, fixture.project.id)).find((item) => item.id === fixture.item.id)
    expect(completedItem).toMatchObject({ status: 'done', contributionResolution: { contributionId: contribution.id } })
    expect(mcp.toolCalls).toHaveLength(1, 'accepting the saved result does not repeat the tool call')

    await openWork(page, fixture)
    const linkedContributions = page.getByRole('main').getByRole('button', { name: /^Contributions\b/ })
    await expect(linkedContributions).toHaveAttribute('aria-expanded', 'true')
    const resolvedContribution = page.locator('[data-work-item-contribution] [data-resource-section="Contributions"] li')
      .filter({ hasText: 'Landed and resolved this work item' })
    await expect(resolvedContribution).toBeVisible()
    await captureFive(page, info, resolvedContribution, 'work-item-mcp-proposal-resolved')
    await assertWcag22Aa(page, 'Item-first commissioned Project work')
  } finally {
    await cleanup(); await mcp.close(); await stack.close()
  }
})

test('invalid model prose is not adopted and stale connection revisions cannot publish saved arguments', async ({ page }, info) => {
  test.setTimeout(ms(150_000))
  const stack = await startMcpRouterStack()
  const mcp = await startMcpFixture({ toolName: TOOL })
  const cleanup = await proxyMcpApi(page, stack)
  try {
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const stamp = randomUUID().slice(0, 8)
    const fixture = await createFixture(page, stamp, mcp.url, `This is prose, not JSON for ${TOOL}.`)
    await openWork(page, fixture)
    const panel = await openProposal(page, fixture)
    await startDraft(panel)
    const { helper, review } = await reviewDraft(fixture, panel, 1)
    await expect(review.locator('[data-contribution-mcp-draft-invalid]')).toBeVisible()
    await expect(review.locator('[data-contribution-mcp-draft-adopt]')).toHaveCount(0)
    const args = panel.locator('[data-work-item-mcp-proposal-arguments]')
    await expect(args).toHaveValue('{}')
    expect(await listContributions(page, fixture.project.id)).toHaveLength(0)
    expect(mcp.toolCalls).toHaveLength(0)
    await captureFive(page, info, helper, 'work-item-mcp-proposal-invalid-reply', review.locator('[data-contribution-mcp-draft-invalid]'))

    fixture.peer.reply = JSON.stringify({ toolName: TOOL, arguments: { query: `valid but stale ${stamp}` } })
    await startDraft(panel)
    const second = await reviewDraft(fixture, panel, 2)
    const adopt = second.review.locator('[data-contribution-mcp-draft-adopt]')
    await expect(adopt).toBeEnabled()
    const inspected = await api(page, 'POST', `/mcp-connections/${fixture.connection.id}/inspect`, {
      operationId: randomUUID(), expectedRevision: fixture.connection.revision,
    })
    expect(inspected.response.ok(), JSON.stringify(inspected.json)).toBe(true)
    await page.reload()
    await openWork(page, fixture)
    const refreshedPanel = await openProposal(page, fixture)
    const refreshedHelper = refreshedPanel.locator('[data-contribution-mcp-draft-helper]')
    const secondRun = refreshedHelper.locator('[data-contribution-mcp-draft-run]').first()
    await expect(secondRun).toBeVisible()
    await secondRun.getByRole('button', { name: 'Review saved reply', exact: true }).click()
    const refreshedReview = refreshedHelper.locator('[data-contribution-mcp-draft-review]')
    await expect(refreshedReview.locator('[data-contribution-mcp-draft-stale]')).toBeVisible()
    await expect(refreshedReview.locator('[data-contribution-mcp-draft-adopt]')).toBeDisabled()
    await expect(refreshedPanel.locator('[data-work-item-mcp-proposal-arguments]')).toHaveValue('{}')
    // The stale Dispatch reply cannot be adopted. A person may still author
    // fresh arguments manually, so the publish control is not the stale gate.
    expect(await listContributions(page, fixture.project.id)).toHaveLength(0)
    expect(mcp.toolCalls).toHaveLength(0)
    await captureFive(page, info, refreshedPanel, 'work-item-mcp-proposal-stale-review', refreshedReview.locator('[data-contribution-mcp-draft-stale]'))

    const malformed = '{not-json'
    await refreshedPanel.locator('[data-work-item-mcp-proposal-arguments]').fill(malformed)
    await expect(refreshedPanel.locator('[data-work-item-mcp-proposal-invalid]')).toBeVisible()
    await expect(refreshedPanel.locator('[data-work-item-mcp-proposal-publish]')).toBeDisabled()
    await returnToWorkFromProject(page, fixture)
    const restoredStructured = page.locator('[data-work-item-mcp-proposal]')
    await expect(restoredStructured.locator('[data-work-item-mcp-proposal-arguments]')).toHaveValue(malformed)
    await expect(restoredStructured.locator('[data-work-item-mcp-proposal-invalid]')).toBeVisible()
    await restoredStructured.locator('[data-work-item-mcp-proposal-cancel]').click()
    const manualStart = page.getByRole('button', { name: 'Start contribution', exact: true })
    await expect(manualStart).toBeEnabled()
    await manualStart.click()
    await expect(page.locator('[data-work-item-contribution-form]')).toBeVisible()
    await expect(page.locator('[data-work-item-contribution-submit]')).toBeEnabled()
    expect(await listContributions(page, fixture.project.id)).toHaveLength(0)
    await assertWcag22Aa(page, 'Invalid and stale Project-work MCP proposals')
  } finally {
    await cleanup(); await mcp.close(); await stack.close()
  }
})

test('held item-first model Dispatch restores its exact MCP helper across SPA navigation and retries once', async ({ page }, info) => {
  test.setTimeout(ms(150_000))
  const stack = await startMcpRouterStack()
  const mcp = await startMcpFixture({ toolName: TOOL })
  const cleanup = await proxyMcpApi(page, stack)
  const dispatchPosts: Array<{ key: string; body: unknown }> = []
  let loseFirstAck = true
  let exposeDispatchFeed = false
  try {
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const stamp = randomUUID().slice(0, 8)
    const modelReply = JSON.stringify({ toolName: TOOL, arguments: { query: `held model reply ${stamp}` } })
    const fixture = await createFixture(page, stamp, mcp.url, modelReply)
    await openWork(page, fixture)
    const panel = await openProposal(page, fixture)
    const helper = panel.locator('[data-contribution-mcp-draft-helper]')
    const start = helper.getByRole('button', { name: 'Draft arguments · uses budget', exact: true })

    // The isolated real router creates a real Dispatch/session/model turn, but
    // this one browser acknowledgement is deliberately lost.
    await page.route('**/api/v1/dispatch', async (route) => {
      const request = route.request()
      const method = request.method()
      if (method === 'GET' && !exposeDispatchFeed) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        return
      }
      if (method !== 'GET' && method !== 'POST') {
        await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: { code: 'method_not_allowed' } }) })
        return
      }
      if (method === 'POST') dispatchPosts.push({ key: request.headers()['idempotency-key'] ?? '', body: request.postDataJSON() })
      const url = new URL(request.url())
      const { origin: _origin, host: _host, ...headers } = request.headers()
      const response = await route.fetch({ url: `${stack.url}${url.pathname}${url.search}`, headers })
      const responseBody = await response.body()
      expect(response.ok(), responseBody.toString('utf8')).toBe(true)
      if (method === 'POST' && loseFirstAck) {
        loseFirstAck = false
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Dispatch acknowledgement was lost.' } }) })
        return
      }
      await route.fulfill({ status: response.status(), headers: response.headers(), body: responseBody })
    })

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
    expect(admittedModelRequests(fixture)[0]?.body.tools).toBeUndefined()
    expect(mcp.toolCalls).toHaveLength(0)
    expect(await listContributions(page, fixture.project.id)).toHaveLength(0)
    await captureFive(page, info, helper, 'work-item-mcp-proposal-held-dispatch', helper.locator('[data-contribution-mcp-draft-start]'))

    // Remount the item page through real SPA navigation. The held source must
    // restore the MCP argument helper, not the unrelated prose-response form.
    await returnToWorkFromProject(page, fixture)
    const returnedPanel = page.locator('[data-work-item-mcp-proposal]')
    const returnedHelper = returnedPanel.locator('[data-contribution-mcp-draft-helper]')
    await expect(returnedHelper).toBeVisible()
    const heldTool = returnedPanel.locator('[data-work-item-mcp-proposal-tool]')
    await expect(heldTool).toBeDisabled()
    await expect(heldTool).toHaveValue(`${fixture.connection.id}\0${fixture.connection.revision}\0${TOOL}`)
    await expect(returnedHelper.getByLabel('Commission and Agent', { exact: true })).toHaveValue(fixture.commission.id)
    await expect(returnedHelper.getByLabel('Endpoint', { exact: true })).toHaveValue(fixture.provider.id)
    await expect(returnedHelper.getByLabel('Model', { exact: true })).toHaveValue(MODEL_ID)
    await expect(returnedHelper.locator('[data-contribution-mcp-draft-start]')).toBeDisabled()
    await returnedPanel.getByText('Contribution details', { exact: true }).click()
    const heldTitle = returnedPanel.getByLabel('Contribution title', { exact: true })
    const heldSummary = returnedPanel.getByLabel('Contribution summary', { exact: true })
    const heldArguments = returnedPanel.getByLabel('MCP arguments', { exact: true })
    await expect(heldTitle).toBeDisabled()
    await expect(heldSummary).toBeDisabled()
    await expect(heldArguments).toBeDisabled()
    await expect(page.locator('[data-project-work-draft]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Draft a response', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('[data-dispatch-creation="failed"]')).toBeVisible()
    await captureFive(page, info, returnedHelper, 'work-item-mcp-proposal-held-helper-restored', returnedHelper.locator('[data-contribution-mcp-draft-start]'))

    exposeDispatchFeed = true
    await page.locator('[data-dispatch-creation="failed"]').getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.locator('[data-dispatch-creation="failed"]')).toHaveCount(0)
    await expect(heldTitle).toBeEnabled()
    await expect(heldSummary).toBeEnabled()
    await expect(heldArguments).toBeEnabled()
    expect(dispatchPosts).toHaveLength(2)
    expect(dispatchPosts[1]?.key).toBe(dispatchPosts[0]?.key)
    expect(dispatchPosts[1]?.body).toEqual(dispatchPosts[0]?.body)
    expect(admittedModelRequests(fixture)).toHaveLength(1, 'retry recovers the already-created Dispatch instead of starting another model turn')
    await expect(returnedHelper.locator('[data-contribution-mcp-draft-run]')).toBeVisible({ timeout: ms(30_000) })
    const savedRun = (await listDispatch(page)).find((run) =>
      run.execution?.projectWork?.itemId === fixture.item.id && run.execution?.mcpProposal?.toolName === TOOL)
    expect(savedRun).toBeTruthy()
    const savedSession = await api(page, 'GET', `/sessions/${encodeURIComponent(savedRun!.execution!.sessionId!)}`)
    expect(savedSession.response.ok()).toBe(true)
    expect(savedSession.json.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', content: modelReply }),
    ]))
    expect(mcp.calls).toContain('tools/list')
    expect(mcp.calls).not.toContain('tools/call')
    expect(mcp.toolCalls).toHaveLength(0)
    expect(await listContributions(page, fixture.project.id)).toHaveLength(0)
    const savedRunRow = returnedHelper.locator('[data-contribution-mcp-draft-run]').first()
    await captureFive(page, info, returnedHelper, 'work-item-mcp-proposal-held-dispatch-recovered', savedRunRow)
    await assertWcag22Aa(page, 'Recovered held item-first MCP argument draft')
  } finally {
    await cleanup(); await mcp.close(); await stack.close()
  }
})

test('lost publication acknowledgement recovers the exact reviewed payload across SPA navigation once', async ({ page }, info) => {
  test.setTimeout(ms(150_000))
  const stack = await startMcpRouterStack()
  const mcp = await startMcpFixture({ toolName: TOOL })
  const cleanup = await proxyMcpApi(page, stack)
  let publishRequests: Array<{ key: string; body: unknown }> = []
  try {
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const stamp = randomUUID().slice(0, 8)
    const fixture = await createFixture(page, stamp, mcp.url, JSON.stringify({ toolName: TOOL, arguments: { query: `held model draft ${stamp}` } }))
    await openWork(page, fixture)
    const panel = await openProposal(page, fixture)
    await startDraft(panel)
    const { review } = await reviewDraft(fixture, panel)
    await review.locator('[data-contribution-mcp-draft-adopt]').click()
    const exactReview = panel.locator('[data-work-item-mcp-proposal-review]')
    await exactReview.getByText('Contribution details', { exact: true }).click()
    const title = `Held proposal ${stamp}`
    const summary = `This exact reviewed proposal survives an uncertain acknowledgement. ${stamp}`
    await exactReview.getByLabel('Contribution title', { exact: true }).fill(title)
    await exactReview.getByLabel('Contribution summary', { exact: true }).fill(summary)
    const editedArguments = { query: `held owner-reviewed args ${stamp}` }
    const args = exactReview.locator('[data-work-item-mcp-proposal-arguments]')
    await args.fill(JSON.stringify(editedArguments, null, 2))

    let hideContributionReads = false
    publishRequests = []
    let lostFirstAck = true
    await page.route(`**/api/v1/projects/${fixture.project.id}/contributions`, async (route) => {
      const request = route.request()
      if (request.method() === 'GET') {
        if (hideContributionReads) await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
        else await route.fallback()
        return
      }
      if (request.method() !== 'POST') { await route.fallback(); return }
      const body = request.postDataJSON()
      const key = request.headers()['idempotency-key'] ?? ''
      publishRequests.push({ key, body })
      if (publishRequests.length > 1) {
        expect(body).toEqual(publishRequests[0]?.body)
        expect(key).toBe(publishRequests[0]?.key)
      }
      const url = new URL(request.url())
      const { origin: _origin, host: _host, ...headers } = request.headers()
      const response = await route.fetch({ url: `${stack.url}${url.pathname}${url.search}`, headers })
      const responseBody = await response.body()
      expect(response.ok(), responseBody.toString('utf8')).toBe(true)
      if (lostFirstAck) {
        lostFirstAck = false
        hideContributionReads = true
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Contribution acknowledgement was lost.' } }) })
        return
      }
      hideContributionReads = false
      await route.fulfill({ status: response.status(), headers: response.headers(), body: responseBody })
    })

    await panel.locator('[data-work-item-mcp-proposal-publish]').click()
    const notice = page.locator('[data-revisioned-mutation="contribution-create"][data-contribution-creation="failed"]')
    await expect(notice).toBeVisible()
    await expect(notice.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    const heldPanel = page.locator('[data-work-item-mcp-proposal]')
    await expect(heldPanel.getByLabel('MCP tool', { exact: true })).toBeDisabled()
    await expect(heldPanel.getByLabel('MCP arguments', { exact: true })).toHaveValue(JSON.stringify(editedArguments, null, 2))
    await expect(heldPanel.getByLabel('Contribution title', { exact: true })).toHaveValue(title)
    await expect(heldPanel.getByLabel('Contribution summary', { exact: true })).toHaveValue(summary)
    expect(publishRequests).toHaveLength(1)
    expect(publishRequests[0]?.key).not.toBe('')
    expect(publishRequests[0]?.body).toMatchObject({
      title, summary, workItemId: fixture.item.id,
      initialMcpProposal: { connectionId: fixture.connection.id, connectionRevision: fixture.connection.revision, toolName: TOOL, arguments: editedArguments },
    })
    expect(admittedModelRequests(fixture)).toHaveLength(1)
    expect(mcp.toolCalls).toHaveLength(0)
    await captureFive(page, info, heldPanel, 'work-item-mcp-proposal-held-exact-payload', notice.getByRole('button', { name: 'Retry', exact: true }))

    // Real SPA departure/remount preserves controller intent and locally held proposal fields.
    await returnToWorkFromProject(page, fixture)
    const returnedPanel = page.locator('[data-work-item-mcp-proposal]')
    await expect(returnedPanel).toBeVisible()
    await expect(returnedPanel.getByLabel('MCP tool', { exact: true })).toBeDisabled()
    await expect(returnedPanel.getByLabel('MCP arguments', { exact: true })).toHaveValue(JSON.stringify(editedArguments, null, 2))
    await returnedPanel.getByText('Contribution details', { exact: true }).click()
    await expect(returnedPanel.getByLabel('Contribution title', { exact: true })).toHaveValue(title)
    await expect(returnedPanel.getByLabel('Contribution summary', { exact: true })).toHaveValue(summary)
    await expect(page.locator('[data-revisioned-mutation="contribution-create"][data-contribution-creation="failed"]')).toBeVisible()
    await captureFive(page, info, returnedPanel, 'work-item-mcp-proposal-recovered-held-payload')

    // Settle the shared intent while the item page is unmounted. The app must
    // not surprise-navigate; returning to the item offers the exact saved door.
    await page.getByRole('main').getByRole('button', { name: fixture.project.name, exact: true }).click()
    await expect(page.getByRole('main').getByRole('heading', { name: fixture.project.name, exact: true })).toBeVisible()
    hideContributionReads = false
    await page.locator('[data-revisioned-mutation="contribution-create"][data-contribution-creation="failed"]')
      .getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.locator('[data-revisioned-mutation="contribution-create"][data-contribution-creation="failed"]')).toHaveCount(0)
    await expect(page.getByRole('main').getByRole('heading', { name: fixture.project.name, exact: true })).toBeVisible()
    expect(publishRequests).toHaveLength(2)
    expect(publishRequests[1]?.key).toBe(publishRequests[0]?.key)
    expect(publishRequests[1]?.body).toEqual(publishRequests[0]?.body)
    expect(admittedModelRequests(fixture)).toHaveLength(1, 'retry replays the saved contribution; it does not call the model again')
    expect(mcp.toolCalls).toHaveLength(0, 'publishing only records an unapproved plan')
    const published = await listContributions(page, fixture.project.id)
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({ title, summary, workItemId: fixture.item.id,
      envelope: { version: 1, status: 'proposed', lines: [{ type: 'mcp.mutate', target: TOOL, mcp: { arguments: editedArguments } }] } })
    await openWorkDoorFromProject(page, fixture)
    const appliedReceipt = page.locator('[data-work-item-mcp-proposal-applied]')
    await expect(appliedReceipt).toBeVisible({ timeout: ms(20_000) })
    await appliedReceipt.getByRole('button', { name: 'Open saved Contribution', exact: true }).click()
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await page.unroute(`**/api/v1/projects/${fixture.project.id}/contributions`)
    await assertWcag22Aa(page, 'Recovered item-first Contribution proposal')
  } finally {
    await cleanup(); await mcp.close(); await stack.close()
  }
})

test('shared Project readers see the published exact plan but not the owner Dispatch draft; foreign account remains walled', async ({ page, browser }, info) => {
  test.setTimeout(ms(180_000))
  const stack = await startMcpRouterStack()
  const mcp = await startMcpFixture({ toolName: TOOL })
  const cleanup = await proxyMcpApi(page, stack)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const readerCleanup = await proxyMcpApi(reader.page, stack)
  const foreignCleanup = await proxyMcpApi(foreign.page, stack)
  try {
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const stamp = randomUUID().slice(0, 8)
    const privateReply = JSON.stringify({ toolName: TOOL, arguments: { query: `workspace-private reply ${stamp}` } })
    const fixture = await createFixture(page, stamp, mcp.url, privateReply)
    const shared = await api(page, 'POST', '/relations/ops', { op: {
      kind: 'share-project', projectId: fixture.project.id, projectName: fixture.project.name, shared: true,
    } })
    expect(shared.response.ok(), JSON.stringify(shared.json)).toBe(true)
    await openWork(page, fixture)
    const panel = await openProposal(page, fixture)
    await startDraft(panel)
    const { review } = await reviewDraft(fixture, panel)
    await review.locator('[data-contribution-mcp-draft-adopt]').click()
    const exactReview = panel.locator('[data-work-item-mcp-proposal-review]')
    await exactReview.getByText('Contribution details', { exact: true }).click()
    const title = `Shared reviewed plan ${stamp}`
    const summary = `The published call is visible to Project readers; private Dispatch history is not. ${stamp}`
    await exactReview.getByLabel('Contribution title', { exact: true }).fill(title)
    await exactReview.getByLabel('Contribution summary', { exact: true }).fill(summary)
    const publishedArguments = { query: `shared approved result intent ${stamp}` }
    await exactReview.locator('[data-work-item-mcp-proposal-arguments]').fill(JSON.stringify(publishedArguments, null, 2))
    await panel.locator('[data-work-item-mcp-proposal-publish]').click()
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: ms(30_000) })
    const contribution = (await listContributions(page, fixture.project.id))[0]!
    const ownerRuns = await listDispatch(page)
    const ownerRun = ownerRuns.find((run) => run.execution?.projectWork?.itemId === fixture.item.id && run.execution.mcpProposal?.toolName === TOOL)
    expect(ownerRun).toBeTruthy()
    expect(admittedModelRequests(fixture)).toHaveLength(1)
    expect(mcp.toolCalls).toHaveLength(0)

    await reader.page.goto(`/projects/${encodeURIComponent(fixture.project.id)}/changes/${encodeURIComponent(contribution.id)}`)
    await expect(reader.page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(reader.page.getByText(publishedArguments.query, { exact: false })).toBeVisible()
    await expect(reader.page.locator('[data-work-item-mcp-proposal]')).toHaveCount(0)
    await expect(reader.page.locator('[data-contribution-mcp-draft-helper]')).toHaveCount(0)
    await expect(reader.page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
    await expect(reader.page.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
    const readerRuns = await listDispatch(reader.page)
    expect(readerRuns.some((run) => run.id === ownerRun!.id)).toBe(false)
    expect(JSON.stringify(readerRuns)).not.toContain(privateReply)
    expect(JSON.stringify(readerRuns)).not.toContain(ownerRun!.title)
    await captureFive(reader.page, info, reader.page.getByRole('main').locator('[data-resource-page]'), 'work-item-mcp-proposal-shared-reader')

    // `shared: true` intentionally grants shared-everyone visibility. After
    // proving that public reader face, return the Project to private before
    // verifying the unrelated tenant cannot read it.
    const unshared = await api(page, 'POST', '/relations/ops', { op: {
      kind: 'share-project', projectId: fixture.project.id, projectName: fixture.project.name, shared: false,
    } })
    expect(unshared.response.ok(), JSON.stringify(unshared.json)).toBe(true)
    await foreign.page.goto(`/projects/${encodeURIComponent(fixture.project.id)}/work/${encodeURIComponent(fixture.item.id)}`)
    const wall = foreign.page.getByText('This project isn’t visible from this account (or no longer exists).', { exact: true })
    await expect(wall).toBeVisible()
    await expect(foreign.page.getByRole('main')).not.toContainText(title)
    await expect(foreign.page.getByRole('main')).not.toContainText(publishedArguments.query)
    await captureFive(foreign.page, info, foreign.page.getByRole('main'), 'work-item-mcp-proposal-foreign-wall', wall)
    await assertWcag22Aa(reader.page, 'Shared Project Contribution proposal')
  } finally {
    await cleanup(); await readerCleanup(); await foreignCleanup()
    await reader.context.close(); await foreign.context.close(); await mcp.close(); await stack.close()
  }
})

