/** Rendered acknowledgement recovery for exact-version Contribution review. */
import { test, expect, type Page } from '@playwright/test'
import type { Contribution, CreateProjectResponse, Identity, Project } from '../contract/index.ts'
import { contributionReviewId } from '../server/contributionReviewIdentity.ts'
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
    data: { name: `Contribution review recovery ${stamp}`, description: 'A test-owned exact-review Project.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  const contributionResponse = await page.request.post(`/api/v1/projects/${project.id}/contributions`, {
    data: { title: `Review exactly once ${stamp}`, summary: 'The visible changeset is the review surface.' },
    headers: { 'Idempotency-Key': `contribution-${stamp}` },
  })
  expect(contributionResponse.ok()).toBe(true)
  const contribution = await contributionResponse.json() as Contribution
  const changesetResponse = await page.request.post(
    `/api/v1/projects/${project.id}/contributions/${contribution.id}/changeset`,
    { data: { entries: [{ kind: 'note', target: 'review surface', after: 'v1' }] } },
  )
  expect(changesetResponse.ok()).toBe(true)
  return { project, contribution: await changesetResponse.json() as Contribution, tenantId }
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

test('a failed review holds its exact version through navigation and Retry runs once', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
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
  await main.getByRole('button', { name: 'Run review', exact: true }).evaluate((button) => {
    button.click()
    button.click()
  })
  const failed = page.locator('[data-contribution-review="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this changeset was reviewed')
  await expect(main.getByRole('button', { name: 'Reviewing v1…', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Revise', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Land', exact: true })).toBeDisabled()
  await expect(main.getByRole('textbox', { name: `Comment on ${context.contribution.title}` })).toBeEnabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')
  expect(bodies[0]).toEqual({ expectedVersion: 1 })

  await main.getByRole('button', { name: context.project.name, exact: true }).click()
  await expect(main.getByRole('heading', { name: context.project.name, exact: true })).toBeVisible()
  await expect(failed).toBeVisible()
  await main.getByRole('button', { name: context.contribution.title, exact: true }).first().click()
  await expect(main.getByRole('button', { name: 'Reviewing v1…', exact: true })).toBeDisabled()

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-contribution-review]')).toHaveCount(0)
  await expect(main).toContainText('no confirmed findings · v1')
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  const expectedId = contributionReviewId(
    context.tenantId,
    context.project.id,
    context.contribution.id,
    keys[0]!,
  )
  const contribution = await currentContribution(page, context)
  expect(contribution.reviewedVersion).toBe(1)
  expect(contribution.events.filter((event) => event.id === expectedId)).toHaveLength(1)
})

test('a lost review response reconciles its receipt without marking a later changeset reviewed', async ({ page }) => {
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
      route.request().url().endsWith(`/${context.contribution.id}/review`)
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
  await main.getByRole('button', { name: 'Run review', exact: true }).click()
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

  const expectedId = contributionReviewId(
    context.tenantId,
    context.project.id,
    context.contribution.id,
    keys[0]!,
  )
  const contribution = await currentContribution(page, context)
  expect(contribution.changeset).toHaveLength(2)
  expect(contribution.reviewedVersion).toBe(1)
  expect(contribution.events.filter((event) => event.id === expectedId)).toHaveLength(1)
  expect(contribution.events.at(-1)?.body).toBe(aftermath)
})
