/** Rendered acknowledgement recovery for New Prompt. */
import { test, expect, type Page } from '@playwright/test'
import type { Identity, SystemPromptEntry } from '../contract/index.ts'
import { systemPromptCreationId } from '../server/systemPromptCreationIdentity.ts'
import { ms } from './budget.ts'

async function tenantId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function prompts(page: Page): Promise<SystemPromptEntry[]> {
  const response = await page.request.get('/api/v1/system-prompts')
  expect(response.ok()).toBe(true)
  return response.json() as Promise<SystemPromptEntry[]>
}

async function openPromptDialog(page: Page, label: string, body: string) {
  await page.goto('/agents/building-blocks')
  await page.getByRole('button', { name: 'New prompt', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New prompt' })
  await dialog.getByLabel('Name').fill(label)
  await dialog.getByPlaceholder('The system prompt an Agent drives the model with.').fill(body)
  return dialog
}

test('prompt fields stay held and Retry preserves one logical create identity', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const label = `Held prompt ${stamp}`
  const body = `Review carefully ${stamp}.`
  const keys: string[] = []
  let attempts = 0
  await page.route('**/api/v1/system-prompts', async (route) => {
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

  const dialog = await openPromptDialog(page, label, body)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const failed = page.locator('[data-system-prompt-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the prompt was created')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-busy', 'true')
  await expect(dialog.getByLabel('Name')).toHaveValue(label)
  const promptBody = dialog.getByPlaceholder('The system prompt an Agent drives the model with.')
  await expect(promptBody).toHaveValue(body)
  await expect(dialog.getByLabel('Name')).toBeDisabled()
  await expect(promptBody).toBeDisabled()

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const expectedId = systemPromptCreationId(await tenantId(page), keys[0]!)
  expect((await prompts(page)).filter((prompt) => prompt.id === expectedId)).toHaveLength(1)
})

test('a committed prompt with a lost response reconciles without a second POST', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const label = `Recovered prompt ${stamp}`
  const body = `Keep exact intent ${stamp}.`
  const keys: string[] = []
  let attempts = 0
  await page.route('**/api/v1/system-prompts', async (route) => {
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

  const dialog = await openPromptDialog(page, label, body)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')
  const expectedId = systemPromptCreationId(await tenantId(page), keys[0]!)
  const stored = await prompts(page)
  expect(stored.filter((prompt) => prompt.id === expectedId)).toHaveLength(1)
  expect(stored.find((prompt) => prompt.id === expectedId)?.body).toBe(body)
  await expect(page.locator('[data-system-prompt-creation="failed"]')).toHaveCount(0)
})
