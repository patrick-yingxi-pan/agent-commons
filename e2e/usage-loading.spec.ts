/** A deferred usage-details import stays contained, closable, and recoverable. */
import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'

const USAGE_MODULE = /\/src\/components\/UsageDetails\.tsx(?:\?.*)?$/u
const USAGE_API = /\/api\/v1\/usage(?:\?.*)?$/u
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

async function expectUsagePopoverContained(page: Page, surface: ReturnType<Page['locator']>, label: string) {
  if (page.viewportSize()!.width < 640) {
    const main = page.locator('#main-workspace')
    const rail = main.locator('xpath=preceding-sibling::div[1]')
    await expect.poll(async () => ({
      mainInert: await main.evaluate(element => element.hasAttribute('inert')),
      railInert: await rail.evaluate(element => element.hasAttribute('inert')),
      railWidth: (await rail.boundingBox())?.width ?? Infinity,
    }), { message: `${label}: the narrow drawer is settled before review` }).toEqual({
      mainInert: false, railInert: true, railWidth: 0,
    })
  }
  await expect.poll(async () => surface.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const workspace = element.closest<HTMLElement>('[data-popover-viewport]')?.getBoundingClientRect()
    const top = Math.max(0, workspace?.top ?? 0)
    const bottom = Math.min(window.innerHeight, workspace?.bottom ?? window.innerHeight)
    return element.hasAttribute('data-popover')
      && box.left >= 7
      && box.top >= top + 7
      && box.right <= window.innerWidth - 7
      && box.bottom <= bottom - 7
      && element.scrollWidth <= element.clientWidth
  }), { message: `${label}: usage details are stamped and contained with a 7px margin` }).toBe(true)
}

test('deferred usage details remain contained, closable, and recover after a failed import', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const created = await page.request.post('/api/v1/sessions', {
    data: { firstMessage: `Usage detail loading ${stamp}`, persistFirstMessage: true, providerId: 'provider-anthropic' },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const session = await created.json() as { id: string }
  expect(session.id).toBeTruthy()

  let requests = 0
  let release!: () => void
  let routeFinished!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const firstRouteFinished = new Promise<void>((resolve) => { routeFinished = resolve })
  let blocked = true
  await page.route(USAGE_MODULE, async (route) => {
    requests += 1
    if (requests === 1 && blocked) {
      try {
        await gate
        await route.abort('failed')
      } finally {
        routeFinished()
      }
      return
    }
    await route.continue()
  })

  try {
    await page.goto(`/s/${encodeURIComponent(session.id)}`)
    const trigger = page.getByRole('button', { name: /^Usage — estimated context/ })
    await expect(trigger).toBeVisible({ timeout: ms(20_000) })
    const draft = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(draft).toBeVisible()
    await draft.fill(`Unsent usage-recovery draft ${stamp}`)

    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Usage details', exact: true })
    const loading = page.locator('[data-usage-details-load="loading"]')
    await expect(loading).toBeVisible({ timeout: ms(20_000) })
    await expect(loading.getByRole('status')).toHaveText('Loading usage details…')
    await expect.poll(() => requests).toBe(1)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect(loading).toBeVisible()
      await expectUsagePopoverContained(page, loading, `${viewport.width}x${viewport.height} loading`)
      await expect(trigger.locator('svg')).toBeVisible()
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await page.screenshot({ path: `.data/usage-loading-review/loading-${viewport.width}x${viewport.height}.png` })
    }

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(draft).toHaveValue(`Unsent usage-recovery draft ${stamp}`)

    // Reopen while the real module request remains held; releasing it rejects
    // the same lazy import, so the local boundary must show its error state.
    await trigger.click()
    await expect(loading).toBeVisible()
    await expectUsagePopoverContained(page, loading, 'reopened loading state')
    blocked = false
    release()
    await firstRouteFinished

    const failed = page.locator('[data-usage-details-load="error"]')
    await expect(failed).toBeVisible({ timeout: ms(20_000) })
    await expect(failed.getByRole('alert')).toBeVisible()
    await expect(failed).toContainText('Copy unsent text before reloading.')
    await expect(failed.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
    await expect(failed.getByRole('button', { name: 'Reload usage details', exact: true })).toBeVisible()
    await expect(draft).toHaveValue(`Unsent usage-recovery draft ${stamp}`)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect(failed).toBeVisible()
      await expectUsagePopoverContained(page, failed, `${viewport.width}x${viewport.height} error`)
      await expect(trigger.locator('svg')).toBeVisible()
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await page.screenshot({ path: `.data/usage-loading-review/error-${viewport.width}x${viewport.height}.png` })
    }

    await failed.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await trigger.click()
    const cachedFailure = page.locator('[data-usage-details-load="error"]')
    await expect(cachedFailure).toBeVisible()
    await expect(cachedFailure).toContainText('Copy unsent text before reloading.')
    expect(requests, 'reopening a rejected lazy import shows the cached error').toBe(1)

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      cachedFailure.getByRole('button', { name: 'Reload usage details', exact: true }).click(),
    ])
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
    const recoveredTrigger = page.getByRole('button', { name: /^Usage — estimated context/ })
    await expect(recoveredTrigger).toBeVisible()
    await recoveredTrigger.click()
    const recovered = page.getByRole('dialog', { name: 'Usage details', exact: true })
    await expect(page.locator('[data-usage-details-load]')).toHaveCount(0, { timeout: ms(20_000) })
    await expect(recovered.getByText('Local usage limits', { exact: true })).toBeVisible()
    await expect(recovered.getByText(/About 4 characters per token/)).toBeVisible()
    await expect(recovered.getByText(/Excludes attachments, runtime tools/)).toBeVisible()
    expect(requests, 'a fresh page load requested the usage details module again').toBe(2)
  } finally {
    release()
    await page.unroute(USAGE_MODULE)
  }
})

test('usage API loading and failure are explicit, retryable, and preserve the unsent draft', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const created = await page.request.post('/api/v1/sessions', {
    data: { firstMessage: `Usage API recovery ${stamp}`, persistFirstMessage: true, providerId: 'provider-anthropic' },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const session = await created.json() as { id: string }
  expect(session.id).toBeTruthy()

  let requests = 0
  let release!: () => void
  let signalFirstRequest!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const firstRequestSeen = new Promise<void>((resolve) => { signalFirstRequest = resolve })
  await page.route(USAGE_API, async (route) => {
    requests += 1
    if (requests === 1) {
      signalFirstRequest()
      await gate
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'unavailable', message: 'Usage is temporarily unavailable.' } }),
      })
      return
    }
    await route.continue()
  })

  try {
    await page.goto(`/s/${encodeURIComponent(session.id)}`)
    await firstRequestSeen
    const trigger = page.getByRole('button', { name: /^Usage — loading/ })
    await expect(trigger).toBeVisible({ timeout: ms(20_000) })
    const draft = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(draft).toBeVisible()
    const draftText = `Keep this unsent usage-recovery draft ${stamp}`
    await draft.fill(draftText)

    await trigger.click()
    const usageRead = page.locator('[data-usage-read]')
    await expect(usageRead).toHaveAttribute('data-usage-read', 'loading')
    const loading = usageRead.getByRole('dialog', { name: 'Usage details', exact: true })
    await expect(loading).toBeVisible()
    await expect(loading).toContainText('Loading usage…')
    await expect(loading).not.toContainText(/\d[\d.]*%/)
    await expect.poll(() => requests).toBe(1)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect(loading).toBeVisible()
      await expectUsagePopoverContained(page, loading, `${viewport.width}x${viewport.height} API loading`)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }

    release()
    await expect(usageRead).toHaveAttribute('data-usage-read', 'error', { timeout: ms(20_000) })
    const failed = usageRead.getByRole('dialog', { name: 'Usage details', exact: true })
    await expect(failed).toBeVisible()
    await expect(failed).toContainText('Couldn’t load usage. Your unsent message is safe.')
    await expect(failed.getByRole('button', { name: 'Retry usage', exact: true })).toBeVisible()
    await expect(failed).not.toContainText(/\d[\d.]*%/)
    await expect(page.getByRole('button', { name: 'Usage — unavailable', exact: true })).toBeVisible()
    await expect(draft).toHaveValue(draftText)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect(failed).toBeVisible()
      await expectUsagePopoverContained(page, failed, `${viewport.width}x${viewport.height} API error`)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }

    const recoveredResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/v1/usage' && url.searchParams.has('session') && response.status() === 200
    })
    await failed.getByRole('button', { name: 'Retry usage', exact: true }).click()
    expect((await recoveredResponse).ok()).toBe(true)
    await expect.poll(() => requests).toBe(2)
    await expect(usageRead).not.toHaveAttribute('data-usage-read', 'error')
    await expect(page.getByRole('button', { name: /^Usage — estimated context/ })).toBeVisible()
    await expect(draft).toHaveValue(draftText)
    await expect(page.getByRole('button', { name: /^Usage — estimated context/ })).toHaveAttribute('aria-expanded', 'true')
    const recoveredDialog = page.getByRole('dialog', { name: 'Usage details', exact: true })
    await expect(recoveredDialog.getByText('Local usage limits', { exact: true })).toBeVisible()
    await expect(recoveredDialog.getByText('Provider quota', { exact: true })).toBeVisible()
  } finally {
    release()
    await page.unroute(USAGE_API)
  }
})
