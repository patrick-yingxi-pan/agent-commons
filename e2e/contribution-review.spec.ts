/** Rendered owner-selected model review, public results, and held recovery. */
import { createServer, type Server } from 'node:http'
import { test, expect, type Page } from '@playwright/test'
import type {
  Agent,
  Contribution,
  ContributionReviewRun,
  ContributionReviewerBinding,
  CreateProjectResponse,
  Identity,
  ModelProvider,
  Project,
  SystemPromptEntry,
} from '../contract/index.ts'
import { contributionReviewId } from '../server/contributionReviewIdentity.ts'
import { ms } from './budget.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

interface Arena {
  project: Project
  contribution: Contribution
  tenantId: string
}

interface ReviewerSetup {
  agent: Agent
  provider: ModelProvider
  binding: ContributionReviewerBinding
  fixture: ReviewFixture
}

interface ReviewFixture {
  server: Server
  baseURL: string
  requests: Array<Record<string, any>>
  close: () => Promise<void>
}

const activeReviewFixtures = new Set<ReviewFixture>()
test.afterEach(async () => {
  await Promise.all([...activeReviewFixtures].map((fixture) => fixture.close()))
})

async function startReviewFixture(mode: 'passed' | 'findings' | 'uncertain' = 'passed'): Promise<ReviewFixture> {
  const requests: Array<Record<string, any>> = []
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    if (req.method === 'GET' && (req.url ?? '').split('?')[0] === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'review-fixture-model', display_name: 'Review fixture model' }] }))
      return
    }
    if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== '/v1/messages') {
      res.writeHead(404).end()
      return
    }
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any> : {}
    const content = body.messages?.at(-1)?.content
    let input: { version?: number; entries?: Array<{ id: string }> } | undefined
    if (typeof content === 'string') {
      try {
        const candidate = JSON.parse(content) as { version?: number; entries?: Array<{ id: string }> }
        if (Number.isSafeInteger(candidate.version) && Array.isArray(candidate.entries)) input = candidate
      } catch {
        // Provider registration probes use plain text; only the frozen review
        // payload has the version + entry shape below.
      }
    }
    if (!input) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: 'msg-review-provider-probe', type: 'message', role: 'assistant', model: 'review-fixture-model',
        content: [{ type: 'text', text: 'Review fixture endpoint is ready.' }], stop_reason: 'end_turn',
        stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      }))
      return
    }
    requests.push({ body, headers: req.headers, method: req.method, url: req.url })
    if (mode === 'uncertain') {
      res.destroy()
      return
    }
    const findings = mode === 'findings' && input.entries?.[0]
      ? [{ entryId: input.entries[0].id, body: `Review fixture found a concrete issue. ${'unbrokenreviewresult'.repeat(12)}` }]
      : []
    const review = {
      summary: mode === 'findings' ? 'The fixture returned one finding.' : 'No actionable defect found by the fixture.',
      findings,
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: `msg-contribution-review-${requests.length}`,
      type: 'message',
      role: 'assistant',
      model: 'review-fixture-model',
      content: [{ type: 'text', text: JSON.stringify(review) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 137, output_tokens: 29 },
    }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  expect(address && typeof address === 'object').toBeTruthy()
  const baseURL = `http://127.0.0.1:${(address as { port: number }).port}`
  const result: ReviewFixture = {
    server,
    baseURL,
    requests,
    close: async () => {
      if (!activeReviewFixtures.has(result)) return
      activeReviewFixtures.delete(result)
      server.closeAllConnections?.()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
  activeReviewFixtures.add(result)
  return result
}

async function arena(page: Page, stamp: string, shared = false): Promise<Arena> {
  const meResponse = await page.request.get('/api/v1/me')
  expect(meResponse.ok()).toBe(true)
  const tenantId = ((await meResponse.json()) as Identity).tenant.id
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: `Contribution review ${stamp}`, description: 'A test-owned model-review Project.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  if (shared) {
    const shareResponse = await page.request.post('/api/v1/relations/ops', {
      data: { op: { kind: 'share-project', projectId: project.id, projectName: project.name, shared: true } },
    })
    expect(shareResponse.ok()).toBe(true)
  }
  const contributionResponse = await page.request.post(`/api/v1/projects/${project.id}/contributions`, {
    data: { title: `Review exactly once ${stamp}`, summary: 'The visible changeset is the review surface.' },
    headers: { 'Idempotency-Key': `contribution-${stamp}` },
  })
  expect(contributionResponse.ok()).toBe(true)
  const contribution = await contributionResponse.json() as Contribution
  const changesetResponse = await page.request.post(
    `/api/v1/projects/${project.id}/contributions/${contribution.id}/changeset`,
    { data: { entries: [{ kind: 'note', target: 'review surface', after: `v1 ${stamp}` }] } },
  )
  expect(changesetResponse.ok()).toBe(true)
  return { project, contribution: await changesetResponse.json() as Contribution, tenantId }
}

async function reviewerSetup(page: Page, stamp: string, mode: 'passed' | 'findings' | 'uncertain' = 'passed'): Promise<ReviewerSetup> {
  const fixture = await startReviewFixture(mode)
  const providerLabel = `Review endpoint ${stamp} ${'providersegment'.repeat(4)}`
  const agentLabel = `Model reviewer ${stamp} ${'reviewerlabel'.repeat(4)}`
  const providerResponse = await page.request.post('/api/v1/providers', {
    data: {
      label: providerLabel,
      modelFamily: 'claude',
      effortLevels: ['Low'],
      models: [{ id: 'review-fixture-model', label: 'Review fixture model' }],
      config: { baseURL: fixture.baseURL, model: 'review-fixture-model' },
    },
    headers: { 'Idempotency-Key': `review-provider-${stamp}` },
  })
  expect(providerResponse.ok()).toBe(true)
  const createdProvider = await providerResponse.json() as ModelProvider
  const promptsResponse = await page.request.get('/api/v1/system-prompts')
  expect(promptsResponse.ok()).toBe(true)
  const prompts = await promptsResponse.json() as SystemPromptEntry[]
  expect(prompts.length).toBeGreaterThan(0)
  const agentResponse = await page.request.post('/api/v1/agents', {
    data: {
      label: agentLabel,
      providerId: createdProvider.id,
      systemPromptId: prompts[0]!.id,
      tools: [],
      instructions: 'Review the frozen changeset and return only the requested JSON result.',
    },
    headers: { 'Idempotency-Key': `review-agent-${stamp}` },
  })
  expect(agentResponse.ok()).toBe(true)
  const agent = await agentResponse.json() as Agent
  const providers = await (await page.request.get('/api/v1/providers')).json() as ModelProvider[]
  const provider = providers.find((candidate) => candidate.id === createdProvider.id)!
  const agents = await (await page.request.get('/api/v1/agents')).json() as Agent[]
  const projectedAgent = agents.find((candidate) => candidate.id === agent.id)!
  expect(provider.execution).toBe('configured')
  expect(provider.defaultModelId).toBe('review-fixture-model')
  expect(projectedAgent.providerId).toBe(provider.id)
  const binding: ContributionReviewerBinding = {
    agentId: projectedAgent.id,
    agentRevision: projectedAgent.revision ?? 0,
    providerId: provider.id,
    providerRevision: provider.definitionRevision ?? 0,
    connectionRevision: provider.connectionRevision ?? 0,
  }
  return { agent: projectedAgent, provider, binding, fixture }
}

async function openContribution(page: Page, context: Arena) {
  await page.goto(`/projects/${encodeURIComponent(context.project.id)}/changes/${encodeURIComponent(context.contribution.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: context.contribution.title, exact: true }))
    .toBeVisible({ timeout: ms(20_000) })
  return main
}

async function currentContribution(page: Page, context: Arena): Promise<Contribution> {
  const response = await page.request.get(`/api/v1/projects/${context.project.id}/contributions`)
  expect(response.ok()).toBe(true)
  const rows = await response.json() as Contribution[]
  return rows.find((candidate) => candidate.id === context.contribution.id)!
}

async function selectReviewer(main: Awaited<ReturnType<typeof openContribution>>, reviewer: Agent) {
  await main.getByRole('combobox', { name: 'Reviewing Agent' }).selectOption(reviewer.id)
}

async function scrollReviewIntoView(page: Page, main: Awaited<ReturnType<typeof openContribution>>) {
  const panel = main.locator('[aria-label="Model reviews"]')
  await panel.scrollIntoViewIfNeeded()
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  await expect(panel).toBeInViewport()
  await expect.poll(() => panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect.poll(() => panel.locator('[data-review-status]').evaluateAll((cards) =>
    cards.every((card) => card.scrollWidth <= card.clientWidth),
  )).toBe(true)
}

test('review controls wait for the panel and mutation runtime, then recover only through full reload', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
  const reviewer = await reviewerSetup(page, stamp)
  let runtimeRequestFailed = false
  const runtimeModule = '**/src/controller/contributionReviewMutationRuntime.ts*'
  await page.route(runtimeModule, async (route) => {
    runtimeRequestFailed = true
    await route.abort('failed')
  })

  const main = await openContribution(page, context)
  const failure = main.locator('[data-contribution-review-load="error"]')
  await expect(failure).toBeVisible()
  expect(runtimeRequestFailed, 'the failure came from the actual lazy mutation-runtime request').toBe(true)
  await expect(failure).toContainText('Copy any unsent text before reloading.')
  await expect(main.getByRole('combobox', { name: 'Reviewing Agent' })).toHaveCount(0)
  await expect(main.getByRole('button', { name: /Run review/ })).toHaveCount(0)
  expect(reviewer.fixture.requests, 'mounting failed admission cannot send a model request').toHaveLength(0)

  await page.unroute(runtimeModule)
  await failure.getByRole('button', { name: 'Reload app', exact: true }).click()
  const recoveredMain = page.locator('main')
  await expect(recoveredMain.locator('[aria-label="Model reviews"]')).toBeVisible({ timeout: ms(20_000) })
  await expect(recoveredMain.getByRole('combobox', { name: 'Reviewing Agent' })).toBeVisible()
  expect(reviewer.fixture.requests, 'full reload admits controls but never auto-dispatches a review').toHaveLength(0)
})

test('a failed review holds the frozen binding through navigation and Retry reuses one key', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
  const reviewer = await reviewerSetup(page, stamp)
  const endpoint = `**/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/review`
  const keys: string[] = []
  const bodies: unknown[] = []
  let fail = true
  await page.route(endpoint, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON())
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated review outage.' } }),
      })
      return
    }
    await route.continue()
  })

  const main = await openContribution(page, context)
  await selectReviewer(main, reviewer.agent)
  const run = main.getByRole('button', { name: 'Run review · uses budget', exact: true })
  await run.evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
  const failed = page.locator('[data-contribution-review="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this changeset was reviewed')
  await expect(main.getByRole('button', { name: 'Reviewing…', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Revise', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Land', exact: true })).toBeDisabled()
  await expect(main.getByRole('textbox', { name: `Comment on ${context.contribution.title}` })).toBeEnabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')
  expect(bodies[0]).toEqual({ expectedVersion: 1, reviewer: reviewer.binding })

  await main.getByRole('button', { name: context.project.name, exact: true }).click()
  await expect(main.getByRole('heading', { name: context.project.name, exact: true })).toBeVisible()
  await expect(failed).toBeVisible()
  await main.getByRole('button', { name: context.contribution.title, exact: true }).first().click()
  await expect(main.getByRole('button', { name: 'Reviewing…', exact: true })).toBeDisabled()

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(main.locator('[data-review-status="passed"]')).toContainText('No actionable defect found by the fixture.')
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  expect(reviewer.fixture.requests).toHaveLength(1)
  expect(reviewer.fixture.requests[0]?.body.tools).toBeUndefined()
  const expectedId = contributionReviewId(context.tenantId, context.project.id, context.contribution.id, keys[0]!)
  const contribution = await currentContribution(page, context)
  expect(contribution.reviews?.filter((review) => review.id === expectedId)).toHaveLength(1)
  expect(contribution.reviews?.find((review) => review.id === expectedId)).toMatchObject({
    version: 1,
    status: 'passed',
    reviewer: reviewer.agent.label,
    provider: reviewer.provider.label,
    model: 'review-fixture-model',
  })
  expect(contribution.events.some((event) => event.id === expectedId)).toBe(false)
  await reviewer.fixture.close()
})

test('a failed Dismiss truth read keeps the billable review held until truth is readable', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = `${Date.now().toString(36)}-dismiss-read`
  const context = await arena(page, stamp)
  const reviewer = await reviewerSetup(page, stamp)
  const keys: string[] = []
  let postSeen = false
  let failReads = true
  let postCount = 0
  let readCount = 0
  await page.route(`**/api/v1/projects/${context.project.id}/contributions**`, async (route) => {
    const request = route.request()
    if (request.method() === 'POST' && request.url().endsWith(`/${context.contribution.id}/review`)) {
      postSeen = true
      postCount += 1
      keys.push(request.headers()['idempotency-key'] ?? '')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated review outage.' } }),
      })
      return
    }
    if (request.method() === 'GET' && postSeen) {
      readCount += 1
      if (failReads) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'internal', message: 'Truth read unavailable.' } }),
        })
        return
      }
    }
    await route.continue()
  })

  const main = await openContribution(page, context)
  await selectReviewer(main, reviewer.agent)
  await main.getByRole('button', { name: 'Run review · uses budget', exact: true }).click()
  const failed = page.locator('[data-contribution-review="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this changeset was reviewed')
  await expect.poll(() => readCount).toBe(1)
  expect(postCount).toBe(1)

  await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect.poll(() => readCount).toBe(2)
  await expect(failed).toContainText('Couldn’t confirm whether this changeset was reviewed')
  await expect(main.getByRole('button', { name: 'Reviewing…', exact: true })).toBeDisabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')
  expect(postCount).toBe(1)

  failReads = false
  await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(main.getByRole('button', { name: 'Run review · uses budget', exact: true })).toBeEnabled()
  expect(postCount).toBe(1, 'only the original explicit Run request was sent')
  await reviewer.fixture.close()
})

test('a lost response reconciles its exact model-review receipt without covering later work', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = `${Date.now().toString(36)}-lost`
  const context = await arena(page, stamp)
  const reviewer = await reviewerSetup(page, stamp, 'findings')
  const staleLedger = [context.contribution]
  const keys: string[] = []
  let committed = false
  let allowFreshReads = false
  await page.route(`**/api/v1/projects/${context.project.id}/contributions**`, async (route) => {
    if (route.request().method() === 'POST' && route.request().url().endsWith(`/${context.contribution.id}/review`)) {
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      expect(route.request().postDataJSON()).toEqual({ expectedVersion: 1, reviewer: reviewer.binding })
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      committed = true
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
      })
      return
    }
    if (committed && route.request().method() === 'GET' && !allowFreshReads) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staleLedger) })
      return
    }
    await route.continue()
  })

  const main = await openContribution(page, context)
  await selectReviewer(main, reviewer.agent)
  await main.getByRole('button', { name: 'Run review · uses budget', exact: true }).click()
  const failed = page.locator('[data-contribution-review="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this changeset was reviewed')
  expect(keys).toHaveLength(1)

  const nextVersion = await page.request.post(
    `/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/changeset`,
    { data: { entries: [{ kind: 'note', target: 'review surface', after: 'v2' }] } },
  )
  expect(nextVersion.ok()).toBe(true)
  const aftermath = 'History after the v1 review response was lost.'
  const note = await page.request.post(
    `/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/comments`,
    { data: { body: aftermath } },
  )
  expect(note.ok()).toBe(true)
  allowFreshReads = true
  await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(page.locator('[data-contribution-review]')).toHaveCount(0)
  await expect(main).toContainText('Changeset · v2')
  await expect(main).toContainText(aftermath)
  expect(keys).toHaveLength(1)

  const expectedId = contributionReviewId(context.tenantId, context.project.id, context.contribution.id, keys[0]!)
  const contribution = await currentContribution(page, context)
  expect(contribution.changeset).toHaveLength(2)
  expect(contribution.reviews?.find((review) => review.id === expectedId)).toMatchObject({ version: 1, status: 'findings' })
  expect(contribution.events.at(-1)?.body).toBe(aftermath)
  expect(reviewer.fixture.requests).toHaveLength(1)
  await reviewer.fixture.close()
})

test('uncertain results are not passes, and another review is an explicit paid rerun', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = `${Date.now().toString(36)}-uncertain`
  const context = await arena(page, stamp)
  const reviewer = await reviewerSetup(page, stamp, 'uncertain')
  const main = await openContribution(page, context)
  await selectReviewer(main, reviewer.agent)
  await main.getByRole('button', { name: 'Run review · uses budget', exact: true }).click()
  await expect(main.locator('[data-review-status="uncertain"]')).toContainText('This is not a passing review')
  await expect(main.getByRole('button', { name: 'Run another review · uses budget again', exact: true })).toBeEnabled()
  const contribution = await currentContribution(page, context)
  expect(contribution.status).toBe('open')
  expect(contribution.reviews?.at(-1)?.status).toBe('uncertain')
  expect(reviewer.fixture.requests).toHaveLength(1)
  await reviewer.fixture.close()
})

test('review outcomes render as Project reader history without owner reviewer controls', async ({ page, browser }) => {
  test.setTimeout(ms(90_000))
  const stamp = `${Date.now().toString(36)}-shared`
  const context = await arena(page, stamp, true)
  const reviewer = await reviewerSetup(page, stamp, 'findings')
  const ownerMain = await openContribution(page, context)
  await selectReviewer(ownerMain, reviewer.agent)
  await ownerMain.getByRole('button', { name: 'Run review · uses budget', exact: true }).click()
  await expect(ownerMain.locator('[data-review-status="findings"]')).toContainText('Review fixture found a concrete issue.')
  await expect(ownerMain.locator('[data-review-status="findings"]')).toContainText('review surface')

  const visitorContext = await browser.newContext({
    extraHTTPHeaders: { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' },
  })
  const visitor = await visitorContext.newPage()
  try {
    const visitorMain = await openContribution(visitor, context)
    await expect(visitorMain.locator('[aria-label="Model reviews"]')).toContainText('Review fixture found a concrete issue.')
    await expect(visitorMain.locator('[data-review-status="findings"]')).toContainText(reviewer.agent.label)
    await expect(visitorMain.getByRole('combobox', { name: 'Reviewing Agent' })).toHaveCount(0)
    await expect(visitorMain.getByRole('button', { name: /Run review/ })).toHaveCount(0)

    const viewports = [
      { width: 320, height: 700 },
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
      { width: 844, height: 390 },
      { width: 1280, height: 800 },
    ]
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await settleArtifactPageRail(page)
      await scrollReviewIntoView(page, ownerMain)
      await page.screenshot({ path: `.data/contribution-review/${stamp}-owner-${viewport.width}x${viewport.height}.png`, fullPage: false })
      await visitor.setViewportSize(viewport)
      await settleArtifactPageRail(visitor)
      await scrollReviewIntoView(visitor, visitorMain)
      await visitor.screenshot({ path: `.data/contribution-review/${stamp}-shared-${viewport.width}x${viewport.height}.png`, fullPage: false })
    }
  } finally {
    await visitorContext.close()
    await reviewer.fixture.close()
  }
})

test('foreign tenant cannot read a private Project review or open reviewer controls', async ({ page, browser }) => {
  test.setTimeout(ms(60_000))
  const stamp = `${Date.now().toString(36)}-foreign`
  const context = await arena(page, stamp)
  const visitorContext = await browser.newContext({
    extraHTTPHeaders: { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' },
  })
  const visitor = await visitorContext.newPage()
  try {
    await visitor.goto(`/projects/${encodeURIComponent(context.project.id)}/changes/${encodeURIComponent(context.contribution.id)}`)
    await expect(visitor.locator('main')).toContainText(/isn’t visible|not available|no longer exists|doesn’t exist|does not exist/i)
    await expect(visitor.locator('[aria-label="Model reviews"]')).toHaveCount(0)
    await expect(visitor.getByRole('combobox', { name: 'Reviewing Agent' })).toHaveCount(0)
  } finally {
    await visitorContext.close()
  }
})
