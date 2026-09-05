/** Rendered acknowledgement recovery for owner Agent proposal decisions. */
import { test, expect, type Browser, type Page } from '@playwright/test'
import type { Agent, AgentChangeProposal, Identity } from '../contract/index.ts'
import { agentProposalVerdictId } from '../server/agentProposalVerdictIdentity.ts'
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
      label: `Proposal decision ${stamp}`,
      ...(await agentBindings(owner)),
      tools: [],
      instructions: 'Keep the current review policy.',
    },
  })
  expect(created.ok()).toBe(true)
  const agent = await created.json() as Agent
  const published = await owner.request.patch(`/api/v1/agents/${agent.id}`, {
    data: { published: true, expectedRevision: agent.revision },
  })
  expect(published.ok()).toBe(true)
  const opened = await proposer.request.post(`/api/v1/agents/${agent.id}/proposals`, {
    data: { fields: { instructions: `Apply the reviewed evidence policy ${stamp}.` }, note: 'One reviewed change.' },
    headers: { 'Idempotency-Key': `proposal-for-verdict-${stamp}` },
  })
  expect(opened.ok()).toBe(true)
  return { agent: await published.json() as Agent, proposal: await opened.json() as AgentChangeProposal }
}

async function openReview(page: Page, agent: Agent) {
  if (page.url() === 'about:blank') {
    await page.goto('/agents')
  } else if (new URL(page.url()).pathname !== '/agents') {
    await page.getByRole('navigation').getByRole('button', { name: 'Agents', exact: true }).click()
  }
  const row = page.getByRole('button', { name: agent.label, exact: true }).first()
  await expect(row).toBeVisible({ timeout: ms(20_000) })
  const review = page.locator('div')
    .filter({ hasText: agent.label })
    .getByRole('button', { name: 'Review 1 proposal', exact: true })
    .last()
  await expect(review).toBeVisible({ timeout: ms(20_000) })
  await review.click()
  const dialog = page.getByRole('dialog', { name: `Proposals — ${agent.label}` })
  await expect(dialog).toBeVisible()
  return dialog
}

async function proposalRows(page: Page, agentId: string): Promise<AgentChangeProposal[]> {
  const response = await page.request.get(`/api/v1/agents/${agentId}/proposals`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<AgentChangeProposal[]>
}

test('a failed Agent proposal decision stays held across navigation and Retry applies it once', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const proposer = await newUser(browser, PROPOSER_HEADERS)
  const stamp = Date.now().toString(36)
  const { agent, proposal } = await arena(owner.page, proposer.page, stamp)
  const keys: string[] = []
  const bodies: unknown[] = []
  let fail = true
  await owner.page.route(`**/api/v1/agents/${agent.id}/proposals/${proposal.id}/merge`, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON())
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated decision outage.' } }),
      })
      return
    }
    await route.continue()
  })

  let dialog = await openReview(owner.page, agent)
  await dialog.getByRole('button', { name: 'Merge', exact: true }).evaluate((button) => {
    button.click()
    button.click()
  })
  const failed = owner.page.locator('[data-agent-proposal-verdict="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this Agent proposal decision was applied')
  let held = dialog.locator('[data-agent-proposal-verdict="held"]')
  await expect(held).toHaveAttribute('aria-busy', 'true')
  await expect(held.getByRole('button', { name: 'Merging…', exact: true })).toBeDisabled()
  await expect(held.getByRole('button', { name: 'Decline', exact: true })).toBeDisabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await owner.page.getByRole('navigation').getByRole('button', { name: 'Models', exact: true }).click()
  dialog = await openReview(owner.page, agent)
  held = dialog.locator('[data-agent-proposal-verdict="held"]')
  await expect(held.getByRole('button', { name: 'Merging…', exact: true })).toBeDisabled()

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(dialog.getByText('merged', { exact: true })).toBeVisible()
  await expect(dialog.locator('[data-agent-proposal-verdict]')).toHaveCount(0)
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  const me = await (await owner.page.request.get('/api/v1/me')).json() as Identity
  const expectedId = agentProposalVerdictId(me.tenant.id, agent.id, proposal.id, keys[0]!)
  const represented = (await proposalRows(owner.page, agent.id)).find((row) => row.id === proposal.id)!
  expect(represented.verdictId).toBe(expectedId)
  const agents = await (await owner.page.request.get('/api/v1/agents')).json() as Agent[]
  expect(agents.find((row) => row.id === agent.id)?.version).toBe(2)

  await owner.context.close()
  await proposer.context.close()
})

test('a committed Agent proposal decision remains held until its exact receipt reconciles', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const proposer = await newUser(browser, PROPOSER_HEADERS)
  const stamp = `${Date.now().toString(36)}-lost`
  const { agent, proposal } = await arena(owner.page, proposer.page, stamp)
  const keys: string[] = []
  let committed = false
  let releaseRead!: () => void
  let markReadStarted!: () => void
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
  await owner.page.route(`**/api/v1/agents/${agent.id}/proposals**`, async (route) => {
    if (route.request().method() === 'POST' && route.request().url().endsWith(`/${proposal.id}/merge`)) {
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

  const dialog = await openReview(owner.page, agent)
  await dialog.getByRole('button', { name: 'Merge', exact: true }).click()
  await readStarted
  const held = dialog.locator('[data-agent-proposal-verdict="held"]')
  await expect(held).toHaveAttribute('aria-busy', 'true')
  await expect(held.getByRole('button', { name: 'Merging…', exact: true })).toBeDisabled()

  releaseRead()
  await expect(dialog.getByText('merged', { exact: true })).toBeVisible()
  await expect(dialog.locator('[data-agent-proposal-verdict]')).toHaveCount(0)
  expect(keys).toHaveLength(1)
  const me = await (await owner.page.request.get('/api/v1/me')).json() as Identity
  const expectedId = agentProposalVerdictId(me.tenant.id, agent.id, proposal.id, keys[0]!)
  const represented = (await proposalRows(owner.page, agent.id)).find((row) => row.id === proposal.id)!
  expect(represented.verdictId).toBe(expectedId)

  await owner.context.close()
  await proposer.context.close()
})
