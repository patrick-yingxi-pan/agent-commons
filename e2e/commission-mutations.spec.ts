/** Rendered cross-device recovery for contributor configuration edits. */
import { test, expect } from '@playwright/test'
import type { Agent, Commission, ModelProvider, SystemPromptEntry } from '../contract/index.ts'
import { ms } from './budget.ts'

test('a stale contributor edit preserves a remote field and retries one held sparse intent', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const providers = await (await page.request.get('/api/v1/providers')).json() as ModelProvider[]
  const prompts = await (await page.request.get('/api/v1/system-prompts')).json() as SystemPromptEntry[]
  const agentResponse = await page.request.post('/api/v1/agents', {
    data: {
      label: `Conflict Contributor ${stamp}`,
      providerId: providers[0]!.id,
      systemPromptId: prompts[0]!.id,
      tools: [],
    },
  })
  expect(agentResponse.ok()).toBe(true)
  const agent = await agentResponse.json() as Agent
  const commissionResponse = await page.request.post('/api/v1/commissions', {
    data: { agentId: agent.id, projectId: 'p-insights', role: 'writer' },
  })
  expect(commissionResponse.ok()).toBe(true)
  const created = await commissionResponse.json() as Commission
  expect(created.configurationRevision).toBe(0)

  let attempts = 0
  const keys: string[] = []
  const patches: Record<string, unknown>[] = []
  await page.route(`**/api/v1/commissions/${created.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    patches.push(route.request().postDataJSON() as Record<string, unknown>)
    if (attempts === 1) {
      const concurrent = await page.request.patch(`/api/v1/commissions/${created.id}`, {
        data: { standing: true, expectedRevision: 0 },
      })
      expect(concurrent.status()).toBe(200)
    }
    await route.continue()
  })

  await page.goto('/projects/p-insights')
  const label = page.getByText(agent.label, { exact: true })
  await expect(label).toBeVisible({ timeout: ms(20_000) })
  const row = label.locator('xpath=../../..')
  await row.getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit contributor' })
  const role = dialog.getByLabel('Project role')
  await role.selectOption('reader')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()

  const failed = page.locator('[data-commission-mutation="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  await expect(role).toHaveValue('reader')
  await expect(role).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  expect(attempts).toBe(1)
  expect(patches[0]).toMatchObject({ role: 'reader', expectedRevision: 0 })
  expect(patches[0]).not.toHaveProperty('standing')
  expect(patches[0]).not.toHaveProperty('authority')

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(dialog).toHaveCount(0)
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(patches[1]).toMatchObject({ role: 'reader', expectedRevision: 1 })
  expect(patches[1]).not.toHaveProperty('standing')

  const stored = await (await page.request.get(`/api/v1/commissions/${created.id}`)).json() as Commission
  expect(stored.role).toBe('reader')
  expect(stored.standing).toBe(true)
  expect(stored.configurationRevision).toBe(2)
})
