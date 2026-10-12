/** Rendered acknowledgement recovery for owner Agent proposal decisions. */
import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import type { Agent, AgentChangeProposal, Identity } from '../contract/index.ts'
import { agentProposalVerdictId } from '../server/agentProposalVerdictIdentity.ts'
import { agentBindings } from './agent-bindings.ts'
import { agentSynopsisRow } from './agent-synopsis-row.ts'
import { ms } from './budget.ts'

const PROPOSER_HEADERS = { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' }
const REVIEW_VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

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
  const row = agentSynopsisRow(page, agent.label)
  await expect(row).toBeVisible({ timeout: ms(20_000) })
  const review = row.getByRole('button', { name: 'Review 1 proposal', exact: true })
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

async function captureReviewLoad(page: Page, testInfo: TestInfo, phase: 'loading' | 'failed') {
  const marker = page.locator(`[data-agent-proposal-review-load="${phase}"]`)
  const dialog = page.getByRole('dialog')
  const panel = dialog.locator('div.relative.flex')
  for (const viewport of REVIEW_VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(marker).toBeVisible()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const box = await panel.boundingBox()
    expect(box, `proposal review panel has a box at ${viewport.width}x${viewport.height}`).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
    await marker.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`agent-proposal-review-${phase}-${viewport.width}x${viewport.height}.png`) })
  }
}

async function captureReviewReady(page: Page, testInfo: TestInfo, agent: Agent, proposalText: string) {
  const dialog = page.getByRole('dialog', { name: `Proposals — ${agent.label}` })
  const panel = dialog.locator('div.relative.flex')
  for (const viewport of REVIEW_VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(dialog.getByText('One reviewed change.', { exact: true })).toBeVisible()
    await expect(dialog.getByText(proposalText, { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Merge', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Decline', exact: true })).toBeVisible()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const box = await panel.boundingBox()
    expect(box, `proposal review panel has a box at ${viewport.width}x${viewport.height}`).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
    await page.screenshot({ path: testInfo.outputPath(`agent-proposal-review-ready-${viewport.width}x${viewport.height}.png`) })
  }
}

test('Agent proposal review loads actual history before exposing Merge and Decline', async ({ browser }, testInfo) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const proposer = await newUser(browser, PROPOSER_HEADERS)
  const stamp = `${Date.now().toString(36)}-deferred-review`
  try {
    const { agent, proposal } = await arena(owner.page, proposer.page, stamp)
    let verdictWrites = 0
    await owner.page.route(`**/api/v1/agents/${agent.id}/proposals/${proposal.id}/**`, async (route) => {
      if (route.request().method() === 'POST' && /\/(merge|decline)$/.test(new URL(route.request().url()).pathname)) verdictWrites += 1
      await route.continue()
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let intercepted = false
    await owner.page.route('**/src/components/AgentProposalsReviewDialog.tsx*', async (route) => {
      intercepted = true
      await gate
      await route.continue()
    })

    const dialog = await openReview(owner.page, agent)
    const loading = owner.page.locator('[data-agent-proposal-review-load="loading"]')
    try {
      await expect(loading).toBeVisible({ timeout: ms(20_000) })
      await expect(loading).toHaveAttribute('role', 'status')
      await expect(loading).toContainText('Loading proposal review…')
      await expect(dialog.getByText('One reviewed change.', { exact: true })).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: 'Merge', exact: true })).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: 'Decline', exact: true })).toHaveCount(0)
      await captureReviewLoad(owner.page, testInfo, 'loading')
      expect(intercepted, 'the test held the actual Agent proposal review module').toBe(true)
      expect(verdictWrites, 'loading proposal history cannot write a verdict').toBe(0)
    } finally {
      release()
    }

    const proposalText = `Apply the reviewed evidence policy ${stamp}.`
    await expect(dialog.getByText('One reviewed change.', { exact: true })).toBeVisible()
    await expect(dialog.getByText(proposalText, { exact: true })).toBeVisible()
    await captureReviewReady(owner.page, testInfo, agent, proposalText)
    expect(verdictWrites, 'rendering proposal history does not choose a verdict').toBe(0)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  } finally {
    await Promise.allSettled([owner.context.close(), proposer.context.close()])
  }
})

test('failed Agent proposal review preserves the page without Merge/Decline authority', async ({ browser }, testInfo) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const proposer = await newUser(browser, PROPOSER_HEADERS)
  const stamp = `${Date.now().toString(36)}-deferred-review-failed`
  try {
    const { agent, proposal } = await arena(owner.page, proposer.page, stamp)
    let verdictWrites = 0
    await owner.page.route(`**/api/v1/agents/${agent.id}/proposals/${proposal.id}/**`, async (route) => {
      if (route.request().method() === 'POST' && /\/(merge|decline)$/.test(new URL(route.request().url()).pathname)) verdictWrites += 1
      await route.continue()
    })
    let blocked = true
    let intercepted = false
    await owner.page.route('**/src/components/AgentProposalsReviewDialog.tsx*', async (route) => {
      intercepted = true
      if (blocked) await route.abort('failed')
      else await route.continue()
    })

    let dialog = await openReview(owner.page, agent)
    const failed = owner.page.locator('[data-agent-proposal-review-load="failed"]')
    await expect(failed).toBeVisible({ timeout: ms(20_000) })
    await expect(failed).toHaveAttribute('role', 'alert')
    await expect(failed).toContainText('No decision was made')
    await expect(dialog.getByRole('button', { name: 'Merge', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Decline', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Reload proposal review', exact: true })).toBeVisible()
    await captureReviewLoad(owner.page, testInfo, 'failed')
    expect(intercepted, 'the test failed the actual Agent proposal review module').toBe(true)
    expect(verdictWrites, 'a failed review chunk cannot write a verdict').toBe(0)

    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    dialog = await openReview(owner.page, agent)
    const cachedFailure = owner.page.locator('[data-agent-proposal-review-load="failed"]')
    await expect(cachedFailure).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Merge', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Decline', exact: true })).toHaveCount(0)
    blocked = false
    await cachedFailure.getByRole('button', { name: 'Reload proposal review', exact: true }).click()
    const recovered = await openReview(owner.page, agent)
    const proposalText = `Apply the reviewed evidence policy ${stamp}.`
    await expect(recovered.getByText('One reviewed change.', { exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(recovered.getByText(proposalText, { exact: true })).toBeVisible()
    await captureReviewReady(owner.page, testInfo, agent, proposalText)
    expect(verdictWrites, 'explicit module recovery does not resolve the proposal').toBe(0)
  } finally {
    await Promise.allSettled([owner.context.close(), proposer.context.close()])
  }
})

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
