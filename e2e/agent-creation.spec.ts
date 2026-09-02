/** Rendered acknowledgement recovery for New Agent. */
import { test, expect, type Page } from '@playwright/test'
import type { Agent, Identity } from '../contract/index.ts'
import { agentCreationId } from '../server/agentCreationIdentity.ts'
import { ms } from './budget.ts'

async function tenantId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function agents(page: Page): Promise<Agent[]> {
  const response = await page.request.get('/api/v1/agents')
  expect(response.ok()).toBe(true)
  return response.json() as Promise<Agent[]>
}

async function openAgentDialog(page: Page, label: string) {
  await page.goto('/agents')
  await page.getByRole('button', { name: 'New agent', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New agent' })
  await dialog.getByLabel('Name').fill(label)
  return dialog
}

test('Agent fields stay held and Retry preserves one logical create identity', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const label = `Held Agent ${Date.now().toString(36)}`
  const keys: string[] = []
  let attempts = 0
  await page.route('**/api/v1/agents', async (route) => {
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

  const dialog = await openAgentDialog(page, label)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const failed = page.locator('[data-agent-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the Agent was created')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-busy', 'true')
  await expect(dialog.getByLabel('Name')).toHaveValue(label)
  await expect(dialog.getByLabel('Name')).toBeDisabled()

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const expectedId = agentCreationId(await tenantId(page), keys[0]!)
  expect((await agents(page)).filter((agent) => agent.id === expectedId)).toHaveLength(1)
})

test('a committed Agent with a lost response reconciles without a second POST', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const label = `Recovered Agent ${Date.now().toString(36)}`
  const keys: string[] = []
  let attempts = 0
  await page.route('**/api/v1/agents', async (route) => {
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

  const dialog = await openAgentDialog(page, label)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')
  const expectedId = agentCreationId(await tenantId(page), keys[0]!)
  const stored = await agents(page)
  expect(stored.filter((agent) => agent.id === expectedId)).toHaveLength(1)
  expect(stored.find((agent) => agent.id === expectedId)?.label).toBe(label)
  await expect(page.locator('[data-agent-creation="failed"]')).toHaveCount(0)
})
