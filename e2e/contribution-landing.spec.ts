/** Rendered acknowledgement recovery for terminal Contribution landing. */
import { test, expect, type Page } from '@playwright/test'
import type { Contribution, CreateProjectResponse, Project } from '../contract/index.ts'
import { ms } from './budget.ts'

interface Arena { project: Project; contribution: Contribution }

async function arena(page: Page, stamp: string, withReviewMaterial = false): Promise<Arena> {
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: `Landing recovery ${stamp}`, description: 'A test-owned Contribution Project.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  const contributionResponse = await page.request.post(`/api/v1/projects/${project.id}/contributions`, {
    data: { title: `Land exactly once ${stamp}`, summary: 'The canonical page is the substantive review surface.' },
    headers: { 'Idempotency-Key': `contribution-${stamp}` },
  })
  expect(contributionResponse.ok()).toBe(true)
  let contribution = await contributionResponse.json() as Contribution
  if (withReviewMaterial) {
    const changeset = await page.request.post(`/api/v1/projects/${project.id}/contributions/${contribution.id}/changeset`, {
      data: { entries: [{ kind: 'note', target: 'release notes', before: 'Draft', after: 'Ready' }] },
    })
    expect(changeset.ok()).toBe(true)
    const envelope = await page.request.post(`/api/v1/projects/${project.id}/contributions/${contribution.id}/envelope`, {
      data: { lines: [{ type: 'connector.write', target: 'release channel', harness: 'draft-escrow' }] },
    })
    expect(envelope.ok()).toBe(true)
    contribution = await envelope.json() as Contribution
  }
  return { project, contribution }
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

test('landing remains held across navigation and Retry reuses one logical act', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp, true)
  const keys: string[] = []
  let fail = true
  await page.route(`**/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/land`, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (fail) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Simulated landing outage.' } }) })
      return
    }
    await route.continue()
  })

  let main = await openContribution(page, context)
  await expect(main.getByRole('button', { name: 'Revise', exact: true })).toBeEnabled()
  await expect(main.getByRole('button', { name: 'Amend', exact: true })).toBeEnabled()
  await main.getByRole('button', { name: 'Land', exact: true }).click()
  const failed = page.locator('[data-contribution-landing="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this Contribution landed')
  await expect(main.getByRole('button', { name: 'Landing…', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Revise', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Amend', exact: true })).toBeDisabled()
  await expect(main.getByRole('textbox', { name: `Comment on ${context.contribution.title}` })).toBeEnabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await main.getByRole('button', { name: context.project.name, exact: true }).click()
  await expect(main.getByRole('heading', { name: context.project.name, exact: true })).toBeVisible()
  await expect(failed).toBeVisible()
  await main.getByRole('button', { name: context.contribution.title, exact: true }).first().click()
  await expect(main.getByRole('heading', { name: context.contribution.title, exact: true })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Landing…', exact: true })).toBeDisabled()

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-contribution-landing]')).toHaveCount(0)
  await expect(main.getByText(/Landed · L\d+/)).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect((await currentContribution(page, context)).status).toBe('landed')
})

test('a lost landing response retries the same durable operation after stale reconciliation', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
  const staleLedger = [context.contribution]
  const keys: string[] = []
  let committed = false
  let allowFreshReads = false
  await page.route(`**/api/v1/projects/${context.project.id}/contributions**`, async (route) => {
    if (route.request().method() === 'POST' && route.request().url().endsWith(`/${context.contribution.id}/land`)) {
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      if (!committed) {
        const response = await route.fetch()
        expect(response.ok()).toBe(true)
        committed = true
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }) })
        return
      }
      await route.continue()
      return
    }
    if (committed && route.request().method() === 'GET' && !allowFreshReads) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staleLedger) })
      return
    }
    await route.continue()
  })

  const main = await openContribution(page, context)
  await main.getByRole('button', { name: 'Land', exact: true }).click()
  const failed = page.locator('[data-contribution-landing="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this Contribution landed')
  allowFreshReads = true
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-contribution-landing]')).toHaveCount(0)
  await expect(main.getByText(/Landed · L\d+/)).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const contribution = await currentContribution(page, context)
  expect(contribution.events.filter((event) => event.kind === 'landed')).toHaveLength(1)
})
