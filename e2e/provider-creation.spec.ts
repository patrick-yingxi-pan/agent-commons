/** Rendered acknowledgement and one-time-secret recovery for provider onboarding. */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { join } from 'node:path'
import type { Identity, ModelProvider } from '../contract/index.ts'
import { providerCreationId } from '../server/providerCreationIdentity.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]
const REVIEW_DIR = join(process.cwd(), '.data', 'provider-onboarding-review')

const capture = (page: Page, name: string) =>
  page.screenshot({ path: join(REVIEW_DIR, `${name}.png`), fullPage: false })

async function expectContainedDialog(page: Page, dialog: Locator) {
  const panel = dialog.locator('[data-bounded-dialog]')
  const footer = panel.locator(':scope > div').last()
  // setViewportSize acknowledges the viewport, not the resize listener and
  // ResizeObserver that update the dialog's live workspace bound. Poll the
  // same strict geometry rather than sampling the previous tier's height.
  await expect.poll(async () => {
    const viewport = page.viewportSize()!
    const workspace = await page.locator('[data-popover-viewport]').boundingBox()
    const boxes = await Promise.all([panel.boundingBox(), footer.boundingBox()])
    return boxes.every((box) => box !== null && box.x >= 7
      && box.y >= (workspace?.y ?? 0) + 7
      && box.x + box.width <= viewport.width - 7
      && box.y + box.height <= viewport.height - 7)
  }, 'panel and footer settle inside the live workspace and viewport').toBe(true)
}

async function tenantId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function providers(page: Page): Promise<ModelProvider[]> {
  const response = await page.request.get('/api/v1/providers')
  expect(response.ok()).toBe(true)
  return response.json() as Promise<ModelProvider[]>
}

async function openSessionProviderDialog(page: Page, label: string) {
  await page.goto('/models')
  await page.getByRole('button', { name: 'New provider', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New provider' })
  await dialog.getByRole('button', { name: 'My AI session', exact: true }).click()
  await dialog.getByLabel('Name').fill(label)
  return dialog
}

test('provider presets submit their selected protocol and editable connection fields without vendor traffic', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const tenant = await tenantId(page)
  const submitted: Array<{ body: Record<string, unknown>; key: string }> = []
  await page.route('**/api/v1/providers', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.continue()
    const body = request.postDataJSON() as Record<string, any>
    const key = request.headers()['idempotency-key'] ?? ''
    submitted.push({ body, key })
    const provider = {
      id: await providerCreationId(tenant, key),
      tenantId: tenant,
      label: body.label,
      modelFamily: body.modelFamily,
      effortLevels: body.effortLevels,
      kind: 'endpoint',
      protocol: body.config.protocol,
      execution: 'configured',
      connectionRevision: 1,
      definitionRevision: 1,
    }
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(provider) })
  })

  const presets = [
    {
      key: 'anthropic',
      label: 'Claude / Anthropic',
      protocol: 'anthropic-messages',
      endpoint: 'https://api.anthropic.com',
      family: 'claude',
      initialModel: '',
      model: 'anthropic-model-from-test',
    },
    {
      key: 'openai',
      label: 'OpenAI',
      protocol: 'openai-responses',
      endpoint: 'https://api.openai.com/v1',
      family: 'gpt',
      initialModel: '',
      model: 'openai-model-from-test',
    },
    {
      key: 'deepseek',
      label: 'DeepSeek',
      protocol: 'anthropic-messages',
      endpoint: 'https://api.deepseek.com/anthropic',
      family: 'deepseek',
      initialModel: 'deepseek-flash',
      model: 'deepseek-model-from-test',
    },
  ] as const

  await page.goto('/models')
  for (const [index, preset] of presets.entries()) {
    await page.getByRole('button', { name: 'New provider', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New provider' })
    await dialog.getByLabel('Provider preset').selectOption(preset.key)
    await expect(dialog.getByRole('combobox', { name: /^Protocol/ })).toHaveValue(preset.protocol)
    await expect(dialog.getByLabel('Endpoint URL')).toHaveValue(preset.endpoint)
    await expect(dialog.getByLabel('Model family')).toHaveValue(preset.family)
    await expect(dialog.getByLabel('Model ID', { exact: true })).toHaveValue(preset.initialModel)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expectContainedDialog(page, dialog)
      const body = dialog.locator('[data-bounded-dialog]').locator(':scope > div').nth(1)
      await body.evaluate((element) => { element.scrollTop = 0 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await capture(page, `preset-${preset.key}-${viewport.width}x${viewport.height}`)
      await dialog.getByRole('combobox', { name: /^Protocol/ }).scrollIntoViewIfNeeded()
      await expect(dialog.getByRole('combobox', { name: /^Protocol/ })).toBeVisible()
      await dialog.getByLabel('Model ID', { exact: true }).scrollIntoViewIfNeeded()
      await expect(dialog.getByLabel('Model ID', { exact: true })).toBeVisible()
      await capture(page, `preset-${preset.key}-connection-${viewport.width}x${viewport.height}`)
    }

    await dialog.getByLabel('Name', { exact: true }).fill(`Preset ${preset.label}`)
    await dialog.getByLabel('Model ID', { exact: true }).fill(preset.model)
    await dialog.getByLabel('Endpoint URL').fill(`${preset.endpoint}/edited`)
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    expect(submitted[index]?.key).not.toBe('')
    expect(submitted[index]?.body).toMatchObject({
      label: `Preset ${preset.label}`,
      modelFamily: preset.family,
      effortLevels: [],
      config: {
        protocol: preset.protocol,
        baseURL: `${preset.endpoint}/edited`,
        model: preset.model,
      },
    })
  }

  await page.getByRole('button', { name: 'New provider', exact: true }).click()
  const custom = page.getByRole('dialog', { name: 'New provider' })
  await custom.getByLabel('Provider preset').selectOption('custom')
  await custom.getByLabel('Name', { exact: true }).fill('Custom provider')
  await custom.getByLabel('Model family').fill('custom-family')
  await custom.getByLabel('Endpoint URL').fill('https://custom.example/v1')
  await custom.getByLabel('Model ID', { exact: true }).fill('custom-model-from-test')
  await custom.getByRole('combobox', { name: /^Protocol/ }).selectOption('openai-responses')
  await custom.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(custom).toHaveCount(0)
  expect(submitted[3]?.body).toMatchObject({
    modelFamily: 'custom-family',
    effortLevels: [],
    config: {
      protocol: 'openai-responses',
      baseURL: 'https://custom.example/v1',
      model: 'custom-model-from-test',
    },
  })
  expect(submitted).toHaveLength(presets.length + 1)
})

test('provider fields stay held and Retry preserves one logical create identity', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const label = `Held relay ${Date.now().toString(36)}`
  const keys: string[] = []
  let attempts = 0
  await page.route('**/api/v1/providers', async (route) => {
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

  const dialog = await openSessionProviderDialog(page, label)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const failed = page.locator('[data-provider-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm the provider')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-busy', 'true')
  await expect(dialog.getByLabel('Name')).toHaveValue(label)
  await expect(dialog.getByLabel('Name')).toBeDisabled()

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expectContainedDialog(page, dialog)
    await capture(page, `session-held-${viewport.width}x${viewport.height}`)
  }

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Connect your session' })).toBeVisible()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    const reveal = page.getByRole('dialog', { name: 'Connect your session' })
    await expect(reveal).toBeVisible()
    await expectContainedDialog(page, reveal)
    await capture(page, `session-reveal-${viewport.width}x${viewport.height}`)
  }
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const expectedId = providerCreationId(await tenantId(page), keys[0]!)
  expect((await providers(page)).filter((provider) => provider.id === expectedId)).toHaveLength(1)
  await page.setViewportSize({ width: 844, height: 390 })
  const reveal = page.getByRole('dialog', { name: 'Connect your session' })
  await reveal.getByRole('button', { name: 'Copy bootstrap prompt', exact: true }).click()
  await expect(reveal.getByRole('button', { name: 'Done', exact: true })).toBeEnabled()
  await reveal.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(reveal).toHaveCount(0)
})

test('a committed Session provider with a lost response recovers its secret without duplication', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const label = `Recovered relay ${Date.now().toString(36)}`
  const keys: string[] = []
  let attempts = 0
  await page.route('**/api/v1/providers', async (route) => {
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

  const dialog = await openSessionProviderDialog(page, label)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Connect your session' })).toBeVisible()
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const expectedId = providerCreationId(await tenantId(page), keys[0]!)
  expect((await providers(page)).filter((provider) => provider.id === expectedId)).toHaveLength(1)
  await expect(page.locator('[data-provider-creation="failed"]')).toHaveCount(0)
})

test('Session provider creation is ready when the New provider form is usable', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const label = `Ready relay ${Date.now().toString(36)}`
  const pageErrors: Error[] = []
  const runtimeRequests: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error))

  const dialog = await openSessionProviderDialog(page, label)
  await page.route('**/src/controller/providerCreationMutationRuntime.ts*', async (route) => {
    runtimeRequests.push(route.request().url())
    await route.abort()
  })

  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Connect your session' })).toBeVisible()
  expect(pageErrors).toHaveLength(0)
  expect(runtimeRequests).toHaveLength(0)
})

async function verifyProviderFormLoading(page: Page, ceremony: 'New provider' | 'Update connection') {
  test.setTimeout(ms(90_000))
  let path = '/models'
  if (ceremony === 'Update connection') {
    const created = await page.request.post('/api/v1/providers', {
      data: { label: `Lazy connection ${Date.now()}`, modelFamily: 'claude', effortLevels: [] },
    })
    expect(created.ok()).toBe(true)
    path = `/models/${(await created.json()).id}`
  }
  const moduleUrl = '**/src/components/ProviderDialogs.tsx*'
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let routeFinished!: () => void
  const routeComplete = new Promise<void>(resolve => { routeFinished = resolve })
  let moduleRequests = 0
  let writes = 0
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname === '/src/components/ProviderDialogs.tsx') moduleRequests++
    if (['POST', 'PATCH'].includes(request.method()) && /^\/api\/v1\/providers(?:\/[^/]+\/connection)?$/.test(url.pathname)) writes++
  })
  await page.route(moduleUrl, async route => {
    await held
    try { await route.abort() } finally { routeFinished() }
  })
  const open = async () => {
    await page.getByRole('button', { name: ceremony, exact: true }).click()
    return page.getByRole('dialog', { name: ceremony, exact: true })
  }
  try {
    await page.goto(path)
    await expect(page.getByRole('button', { name: ceremony, exact: true })).toBeVisible()
    expect(moduleRequests, 'section boot must not load provider forms').toBe(0)
    const loading = await open()
    await expect(loading.locator('[data-provider-form-load="loading"]')).toHaveAttribute('role', 'status')
    await expect(loading.getByRole('button', { name: 'Loading…', exact: true })).toBeDisabled()
    await expect(loading.getByRole('textbox')).toHaveCount(0)
    await expect(loading.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(loading.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expectContainedDialog(page, loading)
      await capture(page, `${ceremony}-loading-${viewport.width}x${viewport.height}`)
    }
    await page.keyboard.press('Escape')
    await expect(loading).toHaveCount(0)
    release()
    await routeComplete
    const failed = await open()
    await expect(failed.locator('[data-provider-form-load="failed"]')).toHaveAttribute('role', 'alert')
    await expect(failed.getByRole('alert')).toContainText(/unsent.*text/i)
    await expect(failed.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await expect(failed.getByRole('textbox')).toHaveCount(0)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expectContainedDialog(page, failed)
      await capture(page, `${ceremony}-failed-${viewport.width}x${viewport.height}`)
    }
    await failed.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(failed).toHaveCount(0)
    await page.unroute(moduleUrl)
    const stillFailed = await open()
    await expect(stillFailed.locator('[data-provider-form-load="failed"]')).toBeVisible()
    expect(moduleRequests).toBe(1)
    expect(writes, 'loading, dismissal and failure cannot submit provider intent').toBe(0)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      stillFailed.getByRole('button', { name: 'Reload app', exact: true }).click(),
    ])
    const recovered = await open()
    await expect(recovered.getByRole('textbox', { name: ceremony === 'New provider' ? 'Name' : /^Model ID/, exact: ceremony === 'New provider' })).toBeVisible()
    expect(moduleRequests).toBe(2)
    expect(writes).toBe(0)
    await recovered.getByRole('button', { name: 'Cancel', exact: true }).click()
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
}

test('New provider loads on demand with bounded, dismissible failure and explicit reload recovery', async ({ page }) => {
  await verifyProviderFormLoading(page, 'New provider')
})

test('Update connection loads on demand with bounded, dismissible failure and explicit reload recovery', async ({ page }) => {
  await verifyProviderFormLoading(page, 'Update connection')
})
