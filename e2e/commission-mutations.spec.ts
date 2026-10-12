/** Rendered cross-device recovery for contributor configuration edits. */
import { test, expect, type Page, type TestInfo, type Locator } from '@playwright/test'
import type { Agent, Commission, ModelProvider, SystemPromptEntry } from '../contract/index.ts'
import { ms } from './budget.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

const COMMISSION_VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

async function createContributor(page: import('@playwright/test').Page, label: string) {
  const providers = await (await page.request.get('/api/v1/providers')).json() as ModelProvider[]
  const prompts = await (await page.request.get('/api/v1/system-prompts')).json() as SystemPromptEntry[]
  const agentResponse = await page.request.post('/api/v1/agents', {
    data: { label, providerId: providers[0]!.id, systemPromptId: prompts[0]!.id, tools: [] },
  })
  expect(agentResponse.ok()).toBe(true)
  const agent = await agentResponse.json() as Agent
  const commissionResponse = await page.request.post('/api/v1/commissions', {
    data: { agentId: agent.id, projectId: 'p-insights', role: 'writer' },
  })
  expect(commissionResponse.ok()).toBe(true)
  return { agent, commission: await commissionResponse.json() as Commission }
}

async function openContributorEditor(page: Page, label: string) {
  await page.goto('/projects/p-insights')
  const contributor = page.getByText(label, { exact: true })
  await expect(contributor).toBeVisible({ timeout: ms(20_000) })
  await settleArtifactPageRail(page)
  const row = contributor.locator('xpath=../../..')
  await row.getByRole('button', { name: 'Edit', exact: true }).click()
  return page.getByRole('dialog', { name: 'Edit contributor', exact: true })
}

async function captureCommissionLoad(page: Page, state: 'loading' | 'failed') {
  const marker = page.locator(`[data-commission-form-load="${state}"]`)
  for (const viewport of COMMISSION_VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(marker).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await marker.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `.data/commission-dialog-loading-review/${state}-${viewport.width}x${viewport.height}.png` })
  }
}

async function captureCommissionReady(page: Page, testInfo: TestInfo, dialog: Locator) {
  const panel = dialog.locator('[data-bounded-dialog="resource-form"]')
  for (const viewport of COMMISSION_VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(dialog.getByLabel('Project role')).toHaveValue('writer')
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const box = await panel.boundingBox()
    expect(box, `contributor form has a box at ${viewport.width}x${viewport.height}`).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
    await page.screenshot({ path: testInfo.outputPath(`commission-form-ready-${viewport.width}x${viewport.height}.png`) })
    if (viewport.height === 390) {
      const choices = dialog.getByRole('checkbox')
      const count = await choices.count()
      expect(count, 'the fixture exposes standing, connector and file-scope choices').toBeGreaterThan(1)
      await dialog.getByLabel('Project role').focus()
      for (let index = 0; index < count; index += 1) await page.keyboard.press('Tab')
      const lastChoice = choices.last()
      await expect(lastChoice).toBeFocused()
      await expect.poll(() => lastChoice.evaluate(element => {
        const body = element.closest('[data-form-fields]')!.parentElement!
        const bounds = body.getBoundingClientRect()
        const control = element.getBoundingClientRect()
        // Native scroll offsets round fractional layout coordinates to whole CSS pixels.
        return body.scrollTop > 0 && control.top >= bounds.top - 1 && control.bottom <= bounds.bottom + 1
      }), { message: 'keyboard navigation scrolls lower permission controls inside the body, above the footer' }).toBe(true)
      await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
      await page.screenshot({ path: testInfo.outputPath('commission-form-ready-bottom-844x390.png') })
    }
  }
}

test('the first contributor edit keeps a modal shell while its form chunk loads', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let intercepted = false
  await page.route('**/src/components/CommissionDialog.tsx*', async (route) => {
    intercepted = true
    await gate
    await route.continue()
  })
  const { agent, commission } = await createContributor(page, `Deferred contributor ${Date.now().toString(36)}`)
  let patches = 0
  await page.route(`**/api/v1/commissions/${commission.id}`, async (route) => {
    if (route.request().method() === 'PATCH') patches += 1
    await route.continue()
  })
  try {
    const dialog = await openContributorEditor(page, agent.label)
    const loading = page.locator('[data-commission-form-load="loading"]')
    await expect(dialog).toBeVisible()
    await expect(loading).toHaveAttribute('role', 'status')
    await expect(loading).toContainText('Loading contributor options…')
    await expect(dialog.getByLabel('Project role')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Loading…', exact: true })).toBeDisabled()
    await captureCommissionLoad(page, 'loading')
    expect(intercepted, 'the test held the actual first-open CommissionDialog chunk').toBe(true)
    expect(patches, 'loading an editor never writes Commission configuration').toBe(0)

    release()
    await expect(dialog.getByLabel('Project role')).toHaveValue('writer')
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await captureCommissionReady(page, testInfo, dialog)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(patches).toBe(0)
  } finally {
    release()
  }
})

test('a failed contributor editor chunk grants no edit authority and recovers after warned reload', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  let blocked = true
  let intercepted = false
  await page.route('**/src/components/CommissionDialog.tsx*', async (route) => {
    intercepted = true
    if (blocked) await route.abort('failed')
    else await route.continue()
  })
  const { agent, commission } = await createContributor(page, `Failed deferred contributor ${Date.now().toString(36)}`)
  let patches = 0
  await page.route(`**/api/v1/commissions/${commission.id}`, async (route) => {
    if (route.request().method() === 'PATCH') patches += 1
    await route.continue()
  })
  const dialog = await openContributorEditor(page, agent.label)
  const failed = page.locator('[data-commission-form-load="failed"]')
  await expect(failed).toHaveAttribute('role', 'alert')
  await expect(failed).toContainText('No change was made')
  await expect(failed).toContainText('Copy any unsent workspace text before reloading')
  await expect(dialog.getByLabel('Project role')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Reload app', exact: true })).toBeEnabled()
  await captureCommissionLoad(page, 'failed')
  expect(intercepted, 'the test failed the actual CommissionDialog chunk').toBe(true)
  expect(patches, 'a failed editor chunk never writes Commission configuration').toBe(0)

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await openContributorEditor(page, agent.label)
  const cachedFailure = page.locator('[data-commission-form-load="failed"]')
  await expect(cachedFailure).toBeVisible()
  blocked = false
  await page.getByRole('dialog', { name: 'Edit contributor', exact: true }).getByRole('button', { name: 'Reload app', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Insights dashboard', exact: true })).toBeVisible({ timeout: ms(20_000) })
  const recovered = await openContributorEditor(page, agent.label)
  await expect(recovered.getByLabel('Project role')).toHaveValue('writer')
  await expect(recovered.locator('[data-commission-form-load]')).toHaveCount(0)
  await captureCommissionReady(page, testInfo, recovered)
  expect(patches).toBe(0)
})

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
