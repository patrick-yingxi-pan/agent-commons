/** Rendered confirmation, dependency recovery, stale-consent recovery, and
 * early-absence retention for System Prompt removal. */
import { test, expect, type Page } from '@playwright/test'
import {
  DEFAULT_PROVIDER_ID,
  type Agent,
  type SystemPromptEntry,
} from '../contract/index.ts'
import { SP_DEFAULT_ID } from '../server/data/prompts.ts'
import { ms } from './budget.ts'

async function createPrompt(page: Page, label: string): Promise<SystemPromptEntry> {
  const response = await page.request.post('/api/v1/system-prompts', {
    data: { label, body: 'Use the reviewed source and state uncertainty.', targetFamily: 'claude' },
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<SystemPromptEntry>
}

async function confirmRemoval(page: Page, prompt: SystemPromptEntry) {
  await page.goto(`/agents/prompts/${encodeURIComponent(prompt.id)}`)
  await expect(page.getByRole('heading', { name: prompt.label, exact: true }))
    .toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: 'Remove prompt', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Remove ${prompt.label}?`, exact: true })
  await expect(dialog).toContainText('removes the reusable prompt from your library')
  await expect(dialog).toContainText('clears its default selection')
  await expect(dialog).toContainText('Agents using it block removal')
  await expect(dialog).toContainText('copied instructions and previous conversations are not changed')
  return dialog
}

test('System Prompt removal confirms scope and retries changed definition truth under one key', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const prompt = await createPrompt(page, `Removal prompt ${Date.now().toString(36)}`)
  const remoteFamily = `remote-${Date.now().toString(36)}`
  const bodies: Record<string, unknown>[] = []
  const keys: string[] = []
  let attempts = 0
  await page.route(`**/api/v1/system-prompts/${prompt.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    attempts += 1
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      const changed = await page.request.patch(`/api/v1/system-prompts/${prompt.id}`, {
        data: { targetFamily: remoteFamily, expectedRevision: 0 },
      })
      expect(changed.status()).toBe(200)
    }
    await route.continue()
  })

  let dialog = await confirmRemoval(page, prompt)
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  dialog = await confirmRemoval(page, prompt)
  await dialog.getByRole('button', { name: 'Remove prompt', exact: true }).click()

  const failed = page.locator('[data-system-prompt-deletion="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  const detail = page.locator('[data-resource-page][data-resource-nature="atomic"]')
  await expect(detail).toHaveAttribute('aria-busy', 'true')
  await expect(detail).toContainText(remoteFamily)
  await expect(page.getByRole('button', { name: 'Edit prompt', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Remove prompt', exact: true })).toBeDisabled()
  expect(bodies[0]).toMatchObject({ expectedRevision: 0 })

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page).toHaveURL(/\/agents$/)
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toMatchObject({ expectedRevision: 1 })
  expect((await page.request.get(`/api/v1/system-prompts/${prompt.id}`)).status()).toBe(404)
})

test('a referenced prompt stays held until its Agent is repointed and dependency Retry succeeds', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const prompt = await createPrompt(page, `Referenced removal prompt ${Date.now().toString(36)}`)
  const agentResponse = await page.request.post('/api/v1/agents', {
    data: {
      label: `Prompt binder ${Date.now().toString(36)}`,
      providerId: DEFAULT_PROVIDER_ID,
      systemPromptId: prompt.id,
      tools: [],
    },
  })
  expect(agentResponse.ok()).toBe(true)
  const agent = await agentResponse.json() as Agent
  const bodies: Record<string, unknown>[] = []
  const keys: string[] = []
  await page.route(`**/api/v1/system-prompts/${prompt.id}`, async (route) => {
    if (route.request().method() === 'DELETE') {
      bodies.push(route.request().postDataJSON() as Record<string, unknown>)
      keys.push(route.request().headers()['idempotency-key'] ?? '')
    }
    await route.continue()
  })

  const dialog = await confirmRemoval(page, prompt)
  await dialog.getByRole('button', { name: 'Remove prompt', exact: true }).click()
  const failed = page.locator('[data-system-prompt-deletion="failed"]')
  await expect(failed).toContainText('An Agent still uses this prompt')
  await expect(failed).toContainText('Choose another prompt for it, then Retry')
  await expect(page.locator('[data-resource-page][data-resource-nature="atomic"]'))
    .toHaveAttribute('aria-busy', 'true')

  const repointed = await page.request.patch(`/api/v1/agents/${agent.id}`, {
    data: { systemPromptId: SP_DEFAULT_ID, expectedRevision: agent.revision ?? 0 },
  })
  expect(repointed.ok()).toBe(true)
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page).toHaveURL(/\/agents$/)
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toEqual(bodies[0])
  expect(keys[1]).toBe(keys[0])
})

test('a committed prompt remains visible while a lost response reconciles exact absence', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const prompt = await createPrompt(page, `Lost prompt removal ${Date.now().toString(36)}`)
  let attempts = 0
  let releaseReconciliation!: () => void
  let markReconciliationStarted!: () => void
  const reconciliationStarted = new Promise<void>((resolve) => { markReconciliationStarted = resolve })
  const reconciliationRelease = new Promise<void>((resolve) => { releaseReconciliation = resolve })
  await page.route(`**/api/v1/system-prompts/${prompt.id}`, async (route) => {
    if (route.request().method() === 'DELETE') {
      attempts += 1
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
      })
      return
    }
    if (route.request().method() === 'GET') {
      markReconciliationStarted()
      await reconciliationRelease
    }
    await route.continue()
  })

  const dialog = await confirmRemoval(page, prompt)
  await dialog.getByRole('button', { name: 'Remove prompt', exact: true }).click()
  await reconciliationStarted
  const detail = page.locator('[data-resource-page][data-resource-nature="atomic"]')
  await expect(detail).toHaveAttribute('aria-busy', 'true')
  await expect(detail).toContainText('Removing prompt…')
  const authoritative = await (await page.request.get('/api/v1/system-prompts')).json() as SystemPromptEntry[]
  expect(authoritative.some((candidate) => candidate.id === prompt.id)).toBe(false)

  releaseReconciliation()
  await expect(page).toHaveURL(/\/agents$/)
  expect(attempts).toBe(1)
})
