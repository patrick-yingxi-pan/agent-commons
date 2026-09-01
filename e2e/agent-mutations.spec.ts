/** Rendered cross-device recovery for Agent configuration edits. */
import { test, expect } from '@playwright/test'
import type { Agent, ModelProvider, SystemPromptEntry } from '../contract/index.ts'
import { ms } from './budget.ts'

test('a stale Agent edit preserves remote fields and retries one held sparse intent', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const [providers, prompts] = await Promise.all([
    page.request.get('/api/v1/providers').then((response) => response.json() as Promise<ModelProvider[]>),
    page.request.get('/api/v1/system-prompts').then((response) => response.json() as Promise<SystemPromptEntry[]>),
  ])
  const provider = providers[0]
  const prompt = prompts[0]
  expect(provider).toBeTruthy()
  expect(prompt).toBeTruthy()
  const stamp = Date.now().toString(36)
  const originalLabel = `Conflict Agent ${stamp}`
  const localLabel = `${originalLabel} local`
  const remoteInstructions = `Remote instructions ${stamp}`
  const createdResponse = await page.request.post('/api/v1/agents', {
    data: {
      label: originalLabel,
      providerId: provider!.id,
      systemPromptId: prompt!.id,
      tools: [],
      instructions: '',
    },
  })
  expect(createdResponse.ok()).toBe(true)
  const created = await createdResponse.json() as Agent
  expect(created.revision).toBe(0)

  let attempts = 0
  const keys: string[] = []
  const patches: Record<string, unknown>[] = []
  await page.route(`**/api/v1/agents/${created.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    patches.push(route.request().postDataJSON() as Record<string, unknown>)
    if (attempts === 1) {
      const concurrent = await page.request.patch(`/api/v1/agents/${created.id}`, {
        data: { instructions: remoteInstructions, expectedRevision: 0 },
      })
      expect(concurrent.status()).toBe(200)
    }
    await route.continue()
  })

  await page.goto(`/agents/${created.id}`)
  await expect(page.getByRole('heading', { name: originalLabel, exact: true })).toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: 'Edit agent', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit agent' })
  const name = dialog.getByLabel('Name')
  await name.fill(localLabel)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()

  const failed = page.locator('[data-agent-mutation="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  await expect(name).toHaveValue(localLabel)
  await expect(name).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  expect(attempts).toBe(1)
  expect(patches[0]).toMatchObject({ label: localLabel, expectedRevision: 0 })
  expect(patches[0]).not.toHaveProperty('instructions')

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: localLabel, exact: true })).toBeVisible()
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(patches[1]).toMatchObject({ label: localLabel, expectedRevision: 1 })
  expect(patches[1]).not.toHaveProperty('instructions')

  const stored = await (await page.request.get('/api/v1/agents')).json() as Agent[]
  const landed = stored.find((agent) => agent.id === created.id)
  expect(landed?.label).toBe(localLabel)
  expect(landed?.instructions).toBe(remoteInstructions)
  expect(landed?.revision).toBe(2)
})
