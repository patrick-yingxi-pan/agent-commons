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
  let releasePreference = () => {}
  try {
    const identityStamp = Date.now().toString(36)
    await page.context().setExtraHTTPHeaders({
      'x-user-id': `user-first-run-model-${identityStamp}`,
      'x-tenant-id': `tenant-first-run-model-${identityStamp}`,
    })

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
      // Narrowing the shell collapses its rail with a short transition. Assert
      // the settled geometry instead of sampling one intermediate animation
      // frame and reporting a false overflow.
      await expect.poll(async () => {
        const box = await setupCard.boundingBox()
        return box !== null && box.x >= 8 && box.x + box.width <= viewport.width - 8
      }, {
        message: `${viewport.width}x${viewport.height} setup card stays inside its 8px inset`,
        timeout: ms(5_000),
      }).toBe(true)
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
    await dialog.getByLabel('Model ID', { exact: true }).fill('mock-model')
    const preferenceGate = new Promise<void>((resolve) => { releasePreference = resolve })
    await page.route('**/api/v1/viewer-preferences/model', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      await preferenceGate
      await route.continue()
    })
    await page.getByRole('button', { name: 'Create', exact: true }).click()

    // A successful probe selects the new provider for fresh drafts and follows
    // the carried Back edge only after its personal preference is durable. The
    // draft was never materialized during setup.
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(/\/models$/)
    await expect(page.locator('[data-revisioned-mutation="model-preferences"][data-mutation-status="pending"]'))
      .toContainText('Saving model preference…')
    releasePreference()
    // Keep the release-shaped provider projection throughout the handoff and
    // conversation. Removing routes mid-handoff races its registry refresh.
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
    const composer = page.getByPlaceholder('Reply to Claude…')
    await expect(composer).toBeEnabled()

    // The setup handoff is not merely a browser-origin preference. Packaged
    // desktop relaunches on a fresh loopback port, so the exact viewer choice
    // must already be durable before the form takes us back to the draft.
    const durablePreference = await page.request.get('/api/v1/viewer-preferences/model')
    expect(durablePreference.ok()).toBeTruthy()
    const providersResponse = await page.request.get('/api/v1/providers')
    expect(providersResponse.ok()).toBeTruthy()
    const createdProvider = ((await providersResponse.json()) as Array<{ id: string; label: string }>)
      .find((provider) => provider.label === FIRST_PROVIDER)
    expect(createdProvider).toBeTruthy()
    expect((await durablePreference.json()).preferences).toMatchObject({
      providerId: createdProvider!.id,
      ultracode: false,
      fast: false,
    })

    // Remove every origin-local hint and reconstruct the page. The same explicit
    // provider must still make the untouched draft executable; no localStorage
    // migration is allowed to be the authority for this result.
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
    await expect(page.getByPlaceholder('Reply to Claude…')).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Model and effort' })).toContainText(FIRST_PROVIDER)

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
  } finally {
    releasePreference()
    await page.unrouteAll({ behavior: 'wait' })
  }
})
