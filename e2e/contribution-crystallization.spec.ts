/** Rendered acknowledgement recovery for append-only Contribution changesets. */
import { test, expect, type Page } from '@playwright/test'
import type { Contribution, CreateProjectResponse, Project } from '../contract/index.ts'
import { ms } from './budget.ts'

interface Arena { project: Project; contribution: Contribution }

async function arena(page: Page, stamp: string): Promise<Arena> {
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: `Crystallization recovery ${stamp}`, description: 'A test-owned append-only Contribution Project.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  const contributionResponse = await page.request.post(`/api/v1/projects/${project.id}/contributions`, {
    data: { title: `Crystallize exactly once ${stamp}`, summary: 'The visible before/after draft is the substantive act surface.' },
    headers: { 'Idempotency-Key': `contribution-${stamp}` },
  })
  expect(contributionResponse.ok()).toBe(true)
  return { project, contribution: await contributionResponse.json() as Contribution }
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

test('a failed crystallization keeps its exact draft through navigation and Retry appends once', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
  const endpoint = `**/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/changeset`
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  let fail = true
  await page.route(endpoint, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (fail) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Simulated crystallization outage.' } }) })
      return
    }
    await route.continue()
  })

  const main = await openContribution(page, context)
  await main.getByRole('button', { name: 'Crystallize', exact: true }).click()
  await main.getByLabel('Change target').fill('release note')
  await main.getByLabel('Before text').fill('Draft')
  await main.getByLabel('After text').fill('Ready')
  await main.getByRole('button', { name: 'Add change', exact: true }).click()
  await main.getByLabel('Change kind').selectOption('file')
  await main.getByLabel('Change target').fill('src/reliable.ts')
  await main.getByLabel('After text').fill('export const reliable = true')
  await main.getByRole('button', { name: 'Crystallize v1', exact: true }).click()

  const failed = page.locator('[data-contribution-crystallization="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this changeset was crystallized')
  const heldDraft = main.locator('[data-contribution-crystallization-draft]')
  await expect(heldDraft).toContainText('Crystallizing 2 exact changes')
  await expect(heldDraft).toContainText('release note')
  await expect(heldDraft).toContainText('Draft')
  await expect(heldDraft).toContainText('Ready')
  await expect(heldDraft).toContainText('src/reliable.ts')
  await expect(heldDraft).toContainText('export const reliable = true')
  await expect(main.getByRole('button', { name: 'Crystallizing…', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Declare effects', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Land', exact: true })).toBeDisabled()
  await expect(main.getByRole('textbox', { name: `Comment on ${context.contribution.title}` })).toBeEnabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await main.getByRole('button', { name: context.project.name, exact: true }).click()
  await expect(main.getByRole('heading', { name: context.project.name, exact: true })).toBeVisible()
  await expect(failed).toBeVisible()
  await main.getByRole('button', { name: context.contribution.title, exact: true }).first().click()
  await expect(main.getByRole('heading', { name: context.contribution.title, exact: true })).toBeVisible()
  await expect(main.locator('[data-contribution-crystallization-draft]')).toContainText('release note')

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-contribution-crystallization]')).toHaveCount(0)
  const changeset = main.locator('[data-contribution-changeset-version="1"]')
  await expect(changeset).toContainText('Changeset · v1')
  await expect(changeset).toContainText('release note')
  await expect(changeset).toContainText('src/reliable.ts')
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  const contribution = await currentContribution(page, context)
  expect(contribution.changeset).toHaveLength(1)
  expect(contribution.events.filter((event) => event.kind === 'crystallized')).toHaveLength(1)
})

test('a lost crystallization response is healed by Dismiss without replacing later history', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = `${Date.now().toString(36)}-lost`
  const context = await arena(page, stamp)
  const staleLedger = [context.contribution]
  const keys: string[] = []
  let committed = false
  let allowFreshReads = false
  await page.route(`**/api/v1/projects/${context.project.id}/contributions**`, async (route) => {
    if (route.request().method() === 'POST' && route.request().url().endsWith(`/${context.contribution.id}/changeset`)) {
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
  await main.getByRole('button', { name: 'Crystallize', exact: true }).click()
  await main.getByLabel('Change target').fill('durable receipt')
  await main.getByLabel('After text').fill('Recorded once')
  await main.getByRole('button', { name: 'Crystallize v1', exact: true }).click()
  const failed = page.locator('[data-contribution-crystallization="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this changeset was crystallized')
  expect(keys).toHaveLength(1)

  const aftermath = 'History added after the crystallization response was lost.'
  const note = await page.request.post(
    `/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/comments`,
    { data: { body: aftermath } },
  )
  expect(note.ok()).toBe(true)
  allowFreshReads = true
  await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(page.locator('[data-contribution-crystallization]')).toHaveCount(0)
  await expect(main.locator('[data-contribution-changeset-version="1"]')).toContainText('durable receipt')
  await expect(main).toContainText(aftermath)
  expect(keys).toHaveLength(1)
  const contribution = await currentContribution(page, context)
  expect(contribution.changeset).toHaveLength(1)
  expect(contribution.events.filter((event) => event.kind === 'crystallized')).toHaveLength(1)
  expect(contribution.events.at(-1)?.body).toBe(aftermath)
})
