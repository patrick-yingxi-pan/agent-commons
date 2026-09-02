/** Rendered confirmation, stale-consent recovery, and early-absence retention
 * for Contributor removal. */
import { test, expect, type Page } from '@playwright/test'
import {
  DEFAULT_PROVIDER_ID,
  type Agent,
  type Commission,
} from '../contract/index.ts'
import { SP_DEFAULT_ID } from '../server/data/prompts.ts'
import { ms } from './budget.ts'

const PROJECT_ID = 'p-insights'

async function createFixture(page: Page, label: string): Promise<{ agent: Agent; commission: Commission }> {
  const agentResponse = await page.request.post('/api/v1/agents', {
    data: { label, providerId: DEFAULT_PROVIDER_ID, systemPromptId: SP_DEFAULT_ID, tools: [] },
  })
  expect(agentResponse.ok()).toBe(true)
  const agent = await agentResponse.json() as Agent
  const commissionResponse = await page.request.post('/api/v1/commissions', {
    data: { agentId: agent.id, projectId: PROJECT_ID, role: 'writer' },
  })
  expect(commissionResponse.ok()).toBe(true)
  return { agent, commission: await commissionResponse.json() as Commission }
}

async function contributorRow(page: Page, label: string) {
  const name = page.getByText(label, { exact: true })
  await expect(name).toBeVisible({ timeout: ms(20_000) })
  return name.locator('xpath=../../..')
}

async function confirmRemoval(page: Page, label: string) {
  const row = await contributorRow(page, label)
  await row.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Remove ${label}?`, exact: true })
  await expect(dialog).toContainText('releases any work items it holds')
  await expect(dialog).toContainText('Previous contributions stay')
  return { row, dialog }
}

test('Contributor removal confirms scope, holds the row, and retries stale reviewed truth', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const fixture = await createFixture(page, `Removal Contributor ${Date.now().toString(36)}`)
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  let attempts = 0
  await page.route(`**/api/v1/commissions/${fixture.commission.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (attempts === 1) {
      const changed = await page.request.patch(`/api/v1/commissions/${fixture.commission.id}`, {
        data: { role: 'reader', expectedRevision: 0 },
      })
      expect(changed.status()).toBe(200)
    }
    await route.continue()
  })

  await page.goto(`/projects/${PROJECT_ID}`)
  let { dialog } = await confirmRemoval(page, fixture.agent.label)
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  ;({ dialog } = await confirmRemoval(page, fixture.agent.label))
  await dialog.getByRole('button', { name: 'Remove Contributor', exact: true }).click()

  const failed = page.locator('[data-commission-deletion="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  const heldRow = await contributorRow(page, fixture.agent.label)
  await expect(heldRow).toHaveAttribute('aria-busy', 'true')
  await expect(heldRow.getByText('reader', { exact: true })).toBeVisible()
  await expect(heldRow.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled()
  await expect(heldRow.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
  expect(attempts).toBe(1)
  expect(bodies[0]).toMatchObject({ expectedRevision: 0 })

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText(fixture.agent.label, { exact: true })).toHaveCount(0)
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toMatchObject({ expectedRevision: 1 })
  const stored = await (await page.request.get(`/api/v1/commissions?project=${PROJECT_ID}`)).json() as Commission[]
  expect(stored.some((commission) => commission.id === fixture.commission.id)).toBe(false)
  await page.request.delete(`/api/v1/agents/${fixture.agent.id}`)
})

test('a committed removal stays visible while its lost response is reconciled', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const fixture = await createFixture(page, `Lost removal ${Date.now().toString(36)}`)
  let attempts = 0
  let releaseReconciliation!: () => void
  let markReconciliationStarted!: () => void
  const reconciliationStarted = new Promise<void>((resolve) => { markReconciliationStarted = resolve })
  const reconciliationRelease = new Promise<void>((resolve) => { releaseReconciliation = resolve })

  await page.route(`**/api/v1/commissions/${fixture.commission.id}`, async (route) => {
    if (route.request().method() === 'DELETE') {
      attempts += 1
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
      })
      return
    }
    if (route.request().method() === 'GET') {
      markReconciliationStarted()
      await reconciliationRelease
    }
    await route.continue()
  })

  await page.goto(`/projects/${PROJECT_ID}`)
  const { dialog } = await confirmRemoval(page, fixture.agent.label)
  await dialog.getByRole('button', { name: 'Remove Contributor', exact: true }).click()
  await reconciliationStarted

  const heldRow = await contributorRow(page, fixture.agent.label)
  await expect(heldRow).toHaveAttribute('data-commission-removal', 'true')
  await expect(heldRow).toContainText('Removing Contributor…')
  await expect(page.locator('[data-commission-deletion="pending"]')).toBeVisible()
  const authoritative = await (await page.request.get(`/api/v1/commissions?project=${PROJECT_ID}`)).json() as Commission[]
  expect(authoritative.some((commission) => commission.id === fixture.commission.id)).toBe(false)

  releaseReconciliation()
  await expect(page.getByText(fixture.agent.label, { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-commission-deletion]')).toHaveCount(0)
  expect(attempts).toBe(1)
  await page.request.delete(`/api/v1/agents/${fixture.agent.id}`)
})
