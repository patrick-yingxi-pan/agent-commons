/** Rendered consent and acknowledgement recovery for work-item retraction. */
import { test, expect, type Page } from '@playwright/test'
import type { CreateProjectResponse, OpenSubGoal, Project } from '../contract/index.ts'
import { ms } from './budget.ts'

interface Arena { project: Project; item: OpenSubGoal }

async function arena(page: Page, stamp: string): Promise<Arena> {
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: `Retraction recovery ${stamp}`, description: 'A test-owned retraction Project.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  const guardedResponse = await page.request.post('/api/v1/relations/ops', {
    data: { op: { kind: 'share-project', projectId: project.id, projectName: project.name, shared: true } },
  })
  expect(guardedResponse.ok()).toBe(true)
  const itemResponse = await page.request.post(`/api/v1/projects/${project.id}/open-subgoals`, {
    data: { subGoal: `Close the recovery ${stamp}`, type: 'charge', target: `budget:${stamp}` },
    headers: { 'Idempotency-Key': `item-${stamp}` },
  })
  expect(itemResponse.ok()).toBe(true)
  return { project, item: await itemResponse.json() as OpenSubGoal }
}

async function openItem(page: Page, context: Arena) {
  await page.goto(`/projects/${encodeURIComponent(context.project.id)}/work/${encodeURIComponent(context.item.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: context.item.subGoal, exact: true })).toBeVisible({ timeout: ms(20_000) })
  return main
}

async function currentItem(page: Page, context: Arena): Promise<OpenSubGoal> {
  const response = await page.request.get(`/api/v1/projects/${context.project.id}/open-subgoals`)
  expect(response.ok()).toBe(true)
  const items = await response.json() as OpenSubGoal[]
  return items.find((item) => item.id === context.item.id)!
}

test('retraction requires informed consent and Retry reuses one logical act across projections', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
  const keys: string[] = []
  let fail = true
  await page.route(`**/api/v1/projects/${context.project.id}/open-subgoals/${context.item.id}/retract`, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (fail) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Simulated retraction outage.' } }) })
      return
    }
    await route.continue()
  })

  const main = await openItem(page, context)
  await main.getByRole('button', { name: 'Retract', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Retract ${context.item.subGoal}?` })
  await expect(dialog).toContainText('permanently closes the item unresolved')
  await expect(dialog).toContainText('cannot be reopened')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(keys).toHaveLength(0)

  await main.getByRole('button', { name: 'Retract', exact: true }).click()
  await dialog.getByRole('button', { name: 'Retract work item', exact: true }).click()
  const failed = page.locator('[data-work-item-retraction="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this item was retracted')
  await expect(main.getByRole('button', { name: 'Retracting…', exact: true })).toBeDisabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await main.getByRole('button', { name: context.project.name, exact: true }).click()
  await expect(main.getByRole('heading', { name: context.project.name, exact: true })).toBeVisible()
  const openWork = main.getByRole('button', { name: /^Open work\b/ })
  if ((await openWork.getAttribute('aria-expanded')) === 'false') await openWork.click()
  await expect(main.getByRole('button', { name: 'Retracting…', exact: true })).toBeDisabled()

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(main.getByText(/retracted by/)).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect((await currentItem(page, context)).status).toBe('retracted')
})

test('a lost retraction response retries the same durable operation after stale reconciliation', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
  const staleItems = [context.item]
  const keys: string[] = []
  let committed = false
  let allowFreshReads = false
  await page.route(`**/api/v1/projects/${context.project.id}/open-subgoals**`, async (route) => {
    if (route.request().method() === 'POST' && route.request().url().endsWith(`/${context.item.id}/retract`)) {
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staleItems) })
      return
    }
    await route.continue()
  })

  const main = await openItem(page, context)
  await main.getByRole('button', { name: 'Retract', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Retract work item', exact: true }).click()
  const failed = page.locator('[data-work-item-retraction="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this item was retracted')
  allowFreshReads = true
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-work-item-retraction]')).toHaveCount(0)
  await expect(main.getByText('Retracted', { exact: true })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect((await currentItem(page, context)).status).toBe('retracted')
})
