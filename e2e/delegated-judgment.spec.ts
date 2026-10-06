/** Rendered owner-started, tool-free Delegation judgment and recovery. */
import { createServer, type Server } from 'node:http'
import { test, expect, type Page, type Browser, type TestInfo } from '@playwright/test'
import type {
  Agent,
  Contribution,
  ContributionReviewerBinding,
  CreateProjectResponse,
  Delegation,
  Identity,
  ModelProvider,
  Project,
  SystemPromptEntry,
} from '../contract/index.ts'
import { delegatedJudgmentId } from '../server/delegatedJudgmentIdentity.ts'
import { ms } from './budget.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { newUser } from './social-helpers.ts'

type FixtureOutcome = 'approve' | 'uncertain' | 'pause'
interface JudgmentWireRequest {
  body: Record<string, any>
  release?: () => void
}
interface JudgmentFixture {
  server: Server
  baseURL: string
  requests: JudgmentWireRequest[]
  release(index: number): void
  close(): Promise<void>
}
interface Arena {
  project: Project
  tenantId: string
  agent: Agent
  provider: ModelProvider
  binding: ContributionReviewerBinding
  fixture: JudgmentFixture
}
interface Subject extends Arena {
  contribution: Contribution
  landDraft: Delegation
  approveDecide: Delegation
}

const API = '/api/v1'
const FIRST_JUDGMENT_SUMMARY = 'The frozen note is consistent with the written policy.'
const viewports = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]
const activeFixtures = new Set<JudgmentFixture>()
test.afterEach(async () => {
  await Promise.all([...activeFixtures].map((fixture) => fixture.close()))
})

async function startJudgmentFixture(outcomes: FixtureOutcome[] = []): Promise<JudgmentFixture> {
  const requests: JudgmentWireRequest[] = []
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any> : {}
    if (req.method === 'GET' && (req.url ?? '').split('?')[0] === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'delegated-judgment-fixture-model', display_name: 'Judgment fixture model' }] }))
      return
    }
    if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== '/v1/messages') {
      res.writeHead(404).end()
      return
    }
    const content = body.messages?.at(-1)?.content
    let frozen: unknown
    if (typeof content === 'string') {
      try { frozen = JSON.parse(content) } catch { /* Provider probe uses plain text. */ }
    }
    const isJudgment = !!frozen && typeof frozen === 'object' &&
      Object.hasOwn(frozen, 'policy') && Object.hasOwn(frozen, 'risk')
    if (!isJudgment) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: 'msg-delegated-judgment-probe', type: 'message', role: 'assistant', model: body.model,
        content: [{ type: 'text', text: 'Judgment fixture endpoint is ready.' }], stop_reason: 'end_turn',
        stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      }))
      return
    }
    const record: JudgmentWireRequest = { body }
    requests.push(record)
    const outcome = outcomes[requests.length - 1] ?? 'approve'
    if (outcome === 'pause') await new Promise<void>((resolve) => { record.release = resolve })
    if (outcome === 'uncertain') {
      res.destroy()
      return
    }
    const summary = requests.length === 1
      ? FIRST_JUDGMENT_SUMMARY
      : `Fixture judgment ${requests.length} used only the frozen policy and read-only inputs.`
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: `msg-delegated-judgment-${requests.length}`,
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text: JSON.stringify({ decision: 'approve', summary }) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 137, output_tokens: 29 },
    }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  expect(address && typeof address === 'object').toBeTruthy()
  const result: JudgmentFixture = {
    server,
    baseURL: `http://127.0.0.1:${(address as { port: number }).port}`,
    requests,
    release(index) { requests[index]?.release?.() },
    close: async () => {
      if (!activeFixtures.has(result)) return
      activeFixtures.delete(result)
      for (const request of requests) request.release?.()
      server.closeAllConnections?.()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
  activeFixtures.add(result)
  return result
}

async function arena(page: Page, stamp: string, outcomes: FixtureOutcome[] = []): Promise<Arena> {
  const meResponse = await page.request.get(`${API}/me`)
  expect(meResponse.ok()).toBe(true)
  const tenantId = ((await meResponse.json()) as Identity).tenant.id
  const projectResponse = await page.request.post(`${API}/projects`, {
    data: { name: `Delegated judgment ${stamp}`, description: 'A test-owned owner judgment Project.' },
    headers: { 'Idempotency-Key': `delegated-judgment-project-${stamp}` },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  const fixture = await startJudgmentFixture(outcomes)
  const providerResponse = await page.request.post(`${API}/providers`, {
    data: {
      label: `Judgment endpoint ${stamp}`,
      modelFamily: 'claude',
      effortLevels: ['Low'],
      models: [{ id: 'delegated-judgment-fixture-model', label: 'Judgment fixture model' }],
      config: { baseURL: fixture.baseURL, model: 'delegated-judgment-fixture-model' },
    },
    headers: { 'Idempotency-Key': `delegated-judgment-provider-${stamp}` },
  })
  expect(providerResponse.ok()).toBe(true)
  const createdProvider = await providerResponse.json() as ModelProvider
  const promptsResponse = await page.request.get(`${API}/system-prompts`)
  expect(promptsResponse.ok()).toBe(true)
  const prompts = await promptsResponse.json() as SystemPromptEntry[]
  expect(prompts.length).toBeGreaterThan(0)
  const agentResponse = await page.request.post(`${API}/agents`, {
    data: {
      label: `Judgment Agent ${stamp}`,
      providerId: createdProvider.id,
      systemPromptId: prompts[0]!.id,
      tools: [],
      instructions: 'This Agent instruction is not delegated-model input.',
    },
    headers: { 'Idempotency-Key': `delegated-judgment-agent-${stamp}` },
  })
  expect(agentResponse.ok()).toBe(true)
  const agent = await agentResponse.json() as Agent
  const providers = await page.request.get(`${API}/providers`)
  expect(providers.ok()).toBe(true)
  const provider = (await providers.json() as ModelProvider[]).find((candidate) => candidate.id === createdProvider.id)!
  const agents = await page.request.get(`${API}/agents`)
  expect(agents.ok()).toBe(true)
  const currentAgent = (await agents.json() as Agent[]).find((candidate) => candidate.id === agent.id)!
  expect(provider.execution).toBe('configured')
  expect(provider.defaultModelId).toBe('delegated-judgment-fixture-model')
  const binding: ContributionReviewerBinding = {
    agentId: currentAgent.id,
    agentRevision: currentAgent.revision ?? 0,
    providerId: provider.id,
    providerRevision: provider.definitionRevision ?? 0,
    connectionRevision: provider.connectionRevision ?? 0,
  }
  return { project, tenantId, agent: currentAgent, provider, binding, fixture }
}

async function createDelegation(
  page: Page,
  context: Arena,
  actKind: 'land' | 'approve-envelope',
  mode: 'draft' | 'decide',
  stamp: string,
): Promise<Delegation> {
  const response = await page.request.post(`${API}/projects/${context.project.id}/delegations`, {
    data: {
      agentId: context.agent.id,
      actKind,
      policy: `Use only the reviewed frozen ${actKind} facts.`,
      escalation: ['effectful'],
      mode,
    },
    headers: { 'Idempotency-Key': `delegated-judgment-delegation-${stamp}` },
  })
  expect(response.ok()).toBe(true)
  return await response.json() as Delegation
}

async function createContribution(page: Page, project: Project, stamp: string): Promise<Contribution> {
  const response = await page.request.post(`${API}/projects/${project.id}/contributions`, {
    data: { title: `Judgment surface ${stamp}`, summary: 'The frozen changeset is the only work input.' },
    headers: { 'Idempotency-Key': `delegated-judgment-contribution-${stamp}` },
  })
  expect(response.ok()).toBe(true)
  const contribution = await response.json() as Contribution
  const crystallized = await page.request.post(`${API}/projects/${project.id}/contributions/${contribution.id}/changeset`, {
    data: { entries: [{ kind: 'note', target: `read-only note ${stamp}`, after: `Frozen change ${stamp}` }] },
    headers: { 'Idempotency-Key': `delegated-judgment-changeset-${stamp}` },
  })
  expect(crystallized.ok()).toBe(true)
  return await crystallized.json() as Contribution
}

async function subject(page: Page, stamp: string, outcomes: FixtureOutcome[] = []): Promise<Subject> {
  const context = await arena(page, stamp, outcomes)
  const contribution = await createContribution(page, context.project, stamp)
  const landDraft = await createDelegation(page, context, 'land', 'draft', `${stamp}-draft`)
  const approveDecide = await createDelegation(page, context, 'approve-envelope', 'decide', `${stamp}-decide`)
  return { ...context, contribution, landDraft, approveDecide }
}

async function openContribution(page: Page, context: Pick<Subject, 'project' | 'contribution'>) {
  await page.goto(`/projects/${encodeURIComponent(context.project.id)}/changes/${encodeURIComponent(context.contribution.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: context.contribution.title, exact: true }))
    .toBeVisible({ timeout: ms(20_000) })
  const panel = main.getByRole('region', { name: 'Delegated judgments', exact: true })
  await expect(panel).toBeVisible()
  return { main, panel }
}

async function runFor(panel: Awaited<ReturnType<typeof openContribution>>['panel'], delegation: Delegation) {
  const select = panel.getByRole('combobox', { name: 'Current Delegation', exact: true })
  await expect(select).toBeVisible()
  await select.selectOption(delegation.id)
  const run = panel.getByRole('button', { name: 'Run judgment · uses budget', exact: true })
  await expect(run).toBeEnabled()
  await run.click()
}

async function currentContribution(page: Page, context: Pick<Subject, 'project' | 'contribution'>): Promise<Contribution> {
  const response = await page.request.get(`${API}/projects/${context.project.id}/contributions`)
  expect(response.ok()).toBe(true)
  const rows = await response.json() as Contribution[]
  return rows.find((candidate) => candidate.id === context.contribution.id)!
}

async function scrollJudgmentCardIntoView(page: Page, panel: Awaited<ReturnType<typeof openContribution>>['panel'], card: import('@playwright/test').Locator) {
  await card.scrollIntoViewIfNeeded()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(panel).toBeInViewport()
  await expect(card).toBeInViewport()
  await expect.poll(() => card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
}

test('pre-commit failure holds the exact judgment across navigation and retries one model request', async ({ page }) => {
  test.setTimeout(ms(75_000))
  const context = await subject(page, `precommit-${Date.now().toString(36)}`, ['approve'])
  const endpoint = `**${API}/projects/${context.project.id}/contributions/${context.contribution.id}/delegated/${context.landDraft.id}`
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  let attempts = 0
  await page.route(endpoint, async (route) => {
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit outage.' } }) })
      return
    }
    await route.continue()
  })

  const { main, panel } = await openContribution(page, context)
  await runFor(panel, context.landDraft)
  const failed = page.locator('[data-delegated-judgment="failed"]')
  await expect(failed).toContainText('Couldn’t confirm what the delegate decided')
  await expect(panel.locator('[data-delegated-judgment-held]')).toBeVisible()
  await expect(main.getByRole('button', { name: 'Land', exact: true })).toBeDisabled()
  await expect(main.getByRole('textbox', { name: `Comment on ${context.contribution.title}` })).toBeEnabled()
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')

  await main.getByRole('button', { name: context.project.name, exact: true }).click()
  await expect(main.getByRole('heading', { name: context.project.name, exact: true })).toBeVisible()
  await expect(failed).toBeVisible()
  await main.getByRole('button', { name: context.contribution.title, exact: true }).first().click()
  await expect(main.getByRole('heading', { name: context.contribution.title, exact: true })).toBeVisible()
  await expect(page.locator('[data-delegated-judgment-held]')).toBeVisible()

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(page.locator('[data-delegated-judgment-status="draft"]')).toContainText('The frozen note is consistent')
  expect(attempts).toBe(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  expect(context.fixture.requests).toHaveLength(1, 'only the explicit retry reaches the configured local model endpoint')
  expect(context.fixture.requests[0]?.body.tools).toBeUndefined()
  expect(context.fixture.requests[0]?.body.messages).toHaveLength(1)
  const expectedId = delegatedJudgmentId(context.tenantId, context.project.id, context.contribution.id, context.landDraft.id, keys[0]!)
  const current = await currentContribution(page, context)
  expect(current.judgments?.filter((run) => run.id === expectedId)).toHaveLength(1)
  expect(current.events.filter((event) => event.id === expectedId)).toHaveLength(1)
  expect(current.events.find((event) => event.id === expectedId)?.kind).toBe('delegated-draft')
})

test('lost acknowledgement exact retry keeps key/body, applies once, and preserves later history after revocation', async ({ page }) => {
  test.setTimeout(ms(75_000))
  const context = await subject(page, `lost-${Date.now().toString(36)}`, ['approve'])
  const envelopeResponse = await page.request.post(`${API}/projects/${context.project.id}/contributions/${context.contribution.id}/envelope`, {
    data: { lines: [{ type: 'connector.read', target: 'release status' }] },
    headers: { 'Idempotency-Key': `delegated-judgment-envelope-${context.contribution.id}` },
  })
  expect(envelopeResponse.ok()).toBe(true)
  context.contribution = await envelopeResponse.json() as Contribution
  const staleLedger = [context.contribution]
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  let committed = false
  let allowFreshReads = false
  await page.route(`**${API}/projects/${context.project.id}/contributions**`, async (route) => {
    const request = route.request()
    if (request.method() === 'POST' && request.url().endsWith(`/delegated/${context.approveDecide.id}`)) {
      keys.push(request.headers()['idempotency-key'] ?? '')
      bodies.push(request.postDataJSON() as Record<string, unknown>)
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      committed = true
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Lost acknowledgement after commit.' } }) })
      return
    }
    if (committed && request.method() === 'GET' && request.url().endsWith('/contributions') && !allowFreshReads) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staleLedger) })
      return
    }
    await route.continue()
  })

  const { main, panel } = await openContribution(page, context)
  await runFor(panel, context.approveDecide)
  const failed = page.locator('[data-delegated-judgment="failed"]')
  await expect(failed).toContainText('Couldn’t confirm what the delegate decided')
  await expect(panel.locator('[data-delegated-judgment-held]')).toBeVisible()
  expect(keys).toHaveLength(1)
  expect(context.fixture.requests).toHaveLength(1)

  const revoked = await page.request.delete(`${API}/projects/${context.project.id}/delegations/${context.approveDecide.id}`)
  expect(revoked.ok()).toBe(true)
  const laterText = 'Later owner history stays after exact judgment replay.'
  const note = await page.request.post(`${API}/projects/${context.project.id}/contributions/${context.contribution.id}/comments`, {
    data: { body: laterText },
  })
  expect(note.ok()).toBe(true)
  allowFreshReads = true
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(main).toContainText(laterText)
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  expect(context.fixture.requests).toHaveLength(1, 'durable exact replay does not dispatch another provider call')

  const id = delegatedJudgmentId(context.tenantId, context.project.id, context.contribution.id, context.approveDecide.id, keys[0]!)
  const current = await currentContribution(page, context)
  expect(current.envelope?.status).toBe('approved')
  expect(current.judgments?.filter((run) => run.id === id)).toHaveLength(1)
  expect(current.events.filter((event) => event.id === id)).toHaveLength(1)
  expect(current.events.find((event) => event.id === id)).toMatchObject({ kind: 'delegated-decision', delegationRevision: 0 })
  expect(current.events.at(-1)?.body).toBe(laterText)
})

test('draft, decide, uncertainty and stale history stay visible while only owners see private explanations', async ({ page, browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const context = await subject(page, `states-${Date.now().toString(36)}`, ['approve', 'uncertain', 'pause', 'approve'])
  const { main, panel } = await openContribution(page, context)

  await panel.getByRole('combobox', { name: 'Current Delegation', exact: true }).selectOption(context.landDraft.id)
  const selectedPolicy = panel.locator('[data-delegated-judgment-preview]')
  await expect(selectedPolicy).toContainText('Policy: Use only the reviewed frozen land facts.')
  for (const viewport of [viewports[4]!, viewports[0]!]) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await scrollJudgmentCardIntoView(page, panel, selectedPolicy)
    await page.screenshot({ path: testInfo.outputPath(`delegated-judgment-selected-policy-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }
  await page.setViewportSize(viewports[4]!)
  await settleArtifactPageRail(page)

  await runFor(panel, context.landDraft)
  const draft = panel.locator('[data-delegated-judgment-status="draft"]')
  await expect(draft).toContainText(FIRST_JUDGMENT_SUMMARY)
  expect((await currentContribution(page, context)).status).toBe('open')
  expect((await currentContribution(page, context)).landingNumber).toBeUndefined()

  await runFor(panel, context.landDraft)
  await expect(panel.locator('[data-delegated-judgment-status="uncertain"]')).toContainText('Outcome uncertain')
  expect(context.fixture.requests).toHaveLength(2, 'uncertainty does not automatically retry')

  await runFor(panel, context.landDraft)
  const pending = panel.locator('[data-delegated-judgment-status="pending"]')
  await expect(pending).toBeVisible()
  await expect(panel.locator('[data-delegated-judgment-pending]')).toBeVisible()
  await expect.poll(() => context.fixture.requests.length).toBe(3)
  await page.setViewportSize(viewports[0]!)
  await settleArtifactPageRail(page)
  await scrollJudgmentCardIntoView(page, panel, pending)
  await page.screenshot({ path: testInfo.outputPath('delegated-judgment-pending-320x700.png'), fullPage: false })

  const movedSource = await page.request.post(`${API}/projects/${context.project.id}/contributions/${context.contribution.id}/changeset`, {
    data: { entries: [{ kind: 'note', target: 'stale after start', after: 'This changes while the provider is running.' }] },
    headers: { 'Idempotency-Key': `delegated-judgment-move-${context.contribution.id}` },
  })
  expect(movedSource.ok()).toBe(true)
  context.fixture.release(2)
  const stale = panel.locator('[data-delegated-judgment-status="stale"]')
  await expect(stale).toContainText('Stale judgment', { timeout: ms(20_000) })
  expect((await currentContribution(page, context)).status).toBe('open')

  const proposed = await page.request.post(`${API}/projects/${context.project.id}/contributions/${context.contribution.id}/envelope`, {
    data: { lines: [{ type: 'connector.read', target: 'release status' }] },
    headers: { 'Idempotency-Key': `delegated-judgment-decide-envelope-${context.contribution.id}` },
  })
  expect(proposed.ok()).toBe(true)
  await runFor(panel, context.approveDecide)
  const decided = panel.locator('[data-delegated-judgment-status="decided"]')
  await expect(decided).toContainText('Fixture judgment 4')
  const current = await currentContribution(page, context)
  expect(current.envelope?.status).toBe('approved', 'decide may apply only this read-only envelope')
  expect(current.status).toBe('open', 'approving a read-only envelope does not land the Contribution')
  await expect(panel.getByRole('combobox', { name: 'Current Delegation', exact: true })).toHaveValue('')
  await expect(panel.locator('[data-delegated-judgment-preview]')).toHaveCount(0)
  expect(context.fixture.requests).toHaveLength(4)
  expect(context.fixture.requests.every((entry) => entry.body.tools === undefined)).toBe(true)
  expect(context.fixture.requests.every((entry) => entry.body.messages.length === 1)).toBe(true)
  await expect(draft).toContainText(FIRST_JUDGMENT_SUMMARY)
  await expect(panel.locator('[data-delegated-judgment-status="uncertain"]')).toBeVisible()
  await expect(stale).toBeVisible()

  // The stable final history contains draft advice, uncertain transport, stale
  // source movement, and a successful read-only decide. Capture the real rendered
  // projection at every supported product viewport tier.
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(draft).toBeVisible()
    await expect(draft).toContainText(FIRST_JUDGMENT_SUMMARY)
    await expect(panel.locator('[data-delegated-judgment-status="uncertain"]')).toBeVisible()
    await expect(stale).toBeVisible()
    await scrollJudgmentCardIntoView(page, panel, draft)
    await page.screenshot({ path: testInfo.outputPath(`delegated-judgment-history-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }

  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  try {
    const hidden = await foreign.page.request.get(`${API}/projects/${encodeURIComponent(context.project.id)}/contributions`)
    expect(hidden.status()).toBe(404, 'a foreign tenant cannot enumerate the private Contribution ledger')
  } finally {
    await foreign.context.close()
  }

  const shared = await page.request.post(`${API}/relations/ops`, {
    data: { op: { kind: 'share-project', projectId: context.project.id, projectName: context.project.name, shared: true } },
  })
  expect(shared.ok()).toBe(true)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  try {
    await reader.page.goto(`/projects/${encodeURIComponent(context.project.id)}/changes/${encodeURIComponent(context.contribution.id)}`)
    const readerPanel = reader.page.getByRole('region', { name: 'Delegated judgments', exact: true })
    for (const viewport of viewports) {
      await reader.page.setViewportSize(viewport)
      await settleArtifactPageRail(reader.page)
      await expect(readerPanel.locator('[data-delegated-judgment-status="draft"]')).toBeVisible({ timeout: ms(20_000) })
      await expect(readerPanel.locator('[data-delegated-judgment-status="decided"]')).toBeVisible()
      await expect(readerPanel).not.toContainText(FIRST_JUDGMENT_SUMMARY)
      await expect(readerPanel).not.toContainText('Fixture judgment 4')
      await expect(readerPanel.getByRole('button', { name: 'Run judgment · uses budget', exact: true })).toHaveCount(0)
      const decidedCard = readerPanel.locator('[data-delegated-judgment-status="decided"]')
      await scrollJudgmentCardIntoView(reader.page, readerPanel, decidedCard)
      await reader.page.screenshot({ path: testInfo.outputPath(`delegated-judgment-shared-history-${viewport.width}x${viewport.height}.png`), fullPage: false })
    }
  } finally {
    await reader.context.close()
  }

})
