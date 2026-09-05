/** Rendered acknowledgement recovery for Agent proposal discussion comments. */
import { test, expect, type Browser, type Page } from '@playwright/test'
import type { Agent, AgentChangeProposal, Identity } from '../contract/index.ts'
import { agentProposalCommentCreationId } from '../server/agentProposalCommentCreationIdentity.ts'
import { agentBindings } from './agent-bindings.ts'
import { ms } from './budget.ts'

const PROPOSER_HEADERS = { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' }

async function newUser(browser: Browser, headers?: Record<string, string>) {
  const context = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  return { context, page: await context.newPage() }
}

async function arena(owner: Page, proposer: Page, stamp: string) {
  const created = await owner.request.post('/api/v1/agents', {
    data: {
      label: `Proposal discussion ${stamp}`,
      ...(await agentBindings(owner)),
      tools: [],
      instructions: 'Keep the review trail legible.',
    },
  })
  expect(created.ok()).toBe(true)
  const agent = await created.json() as Agent
  const published = await owner.request.patch(`/api/v1/agents/${agent.id}`, {
    data: { published: true, expectedRevision: agent.revision },
  })
  expect(published.ok()).toBe(true)
  const opened = await proposer.request.post(`/api/v1/agents/${agent.id}/proposals`, {
    data: { fields: { instructions: `Show the evidence first ${stamp}.` }, note: 'Please review this change.' },
    headers: { 'Idempotency-Key': `proposal-for-comment-${stamp}` },
  })
  expect(opened.ok()).toBe(true)
  return { agent: await published.json() as Agent, proposal: await opened.json() as AgentChangeProposal }
}

async function openProposal(page: Page, agent: Agent, proposal: AgentChangeProposal) {
  await page.goto('/agents/discover')
  await expect(page.getByRole('button', { name: agent.label, exact: true }).first()).toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: agent.label, exact: true }).first().click()
  await expect(page.getByRole('heading', { name: agent.label, exact: true })).toBeVisible({ timeout: ms(20_000) })
  const form = page.locator('[data-agent-proposal-comment-form]')
  await expect(form).toBeVisible()
  return { form, input: form.getByLabel(`Comment on proposal ${proposal.id}`) }
}

async function proposalRows(page: Page, agentId: string): Promise<AgentChangeProposal[]> {
  const response = await page.request.get(`/api/v1/agents/${agentId}/proposals`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<AgentChangeProposal[]>
}

test('a failed Agent proposal comment keeps its exact draft through navigation and Retry posts once', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const proposer = await newUser(browser, PROPOSER_HEADERS)
  const stamp = Date.now().toString(36)
  const { agent, proposal } = await arena(owner.page, proposer.page, stamp)
  const body = `Keep this exact review thought ${stamp}.`
  const keys: string[] = []
  const bodies: unknown[] = []
  let fail = true
  await proposer.page.route(`**/api/v1/agents/${agent.id}/proposals/${proposal.id}/comments`, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON())
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated comment outage.' } }),
      })
      return
    }
    await route.continue()
  })

  let { form, input } = await openProposal(proposer.page, agent, proposal)
  await input.fill(body)
  await form.getByRole('button', { name: 'Post', exact: true }).evaluate((button) => {
    button.click()
    button.click()
  })

  const failed = proposer.page.locator('[data-agent-proposal-comment-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this Agent proposal comment was posted')
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(input).toHaveValue(body)
  await expect(input).toBeDisabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await proposer.page.goBack()
  await expect(proposer.page).toHaveURL(/\/agents\/discover$/)
  await proposer.page.goForward()
  form = proposer.page.locator('[data-agent-proposal-comment-form]')
  input = form.getByLabel(`Comment on proposal ${proposal.id}`)
  await expect(input).toHaveValue(body)
  await expect(input).toBeDisabled()

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(proposer.page.getByText(body, { exact: true })).toBeVisible()
  await expect(proposer.page.locator('[data-agent-proposal-comment-creation]')).toHaveCount(0)
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  expect(bodies[0]).toEqual({ body })
  const me = await (await proposer.page.request.get('/api/v1/me')).json() as Identity
  const expectedId = agentProposalCommentCreationId(me.tenant.id, agent.id, proposal.id, keys[0]!)
  const represented = (await proposalRows(proposer.page, agent.id)).find((row) => row.id === proposal.id)!
  expect(represented.comments?.filter((comment) => comment.id === expectedId)).toHaveLength(1)

  await owner.context.close()
  await proposer.context.close()
})

test('a committed Agent proposal comment stays frozen until exact reconciliation after response loss', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const proposer = await newUser(browser, PROPOSER_HEADERS)
  const stamp = `${Date.now().toString(36)}-lost`
  const { agent, proposal } = await arena(owner.page, proposer.page, stamp)
  const body = `Recover this exact committed discussion ${stamp}.`
  const keys: string[] = []
  let committed = false
  let releaseRead!: () => void
  let markReadStarted!: () => void
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
  await proposer.page.route(`**/api/v1/agents/${agent.id}/proposals**`, async (route) => {
    if (route.request().method() === 'POST' && route.request().url().endsWith(`/${proposal.id}/comments`)) {
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
      await readGate
    }
    await route.continue()
  })

  const { form, input } = await openProposal(proposer.page, agent, proposal)
  await input.fill(body)
  await form.getByRole('button', { name: 'Post', exact: true }).click()
  await readStarted
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(input).toHaveValue(body)
  await expect(input).toBeDisabled()

  releaseRead()
  await expect(proposer.page.getByText(body, { exact: true })).toBeVisible()
  await expect(proposer.page.locator('[data-agent-proposal-comment-creation]')).toHaveCount(0)
  expect(keys).toHaveLength(1)
  const me = await (await proposer.page.request.get('/api/v1/me')).json() as Identity
  const expectedId = agentProposalCommentCreationId(me.tenant.id, agent.id, proposal.id, keys[0]!)
  const represented = (await proposalRows(proposer.page, agent.id)).find((row) => row.id === proposal.id)!
  expect(represented.comments?.filter((comment) => comment.id === expectedId)).toHaveLength(1)

  await owner.context.close()
  await proposer.context.close()
})
