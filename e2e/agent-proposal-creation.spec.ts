/** Rendered acknowledgement recovery for proposing a change to a public Agent. */
import { test, expect, type Browser, type Page } from '@playwright/test'
import type { Agent, AgentChangeProposal, Identity } from '../contract/index.ts'
import { agentProposalCreationId } from '../server/agentProposalCreationIdentity.ts'
import { agentBindings } from './agent-bindings.ts'
import { ms } from './budget.ts'

const PROPOSER_HEADERS = { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' }

async function newUser(browser: Browser, headers?: Record<string, string>) {
  const context = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  return { context, page: await context.newPage() }
}

async function publishedAgent(page: Page, label: string): Promise<Agent> {
  const created = await page.request.post('/api/v1/agents', {
    data: {
      label,
      ...(await agentBindings(page)),
      tools: [],
      instructions: 'Preserve the current evidence trail.',
    },
  })
  expect(created.ok()).toBe(true)
  const agent = await created.json() as Agent
  const published = await page.request.patch(`/api/v1/agents/${agent.id}`, {
    data: { published: true, expectedRevision: agent.revision },
  })
  expect(published.ok()).toBe(true)
  return published.json() as Promise<Agent>
}

async function openForm(page: Page, agent: Agent) {
  await page.goto('/agents/discover')
  await expect(page.getByRole('button', { name: agent.label, exact: true }).first()).toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: agent.label, exact: true }).first().click()
  await expect(page.getByRole('heading', { name: agent.label, exact: true })).toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: 'Propose a change', exact: true }).click()
  return page.locator('[data-form-dialog="agent-proposal-creation"]')
}

async function tenantId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function proposals(page: Page, agentId: string): Promise<AgentChangeProposal[]> {
  const response = await page.request.get(`/api/v1/agents/${agentId}/proposals`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<AgentChangeProposal[]>
}

test('failed Agent proposal stays visible across navigation and Retry preserves one exact proposal', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const proposer = await newUser(browser, PROPOSER_HEADERS)
  const agent = await publishedAgent(owner.page, `Held proposal host ${Date.now().toString(36)}`)
  const changedPrompt = `Keep one durable prompt ${Date.now().toString(36)}.`
  const changedInstructions = 'Show the evidence before drawing the conclusion.'
  const note = 'This entire authored form must survive uncertainty.'
  const keys: string[] = []
  const bodies: unknown[] = []
  let fail = true
  await proposer.page.route(`**/api/v1/agents/${agent.id}/proposals`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON())
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit failure.' } }),
      })
      return
    }
    await route.continue()
  })

  let form = await openForm(proposer.page, agent)
  await form.getByLabel('Proposed system prompt').fill(changedPrompt)
  await form.getByLabel('Proposed instructions').fill(changedInstructions)
  await form.getByLabel('Proposal note').fill(note)
  await form.getByRole('button', { name: 'Open proposal', exact: true }).click()

  const failed = proposer.page.locator('[data-agent-proposal-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the Agent proposal opened')
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(form.getByLabel('Proposed system prompt')).toBeDisabled()
  await expect(form.getByLabel('Proposed system prompt')).toHaveValue(changedPrompt)
  await expect(form.getByLabel('Proposed instructions')).toHaveValue(changedInstructions)
  await expect(form.getByLabel('Proposal note')).toHaveValue(note)
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await proposer.page.goBack()
  await expect(proposer.page).toHaveURL(/\/agents\/discover$/)
  await proposer.page.goForward()
  form = proposer.page.locator('[data-form-dialog="agent-proposal-creation"]')
  await expect(form).toBeVisible()
  await expect(form.getByLabel('Proposed system prompt')).toHaveValue(changedPrompt)
  await expect(form.getByLabel('Proposed instructions')).toHaveValue(changedInstructions)
  await expect(form.getByLabel('Proposal note')).toHaveValue(note)
  await expect(form.getByLabel('Proposal note')).toBeDisabled()

  fail = false
  await proposer.page.locator('[data-agent-proposal-creation="failed"]')
    .getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(form).toHaveCount(0)
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  const expectedId = agentProposalCreationId(await tenantId(proposer.page), agent.id, keys[0]!)
  expect((await proposals(proposer.page, agent.id)).filter((proposal) => proposal.id === expectedId)).toHaveLength(1)

  await owner.context.close()
  await proposer.context.close()
})

test('a committed Agent proposal remains held until exact lost-response reconciliation', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const proposer = await newUser(browser, PROPOSER_HEADERS)
  const agent = await publishedAgent(owner.page, `Recovered proposal host ${Date.now().toString(36)}`)
  const changedPrompt = `Recover this exact committed prompt ${Date.now().toString(36)}.`
  const note = 'Do not post a second proposal while checking the first.'
  const keys: string[] = []
  let committed = false
  let releaseRead!: () => void
  let markReadStarted!: () => void
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
  const readReleased = new Promise<void>((resolve) => { releaseRead = resolve })
  await proposer.page.route(`**/api/v1/agents/${agent.id}/proposals`, async (route) => {
    if (route.request().method() === 'POST') {
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      await response.body()
      committed = true
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
      })
      return
    }
    if (committed && route.request().method() === 'GET') {
      markReadStarted()
      await readReleased
    }
    await route.continue()
  })

  let form = await openForm(proposer.page, agent)
  await form.getByLabel('Proposed system prompt').fill(changedPrompt)
  await form.getByLabel('Proposal note').fill(note)
  await form.getByRole('button', { name: 'Open proposal', exact: true }).click()
  await readStarted
  await expect(form).toHaveAttribute('aria-busy', 'true')

  await proposer.page.goBack()
  await expect(proposer.page).toHaveURL(/\/agents\/discover$/)
  await proposer.page.goForward()
  form = proposer.page.locator('[data-form-dialog="agent-proposal-creation"]')
  await expect(form).toBeVisible()
  await expect(form.getByLabel('Proposed system prompt')).toHaveValue(changedPrompt)
  await expect(form.getByLabel('Proposal note')).toHaveValue(note)
  await expect(form.getByLabel('Proposal note')).toBeDisabled()
  releaseRead()

  await expect(form).toHaveCount(0)
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')
  const expectedId = agentProposalCreationId(await tenantId(proposer.page), agent.id, keys[0]!)
  expect((await proposals(proposer.page, agent.id)).filter((proposal) => proposal.id === expectedId)).toHaveLength(1)
  await expect(proposer.page.locator('[data-agent-proposal-creation]')).toHaveCount(0)

  await owner.context.close()
  await proposer.context.close()
})
