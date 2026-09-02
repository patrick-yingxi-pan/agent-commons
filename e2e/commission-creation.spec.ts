/** Rendered acknowledgement recovery for Commission an agent. */
import { test, expect, type Page } from '@playwright/test'
import { DEFAULT_PROVIDER_ID, type Agent, type Commission, type Identity } from '../contract/index.ts'
import { commissionCreationId } from '../server/commissionCreationIdentity.ts'
import { SP_DEFAULT_ID } from '../server/data/prompts.ts'
import { ms } from './budget.ts'

const PROJECT_ID = 'p-insights'

async function tenantId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function createTestAgent(page: Page, label: string): Promise<Agent> {
  const response = await page.request.post('/api/v1/agents', {
    data: { label, providerId: DEFAULT_PROVIDER_ID, systemPromptId: SP_DEFAULT_ID },
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<Agent>
}

async function commissions(page: Page): Promise<Commission[]> {
  const response = await page.request.get(`/api/v1/commissions?project=${PROJECT_ID}`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<Commission[]>
}

async function openCommissionPicker(page: Page, label: string) {
  await page.goto(`/projects/${PROJECT_ID}`)
  await page.getByRole('button', { name: 'Commission an agent', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Commission an agent' })
  const choice = picker.getByRole('button', { name: new RegExp(`^${label}`) })
  await expect(choice).toBeVisible()
  return { picker, choice }
}

test('Contributor choice stays held and Retry preserves one logical commission', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const label = `Held Contributor ${Date.now().toString(36)}`
  const agent = await createTestAgent(page, label)
  const keys: string[] = []
  let attempts = 0
  await page.route('**/api/v1/commissions*', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit failure.' } }),
      })
      return
    }
    await route.continue()
  })

  const { picker, choice } = await openCommissionPicker(page, label)
  await choice.click()
  const failed = page.locator('[data-commission-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the Agent joined this Project')
  await expect(picker).toBeVisible()
  await expect(picker).toHaveAttribute('aria-busy', 'true')
  await expect(choice).toBeDisabled()
  await expect(choice).toHaveAttribute('data-pending', 'true')
  await expect(page.getByRole('button', { name: 'Commission an agent', exact: true })).toBeDisabled()
  await page.getByRole('heading', { name: 'Insights dashboard' }).click()
  await expect(picker).toBeVisible()

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(picker).toHaveCount(0)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const expectedId = commissionCreationId(await tenantId(page), keys[0]!)
  const stored = await commissions(page)
  expect(stored.filter((commission) => commission.id === expectedId)).toHaveLength(1)
  expect(stored.find((commission) => commission.id === expectedId)?.agentId).toBe(agent.id)
})

test('a committed commission with a lost response reconciles without a second POST', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const label = `Recovered Contributor ${Date.now().toString(36)}`
  const agent = await createTestAgent(page, label)
  const keys: string[] = []
  let attempts = 0
  await page.route('**/api/v1/commissions*', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
      })
      return
    }
    await route.continue()
  })

  const { picker, choice } = await openCommissionPicker(page, label)
  await choice.click()
  await expect(picker).toHaveCount(0)
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')
  const expectedId = commissionCreationId(await tenantId(page), keys[0]!)
  const stored = await commissions(page)
  expect(stored.filter((commission) => commission.id === expectedId)).toHaveLength(1)
  expect(stored.find((commission) => commission.id === expectedId)?.agentId).toBe(agent.id)
  await expect(page.locator('[data-commission-creation="failed"]')).toHaveCount(0)
})
