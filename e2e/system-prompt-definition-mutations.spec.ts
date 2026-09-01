/** Rendered cross-device recovery for system-prompt definition edits. */
import { test, expect } from '@playwright/test'
import type { SystemPromptEntry } from '../contract/index.ts'
import { ms } from './budget.ts'

test('a stale prompt edit preserves a remote field and retries one held sparse intent', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const originalLabel = `Conflict Prompt ${stamp}`
  const localLabel = `${originalLabel} local`
  const remoteBody = `Remote prompt body ${stamp}.`
  const createdResponse = await page.request.post('/api/v1/system-prompts', {
    data: {
      label: originalLabel,
      body: 'Original prompt body.',
      targetFamily: 'claude',
    },
  })
  expect(createdResponse.ok()).toBe(true)
  const created = await createdResponse.json() as SystemPromptEntry
  expect(created.definitionRevision).toBe(0)

  let attempts = 0
  const keys: string[] = []
  const patches: Record<string, unknown>[] = []
  await page.route(`**/api/v1/system-prompts/${created.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    patches.push(route.request().postDataJSON() as Record<string, unknown>)
    if (attempts === 1) {
      const concurrent = await page.request.patch(`/api/v1/system-prompts/${created.id}`, {
        data: { body: remoteBody, expectedRevision: 0 },
      })
      expect(concurrent.status()).toBe(200)
    }
    await route.continue()
  })

  await page.goto(`/agents/prompts/${created.id}`)
  await expect(page.getByRole('heading', { name: originalLabel, exact: true })).toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: 'Edit prompt', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit prompt' })
  const name = dialog.getByLabel('Name')
  await name.fill(localLabel)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()

  const failed = page.locator('[data-system-prompt-definition-mutation="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  await expect(name).toHaveValue(localLabel)
  await expect(name).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  expect(attempts).toBe(1)
  expect(patches[0]).toMatchObject({ label: localLabel, expectedRevision: 0 })
  expect(patches[0]).not.toHaveProperty('body')
  expect(patches[0]).not.toHaveProperty('targetFamily')
  expect(patches[0]).not.toHaveProperty('tenantId')

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: localLabel, exact: true })).toBeVisible()
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(patches[1]).toMatchObject({ label: localLabel, expectedRevision: 1 })
  expect(patches[1]).not.toHaveProperty('body')

  const stored = await (await page.request.get('/api/v1/system-prompts')).json() as SystemPromptEntry[]
  const landed = stored.find((prompt) => prompt.id === created.id)
  expect(landed?.label).toBe(localLabel)
  expect(landed?.body).toBe(remoteBody)
  expect(landed?.targetFamily).toBe('claude')
  expect(landed?.definitionRevision).toBe(2)
})
