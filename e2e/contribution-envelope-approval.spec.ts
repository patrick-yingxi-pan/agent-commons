/** Rendered acknowledgement recovery for exact-version effect-envelope consent. */
import { test, expect, type Page } from '@playwright/test'
import type { Contribution, CreateProjectResponse, Project } from '../contract/index.ts'
import { ms } from './budget.ts'

interface Arena { project: Project; contribution: Contribution }

async function arena(page: Page, stamp: string): Promise<Arena> {
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: `Envelope approval recovery ${stamp}`, description: 'A test-owned exact-consent Project.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  const contributionResponse = await page.request.post(`/api/v1/projects/${project.id}/contributions`, {
    data: { title: `Approve exactly once ${stamp}`, summary: 'The visible envelope is the substantive consent surface.' },
    headers: { 'Idempotency-Key': `contribution-${stamp}` },
  })
  expect(contributionResponse.ok()).toBe(true)
  const contribution = await contributionResponse.json() as Contribution
  const envelopeResponse = await page.request.post(
    `/api/v1/projects/${project.id}/contributions/${contribution.id}/envelope`,
    { data: { lines: [{ type: 'connector.write', target: `gmail:${stamp}`, cardinality: 2, harness: 'draft-escrow' }] } },
  )
  expect(envelopeResponse.ok()).toBe(true)
  return { project, contribution: await envelopeResponse.json() as Contribution }
}

async function openContribution(page: Page, context: Arena) {
  await page.goto(`/projects/${encodeURIComponent(context.project.id)}/changes/${encodeURIComponent(context.contribution.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: context.contribution.title, exact: true })).toBeVisible({ timeout: ms(20_000) })
  return main
}

async function currentContribution(page: Page, context: Arena): Promise<Contribution> {
  const response = await page.request.get(`/api/v1/projects/${context.project.id}/contributions`)
  expect(response.ok()).toBe(true)
  const contributions = await response.json() as Contribution[]
  return contributions.find((contribution) => contribution.id === context.contribution.id)!
}

test('a failed approval holds its reviewed envelope through navigation and Retry approves once', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
  const endpoint = `**/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/envelope/approve`
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  let fail = true
  await page.route(endpoint, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (fail) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Simulated approval outage.' } }) })
      return
    }
    await route.continue()
  })

  const main = await openContribution(page, context)
  await main.getByRole('button', { name: 'Approve', exact: true }).click()
  const failed = page.locator('[data-contribution-envelope-approval="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this envelope was approved')
  await expect(main.getByRole('button', { name: 'Approving…', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Amend', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Crystallize', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Land', exact: true })).toBeDisabled()
  await expect(main.getByRole('textbox', { name: `Comment on ${context.contribution.title}` })).toBeEnabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')
  expect(bodies[0]).toEqual({ expectedVersion: 1 })

  await main.getByRole('button', { name: context.project.name, exact: true }).click()
  await expect(main.getByRole('heading', { name: context.project.name, exact: true })).toBeVisible()
  await expect(failed).toBeVisible()
  await main.getByRole('button', { name: context.contribution.title, exact: true }).first().click()
  await expect(main.getByRole('button', { name: 'Approving…', exact: true })).toBeDisabled()

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-contribution-envelope-approval]')).toHaveCount(0)
  await expect(main).toContainText(`Effect envelope · v1`)
  await expect(main).toContainText('Approved by')
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  const contribution = await currentContribution(page, context)
  expect(contribution.envelope?.approvedVersion).toBe(1)
  expect(contribution.events.filter((event) => event.kind === 'envelope-approved')).toHaveLength(1)
})

test('a lost approval response is healed by Dismiss without erasing later history', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = `${Date.now().toString(36)}-lost`
  const context = await arena(page, stamp)
  const staleLedger = [context.contribution]
  const keys: string[] = []
  let committed = false
  let allowFreshReads = false
  await page.route(`**/api/v1/projects/${context.project.id}/contributions**`, async (route) => {
    if (route.request().method() === 'POST' && route.request().url().endsWith(`/${context.contribution.id}/envelope/approve`)) {
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      committed = true
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }) })
      return
    }
    if (committed && route.request().method() === 'GET' && !allowFreshReads) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staleLedger) })
      return
    }
    await route.continue()
  })

  const main = await openContribution(page, context)
  await main.getByRole('button', { name: 'Approve', exact: true }).click()
  const failed = page.locator('[data-contribution-envelope-approval="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this envelope was approved')
  expect(keys).toHaveLength(1)

  const aftermath = 'History added after the approval response was lost.'
  const note = await page.request.post(
    `/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/comments`,
    { data: { body: aftermath } },
  )
  expect(note.ok()).toBe(true)
  allowFreshReads = true
  await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(page.locator('[data-contribution-envelope-approval]')).toHaveCount(0)
  await expect(main).toContainText('Approved by')
  await expect(main).toContainText(aftermath)
  expect(keys).toHaveLength(1)
  const contribution = await currentContribution(page, context)
  expect(contribution.envelope?.approvedVersion).toBe(1)
  expect(contribution.events.filter((event) => event.kind === 'envelope-approved')).toHaveLength(1)
  expect(contribution.events.at(-1)?.body).toBe(aftermath)
})
