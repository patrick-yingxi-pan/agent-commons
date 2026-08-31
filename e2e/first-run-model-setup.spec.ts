/** MODEL-31 — a clean draft never invites an impossible send. The provider
 * registry response is release-shaped (all inherited endpoints unconfigured),
 * while the rest of the walk uses the real UI, provider probe, model endpoint,
 * draft materialization, and message route. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

const FIRST_PROVIDER = `First-run model ${Date.now()}`
const FIRST_MESSAGE = `First connected conversation ${Date.now()}`
const MODEL_PORT = 8830 + Number(process.env.E2E_SHARD ?? 0)

test('a clean draft connects a verified model and returns ready for its first conversation', async ({ page }) => {
  test.setTimeout(ms(90_000))

  // Development intentionally serves runnable mock providers. Change only the
  // read projection of pre-existing entries to the release posture; a provider
  // created by this test keeps the real server-computed configured state.
  await page.route('**/api/v1/providers', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    const response = await route.fetch()
    const providers = await response.json()
    await route.fulfill({
      response,
      json: providers.map((provider: { label: string; kind?: string }) =>
        provider.label === FIRST_PROVIDER
          ? provider
          : provider.kind === 'session'
            ? { ...provider, online: false }
            : { ...provider, execution: 'unconfigured' },
      ),
    })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Connect a model to begin' })).toBeVisible()
  await expect(page.getByPlaceholder('Connect a model provider to begin…')).toBeDisabled()

  const setupCard = page.locator('[data-model-setup] > div')
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 844, height: 390 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport)
    const box = await setupCard.boundingBox()
    expect(box, `${viewport.width}x${viewport.height} setup card`).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(8)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 8)
    await expect(page.getByRole('button', { name: 'Connect a model', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }

  // The contextual act uses this pane's normal navigation edge. It lands on
  // Models with the canonical form already open—not on another instruction page.
  await page.getByRole('button', { name: 'Connect a model', exact: true }).click()
  await expect(page).toHaveURL(/\/models$/)
  const dialog = page.getByRole('dialog', { name: 'New provider' })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to New session' })).toBeVisible()

  await page.getByPlaceholder('e.g. Anthropic (prod)', { exact: true }).fill(FIRST_PROVIDER)
  await page.getByPlaceholder('https://models.example.com/v1', { exact: true }).fill(`http://127.0.0.1:${MODEL_PORT}`)
  await page.getByRole('button', { name: 'Create', exact: true }).click()

  // A successful probe selects the new provider for fresh drafts and follows
  // the carried Back edge. The draft was never materialized during setup.
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
  const composer = page.getByPlaceholder('Reply to Claude…')
  await expect(composer).toBeEnabled()

  await composer.fill(FIRST_MESSAGE)
  await composer.press('Enter')
  await expect(page).toHaveURL(/\/s\/[^/]+$/)
  await expect(page.locator('[data-turn]').filter({ hasText: FIRST_MESSAGE })).toBeVisible()

  // Materialization alone is not a usable first run: prove the configured
  // provider actually completes the first assistant turn through the API seam.
  await expect.poll(
    async () => page.evaluate(async () => {
      const id = location.pathname.split('/').at(-1)
      const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id ?? '')}`)
      if (!response.ok) return []
      const session = await response.json()
      return (session.messages ?? []).map((message: { role: string }) => message.role)
    }),
    { timeout: ms(20_000) },
  ).toEqual(['user', 'assistant'])
})
