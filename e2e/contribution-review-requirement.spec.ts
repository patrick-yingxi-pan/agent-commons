/** Rendered acknowledgement recovery for the owner's review requirement. */
import { test, expect, type Page } from '@playwright/test'
import type { Contribution, CreateProjectResponse, Identity, Project } from '../contract/index.ts'
import { contributionReviewRequirementId } from '../server/contributionReviewRequirementIdentity.ts'
import { ms } from './budget.ts'

interface Arena {
  project: Project
  contribution: Contribution
  tenantId: string
}

async function arena(page: Page, stamp: string): Promise<Arena> {
  const meResponse = await page.request.get('/api/v1/me')
  expect(meResponse.ok()).toBe(true)
  const tenantId = ((await meResponse.json()) as Identity).tenant.id
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: `Review requirement recovery ${stamp}`, description: 'A test-owned tightening Project.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  const contributionResponse = await page.request.post(`/api/v1/projects/${project.id}/contributions`, {
    data: { title: `Tighten this gate ${stamp}`, summary: 'Review becomes mandatory once.' },
    headers: { 'Idempotency-Key': `contribution-${stamp}` },
  })
  expect(contributionResponse.ok()).toBe(true)
  return { project, contribution: await contributionResponse.json() as Contribution, tenantId }
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

test('a failed review requirement stays held through navigation and Retry tightens once', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
  const endpoint = `**/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/require-review`
  const keys: string[] = []
  let fail = true
  await page.route(endpoint, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated tightening outage.' } }),
      })
      return
    }
    await route.continue()
  })

  const main = await openContribution(page, context)
  await main.getByRole('button', { name: 'Require review', exact: true }).evaluate((button) => {
    button.click()
    button.click()
  })
  const failed = page.locator('[data-contribution-require-review="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether review is required')
  await expect(main.getByRole('button', { name: 'Requiring review…', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Land', exact: true })).toBeDisabled()
  await expect(main.getByRole('textbox', { name: `Comment on ${context.contribution.title}` })).toBeEnabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await main.getByRole('button', { name: context.project.name, exact: true }).click()
  await expect(main.getByRole('heading', { name: context.project.name, exact: true })).toBeVisible()
  await expect(failed).toBeVisible()
  await main.getByRole('button', { name: context.contribution.title, exact: true }).first().click()
  await expect(main.getByRole('button', { name: 'Requiring review…', exact: true })).toBeDisabled()

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-contribution-require-review]')).toHaveCount(0)
  await expect(main).toContainText('adversarial review required before landing')
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  const expectedId = contributionReviewRequirementId(
    context.tenantId,
    context.project.id,
    context.contribution.id,
    keys[0]!,
  )
  const contribution = await currentContribution(page, context)
  expect(contribution.reviewRequired).toBe(true)
  expect(contribution.events.filter((event) => event.id === expectedId)).toHaveLength(1)
})

test('a lost review-requirement response reconciles its receipt without erasing later history', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = `${Date.now().toString(36)}-lost`
  const context = await arena(page, stamp)
  const staleLedger = [context.contribution]
  const keys: string[] = []
  let committed = false
  let allowFreshReads = false
  await page.route(`**/api/v1/projects/${context.project.id}/contributions**`, async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().url().endsWith(`/${context.contribution.id}/require-review`)
    ) {
      keys.push(route.request().headers()['idempotency-key'] ?? '')
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
  await main.getByRole('button', { name: 'Require review', exact: true }).click()
  const failed = page.locator('[data-contribution-require-review="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether review is required')
  expect(keys).toHaveLength(1)

  const aftermath = 'History after the review-requirement response was lost.'
  const note = await page.request.post(
    `/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/comments`,
    { data: { body: aftermath } },
  )
  expect(note.ok()).toBe(true)
  allowFreshReads = true
  await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(page.locator('[data-contribution-require-review]')).toHaveCount(0)
  await expect(main).toContainText('adversarial review required before landing')
  await expect(main).toContainText(aftermath)
  expect(keys).toHaveLength(1)

  const expectedId = contributionReviewRequirementId(
    context.tenantId,
    context.project.id,
    context.contribution.id,
    keys[0]!,
  )
  const contribution = await currentContribution(page, context)
  expect(contribution.reviewRequired).toBe(true)
  expect(contribution.events.filter((event) => event.id === expectedId)).toHaveLength(1)
  expect(contribution.events.at(-1)?.body).toBe(aftermath)
})
