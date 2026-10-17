/** The provider gauge keeps its shell eager and loads its detail body on demand. */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { ModelProvider } from '../contract/index.ts'
import { settledNarrowRail } from './accessibility-helpers.ts'
import { ms } from './budget.ts'

const API = '/api/v1'
const MODEL_PORT = 8830 + Number(process.env.E2E_SHARD ?? 0)
const PROVIDER_BODY = /\/src\/components\/ProvidersControlBody\.tsx(?:\?.*)?$/u
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

function testIdentity(stamp: string, suffix: string) {
  return {
    'x-user-id': `user-provider-gauge-${suffix}-${stamp}`,
    'x-tenant-id': `tenant-provider-gauge-${suffix}-${stamp}`,
  }
}

async function createProvider(page: Page, label: string): Promise<ModelProvider> {
  const response = await page.request.post(`${API}/providers`, {
    data: {
      label,
      modelFamily: 'claude',
      effortLevels: ['Low', 'High'],
      config: { baseURL: `http://127.0.0.1:${MODEL_PORT}` },
    },
  })
  expect(response.ok(), await response.text()).toBe(true)
  return response.json() as Promise<ModelProvider>
}

async function appProviderRead(page: Page) {
  const responsePromise = page.waitForResponse(response => {
    const url = new URL(response.url())
    return response.request().method() === 'GET' && url.pathname === `${API}/providers`
  })
  await page.goto('/')
  const response = await responsePromise
  expect(new URL(response.url()).origin, 'provider registry is read from the app origin')
    .toBe(new URL(page.url()).origin)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<ModelProvider[]>
}

function providerTrigger(page: Page) {
  return page.getByRole('button', { name: /^Model providers — \d+ registered$/u })
}

async function expectContained(page: Page, surface: Locator, label: string) {
  if (page.viewportSize()!.width < 640) await settledNarrowRail(page)
  await expect.poll(async () => surface.evaluate(element => {
    const box = element.getBoundingClientRect()
    const workspace = element.closest<HTMLElement>('[data-popover-viewport]')?.getBoundingClientRect()
    const top = Math.max(0, workspace?.top ?? 0)
    const bottom = Math.min(window.innerHeight, workspace?.bottom ?? window.innerHeight)
    return element.hasAttribute('data-popover')
      && box.left >= 7 && box.top >= top + 7
      && box.right <= window.innerWidth - 7 && box.bottom <= bottom - 7
      && element.scrollWidth <= element.clientWidth
  }), { message: `${label} stays inside the visible workspace` }).toBe(true)
}

async function expectRows(details: Locator, providers: ModelProvider[]) {
  const rows = details.locator('[data-provider-details-row]')
  await expect(rows, 'rendered provider rows match the same-origin registry response').toHaveCount(providers.length)
  for (const provider of providers) {
    const row = details.locator(`[data-provider-details-row="${provider.id}"]`)
    await expect(row, `registered provider ${provider.id} has one rendered row`).toHaveCount(1)
    await expect(row.getByText(provider.label, { exact: true })).toBeVisible()
    await expect(row.getByText(provider.modelFamily, { exact: true })).toBeVisible()
  }
}

async function capture(page: Page, testInfo: TestInfo, state: string) {
  const viewport = page.viewportSize()!
  await page.screenshot({ path: testInfo.outputPath(`provider-gauge-${state}-${viewport.width}x${viewport.height}.png`) })
}

test('provider gauge defers its detail body until opened and contains loading then loaded states', async ({ page }, testInfo) => {
  test.setTimeout(ms(75_000))
  const stamp = crypto.randomUUID().slice(0, 10)
  await page.context().setExtraHTTPHeaders(testIdentity(stamp, 'loading'))
  const own = await createProvider(page, `Gauge loading fixture ${stamp}`)
  let chunkRequests = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(PROVIDER_BODY, async route => {
    chunkRequests += 1
    await gate
    await route.continue()
  })

  try {
    const providers = await appProviderRead(page)
    expect(providers.some(provider => provider.id === own.id && provider.label === own.label)).toBe(true)
    const trigger = providerTrigger(page)
    await expect(trigger).toHaveAccessibleName(`Model providers — ${providers.length} registered`)
    expect(chunkRequests, 'opening the composer does not request the deferred provider body').toBe(0)
    const draft = page.getByRole('textbox', { name: 'Message', exact: true })
    const model = page.getByRole('button', { name: 'Model and effort', exact: true })
    const selectedModel = await model.innerText()
    const draftText = `Keep this unsent provider-gauge draft ${stamp}`
    await draft.fill(draftText)
    await trigger.click()
    const loading = page.getByRole('status').and(page.locator('[data-provider-details-loading]'))
    await expect(loading).toBeVisible()
    await expect(page.locator('[data-provider-details]')).toHaveCount(0)
    const loadingPopover = loading.locator('xpath=ancestor::*[@data-popover][1]')

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect(loading).toBeVisible()
      await expectContained(page, loadingPopover, `${viewport.width}x${viewport.height} provider loading`)
      await expect(draft).toHaveValue(draftText)
      await expect(model).toHaveText(selectedModel)
      await capture(page, testInfo, 'loading')
    }

    release()
    const details = page.locator('[data-provider-details]')
    await expect(details).toBeVisible()
    await expectRows(details, providers)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      const popover = details.locator('xpath=ancestor::*[@data-popover][1]')
      await expectContained(page, popover, `${viewport.width}x${viewport.height} provider details`)
      await expectRows(details, providers)
      await expect(draft).toHaveValue(draftText)
      await expect(model).toHaveText(selectedModel)
      await capture(page, testInfo, 'loaded')
    }
    expect(chunkRequests).toBe(1)
    await page.keyboard.press('Escape')
    await expect(details).toHaveCount(0)
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  } finally {
    release()
  }
})

test('failed provider detail import preserves the draft until warned Reload fetches a fresh chunk', async ({ page }, testInfo) => {
  test.setTimeout(ms(75_000))
  const stamp = crypto.randomUUID().slice(0, 10)
  await page.context().setExtraHTTPHeaders(testIdentity(stamp, 'reload'))
  const own = await createProvider(page, `Gauge reload fixture ${stamp}`)
  let chunkRequests = 0
  await page.route(PROVIDER_BODY, async route => {
    chunkRequests += 1
    if (chunkRequests === 1) {
      await route.abort('failed')
      return
    }
    await route.continue()
  })

  const providers = await appProviderRead(page)
  expect(providers.some(provider => provider.id === own.id && provider.label === own.label)).toBe(true)
  const trigger = providerTrigger(page)
  await expect(trigger).toHaveAccessibleName(`Model providers — ${providers.length} registered`)
  expect(chunkRequests, 'the lazy body is not requested until the gauge is explicitly opened').toBe(0)
  const draft = page.getByRole('textbox', { name: 'Message', exact: true })
  const model = page.getByRole('button', { name: 'Model and effort', exact: true })
  const selectedModel = await model.innerText()
  const draftText = `Keep this unsent provider-gauge retry draft ${stamp}`
  await draft.fill(draftText)
  await trigger.click()
  const error = page.getByRole('alert').and(page.locator('[data-provider-details-error]'))
  await expect(error).toBeVisible()
  await expect(error).toContainText('Copy unsent workspace text before reloading.')
  expect(chunkRequests).toBe(1)
  const errorPopover = error.locator('xpath=ancestor::*[@data-popover][1]')

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(error).toBeVisible()
    await expectContained(page, errorPopover, `${viewport.width}x${viewport.height} provider error`)
    await expect(error.getByRole('button', { name: 'Reload provider details', exact: true })).toBeVisible()
    await expect(draft).toHaveValue(draftText)
    await expect(model).toHaveText(selectedModel)
    await capture(page, testInfo, 'error')
  }

  await page.setViewportSize(VIEWPORTS.at(-1)!)
  const pageReloaded = page.waitForEvent('load')
  await error.getByRole('button', { name: 'Reload provider details', exact: true }).click()
  await pageReloaded
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveAccessibleName(`Model providers — ${providers.length} registered`)
  await expect(draft).toHaveValue('')
  await expect(model).toHaveText(selectedModel)
  expect(chunkRequests, 'page reload leaves the gauge body unopened').toBe(1)
  await trigger.click()
  const details = page.locator('[data-provider-details]')
  await expect(details).toBeVisible()
  expect(chunkRequests, 'opening the gauge after page reload requested a fresh module chunk').toBe(2)
  await expectRows(details, providers)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    const popover = details.locator('xpath=ancestor::*[@data-popover][1]')
    await expectContained(page, popover, `${viewport.width}x${viewport.height} reloaded provider details`)
    await expectRows(details, providers)
    await expect(draft).toHaveValue('')
    await expect(model).toHaveText(selectedModel)
    await capture(page, testInfo, 'reloaded')
  }

  await page.keyboard.press('Escape')
  await expect(details).toHaveCount(0)
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
})
